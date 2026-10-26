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
import { PROVIDER_IDS, routesOf } from '../config/schema.js';
import { loadSettings } from '../config/loader.js';
import type { CredentialSource } from '../config/loader.js';
import type { RoutesSettings, RouteTarget, Settings } from '../config/schema.js';
import {
  projectOverrides,
  readRawSettings,
  writeSettings as writeSettingsFile,
} from '../config/writer.js';
import { aliasCommands, guidanceFor, routeEntries } from '../routes/catalog.js';
import type { RouteEntry } from '../routes/catalog.js';
import { fallbackText, resolveRoute } from '../routes/resolve.js';
import type { SettingsPatchEntry, WriteResult } from '../config/writer.js';
import { learnModelPatch, modelCatalog } from '../config/models.js';
import type { DialogState } from '../setup/dialog.js';
import { SetupDriver } from '../setup/driver.js';
import type { SetupDeps } from '../setup/driver.js';
import { DEFAULT_COMMANDS, executeSlash } from './commands.js';
import type { SlashCommand } from './commands.js';
import type { SpecKitService } from '../speckit/service.js';
import type { InputHistory } from './history.js';
import type { Session } from './session.js';
import { SessionBusyError } from './session.js';
import { runTurn } from './turn.js';
import type { TurnResult } from './turn.js';
import { ChipRegistry } from '../ui/chips.js';
import { toolLabel } from '../ui/toolDisplay.js';
import { activityReducer, formatSummary, initialActivity, summarize } from './activity.js';
import type { Activity, ActivityEvent } from './activity.js';
import type { ContentPart } from '../providers/types.js';
import type { Effort } from '../config/schema.js';
import type { StepName } from '../autopilot/types.js';
import { AutopilotDriver, shellVerify } from '../autopilot/driver.js';
import type { AutopilotDeps } from '../autopilot/driver.js';
import { ghRemote } from '../autopilot/remote.js';
import { systemGit, systemGitCommit } from '../speckit/git.js';

/** Status bar line of an autopilot run (specs/011 FR-025). */
export interface AutopilotStatus {
  story: number;
  total: number;
  step: StepName;
}

export type NoticeLevel = 'info' | 'warn' | 'error';

