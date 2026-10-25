import type {
  ContentPart,
  ModelProvider,
  ProviderEvent,
  ProviderRequest,
  StopReason,
} from '../providers/types.js';
import { classifyAction, needsConfirmation } from '../tools/approval.js';
import type { ApprovalMode } from '../tools/approval.js';
import type {
  AskUserOutcome,
  AskUserRequest,
  PendingToolAction,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from '../tools/types.js';
import { MaestroError } from '../utils/errors.js';
import type { Session } from './session.js';

export const MAX_TOOL_ITERATIONS = 10;

export interface TurnCallbacks {
  onDelta?: (text: string) => void;
  onNotice?: (text: string, level: 'info' | 'warn') => void;
  onError?: (err: MaestroError) => void;
  /** Called for tool calls that require confirmation in the current mode. Resolve true to approve. */
  confirm?: (action: Omit<PendingToolAction, 'resolve'>) => Promise<boolean>;
  /** Called by `ask_user`; absent in non-interactive runs (contracts/ask-user.md § 4). */
  ask?: (request: AskUserRequest) => Promise<AskUserOutcome>;
  /** An edit/command ran without confirmation because of the approval mode (FR-005). */
  onAutoApproved?: (name: string, input: unknown, summary: string, mode: ApprovalMode) => void;
  onToolStart?: (name: string, input: unknown) => void;
  onToolEnd?: (name: string, result: ToolResult) => void;
}

export interface TurnOptions {
  system: string;
  tools: ToolDefinition[];
  toolSettings: ToolContext['settings'];
  /** Live approval mode; a getter so Tab during the turn affects the next tool call. */
  approvalMode?: () => ApprovalMode;
  /**
   * Runs before the approval policy; a defined result replaces the tool call entirely
   * (Spec Kit scripts executed natively, specs/006 contracts/native-steps.md § 1).
   */
  intercept?: (tool: ToolDefinition, input: unknown) => Promise<ToolResult | undefined>;
  maxToolIterations?: number;
  /** Model of the route for this turn (specs/008); defaults to `session.modelOverride`. */
  model?: string;
  overrides?: ProviderRequest['overrides'];
  /** Route name recorded on the assistant messages (absent = chat). */
  route?: string;
}

export interface TurnResult {
  stopReason: StopReason | 'error';
  text: string;
  error?: MaestroError;
  usage: { inputTokens: number; outputTokens: number };
  toolIterations: number;
}

interface Collected {
  text: string;
  toolCalls: Array<{ callId: string; name: string; input: unknown }>;
  stop?: StopReason;
  detail?: string;
  error?: MaestroError;
  usage: { inputTokens: number; outputTokens: number };
}

async function collect(
  events: AsyncIterable<ProviderEvent>,
  cb: TurnCallbacks,
  usage: { inputTokens: number; outputTokens: number },
): Promise<Collected> {
  const c: Collected = { text: '', toolCalls: [], usage };
  for await (const ev of events) {
    switch (ev.type) {
      case 'text_delta':
        c.text += ev.text;
        cb.onDelta?.(ev.text);
        break;
      case 'tool_call':
        c.toolCalls.push({ callId: ev.callId, name: ev.name, input: ev.input });
        break;
      case 'usage':
        usage.inputTokens += ev.inputTokens;
        usage.outputTokens += ev.outputTokens;
        break;
      case 'done':
        c.stop = ev.stopReason;
        c.detail = ev.detail;
        return c;
      case 'error':
        c.error = ev.error;
        return c;
    }
  }
  // Provider ended without a terminal event — treat as end_turn.
  c.stop = 'end_turn';
  return c;
}

async function previewOf(tool: ToolDefinition, input: unknown, ctx: ToolContext): Promise<string> {
  try {
    return tool.preview ? await tool.preview(input, ctx) : JSON.stringify(input, null, 2);
  } catch (err) {
    return `(preview unavailable: ${err instanceof Error ? err.message : String(err)})`;
  }
}

function firstLine(s: string): string {
  return s.split('\n')[0] ?? '';
}

async function executeTool(
  tool: ToolDefinition,
  callId: string,
  rawInput: unknown,
  ctx: ToolContext,
  session: Session,
  cb: TurnCallbacks,
  opts: TurnOptions,
): Promise<ToolResult> {
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      isError: true,
      output: `invalid input for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    };
  }
  const input = parsed.data;

  if (opts.intercept) {
    const intercepted = await opts.intercept(tool, input);
    if (intercepted) return intercepted;
  }

  // Approval policy (contracts/approval-modes.md): read/question never ask; the rest depends on the mode.
  const { kind, reason } = classifyAction(tool, input);
  if (kind !== 'read' && kind !== 'question') {
    const mode = opts.approvalMode?.() ?? 'default';
    const previewText = await previewOf(tool, input, ctx);
    if (needsConfirmation(mode, kind)) {
      if (!cb.confirm) {
        return {
          isError: true,
          output: `confirmation required (${mode}); not available in non-interactive mode`,
        };
      }
      const approved = await new Promise<boolean>((resolve) => {
        const action: PendingToolAction = {
          callId,
          tool,
          input,
          previewText,
          reason,
          mode,
          resolve,
        };
        session.setPendingConfirmation(action);
        cb.confirm!(action).then(resolve, () => resolve(false));
      });
      session.setPendingConfirmation(undefined);
      if (!approved) return { isError: true, output: 'user declined' };
    } else {
      cb.onAutoApproved?.(tool.name, input, firstLine(previewText), mode);
    }
  }

  cb.onToolStart?.(tool.name, input);
  let result: ToolResult;
  try {
    result = await tool.run(input, ctx);
  } catch (err) {
    result = {
      isError: true,
      output: `tool failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  cb.onToolEnd?.(tool.name, result);
  return result;
}

/**
 * Runs one user turn against the active provider, including the tool loop
 * (contracts/provider-interface.md § 3). The user message must already be in `session.history`.
 */
export async function runTurn(
  session: Session,
  provider: ModelProvider,
  opts: TurnOptions,
  cb: TurnCallbacks = {},
): Promise<TurnResult> {
  const ac = session.beginGeneration();
  const usage = { inputTokens: 0, outputTokens: 0 };
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]));
  const toolCtx: ToolContext = {
    cwd: session.cwd,
    signal: ac.signal,
    settings: opts.toolSettings,
    ask: cb.ask,
  };
  const maxIter = opts.maxToolIterations ?? MAX_TOOL_ITERATIONS;
  let iterations = 0;
  let fullText = '';
  // Route model (specs/008) or the session override (--model / `/model claude x`).
  const model = opts.model ?? session.modelOverride;

  try {
    for (;;) {
      const collected = await collect(
        provider.stream({
          messages: [...session.history],
          system: opts.system,
          tools: opts.tools,
          model,
          overrides: opts.overrides,
          signal: ac.signal,
        }),
        cb,
        usage,
      );
      fullText += collected.text;

      if (collected.error) {
        if (collected.text)
          session.pushAssistant(
            [{ type: 'text', text: collected.text }],
            provider.id,
            model,
            opts.route,
          );
        cb.onError?.(collected.error);
        return {
          stopReason: 'error',
          text: fullText,
          error: collected.error,
          usage,
          toolIterations: iterations,
        };
      }

      const parts: ContentPart[] = [];
      if (collected.text) parts.push({ type: 'text', text: collected.text });

      if (collected.stop === 'tool_use' && collected.toolCalls.length > 0) {
        for (const tc of collected.toolCalls) parts.push({ type: 'tool_call', ...tc });
        session.pushAssistant(parts, provider.id, model, opts.route);

        iterations += 1;
        const results: Array<{ callId: string; output: string; isError: boolean }> = [];
        for (const tc of collected.toolCalls) {
          const tool = toolMap.get(tc.name as ToolDefinition['name']);
          if (!tool) {
            results.push({ callId: tc.callId, output: `unknown tool: ${tc.name}`, isError: true });
            continue;
          }
          if (ac.signal.aborted) {
            results.push({ callId: tc.callId, output: 'cancelled by user', isError: true });
            continue;
          }
          const r = await executeTool(tool, tc.callId, tc.input, toolCtx, session, cb, opts);
          results.push({ callId: tc.callId, ...r });
        }
        session.pushToolResults(results);

        if (ac.signal.aborted)
          return { stopReason: 'cancelled', text: fullText, usage, toolIterations: iterations };
        if (iterations >= maxIter) {
          cb.onNotice?.(`stopped after ${maxIter} tool iterations in one turn`, 'warn');
          return { stopReason: 'end_turn', text: fullText, usage, toolIterations: iterations };
        }
        continue;
      }

      // Terminal stop reasons
      session.pushAssistant(parts, provider.id, model, opts.route);
      switch (collected.stop) {
        case 'max_tokens':
          cb.onNotice?.('response truncated (max_tokens reached)', 'warn');
          break;
        case 'refusal':
          cb.onNotice?.(
            `the provider declined this request${collected.detail ? `: ${collected.detail}` : ''}`,
            'warn',
          );
          break;
        case 'tool_use':
          cb.onNotice?.('the model requested a tool but none are available', 'warn');
          break;
        default:
          break;
      }
      return {
        stopReason: collected.stop ?? 'end_turn',
        text: fullText,
        usage,
        toolIterations: iterations,
      };
    }
  } catch (err) {
    const me =
      err instanceof MaestroError
        ? err
        : new MaestroError({
            category: 'unknown',
            message: err instanceof Error ? err.message : String(err),
            cause: err,
            providerId: provider.id,
          });
    cb.onError?.(me);
    return { stopReason: 'error', text: fullText, error: me, usage, toolIterations: iterations };
  } finally {
    session.endGeneration();
  }
}
