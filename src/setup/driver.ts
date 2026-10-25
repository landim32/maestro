import type { SettingsPatchEntry } from '../config/writer.js';
import type { SessionController } from '../session/controller.js';
import { MaestroError } from '../utils/errors.js';
import { createAntCli, envShadowWarning } from './antCli.js';
import type { AntCli, LoginRun } from './antCli.js';
import { authFlowReducer, effectsFor, initialAuthFlow, refreshMenu } from './authFlow.js';
import type { AuthFlowEvent, AuthFlowState } from './authFlow.js';
import { testConnection as defaultTestConnection } from './connectionTest.js';
import type { ConnectionTester } from './connectionTest.js';
import type { DialogKey } from './dialog.js';
import { installHints } from './installHints.js';
import type { MethodId } from './methods.js';
import { initialModelFlow, modelEffectsFor, modelFlowReducer } from './modelFlow.js';
import type { ModelFlowContext, ModelFlowEvent, ModelFlowState } from './modelFlow.js';
import {
  describeRouteResult,
  initialRoutesFlow,
  routesEffectsFor,
  routesFlowReducer,
} from './routesFlow.js';
import type { RoutesFlowContext, RoutesFlowEvent, RoutesFlowState } from './routesFlow.js';

export interface SetupDeps {
  testConnection: ConnectionTester;
  ant: AntCli;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

/**
 * Connects the pure flow reducers to the controller and to side effects
 * (connection test, settings writes, the `ant` CLI). Research R7.
 */
export class SetupDriver {
  private readonly deps: SetupDeps;
  private testAbort?: AbortController;
  private loginRun?: LoginRun;
  private antPath?: string;
  private generation = 0;

  constructor(
    private readonly ctl: SessionController,
    deps: Partial<SetupDeps> = {},
  ) {
    const env = deps.env ?? ctl.env;
    const platform = deps.platform ?? process.platform;
    this.deps = {
      testConnection: deps.testConnection ?? defaultTestConnection,
      ant: deps.ant ?? createAntCli({ env, platform }),
      env,
      platform,
    };
  }

  // ------------------------------------------------------------------ opening

  openAuth(preselect?: MethodId): boolean {
    const flow = initialAuthFlow(this.ctl.statuses(), preselect);
    const ok = this.ctl.openDialog({ type: 'auth', flow });
    if (ok) this.ctl.logger.log('setup.open', { dialog: 'auth', preselect });
    return ok;
  }

  private modelCtx(): ModelFlowContext {
    return {
      statuses: this.ctl.statuses(),
      settings: this.ctl.settings,
      activeModel: this.ctl.activeModel,
    };
  }

  openModel(): boolean {
    const flow = initialModelFlow(this.modelCtx());
    const ok = this.ctl.openDialog({ type: 'model', flow });
    if (ok) this.ctl.logger.log('setup.open', { dialog: 'model' });
    return ok;
  }

  private routesCtx(): RoutesFlowContext {
    return {
      entries: this.ctl.routeEntries(),
      statuses: this.ctl.statuses(),
      settings: this.ctl.settings,
      commandNames: this.ctl.commands.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
    };
  }

  /** `/routes` (specs/008 contracts/routes-dialog.md § 1). */
  openRoutes(): boolean {
    const flow = initialRoutesFlow(this.routesCtx());
    const ok = this.ctl.openDialog({ type: 'routes', flow });
    if (ok) this.ctl.logger.log('setup.open', { dialog: 'routes' });
    return ok;
  }

  /** Context of the open routes dialog (the UI needs the entries to render the list). */
  routesContext(): RoutesFlowContext {
    return this.routesCtx();
  }

  /** Cancels any in-flight effect (used on exit). */
  abort(): void {
    this.testAbort?.abort();
    this.loginRun?.cancel();
  }

  // ------------------------------------------------------------------ dispatch

  dispatch(key: DialogKey): void {
    const dialog = this.ctl.dialog;
    if (!dialog) return;
    if (dialog.type === 'auth') this.dispatchAuth(key);
    else if (dialog.type === 'model') this.dispatchModel(key);
    else this.dispatchRoutes(key);
  }

  dispatchRoutes(event: RoutesFlowEvent): void {
    const dialog = this.ctl.dialog;
    if (!dialog || dialog.type !== 'routes') return;
    const prev = dialog.flow;
    const next = routesFlowReducer(prev, event, this.routesCtx());
    if (next === prev) return;
    this.ctl.setDialog({ type: 'routes', flow: next });
    if (next.step !== prev.step) this.runRoutesEffect(next);
  }

  // ------------------------------------------------------------------ routes effects

