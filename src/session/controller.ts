import { EventEmitter } from 'node:events';
import { createProvider, listStatuses } from '../providers/registry.js';
import { statusLabel } from '../providers/status.js';
import type {
  ModelProvider,
  ProviderContext,
  ProviderId,
  ProviderStatus,
} from '../providers/types.js';
import type { PendingToolAction, ToolDefinition } from '../tools/types.js';
import { formatError, MaestroError } from '../utils/errors.js';
import { noopLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import { PROVIDER_IDS } from '../config/schema.js';
import { DEFAULT_COMMANDS, executeSlash } from './commands.js';
import type { SlashCommand } from './commands.js';
import type { Session } from './session.js';
import { SessionBusyError } from './session.js';
import { runTurn } from './turn.js';
import type { TurnResult } from './turn.js';

export type NoticeLevel = 'info' | 'warn' | 'error';

export interface Notice {
  id: number;
  level: NoticeLevel;
  text: string;
  /** Index in `session.history` after which this notice was emitted. */
  position: number;
}

export interface ControllerOptions {
  session: Session;
  ctx: ProviderContext;
  tools: ToolDefinition[];
  system: string;
  debug?: boolean;
  /** Interactive sessions can ask the user to confirm tool actions; non-interactive ones auto-decline. */
  interactive?: boolean;
  logger?: Logger;
  commands?: SlashCommand[];
  /** Test seam: custom provider instances by id. */
  providerOverride?: (id: ProviderId) => ModelProvider | undefined;
}

/** In interactive mode the UI answers through controller.confirm(); the promise itself never settles. */
const waitForUi = () => new Promise<boolean>(() => {});

export interface ControllerEvents {
  change: [];
  exit: [];
}

/** Glue between Session, providers, tools and the UI (interactive or non-interactive). */
export class SessionController extends EventEmitter<ControllerEvents> {
  readonly session: Session;
  readonly commands: SlashCommand[];
  readonly tools: ToolDefinition[];
  readonly system: string;
  readonly debug: boolean;
  readonly interactive: boolean;
  readonly logger: Logger;
  private readonly ctx: ProviderContext;
  private readonly providerOverride?: (id: ProviderId) => ModelProvider | undefined;
  private provider?: ModelProvider;
  private noticeSeq = 0;

  partialText = '';
  notices: Notice[] = [];
  lastUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(opts: ControllerOptions) {
    super();
    this.session = opts.session;
    this.ctx = { ...opts.ctx, activeId: opts.session.activeProviderId };
    this.tools = opts.tools;
    this.system = opts.system;
    this.debug = opts.debug ?? false;
    this.interactive = opts.interactive ?? true;
    this.logger = opts.logger ?? noopLogger;
    this.commands = opts.commands ?? DEFAULT_COMMANDS;
    this.providerOverride = opts.providerOverride;
    this.session.on('change', () => this.emit('change'));
  }

  get activeProvider(): ModelProvider {
    if (!this.provider) {
      const id = this.session.activeProviderId;
      this.provider = this.providerOverride?.(id) ?? createProvider(id, this.ctx);
    }
    return this.provider;
  }

  get activeModel(): string {
    return (
      this.session.modelOverride ?? this.ctx.settings.providers[this.session.activeProviderId].model
    );
  }

  statuses(): ProviderStatus[] {
    return listStatuses({ ...this.ctx, activeId: this.session.activeProviderId });
  }

  notice(text: string, level: NoticeLevel = 'info'): void {
    this.notices.push({ id: ++this.noticeSeq, level, text, position: this.session.history.length });
    this.emit('change');
  }

  describeProviders(): string {
    const rows = this.statuses().map((s) => {
      const label = statusLabel(s);
      const model = s.id === this.session.activeProviderId ? this.activeModel : s.model;
      const cred =
        s.credentialSource === 'none'
          ? '-'
          : s.credentialSource + (s.maskedKey ? ` ${s.maskedKey}` : '');
      const extra = s.missing.length ? `  missing: ${s.missing.join(', ')}` : '';
      return `  ${s.id.padEnd(7)} ${label.padEnd(15)} ${model.padEnd(24)} ${cred}${extra}`;
    });
    return [
      `Active: ${this.session.activeProviderId} / ${this.activeModel}`,
      '',
      '  id      status          model                    credentials',
      ...rows,
    ].join('\n');
  }

  switchProvider(id: ProviderId, model?: string): boolean {
    if (!(PROVIDER_IDS as readonly string[]).includes(id)) {
      this.notice(`Unknown provider '${id}'. Available: ${PROVIDER_IDS.join(', ')}.`, 'warn');
      return false;
    }
    const status = this.statuses().find((s) => s.id === id)!;
    if (!status.enabled) {
      this.notice(
        `Provider '${id}' is disabled in settings.json (providers.${id}.enabled).`,
        'warn',
      );
      return false;
    }
    if (!status.configured) {
      this.notice(
        `Provider '${id}' is not configured (missing: ${status.missing.join(', ')}).${status.hint ? `\n  ${status.hint}` : ''}`,
        'warn',
      );
      return false;
    }
    try {
      this.session.switchProvider(id, model);
    } catch (err) {
      if (err instanceof SessionBusyError) {
        this.notice(err.message, 'warn');
        return false;
      }
      throw err;
    }
    this.provider = undefined;
    this.ctx.activeId = id;
    this.notice(`Switched to ${id} / ${this.activeModel}. Conversation history preserved.`, 'info');
    return true;
  }

  clearConversation(): void {
    try {
      this.session.clear();
      this.notice('Conversation cleared.', 'info');
    } catch (err) {
      if (err instanceof SessionBusyError) this.notice(err.message, 'warn');
      else throw err;
    }
  }

  requestExit(): void {
    this.session.cancel();
    this.emit('exit');
  }

  cancel(): void {
    this.session.cancel();
  }

  /** Resolves a pending tool confirmation (y/n). */
  confirm(approved: boolean): void {
    const pending = this.session.pendingConfirmation;
    if (pending) pending.resolve(approved);
  }

  /** Handles one line of user input: slash command or chat message. */
  async submit(
    input: string,
    opts: {
      confirm?: (a: Omit<PendingToolAction, 'resolve'>) => Promise<boolean>;
      onDelta?: (text: string) => void;
    } = {},
  ): Promise<TurnResult | undefined> {
    if (await executeSlash(input, this)) return undefined;
    if (this.session.state !== 'idle') {
      this.notice('A response is still in progress. Press Esc to cancel it first.', 'warn');
      return undefined;
    }
    if (!this.session.pushUser(input)) return undefined;

    this.partialText = '';
    const provider = this.activeProvider;
    this.logger.log('turn.start', {
      provider: provider.id,
      model: this.activeModel,
      messages: this.session.history.length,
      tools: this.tools.map((t) => t.name),
    });
    const startedAt = Date.now();
    const result = await runTurn(
      this.session,
      provider,
      { system: this.system, tools: this.tools, toolSettings: this.ctx.settings.tools },
      {
        onDelta: (t) => {
          this.partialText += t;
          opts.onDelta?.(t);
          this.emit('change');
        },
        onNotice: (text, level) => this.notice(text, level),
        onError: (err) => {
          this.logger.log('turn.error', {
            provider: provider.id,
            category: err.category,
            message: err.message,
            cause: err.cause,
          });
          this.notice(formatError(err, { debug: this.debug }), 'error');
        },
        onToolStart: (name, input) => this.notice(`⚙ ${name} ${summarizeInput(input)}`, 'info'),
        onToolEnd: (name, r) => {
          if (r.isError) this.notice(`⚠ ${name}: ${firstLine(r.output)}`, 'warn');
          this.partialText = '';
        },
        confirm: opts.confirm ?? (this.interactive ? waitForUi : undefined),
      },
    );
    this.partialText = '';
    this.lastUsage = result.usage;
    this.logger.log('turn.end', {
      provider: provider.id,
      stopReason: result.stopReason,
      durationMs: Date.now() - startedAt,
      usage: result.usage,
      toolIterations: result.toolIterations,
      chars: result.text.length,
    });
    this.emit('change');
    return result;
  }
}

function summarizeInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const o = input as Record<string, unknown>;
  const key = 'path' in o ? o['path'] : 'command' in o ? o['command'] : undefined;
  return key !== undefined ? String(key) : '';
}

function firstLine(s: string): string {
  return s.split('\n')[0] ?? '';
}

export { MaestroError };
