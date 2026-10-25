/**
 * Pure reducer of the /routes dialog (specs/008 data-model.md § 6, contracts/routes-dialog.md).
 * Side effects (settings writes) live in SetupDriver.
 */
import { modelCatalog } from '../config/models.js';
import { PROVIDER_IDS, ROUTE_NAME_RE } from '../config/schema.js';
import type { ProviderId, RouteTarget, Settings } from '../config/schema.js';
import type { ProviderStatus } from '../providers/types.js';
import type { RouteEntry } from '../routes/catalog.js';
import type { ProviderChoice } from './modelFlow.js';

export interface RoutesFlowContext {
  entries: RouteEntry[];
  statuses: ProviderStatus[];
  settings: Settings;
  /** Names of every command (shortcut collisions when creating a route). */
  commandNames: string[];
}

export type RouteAction = 'set' | 'reset' | 'remove' | 'back';

export type RoutesFlowState =
  | { step: 'list'; selected: number } // index into ctx.entries; entries.length → "Nova rota…"
  | { step: 'action'; route: string; options: RouteAction[]; selected: number }
  | { step: 'provider'; route: string; providers: ProviderChoice[]; selected: number }
  | { step: 'model'; route: string; providerId: ProviderId; models: string[]; selected: number } // models.length → custom
  | { step: 'custom'; route: string; providerId: ProviderId; value: string; error?: string }
  | { step: 'newRoute'; value: string; error?: string }
  | {
      step: 'applying';
      route: string;
      action: 'set' | 'reset' | 'remove';
      target?: RouteTarget;
      learn?: boolean;
    }
  | { step: 'done'; message: string }
  | { step: 'failed'; error: string }
  | { step: 'closed' };

export type RoutesFlowEvent =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'enter' }
  | { type: 'back' }
  | { type: 'cancel' }
  | { type: 'input'; value: string }
  | { type: 'applied'; message: string }
  | { type: 'applyError'; error: string };

export type RoutesEffect = { kind: 'none' } | { kind: 'apply' } | { kind: 'close' };

export const NEW_ROUTE_LABEL = 'Nova rota…';

export const ACTION_LABELS: Record<RouteAction, string> = {
  set: 'Escolher provedor e modelo',
  reset: 'Voltar ao padrão',
  remove: 'Remover rota',
  back: 'Voltar',
};

export function initialRoutesFlow(_ctx: RoutesFlowContext): RoutesFlowState {
  return { step: 'list', selected: 0 };
}

/** Actions offered for a route (contracts/routes-dialog.md § 3). */
export function actionsFor(entry: RouteEntry): RouteAction[] {
  const out: RouteAction[] = ['set'];
  if (entry.missingCommand || (!entry.builtin && entry.kind === 'purpose')) out.push('remove');
  else if (entry.target) out.push('reset');
  out.push('back');
  return out;
}

function providerChoices(ctx: RoutesFlowContext): ProviderChoice[] {
  return PROVIDER_IDS.map((id) => {
    const s = ctx.statuses.find((x) => x.id === id);
    return {
      id,
      configured: Boolean(s?.configured && s.enabled),
      credentialSource: s?.credentialSource ?? 'none',
      maskedKey: s?.maskedKey,
    };
  });
}

/** Next configured provider from `from` in `dir`, or `from` when none is configured. */
function nextConfigured(providers: ProviderChoice[], from: number, dir: 1 | -1): number {
  const n = providers.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + dir * step + n * step) % n;
    if (providers[i]?.configured) return i;
  }
  return from;
}

function toProvider(ctx: RoutesFlowContext, route: string): RoutesFlowState {
  const providers = providerChoices(ctx);
  const entry = ctx.entries.find((e) => e.name === route);
  let selected = providers.findIndex((p) => p.id === entry?.resolved.provider && p.configured);
  if (selected < 0) selected = providers.findIndex((p) => p.configured);
  return { step: 'provider', route, providers, selected: Math.max(0, selected) };
}

function toModel(ctx: RoutesFlowContext, route: string, providerId: ProviderId): RoutesFlowState {
  const models = modelCatalog(ctx.settings, providerId);
  const entry = ctx.entries.find((e) => e.name === route);
  const current = entry?.resolved.provider === providerId ? entry.resolved.model : undefined;
  const idx = current ? models.indexOf(current) : -1;
  return { step: 'model', route, providerId, models, selected: idx >= 0 ? idx : 0 };
}

/** Validation of a new route name (contracts/routes-dialog.md § 4). */
export function validateRouteName(name: string, ctx: RoutesFlowContext): string | undefined {
  const n = name.trim();
  if (n === '') return 'informe o nome da rota';
  if (!ROUTE_NAME_RE.test(n)) return 'use minúsculas, dígitos, ".", "-" ou "_"';
  if (ctx.entries.some((e) => e.name === n)) return `a rota ${n} já existe`;
  if (ctx.commandNames.includes(n)) return `já existe um comando /${n}`;
  return undefined;
}