  private runRoutesEffect(state: RoutesFlowState): void {
    const effect = routesEffectsFor(state);
    if (effect.kind === 'close') {
      this.ctl.closeDialog();
      return;
    }
    if (effect.kind !== 'apply' || state.step !== 'applying') return;
    const entry = this.ctl.routeEntries().find((e) => e.name === state.route);
    try {
      // Route names may contain dots (speckit.plan): explicit segments keep the key whole.
      const patch: SettingsPatchEntry[] = [
        {
          path: `routes.${state.route}`,
          segments: ['routes', state.route],
          value: state.action === 'set' ? state.target : undefined,
        },
      ];
      if (state.action === 'set' && state.target && state.learn) {
        patch.push(...this.ctl.rememberModel(state.target.provider, state.target.model));
      }
      const result = this.ctl.writeSettings(patch);
      this.ctl.logger.log('routes.write', { route: state.route, action: state.action });
      this.ctl.reloadSettings();
      this.ctl.refreshCommands();
      const overridden = result.overriddenByProject.includes(`routes.${state.route}`);
      this.dispatchRoutes({
        type: 'applied',
        message: describeRouteResult(state, entry, overridden),
      });
    } catch (err) {
      const msg = err instanceof MaestroError ? err.message : String(err);
      this.dispatchRoutes({ type: 'applyError', error: msg });
    }
  }

  dispatchAuth(event: AuthFlowEvent): void {
    const dialog = this.ctl.dialog;
    if (!dialog || dialog.type !== 'auth') return;
    const prev = dialog.flow;
    let next = authFlowReducer(prev, event, this.ctl.settings);
    if (next === prev) return;
    if (next.step === 'menu' && next.items.length === 0)
      next = refreshMenu(next, this.ctl.statuses());

    // Leaving an effectful step cancels its effect.
    if (prev.step === 'testing' && next.step !== 'testing') this.testAbort?.abort();
    if (
      prev.step === 'login.running' &&
      next.step !== 'login.running' &&
      next.step !== 'activate'
    ) {
      this.loginRun?.cancel();
    }

    this.ctl.setDialog({ type: 'auth', flow: next });
    if (next.step !== prev.step) this.runAuthEffect(next);
  }

  dispatchModel(event: ModelFlowEvent): void {
    const dialog = this.ctl.dialog;
    if (!dialog || dialog.type !== 'model') return;
    const prev = dialog.flow;
    const next = modelFlowReducer(prev, event, this.modelCtx());
    if (next === prev) return;
    this.ctl.setDialog({ type: 'model', flow: next });
    if (next.step !== prev.step) this.runModelEffect(next);
  }

  // ------------------------------------------------------------------ auth effects

  private runAuthEffect(state: AuthFlowState): void {
    const effect = effectsFor(state);
    const gen = ++this.generation;
    const stillCurrent = () => gen === this.generation && this.ctl.dialog?.type === 'auth';

    switch (effect.kind) {
      case 'close':
        this.finishAuth(state);
        return;

      case 'test': {
        if (state.step !== 'testing') return;
        this.testAbort = new AbortController();
        void this.deps
          .testConnection(state.method, state.values, {
            ctx: this.ctl.context,
            signal: this.testAbort.signal,
          })
          .then((result) => {
            this.ctl.logger.log('setup.test', { method: state.method.id, ok: result.ok });
            if (stillCurrent() && this.ctl.dialog?.flow.step === 'testing') {
              this.dispatchAuth({ type: 'testResult', result });
            }
          });
        return;
      }

      case 'save': {
        if (state.step !== 'saving') return;
        try {
          const warnings = this.save(state);
          if (!state.verified) this.ctl.markUnverified(state.method.providerId);
          this.dispatchAuth({ type: 'saved', warnings });
        } catch (err) {
          const msg =
            err instanceof MaestroError
              ? `${err.message}${err.hint ? ` (${err.hint})` : ''}`
              : String(err);
          this.dispatchAuth({ type: 'saveError', error: msg });
        }
        return;
      }

      case 'activate': {
        if (state.step !== 'activating') return;
        const model = this.ctl.settings.providers[state.method.providerId].model;
        const ok = this.ctl.switchProvider(state.method.providerId, model);
        if (ok) this.ctl.persistActive();
        this.dispatchAuth({ type: 'activated' });
        return;
      }

      case 'detectAnt': {
        const loc = this.deps.ant.locate();
        this.antPath = loc?.path;
        this.dispatchAuth({
          type: 'antDetected',
          found: Boolean(loc),
          hints: installHints(this.deps.platform),
        });
        return;
      }

      case 'runLogin': {
        if (!this.antPath) {
          this.dispatchAuth({
            type: 'loginExit',
            ok: false,
            reason: 'CLI ant não localizada',
            warnings: [],
          });
          return;
        }
        const run = this.deps.ant.runLogin(this.antPath, {
          onOutput: (_text, url) => {
            if (url && stillCurrent()) this.dispatchAuth({ type: 'loginOutput', url });
          },
        });
        this.loginRun = run;
        void run.promise.then(async (result) => {
          this.loginRun = undefined;
          if (!stillCurrent()) return;
          if (!result.ok && result.cancelled) return; // state already moved back to the menu
          let ok = result.ok;
          let reason = result.ok ? undefined : result.reason;
          if (ok && this.antPath) {
            const status = await this.deps.ant.readStatus(this.antPath);
            ok = status.loggedIn;
            if (!ok) reason = 'o login terminou, mas nenhum perfil ativo foi encontrado';
          }
          this.ctl.logger.log('setup.login', { ok });
          if (ok) {
            try {
              this.ctl.writeSettings([{ path: 'providers.claude.enabled', value: true }]);
            } catch {
              /* enabling is best-effort; the profile itself lives outside settings.json */
            }
            this.ctl.reloadSettings();
          }
          const warnings: string[] = [];
          const shadow = envShadowWarning(this.deps.env);
          if (ok && shadow) warnings.push(shadow);
          if (this.ctl.dialog?.type === 'auth' && this.ctl.dialog.flow.step === 'login.running') {
            this.dispatchAuth({ type: 'loginExit', ok, reason, warnings });
          }
        });
        return;
      }

      default:
        return;
    }
  }

