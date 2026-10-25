import { EventEmitter } from 'node:events';
import { createProvider, listStatuses } from '../providers/registry.js';
import { statusLabel } from '../providers/status.js';
import type {
  ModelProvider,
  ProviderContext,
  ProviderId,
  ProviderStatus,
} from '../providers/types.js';
import type {
  AskUserOutcome,
  AskUserRequest,
  PendingToolAction,
  ToolDefinition,
} from '../tools/types.js';
import { approvalModeInfo, nextApprovalMode } from '../tools/approval.js';
import type { ApprovalMode } from '../tools/approval.js';
import { answerText } from '../tools/askUser.js';
import { askUserReducer, initialAskUserFlow } from '../setup/askUserFlow.js';
import type { AskUserFlowState, AskUserKey } from '../setup/askUserFlow.js';
import { formatError, MaestroError } from '../utils/errors.js';
import { noopLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import { PROVIDER_IDS } from '../config/schema.js';
import { loadSettings } from '../config/loader.js';
import type { CredentialSource } from '../config/loader.js';
import type { Settings } from '../config/schema.js';
import { readRawSettings, writeSettings as writeSettingsFile } from '../config/writer.js';
import type { SettingsPatchEntry, WriteResult } from '../config/writer.js';
import { learnModelPatch, modelCatalog } from '../config/models.js';
import type { DialogState } from '../setup/dialog.js';
import { SetupDriver } from '../setup/driver.js';
import type { SetupDeps } from '../setup/driver.js';
import { DEFAULT_COMMANDS, executeSlash } from './commands.js';
import type { SlashCommand } from './commands.js';
import type { InputHistory } from './history.js';
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

export interface SettingsPaths {
  globalPath: string;
  cwd: string;
}

export interface LoadedSettingsLike {
  settings: Settings;
  credentialSources: Record<ProviderId, CredentialSource>;
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
  /** Where settings are persisted by /auth and /model (absent → in-memory only). */
  settingsPaths?: SettingsPaths;
  env?: NodeJS.ProcessEnv;
  /** Test seam: custom provider instances by id. */
  providerOverride?: (id: ProviderId) => ModelProvider | undefined;
  /** Test seams for the setup flows (connection test, `ant` CLI). */
  setupDeps?: Partial<SetupDeps>;
  /** Test seam: replaces the settings writer/loader. */
  settingsWriter?: (patch: SettingsPatchEntry[]) => WriteResult;
  settingsLoader?: () => LoadedSettingsLike;
  /** Persistent input history (interactive only; absent in `-p`). See contracts/history.md. */
  history?: InputHistory;
}

/** In interactive mode the UI answers through controller.confirm(); the promise itself never settles. */
const waitForUi = () => new Promise<boolean>(() => {});

export interface ControllerEvents {
  change: [];
  exit: [];
}

/** Glue between Session, providers, tools, dialogs and the UI (interactive or non-interactive). */
export class SessionController extends EventEmitter<ControllerEvents> {
  readonly session: Session;
  readonly commands: SlashCommand[];
  readonly tools: ToolDefinition[];
  readonly system: string;
  readonly debug: boolean;
  readonly interactive: boolean;
  readonly logger: Logger;
  readonly env: NodeJS.ProcessEnv;
  readonly settingsPaths?: SettingsPaths;
  readonly history?: InputHistory;
  private ctx: ProviderContext;
  private readonly providerOverride?: (id: ProviderId) => ModelProvider | undefined;
  private readonly settingsWriter?: (patch: SettingsPatchEntry[]) => WriteResult;
  private readonly settingsLoader?: () => LoadedSettingsLike;
  private readonly setupDeps: Partial<SetupDeps>;
  private provider?: ModelProvider;
  private noticeSeq = 0;
  private setupDriver?: SetupDriver;

  partialText = '';
  notices: Notice[] = [];
  lastUsage = { inputTokens: 0, outputTokens: 0 };
  /** Open modal dialog (/auth, /model), if any. */
  dialog?: DialogState;
  /**
   * Live approval mode (contracts/approval-modes.md). Starts from settings.tools.approvalMode;
   * Tab and /approval-mode change it for this session only — never written back.
   */
  approvalMode: ApprovalMode;
  /** Short-lived status-bar message (e.g. after a mode change); `seq` lets the UI expire it. */
  transient?: { text: string; seq: number };
  private transientSeq = 0;
  /** `ask_user` dialog state while `session.state === 'awaiting_answer'` (contracts/ask-user.md). */
  questionFlow?: AskUserFlowState;

  constructor(opts: ControllerOptions) {
    super();
    this.session = opts.session;
    this.ctx = { ...opts.ctx, activeId: opts.session.activeProviderId, unverified: new Set() };
    this.approvalMode = opts.ctx.settings.tools.approvalMode;
    this.tools = opts.tools;
    this.system = opts.system;
    this.debug = opts.debug ?? false;
    this.interactive = opts.interactive ?? true;
    this.logger = opts.logger ?? noopLogger;
    this.env = opts.env ?? opts.ctx.env ?? process.env;
    this.settingsPaths = opts.settingsPaths;
    this.commands = opts.commands ?? DEFAULT_COMMANDS;
    this.providerOverride = opts.providerOverride;
    this.settingsWriter = opts.settingsWriter;
    this.settingsLoader = opts.settingsLoader;
    this.setupDeps = opts.setupDeps ?? {};
    this.history = opts.history;
    this.session.on('change', () => this.emit('change'));
  }

  /** Read-only view of the provider context (settings, credential sources, active id). */
  get context(): ProviderContext {
    return this.ctx;
  }

  get settings(): Settings {
    return this.ctx.settings;
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

  /** Lazily created driver for the /auth and /model dialogs. */
  get setup(): SetupDriver {
    if (!this.setupDriver) this.setupDriver = new SetupDriver(this, this.setupDeps);
    return this.setupDriver;
  }

  statuses(): ProviderStatus[] {
    return listStatuses({ ...this.ctx, activeId: this.session.activeProviderId });
  }

  // ---------------------------------------------------------------- approval mode

  /** Tab / Shift+Tab: next or previous mode in the cycle (session only). */
  cycleApprovalMode(dir: 1 | -1): ApprovalMode {
    this.setApprovalMode(nextApprovalMode(this.approvalMode, dir));
    return this.approvalMode;
  }

  setApprovalMode(mode: ApprovalMode): void {
    this.approvalMode = mode;
    this.logger.log('approval.mode', { mode });
    this.showTransient(`modo: ${approvalModeInfo(mode).label}`);
  }

  showTransient(text: string): void {
    this.transient = { text, seq: ++this.transientSeq };
    this.emit('change');
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
      const unverified = s.verified === false ? '  (not verified)' : '';
      return `  ${s.id.padEnd(7)} ${label.padEnd(15)} ${model.padEnd(24)} ${cred}${extra}${unverified}`;
    });
    // Catalogue per provider; `*` marks the active model (contracts/model-catalog.md § 3).
    const models = PROVIDER_IDS.map((id) => {
      const list = modelCatalog(this.ctx.settings, id).map((m) =>
        id === this.session.activeProviderId && m === this.activeModel ? `* ${m}` : m,
      );
      return `  ${`${id}:`.padEnd(8)}${list.join(', ')}`;
    });
    return [
      `Active: ${this.session.activeProviderId} / ${this.activeModel}`,
      '',
      '  id      status          model                    credentials',
      ...rows,
      '',
      'Models:',
      ...models,
    ].join('\n');
  }

  /**
   * Patch that adds `model` to `providers.<id>.models` of the global file when missing
   * (`[]` when already listed or without settings paths). Reads the raw global file so a
   * project-level list is never copied into it (research R6).
   */
  rememberModel(id: ProviderId, model: string): SettingsPatchEntry[] {
    if (!this.settingsPaths) return [];
    try {
      return learnModelPatch(readRawSettings(this.settingsPaths.globalPath), id, model);
    } catch {
      return [];
    }
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

  // ---------------------------------------------------------------- settings persistence

  /** Writes a patch to the global settings file (or no-op when running without paths). */
  writeSettings(patch: SettingsPatchEntry[]): WriteResult {
    if (this.settingsWriter) return this.settingsWriter(patch);
    if (!this.settingsPaths) return { path: '(memory)', overriddenByProject: [] };
    const result = writeSettingsFile(patch, this.settingsPaths);
    this.logger.log('settings.write', { paths: patch.map((p) => p.path), file: result.path });
    return result;
  }

  /** Re-reads settings from disk (or the injected loader) and applies them to the live context. */
  reloadSettings(): void {
    let loaded: LoadedSettingsLike | undefined;
    if (this.settingsLoader) loaded = this.settingsLoader();
    else if (this.settingsPaths) {
      loaded = loadSettings({
        configPath: this.settingsPaths.globalPath,
        cwd: this.settingsPaths.cwd,
        env: this.env,
      });
    }
    if (loaded) this.applySettings(loaded);
  }

  /** Replaces settings/credential sources in memory; the cached provider is rebuilt lazily. */
  applySettings(loaded: LoadedSettingsLike): void {
    this.ctx = {
      ...this.ctx,
      settings: loaded.settings,
      credentialSources: loaded.credentialSources,
    };
    this.provider = undefined;
    this.emit('change');
  }

  /** Persists the active provider (and optionally its model) after a switch. */
  persistActive(model?: string): void {
    const id = this.session.activeProviderId;
    const patch: SettingsPatchEntry[] = [{ path: 'activeProvider', value: id }];
    if (model) {
      patch.push({ path: `providers.${id}.model`, value: model });
      patch.push(...this.rememberModel(id, model)); // `/model <id> <modelo>` also learns the name
    }
    try {
      this.writeSettings(patch);
      this.reloadSettings();
    } catch (err) {
      const e =
        err instanceof MaestroError
          ? err
          : new MaestroError({ category: 'unknown', message: String(err) });
      this.notice(`Não foi possível gravar a configuração: ${e.message}`, 'warn');
    }
  }

  markUnverified(id: ProviderId): void {
    this.ctx.unverified?.add(id);
    this.emit('change');
  }

  // ---------------------------------------------------------------- dialogs

  /** Opens a modal dialog; refused while a response is in progress or another dialog is open. */
  openDialog(state: DialogState): boolean {
    if (this.dialog) return false;
    if (this.session.state !== 'idle') {
      this.notice('Aguarde a resposta terminar antes de abrir um diálogo.', 'warn');
      return false;
    }
    this.dialog = state;
    this.emit('change');
    return true;
  }

  setDialog(state: DialogState): void {
    this.dialog = state;
    this.emit('change');
  }

  closeDialog(): void {
    this.dialog = undefined;
    this.emit('change');
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
    this.setupDriver?.abort();
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

  // ---------------------------------------------------------------- ask_user

  /** `ctx.ask` for interactive sessions: parks the question in the session until the UI answers. */
  private readonly askUser = (request: AskUserRequest): Promise<AskUserOutcome> =>
    new Promise((resolve) => {
      this.questionFlow = initialAskUserFlow(request.questions);
      this.session.setPendingQuestion({
        request,
        resolve: (outcome) => {
          this.questionFlow = undefined;
          resolve(outcome);
        },
      });
    });

  /** Routes a dialog key to the ask_user reducer; done/cancelled resolve the pending question. */
  dispatchQuestion(key: AskUserKey): void {
    const pending = this.session.pendingQuestion;
    const flow = this.questionFlow;
    if (!pending || !flow) return;
    const next = askUserReducer(flow, key);
    if (next.step === 'question') {
      this.questionFlow = next;
      this.emit('change');
      return;
    }
    const { questions } = pending.request;
    if (next.step === 'done') {
      // Transcript shows the choices as the user's words; logs never record the text (FR-018).
      next.answers.forEach((a, i) => {
        this.notice(`› [${questions[i]?.header ?? i + 1}] ${answerText(a)}`, 'info');
      });
      this.logger.log('ask_user.answered', {
        questions: questions.length,
        other: next.answers.filter((a) => a.kind === 'other').length,
      });
      this.session.setPendingQuestion(undefined);
      pending.resolve({ answered: true, answers: next.answers });
    } else {
      this.logger.log('ask_user.declined', { questions: questions.length });
      this.session.setPendingQuestion(undefined);
      pending.resolve({ answered: false });
    }
  }

  /** Handles one line of user input: slash command or chat message. */
  async submit(
    input: string,
    opts: {
      confirm?: (a: Omit<PendingToolAction, 'resolve'>) => Promise<boolean>;
      onDelta?: (text: string) => void;
    } = {},
  ): Promise<TurnResult | undefined> {
    if (this.dialog) {
      this.notice('Feche o diálogo (Esc) antes de enviar mensagens.', 'warn');
      return undefined;
    }
    // Recorded before executing so that /clear and /exit are kept too (contracts/history.md § 2).
    this.history?.push(input);
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
    let autoNoted = false; // onAutoApproved already announced the tool; skip the plain ⚙ line
    const result = await runTurn(
      this.session,
      provider,
      {
        system: this.system,
        tools: this.tools,
        toolSettings: this.ctx.settings.tools,
        approvalMode: () => this.approvalMode,
      },
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
        // FR-005: an action that ran without asking is announced with the same summary the dialog shows.
        onAutoApproved: (name, input, summary, mode) => {
          autoNoted = true;
          this.logger.log('approval.auto', { tool: name, mode });
          const target = summarizeInput(input);
          this.notice(
            `⚙ ${name}${target ? ` ${target}` : ''}  ·  ${summary}  ·  auto (${approvalModeInfo(mode).label})`,
            'info',
          );
        },
        onToolStart: (name, input) => {
          if (autoNoted) {
            autoNoted = false;
            return;
          }
          this.notice(`⚙ ${name} ${summarizeInput(input)}`, 'info');
        },
        onToolEnd: (name, r) => {
          if (r.isError) this.notice(`⚠ ${name}: ${firstLine(r.output)}`, 'warn');
          this.partialText = '';
        },
        confirm: opts.confirm ?? (this.interactive ? waitForUi : undefined),
        ask: this.interactive ? this.askUser : undefined,
      },
    );
    this.partialText = '';
    this.lastUsage = result.usage;
    if (result.stopReason !== 'error') this.ctx.unverified?.delete(provider.id);
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
