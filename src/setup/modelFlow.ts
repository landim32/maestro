import type { CredentialSource } from '../config/loader.js';
import type { ProviderId, ProviderStatus } from '../providers/types.js';

export interface ModelItem {
  providerId: ProviderId;
  model: string;
  active: boolean;
  configured: boolean;
  credentialSource: CredentialSource;
  maskedKey?: string;
}

export type ModelFlowState =
  | { step: 'list'; items: ModelItem[]; selected: number } // selected === items.length → "Digitar outro modelo…"
  | { step: 'custom'; providerId: ProviderId; value: string; error?: string }
  | { step: 'applying'; providerId: ProviderId; model: string }
  | { step: 'done'; providerId: ProviderId; model: string }
  | { step: 'failed'; error: string }
  | { step: 'closed' };

export type ModelFlowEvent =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'enter' }
  | { type: 'back' }
  | { type: 'cancel' }
  | { type: 'input'; value: string }
  | { type: 'applied' }
  | { type: 'applyError'; error: string };

export type ModelEffect = { kind: 'none' } | { kind: 'apply' } | { kind: 'close' };

export function buildModelItems(statuses: ProviderStatus[], activeModel: string): ModelItem[] {
  return statuses.map((s) => ({
    providerId: s.id,
    model: s.active ? activeModel : s.model,
    active: s.active,
    configured: s.configured,
    credentialSource: s.credentialSource,
    maskedKey: s.maskedKey,
  }));
}

export function initialModelFlow(statuses: ProviderStatus[], activeModel: string): ModelFlowState {
  const items = buildModelItems(statuses, activeModel);
  const active = items.findIndex((i) => i.active);
  return { step: 'list', items, selected: active >= 0 ? active : firstEnabled(items, 0, 1) };
}

/** Index of the next selectable entry (configured item or the trailing custom entry) from `from` in `dir`. */
function firstEnabled(items: ModelItem[], from: number, dir: 1 | -1): number {
  const total = items.length + 1; // + custom entry
  let i = from;
  for (let n = 0; n < total; n++) {
    if (i === items.length || items[i]?.configured) return i;
    i = (i + dir + total) % total;
  }
  return items.length;
}

export function modelFlowReducer(state: ModelFlowState, event: ModelFlowEvent): ModelFlowState {
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
        if (state.selected === state.items.length) {
          const base = state.items.find((i) => i.active) ?? state.items.find((i) => i.configured);
          if (!base) return state;
          return { step: 'custom', providerId: base.providerId, value: base.model };
        }
        const item = state.items[state.selected];
        if (!item || !item.configured) return state;
        return { step: 'applying', providerId: item.providerId, model: item.model };
      }
      return state;
    }
    case 'custom': {
      if (event.type === 'input') return { ...state, value: event.value, error: undefined };
      if (event.type === 'back') return { step: 'list', items: [], selected: 0 }; // items re-seeded by the driver
      if (event.type === 'enter') {
        const model = state.value.trim();
        if (model === '') return { ...state, error: 'informe o modelo' };
        return { step: 'applying', providerId: state.providerId, model };
      }
      return state;
    }
    case 'applying': {
      if (event.type === 'applied')
        return { step: 'done', providerId: state.providerId, model: state.model };
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

export function refreshModelList(
  state: ModelFlowState,
  statuses: ProviderStatus[],
  activeModel: string,
): ModelFlowState {
  if (state.step !== 'list' || state.items.length > 0) return state;
  return initialModelFlow(statuses, activeModel);
}

export function modelEffectsFor(state: ModelFlowState): ModelEffect {
  if (state.step === 'applying') return { kind: 'apply' };
  if (state.step === 'closed') return { kind: 'close' };
  return { kind: 'none' };
}