export function routesFlowReducer(
  state: RoutesFlowState,
  event: RoutesFlowEvent,
  ctx: RoutesFlowContext,
): RoutesFlowState {
  if (event.type === 'cancel') return { step: 'closed' };
  switch (state.step) {
    case 'list': {
      const total = ctx.entries.length + 1;
      if (event.type === 'up') return { ...state, selected: (state.selected - 1 + total) % total };
      if (event.type === 'down') return { ...state, selected: (state.selected + 1) % total };
      if (event.type === 'back') return { step: 'closed' };
      if (event.type === 'enter') {
        if (state.selected >= ctx.entries.length) return { step: 'newRoute', value: '' };
        const entry = ctx.entries[state.selected]!;
        return { step: 'action', route: entry.name, options: actionsFor(entry), selected: 0 };
      }
      return state;
    }
    case 'action': {
      const n = state.options.length;
      if (event.type === 'up') return { ...state, selected: (state.selected - 1 + n) % n };
      if (event.type === 'down') return { ...state, selected: (state.selected + 1) % n };
      if (event.type === 'back') return backToList(ctx, state.route);
      if (event.type === 'enter') {
        const action = state.options[state.selected] ?? 'back';
        if (action === 'back') return backToList(ctx, state.route);
        if (action === 'set') return toProvider(ctx, state.route);
        return { step: 'applying', route: state.route, action };
      }
      return state;
    }
    case 'provider': {
      if (event.type === 'up')
        return { ...state, selected: nextConfigured(state.providers, state.selected, -1) };
      if (event.type === 'down')
        return { ...state, selected: nextConfigured(state.providers, state.selected, 1) };
      if (event.type === 'back') {
        const entry = ctx.entries.find((e) => e.name === state.route);
        if (!entry) return { step: 'newRoute', value: state.route };
        return { step: 'action', route: state.route, options: actionsFor(entry), selected: 0 };
      }
      if (event.type === 'enter') {
        const p = state.providers[state.selected];
        if (!p || !p.configured) return state;
        return toModel(ctx, state.route, p.id);
      }
      return state;
    }
    case 'model': {
      const total = state.models.length + 1;
      if (event.type === 'up') return { ...state, selected: (state.selected - 1 + total) % total };
      if (event.type === 'down') return { ...state, selected: (state.selected + 1) % total };
      if (event.type === 'back') return toProvider(ctx, state.route);
      if (event.type === 'enter') {
        if (state.selected >= state.models.length) {
          return { step: 'custom', route: state.route, providerId: state.providerId, value: '' };
        }
        const model = state.models[state.selected]!;
        return {
          step: 'applying',
          route: state.route,
          action: 'set',
          target: { provider: state.providerId, model },
          learn: false,
        };
      }
      return state;
    }
    case 'custom': {
      if (event.type === 'input') return { ...state, value: event.value, error: undefined };
      if (event.type === 'back') return toModel(ctx, state.route, state.providerId);
      if (event.type === 'enter') {
        const model = state.value.trim();
        if (model === '') return { ...state, error: 'informe o modelo' };
        if (/\s/.test(model)) return { ...state, error: 'o modelo não pode conter espaços' };
        return {
          step: 'applying',
          route: state.route,
          action: 'set',
          target: { provider: state.providerId, model },
          learn: !modelCatalog(ctx.settings, state.providerId).includes(model),
        };
      }
      return state;
    }
    case 'newRoute': {
      if (event.type === 'input') return { ...state, value: event.value, error: undefined };
      if (event.type === 'back') return { step: 'list', selected: ctx.entries.length };
      if (event.type === 'enter') {
        const error = validateRouteName(state.value, ctx);
        if (error) return { ...state, error };
        return toProvider(ctx, state.value.trim());
      }
      return state;
    }
    case 'applying': {
      if (event.type === 'applied') return { step: 'done', message: event.message };
      if (event.type === 'applyError') return { step: 'failed', error: event.error };
      return state;
    }
    case 'done':
      return { step: 'closed' };
    case 'failed': {
      if (event.type === 'enter' || event.type === 'back') return { step: 'closed' };
      return state;
    }
    default:
      return state;
  }
}

function backToList(ctx: RoutesFlowContext, route: string): RoutesFlowState {
  const idx = ctx.entries.findIndex((e) => e.name === route);
  return { step: 'list', selected: idx >= 0 ? idx : 0 };
}

export function routesEffectsFor(state: RoutesFlowState): RoutesEffect {
  if (state.step === 'applying') return { kind: 'apply' };
  if (state.step === 'closed') return { kind: 'close' };
  return { kind: 'none' };
}

/** Message shown after a successful write (contracts/routes-dialog.md § 5). */
export function describeRouteResult(
  state: Extract<RoutesFlowState, { step: 'applying' }>,
  entry: RouteEntry | undefined,
  overriddenByProject: boolean,
): string {
  const suffix = overriddenByProject
    ? ' (sobrescrita por ./.maestro/settings.json neste projeto)'
    : '';
  if (state.action === 'reset') return `Rota ${state.route} voltou ao padrão.${suffix}`;
  if (state.action === 'remove') return `Rota ${state.route} removida.${suffix}`;
  const t = state.target!;
  const effort = t.effort ? ` (${t.effort})` : '';
  const created = !entry;
  const hint =
    created || (entry?.kind === 'purpose' && state.route !== 'chat')
      ? ` Use /ask ${state.route} … ou /${state.route} ….`
      : '';
  return `Rota ${state.route}${created ? ' criada' : ''} → ${t.provider} / ${t.model}${effort}.${suffix}${hint}`;
}