  /** Builds and writes the settings patch for a fields method; returns warnings. */
  private save(state: Extract<AuthFlowState, { step: 'saving' }>): string[] {
    const id = state.method.providerId;
    const patch: SettingsPatchEntry[] = [{ path: `providers.${id}.enabled`, value: true }];
    for (const field of state.method.fields) {
      const value = state.values[field.key] ?? '';
      if (field.key === 'apiKey') {
        if (state.keepCurrentKey && value === '') continue;
        patch.push({ path: `providers.${id}.apiKey`, value });
      } else if (field.key === 'protocol') {
        patch.push({ path: `providers.${id}.protocol`, value });
      } else if (field.key === 'baseUrl') {
        patch.push({
          path: `providers.${id}.baseUrl`,
          value: value.trim() === '' ? undefined : value,
        });
      } else {
        patch.push({ path: `providers.${id}.model`, value });
      }
    }
    const result = this.ctl.writeSettings(patch);
    this.ctl.reloadSettings();

    const warnings: string[] = [];
    for (const p of result.overriddenByProject)
      warnings.push(`./.maestro/settings.json sobrescreve ${p} nesta pasta.`);
    if (id === 'qwen' && this.deps.env['DASHSCOPE_API_KEY']) {
      warnings.push('DASHSCOPE_API_KEY está definida e tem precedência sobre a chave gravada.');
    }
    if (
      id === 'claude' &&
      (this.deps.env['ANTHROPIC_API_KEY'] || this.deps.env['ANTHROPIC_AUTH_TOKEN'])
    ) {
      warnings.push(
        'Uma variável ANTHROPIC_* está definida e tem precedência sobre a chave gravada.',
      );
    }
    return warnings;
  }

  private finishAuth(state: AuthFlowState): void {
    void state;
    this.ctl.closeDialog();
  }

  // ------------------------------------------------------------------ model effects

  private runModelEffect(state: ModelFlowState): void {
    const effect = modelEffectsFor(state);
    if (effect.kind === 'close') {
      this.ctl.closeDialog();
      return;
    }
    if (effect.kind === 'apply' && state.step === 'applying') {
      const ok = this.ctl.switchProvider(state.providerId, state.model);
      if (!ok) {
        this.dispatchModel({
          type: 'applyError',
          error: `não foi possível ativar ${state.providerId}`,
        });
        return;
      }
      // The switch already happened; a failed write only downgrades to a warning (FR-017).
      let warning: string | undefined;
      try {
        this.ctl.writeSettings([
          { path: 'activeProvider', value: state.providerId },
          { path: `providers.${state.providerId}.model`, value: state.model },
          ...(state.learn ? this.ctl.rememberModel(state.providerId, state.model) : []),
        ]);
        this.ctl.reloadSettings();
      } catch (err) {
        const msg = err instanceof MaestroError ? err.message : String(err);
        warning = `Não foi possível gravar a configuração: ${msg}`;
        this.ctl.notice(warning, 'warn');
      }
      this.dispatchModel({ type: 'applied', warning });
      // `done` closes immediately on the next dispatch; close now for a snappy UX.
      this.dispatchModel({ type: 'enter' });
    }
  }
}

/** Public helper used by commands and the UI to notify the end of an /auth flow. */
export function describeDone(
  state: Extract<AuthFlowState, { step: 'done' }>,
  model: string,
): string {
  return `Conectado: ${state.method.providerId} / ${model}${state.activated ? ' (ativo)' : ''}`;
}