/** What the interactive prompt hands over on Enter (specs/007 data-model.md § 3). */
export interface PromptSubmission {
  /** Text with chip labels (transcript, history.jsonl). */
  display: string;
  /** Text expanded for the model (delimited blocks). */
  text: string;
  /** Extra parts (images). */
  parts: Array<Extract<ContentPart, { type: 'image' }>>;
  /** Attachments refused or changed at send time. */
  warnings: string[];
  /** Chips that were sent, for the debug log (kind and size only). */
  sent?: Array<{ kind: string; lines?: number; bytes?: number }>;
}

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
  /** Native Spec Kit host (commands, script interception); absent → no /speckit.* commands. */
  specKit?: SpecKitService;
  /** Test seams for the autopilot (specs/011): git, remote, verification, clock. */
  autopilotDeps?: Partial<Omit<AutopilotDeps, 'controller'>>;
  /** Test seams for the activity line (specs/009): clock and the waiting-phrase draw. */
  clock?: () => number;
  random?: () => number;
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
  commands: SlashCommand[];
  readonly specKit?: SpecKitService;
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
  private readonly providers = new Map<ProviderId, ModelProvider>();
  /** Built-in + Spec Kit commands, without the route shortcuts (recomputed by refreshCommands). */
  private baseCommands: SlashCommand[];
  /** `chat` route unavailable: warned once per session (contracts/route-resolution.md § 2). */
  private chatWarned = false;
  private noticeSeq = 0;
  private setupDriver?: SetupDriver;

  partialText = '';
  notices: Notice[] = [];
  lastUsage = { inputTokens: 0, outputTokens: 0 };
  /** Activity of the turn in progress (specs/009 US1); undefined when idle. */
  activity?: Activity;
  /** Autopilot run in progress (specs/011); undefined otherwise. */
  autopilotStatus?: AutopilotStatus;
  /** Set by the autopilot driver while a run is active: Esc cancels the whole run (specs/011). */
  autopilotCancel?: () => void;
  /** Per-run replacements installed by `runOverrides` (specs/011 research R3). */
  private overrides: {
    ask?: (request: AskUserRequest) => Promise<AskUserOutcome>;
    confirm?: (action: Omit<PendingToolAction, 'resolve'>) => Promise<boolean>;
  } = {};
  readonly clock: () => number;
  private readonly random: () => number;
  private readonly autopilotDeps: Partial<Omit<AutopilotDeps, 'controller'>>;
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
  /** True when the last slash command refused to run (unknown or missing prerequisites). */
  lastCommandBlocked = false;
  /** Paste/file/image markers of this session (specs/007 contracts/paste-chips.md). */
  readonly chips = new ChipRegistry();
  /** Live mouse tracking state (initial: `ui.mouse`); `/mouse` toggles it for the session. */
  mouseEnabled: boolean;
  /** Route of the turn being generated when it is not `chat` (status bar, specs/008). */
  currentRoute?: string;

  constructor(opts: ControllerOptions) {
    super();
    this.session = opts.session;
    this.ctx = { ...opts.ctx, activeId: opts.session.activeProviderId, unverified: new Set() };
    this.approvalMode = opts.ctx.settings.tools.approvalMode;
    this.mouseEnabled = opts.ctx.settings.ui.mouse;
    this.tools = opts.tools;
    this.system = opts.system;
    this.debug = opts.debug ?? false;
    this.interactive = opts.interactive ?? true;
    this.logger = opts.logger ?? noopLogger;
    this.env = opts.env ?? opts.ctx.env ?? process.env;
    this.settingsPaths = opts.settingsPaths;
    this.specKit = opts.specKit;
    this.baseCommands = [
      ...(opts.commands ?? DEFAULT_COMMANDS),
      ...(opts.specKit?.commands() ?? []),
    ];
    this.commands = this.baseCommands;
    if (this.specKit) {
      this.specKit.onStep = (step, result) => {
        // Interactive: the transcript shows `⏺ Speckit(step)` (specs/009 contracts/transcript.md § 4).
        if (!this.interactive) {
          if (result.ok) this.notice(`⚙ speckit ${step}  ·  ${result.summary}`, 'info');
          else this.notice(`⚠ speckit ${step}: ${firstLine(result.output)}`, 'warn');
        }
        for (const w of result.warnings ?? []) this.notice(`  ${w}`, 'warn');
      };
    }
    this.providerOverride = opts.providerOverride;
    this.settingsWriter = opts.settingsWriter;
    this.settingsLoader = opts.settingsLoader;
    this.setupDeps = opts.setupDeps ?? {};
    this.history = opts.history;
    this.clock = opts.clock ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.autopilotDeps = opts.autopilotDeps ?? {};
    this.session.on('change', () => {
      // Confirmation / question phases follow the session state (specs/009 contracts/activity-line.md § 2).
      if (this.activity) {
        const st = this.session.state;
        let next = activityReducer(this.activity, {
          type: 'confirm',
          pending: st === 'awaiting_confirmation',
        });
        next = activityReducer(next, { type: 'question', pending: st === 'awaiting_answer' });
        this.activity = next;
      }
      this.emit('change');
    });
    this.commands = this.withRouteAliases(this.baseCommands);
  }

  /** Adds `/<route>` shortcuts for purpose routes that do not collide with a command (specs/008). */
  private withRouteAliases(base: SlashCommand[]): SlashCommand[] {
    const entries = routeEntries({
      routes: routesOf(this.ctx.settings),
      commands: base,
      statuses: this.statuses(),
      active: { provider: this.session.activeProviderId, model: this.activeModel },
    });
    const aliases = aliasCommands(
      entries,
      base.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
      (ctl, route) =>
        (ctl as SessionController).notice(
          `Uso: /${route} <pedido> (atalho de /ask ${route}).`,
          'warn',
        ),
    );
    return [...base, ...aliases];
  }

  /** Read-only view of the provider context (settings, credential sources, active id). */
  get context(): ProviderContext {
    return this.ctx;
  }

  get settings(): Settings {
    return this.ctx.settings;
  }

  get activeProvider(): ModelProvider {
    return this.providerFor(this.session.activeProviderId);
  }

  /** Provider instance by id (one per session; rebuilt after settings changes). Routes use it (specs/008). */
  providerFor(id: ProviderId): ModelProvider {
    let p = this.providers.get(id);
    if (!p) {
      p = this.providerOverride?.(id) ?? createProvider(id, this.ctx);
      this.providers.set(id, p);
    }
    return p;
  }

  /** Routes as the UI and the commands see them (contracts/routes-config.md § 2). */
  routeEntries(): RouteEntry[] {
    let rawGlobal: RoutesSettings | undefined;
    let projectKeys: string[] | undefined;
    if (this.settingsPaths) {
      try {
        const raw = readRawSettings(this.settingsPaths.globalPath)['routes'];
        rawGlobal = routesOf({ routes: (raw ?? {}) as Record<string, string | RouteTarget> });
        const names = Object.keys(this.ctx.settings.routes).map((n) => ['routes', n]);
        projectKeys = projectOverrides(names, this.settingsPaths.cwd);
      } catch {
        /* unreadable file: origins fall back to global */
      }
    }
    return routeEntries({
      routes: routesOf(this.ctx.settings),
      commands: this.commands,
      statuses: this.statuses(),
      active: { provider: this.session.activeProviderId, model: this.activeModel },
      rawGlobal,
      projectKeys,
    });
  }

  get activeModel(): string {
    return (
      this.session.modelOverride ?? this.ctx.settings.providers[this.session.activeProviderId].model
    );
  }

  /** Re-reads the Spec Kit command files (after /speckit.init) and the route shortcuts. */
  refreshCommands(): void {
    if (this.specKit) {
      this.specKit.refresh();
      this.baseCommands = [
        ...this.baseCommands.filter((c) => !c.origin),
        ...this.specKit.commands(),
      ];
    }
    this.commands = this.withRouteAliases(this.baseCommands);
    this.emit('change');
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

  /** `/mouse on|off`: mouse tracking for this session only (contracts/mouse-selection.md § 5). */
  setMouse(on: boolean): void {
    this.mouseEnabled = on;
    this.logger.log('mouse.toggle', { enabled: on });
    this.showTransient(`mouse ${on ? 'on' : 'off'}`);
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
    this.providers.clear();
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
    this.providers.clear();
    // Route shortcuts depend on settings.routes (specs/008).
    this.commands = this.withRouteAliases(this.baseCommands);
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

  clearConversation(opts: { quiet?: boolean } = {}): void {
    try {
      this.session.clear();
      if (!opts.quiet) this.notice('Conversation cleared.', 'info');
    } catch (err) {
      if (err instanceof SessionBusyError) this.notice(err.message, 'warn');
      else throw err;
    }
  }

  // ---------------------------------------------------------------- autopilot (specs/011)

  /**
   * Replaces, for one autopilot run, how questions and confirmations are answered and the
   * approval mode (research R3). Returns the function that restores the previous behaviour.
   */
  runOverrides(o: {
    ask?: (request: AskUserRequest) => Promise<AskUserOutcome>;
    confirm?: (action: Omit<PendingToolAction, 'resolve'>) => Promise<boolean>;
    approvalMode?: ApprovalMode;
  }): () => void {
    const previous = { overrides: this.overrides, mode: this.approvalMode };
    this.overrides = { ask: o.ask, confirm: o.confirm };
    if (o.approvalMode) this.approvalMode = o.approvalMode;
    this.emit('change');
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      this.overrides = previous.overrides;
      this.approvalMode = previous.mode;
      this.emit('change');
    };
  }

  /** A driver for one autopilot run (real git, `gh` and shell unless injected). */
  createAutopilot(progress?: (line: string) => void): AutopilotDriver {
    const d = this.autopilotDeps;
    return new AutopilotDriver({
      controller: this,
      git: d.git ?? this.specKit?.git ?? systemGit,
      gitCommit: d.gitCommit ?? systemGitCommit,
      remote: d.remote ?? ghRemote,
      verify: d.verify ?? shellVerify,
      now: d.now,
      pid: d.pid,
      progress: progress ?? d.progress,
    });
  }

  /** `autopiloto · história n/N · <passo>` in the status bar; undefined when no run is active. */
  setAutopilotStatus(status: AutopilotStatus | undefined): void {
    this.autopilotStatus = status;
    this.emit('change');
  }

  /** Target of a route without running a turn (the autopilot decider calls the provider itself). */
  resolveRouteTarget(route: string): {
    provider: ModelProvider;
    model?: string;
    overrides?: { effort?: Effort; maxTokens?: number };
  } {
    const resolved = resolveRoute({
      forced: route,
      routes: routesOf(this.ctx.settings),
      statuses: this.statuses(),
      active: { provider: this.session.activeProviderId, model: this.activeModel },
      known: this.routeEntries()
        .filter((e) => !e.missingCommand)
        .map((e) => e.name),
    });
    const t = resolved.target;
    return {
      provider: this.providerFor(t.provider),
      model: resolved.via === 'active' ? this.session.modelOverride : t.model,
      overrides:
        t.effort !== undefined || t.maxTokens !== undefined
          ? { effort: t.effort, maxTokens: t.maxTokens }
          : undefined,
    };
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

  /**
   * Handles one line of user input: slash command or chat message. A `PromptSubmission`
   * (interactive prompt with markers) records `display` in the history and sends `text`
   * plus its image parts; the pasted content itself never reaches history or logs.
   */
  async submit(
    input: string | PromptSubmission,
    opts: {
      confirm?: (a: Omit<PendingToolAction, 'resolve'>) => Promise<boolean>;
      onDelta?: (text: string) => void;
      /** Forced route for this request (`-p --route`; specs/008). */
      route?: string;
      /** false: not recorded in the ↑/↓ input history (autopilot turns, specs/011). */
      record?: boolean;
    } = {},
  ): Promise<TurnResult | undefined> {
    if (this.dialog) {
      this.notice('Feche o diálogo (Esc) antes de enviar mensagens.', 'warn');
      return undefined;
    }
    const submission = typeof input === 'string' ? undefined : input;
    const typed = typeof input === 'string' ? input : input.display;
    const expanded = typeof input === 'string' ? input : input.text;
    // Recorded before executing so that /clear and /exit are kept too (contracts/history.md § 2).
    // Autopilot turns are not the user's input and stay out of ↑/↓ (specs/011).
    if (opts.record !== false) this.history?.push(typed);
    if (submission) {
      for (const w of submission.warnings) this.notice(w, 'warn');
      for (const c of submission.sent ?? []) this.logger.log('paste.chip', c);
    }
    // Slash commands see the expanded text (a marker counts as the argument, contracts/paste-chips.md § 3).
    const slash = await executeSlash(expanded, this);
    this.lastCommandBlocked = Boolean(slash.blocked);
    if (slash.handled && !slash.turn) return undefined;
    if (this.session.state !== 'idle') {
      this.notice('A response is still in progress. Press Esc to cancel it first.', 'warn');
      return undefined;
    }
    // A prompt command (Spec Kit) sends the composed prompt but shows the typed line.
    const text = slash.turn ? slash.turn.prompt : expanded;
    const display = slash.turn ? slash.turn.display : submission?.display;
    let parts = submission?.parts ?? [];
    // Route of this turn (specs/008 contracts/route-resolution.md): forced → command → chat → active.
    const entries = this.routeEntries();
    const resolved = resolveRoute({
      forced: slash.turn?.route ?? opts.route,
      command: slash.command?.kind === 'prompt' ? slash.command.name : undefined,
      routes: routesOf(this.ctx.settings),
      statuses: this.statuses(),
      active: { provider: this.session.activeProviderId, model: this.activeModel },
      known: entries.filter((e) => !e.missingCommand).map((e) => e.name),
    });
    for (const fb of resolved.fallbacks) {
      if (fb.route === 'chat') {
        if (this.chatWarned) continue;
        this.chatWarned = true;
      }
      this.notice(fallbackText(fb, resolved.via !== 'active'), 'warn');
    }
    const provider = this.providerFor(resolved.target.provider);
    if (parts.length > 0 && !provider.capabilities?.images) {
      this.notice(
        `O provedor ${provider.id} não aceita imagens; ${parts.length === 1 ? 'a imagem foi descartada' : 'as imagens foram descartadas'}.`,
        'warn',
      );
      parts = [];
    }
    if (!this.session.pushUser(text, display, parts)) return undefined;

    this.partialText = '';
    const route = resolved.route === 'chat' ? undefined : resolved.route;
    this.currentRoute = route;
    this.logger.log('route.resolve', {
      route: resolved.route,
      provider: resolved.target.provider,
      model: resolved.target.model,
      via: resolved.via,
      fallbacks: resolved.fallbacks,
    });
    this.logger.log('turn.start', {
      provider: provider.id,
      model: resolved.target.model,
      route: resolved.route,
      messages: this.session.history.length,
      tools: this.tools.map((t) => t.name),
    });
    const startedAt = Date.now();
    // Activity line (specs/009 US1): starts before the first token, fed by the turn callbacks.
    this.activity = initialActivity(this.clock(), this.random);
    const feed = (e: ActivityEvent) => {
      if (this.activity) this.activity = activityReducer(this.activity, e);
    };
    // In the interactive session the transcript shows each tool call (`⏺ Label(arg)` + `⎿ …`);
    // the `⚙` notices remain for `-p`, where they go to stderr (contracts/transcript.md § 4–5).
    const toolNotices = !this.interactive;
    let autoNoted = false; // onAutoApproved already announced the tool; skip the plain ⚙ line
    const guidance = guidanceFor(route);
    const overrides =
      resolved.target.effort !== undefined || resolved.target.maxTokens !== undefined
        ? { effort: resolved.target.effort, maxTokens: resolved.target.maxTokens }
        : undefined;
    const result = await runTurn(
      this.session,
      provider,
      {
        system: guidance ? `${this.system}\n\n${guidance}` : this.system,
        tools: this.tools,
        toolSettings: this.ctx.settings.tools,
        maxToolIterations: this.ctx.settings.tools.maxToolIterations,
        approvalMode: () => this.approvalMode,
        intercept: this.specKit?.intercept,
        // On the default chat the request looks exactly as before (no explicit model).
        model: resolved.via === 'active' ? this.session.modelOverride : resolved.target.model,
        overrides,
        route,
      },
      {
        onDelta: (t) => {
          this.partialText += t;
          feed({ type: 'delta', chars: t.length });
          opts.onDelta?.(t);
          this.emit('change');
        },
        onUsage: (input, output) => {
          feed({ type: 'usage', input, output });
          this.emit('change');
        },
        // Rate limit: the partial reply is dropped and the request retried after a wait.
        onRetry: (waitMs, attempt) => {
          this.partialText = '';
          this.logger.log('turn.retry', { provider: provider.id, waitMs, attempt });
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
          if (!toolNotices) return;
          const target = summarizeInput(input);
          this.notice(
            `⚙ ${name}${target ? ` ${target}` : ''}  ·  ${summary}  ·  auto (${approvalModeInfo(mode).label})`,
            'info',
          );
        },
        onToolStart: (name, input) => {
          feed({ type: 'toolStart', label: toolLabel(name, input) });
          this.emit('change');
          if (autoNoted) {
            autoNoted = false;
            return;
          }
          if (toolNotices) this.notice(`⚙ ${name} ${summarizeInput(input)}`, 'info');
        },
        onToolEnd: (name, r) => {
          feed({ type: 'toolEnd' });
          if (r.isError && toolNotices) this.notice(`⚠ ${name}: ${firstLine(r.output)}`, 'warn');
          this.partialText = '';
          this.emit('change');
        },
        confirm:
          opts.confirm ?? this.overrides.confirm ?? (this.interactive ? waitForUi : undefined),
        ask: this.overrides.ask ?? (this.interactive ? this.askUser : undefined),
      },
    );
    this.partialText = '';
    this.currentRoute = undefined;
    this.lastUsage = result.usage;
    if (result.stopReason !== 'error') this.ctx.unverified?.delete(provider.id);
    // Turn summary (contracts/activity-line.md § 4); `-p` keeps its stderr as before.
    const summary = this.activity
      ? summarize(this.activity, {
          at: this.clock(),
          cancelled: result.stopReason === 'cancelled',
        })
      : undefined;
    this.activity = undefined;
    if (summary && this.interactive) this.notice(formatSummary(summary), 'info');
    this.logger.log('turn.end', {
      provider: provider.id,
      stopReason: result.stopReason,
      durationMs: Date.now() - startedAt,
      usage: result.usage,
      toolIterations: result.toolIterations,
      chars: result.text.length,
      outTokensShown: summary?.outTokens,
      approximate: summary?.approximate,
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
