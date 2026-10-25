import type { CredentialSource } from '../config/loader.js';
import { modelCatalog } from '../config/models.js';
import { PROVIDER_IDS } from '../config/schema.js';
import type { Settings } from '../config/schema.js';
import type { ProviderId, ProviderStatus } from '../providers/types.js';

/** One selectable row of the /model list: a model of a provider (data-model § 3). */
export interface ModelEntry {
  providerId: ProviderId;
  model: string;
  /** Active provider AND active model. */
  active: boolean;
  /** From ProviderStatus; false → disabled row. */
  configured: boolean;
  credentialSource: CredentialSource;
  maskedKey?: string;
}

export interface ProviderChoice {
  id: ProviderId;
  configured: boolean;
  credentialSource: CredentialSource;
  maskedKey?: string;
}

/** Everything the reducer needs from the session (statuses, settings, active model). */
export interface ModelFlowContext {
  statuses: ProviderStatus[];
  settings: Settings;
  activeModel: string;
}

export type ModelFlowState =
  | { step: 'list'; items: ModelEntry[]; selected: number } // selected === items.length → "Digitar outro modelo…"
  | { step: 'customProvider'; providers: ProviderChoice[]; selected: number }
  | { step: 'custom'; providerId: ProviderId; value: string; error?: string }
  | { step: 'applying'; providerId: ProviderId; model: string; learn: boolean }
  | { step: 'done'; providerId: ProviderId; model: string; warning?: string }
  | { step: 'failed'; error: string }
  | { step: 'closed' };

export type ModelFlowEvent =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'enter' }
  | { type: 'back' }
  | { type: 'cancel' }
  | { type: 'input'; value: string }
  | { type: 'applied'; warning?: string }
  | { type: 'applyError'; error: string };

export type ModelEffect = { kind: 'none' } | { kind: 'apply' } | { kind: 'close' };

/** One entry per model, grouped by provider in PROVIDER_IDS order; the active model is always present. */
export function buildModelEntries(ctx: ModelFlowContext): ModelEntry[] {
  const out: ModelEntry[] = [];
  for (const id of PROVIDER_IDS) {
    const s = ctx.statuses.find((x) => x.id === id);
    if (!s) continue;
    const catalog = modelCatalog(ctx.settings, id);
    if (s.active && !catalog.includes(ctx.activeModel)) catalog.push(ctx.activeModel);
    for (const model of catalog) {
      out.push({
        providerId: id,
        model,
        active: s.active && model === ctx.activeModel,
        configured: s.configured,
        credentialSource: s.credentialSource,
        maskedKey: s.maskedKey,
      });
    }
  }
  return out;
}

function providerChoices(ctx: ModelFlowContext): ProviderChoice[] {
  return PROVIDER_IDS.map((id) => {
    const s = ctx.statuses.find((x) => x.id === id);
    return {
      id,
      configured: s?.configured ?? false,
      credentialSource: s?.credentialSource ?? 'none',
      maskedKey: s?.maskedKey,
    };
  });
}

export function initialModelFlow(ctx: ModelFlowContext): ModelFlowState {
  const items = buildModelEntries(ctx);
  const active = items.findIndex((i) => i.active);
  return { step: 'list', items, selected: active >= 0 ? active : firstEnabled(items, 0, 1) };
}

/** Index of the next selectable entry (configured item or the trailing custom entry) from `from` in `dir`. */
function firstEnabled(items: ModelEntry[], from: number, dir: 1 | -1): number {
  const total = items.length + 1; // + custom entry
  let i = from;
  for (let n = 0; n < total; n++) {
    if (i === items.length || items[i]?.configured) return i;
    i = (i + dir + total) % total;
  }
  return items.length;
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

function toCustomProvider(ctx: ModelFlowContext, prefer?: ProviderId): ModelFlowState {
  const providers = providerChoices(ctx);
  const activeId = ctx.statuses.find((s) => s.active)?.id;
  const want = prefer ?? activeId;
  let selected = providers.findIndex((p) => p.id === want && p.configured);
  if (selected < 0) selected = providers.findIndex((p) => p.configured);
  return { step: 'customProvider', providers, selected: Math.max(0, selected) };
}

/** Pure transitions (data-model § 3). */
export function modelFlowReducer(
  state: ModelFlowState,
  event: ModelFlowEvent,
  ctx: ModelFlowContext,
): ModelFlowState {
  if (event.type === 'cancel') return { step: 'closed' };
  switch (state.step) {
    case 'list': {
      const total = state.items.length + 1;
      if (event.type === 'up')
        return {
          ...state,
          selected: firstEnabled(state.items, (state.selected - 1 + total) % total, -1),
        };
      if (event.type === 'down')
        return { ...state, selected: firstEnabled(state.items, (state.selected + 1) % total, 1) };
      if (event.type === 'back') return { step: 'closed' };
      if (event.type === 'enter') {
        if (state.selected === state.items.length) return toCustomProvider(ctx);
        const item = state.items[state.selected];
        if (!item || !item.configured) return state;
        return {
          step: 'applying',
          providerId: item.providerId,
          model: item.model,
          learn: !modelCatalog(ctx.settings, item.providerId).includes(item.model),
        };
      }
      return state;
    }
    case 'customProvider': {
      if (event.type === 'up')
        return { ...state, selected: nextConfigured(state.providers, state.selected, -1) };
      if (event.type === 'down')
        return { ...state, selected: nextConfigured(state.providers, state.selected, 1) };
      if (event.type === 'back') return initialModelFlow(ctx);
      if (event.type === 'enter') {
        const p = state.providers[state.selected];
        if (!p || !p.configured) return state;
        const s = ctx.statuses.find((x) => x.id === p.id);
        const value = s?.active ? ctx.activeModel : ctx.settings.providers[p.id].model;
        return { step: 'custom', providerId: p.id, value };
      }
      return state;
    }
    case 'custom': {
      if (event.type === 'input') return { ...state, value: event.value, error: undefined };
      if (event.type === 'back') return toCustomProvider(ctx, state.providerId);
      if (event.type === 'enter') {
        const model = state.value.trim();
        if (model === '') return { ...state, error: 'informe o modelo' };
        return {
          step: 'applying',
          providerId: state.providerId,
          model,
          learn: !modelCatalog(ctx.settings, state.providerId).includes(model),
        };
      }
      return state;
    }
    case 'applying': {
      if (event.type === 'applied')
        return {
          step: 'done',
          providerId: state.providerId,
          model: state.model,
          warning: event.warning,
        };
      if (event.type === 'applyError') return { step: 'failed', error: event.error };
      return state;
    }
    case 'done':
      return { step: 'closed' };
    case 'failed': {
      if (event.type === 'enter' || event.type === 'back') return { step: 'closed' };
      return state;
    }
    case 'closed':
      return state;
  }
}

export function modelEffectsFor(state: ModelFlowState): ModelEffect {
  if (state.step === 'applying') return { kind: 'apply' };
  if (state.step === 'closed') return { kind: 'close' };
  return { kind: 'none' };
}
