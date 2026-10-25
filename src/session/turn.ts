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
  ToolResultDisplay,
} from '../tools/types.js';
import type { FileDiff } from '../tools/diff.js';
import { MaestroError } from '../utils/errors.js';
import type { Session } from './session.js';
import { DEFAULTS } from '../config/defaults.js';

/** Fallback when the caller passes no `maxToolIterations` (the controller passes `tools.maxToolIterations`). */
export const MAX_TOOL_ITERATIONS = DEFAULTS.tools.maxToolIterations;

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
  /** Every `usage` event as it arrives (specs/009 research R4: live token count). */
  onUsage?: (inputTokens: number, outputTokens: number) => void;
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
        cb.onUsage?.(ev.inputTokens, ev.outputTokens);
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

  // Diff of what the call will change, taken once before it runs (specs/009 contracts/diff-view.md § 5).
  let diff: FileDiff | undefined;
  if (tool.diff) {
    try {
      diff = await tool.diff(input, ctx);
    } catch {
      diff = undefined; // the preview/run report the problem themselves
    }
  }
  const display: ToolResultDisplay = {};
  if (diff) display.diff = diff;

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
          diff,
          resolve,
        };
        session.setPendingConfirmation(action);
        cb.confirm!(action).then(resolve, () => resolve(false));
      });
      session.setPendingConfirmation(undefined);
      if (!approved) return { isError: true, output: 'user declined', display: { declined: true } };
    } else {
      display.autoMode = mode;
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
  if (Object.keys(display).length > 0)
    result = { ...result, display: { ...display, ...result.display } };
  cb.onToolEnd?.(tool.name, result);
  return result;
}

/**
 * Tool calls allowed per `maxToolIterations` when the provider drives the loop itself (it calls
 * tools one at a time, while the built-in loop counts batches).
 */
export const CALLS_PER_ITERATION = 5;

interface DrivenTurnState {
  ac: AbortController;
  usage: { inputTokens: number; outputTokens: number };
  toolMap: Map<string, ToolDefinition>;
  toolCtx: ToolContext;
  maxCalls: number;
}

/**
 * Turn for providers with `capabilities.executesTools` (specs/010 research R4): the provider
 * runs its own loop and calls `runTool`. Calls are serialized so the history keeps the usual
 * assistant(tool_call) → tool(result) alternation and confirmations never overlap; each call
 * goes through `executeTool` exactly like the built-in loop.
 */
async function runProviderDrivenTurn(
  session: Session,
  provider: ModelProvider,
  opts: TurnOptions,
  cb: TurnCallbacks,
  st: DrivenTurnState,
): Promise<TurnResult> {
  const model = opts.model ?? session.modelOverride;
  let pending = '';
  let fullText = '';
  let calls = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const runOne = async (tc: {
    callId: string;
    name: string;
    input: unknown;
  }): Promise<ToolResult> => {
    if (st.ac.signal.aborted) return { output: 'cancelled by user', isError: true };
    calls += 1;
    const parts: ContentPart[] = pending ? [{ type: 'text', text: pending }] : [];
    pending = '';
    parts.push({ type: 'tool_call', callId: tc.callId, name: tc.name, input: tc.input });
    session.pushAssistant(parts, provider.id, model, opts.route);

    let result: ToolResult;
    const tool = st.toolMap.get(tc.name);
    if (!tool) {
      result = { output: `unknown tool: ${tc.name}`, isError: true };
    } else if (calls > st.maxCalls) {
      if (calls === st.maxCalls + 1)
        cb.onNotice?.(`stopped after ${st.maxCalls} tool calls in one turn`, 'warn');
      result = {
        output: `tool call limit (${st.maxCalls}) reached for this turn; answer with what you have`,
        isError: true,
      };
    } else {
      result = await executeTool(tool, tc.callId, tc.input, st.toolCtx, session, cb, opts);
    }
    session.pushToolResults([{ callId: tc.callId, ...result }]);
    return result;
  };

  const runTool = (tc: { callId: string; name: string; input: unknown }) => {
    const next = queue.then(() => runOne(tc));
    queue = next.catch(() => undefined);
    return next;
  };

  try {
    const collected = await collect(
      provider.stream({
        messages: [...session.history],
        system: opts.system,
        tools: opts.tools,
        model,
        overrides: opts.overrides,
        signal: st.ac.signal,
        runTool,
      }),
      {
        ...cb,
        onDelta: (t) => {
          pending += t;
          fullText += t;
          cb.onDelta?.(t);
        },
      },
      st.usage,
    );
    await queue;

    if (collected.error) {
      if (pending)
        session.pushAssistant([{ type: 'text', text: pending }], provider.id, model, opts.route);
      cb.onError?.(collected.error);
      return {
        stopReason: 'error',
        text: fullText,
        error: collected.error,
        usage: st.usage,
        toolIterations: calls,
      };
    }
    // Same as the built-in loop: the final text, if any, closes the turn (empty parts are ignored).
    session.pushAssistant(
      pending ? [{ type: 'text', text: pending }] : [],
      provider.id,
      model,
      opts.route,
    );
    if (st.ac.signal.aborted || collected.stop === 'cancelled')
      return { stopReason: 'cancelled', text: fullText, usage: st.usage, toolIterations: calls };
    if (collected.stop === 'max_tokens')
      cb.onNotice?.('response truncated (max_tokens reached)', 'warn');
    if (collected.stop === 'refusal')
      cb.onNotice?.(
        `the provider declined this request${collected.detail ? `: ${collected.detail}` : ''}`,
        'warn',
      );
    return {
      stopReason: collected.stop ?? 'end_turn',
      text: fullText,
      usage: st.usage,
      toolIterations: calls,
    };
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
    return {
      stopReason: 'error',
      text: fullText,
      error: me,
      usage: st.usage,
      toolIterations: calls,
    };
  } finally {
    session.endGeneration();
  }
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
  if (provider.capabilities?.executesTools) {
    return runProviderDrivenTurn(session, provider, opts, cb, {
      ac,
      usage,
      toolMap,
      toolCtx,
      maxCalls: maxIter * CALLS_PER_ITERATION,
    });
  }
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
        const results: Array<{ callId: string } & ToolResult> = [];
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
