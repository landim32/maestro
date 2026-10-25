import type { ProviderStatus } from '../providers/types.js';
import type { Settings } from '../config/schema.js';
import type { ConnectionMethod, FieldKey, MethodId, MethodStatus, Values } from './methods.js';
import { CONNECTION_METHODS, currentValues, fieldDefault, methodStatus } from './methods.js';

export type { Values } from './methods.js';

export type ConnectionTestResult =
  | { ok: true; latencyMs: number }
  | {
      ok: false;
      category: 'auth' | 'network' | 'timeout' | 'model' | 'provider';
      message: string;
      field?: FieldKey;
    };

export interface MenuItem {
  method: ConnectionMethod;
  status: MethodStatus;
  provider?: ProviderStatus;
}

export type AuthFlowState =
  | { step: 'menu'; selected: number; items: MenuItem[] }
  | {
      step: 'fields';
      method: ConnectionMethod;
      index: number;
      values: Values;
      /** The provider already has a stored/env key; Enter on an empty secret keeps it. */
      editing: boolean;
      keepCurrentKey: boolean;
      error?: string;
    }
  | { step: 'testing'; method: ConnectionMethod; values: Values; keepCurrentKey: boolean }
  | {
      step: 'testFailed';
      method: ConnectionMethod;
      values: Values;
      keepCurrentKey: boolean;
      result: Extract<ConnectionTestResult, { ok: false }>;
      selected: 0 | 1 | 2;
    }
  | {
      step: 'saving';
      method: ConnectionMethod;
      values: Values;
      keepCurrentKey: boolean;
      verified: boolean;
    }
  | { step: 'saveFailed'; method: ConnectionMethod; error: string }
  | { step: 'activate'; method: ConnectionMethod; selected: 0 | 1; warnings: string[] }
  | { step: 'activating'; method: ConnectionMethod; warnings: string[] }
  | { step: 'done'; method: ConnectionMethod; activated: boolean; warnings: string[] }
  | { step: 'login.detect'; method: ConnectionMethod }
  | { step: 'login.missing'; method: ConnectionMethod; hints: string[]; selected: 0 | 1 }
  | { step: 'login.running'; method: ConnectionMethod; url?: string; startedAt: number }
  | { step: 'login.failed'; method: ConnectionMethod; reason: string; selected: 0 | 1 }
  | { step: 'closed' };

export type AuthFlowEvent =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'enter' }
  | { type: 'back' }
  | { type: 'cancel' }
  | { type: 'input'; value: string }
  | { type: 'testResult'; result: ConnectionTestResult }
  | { type: 'saved'; warnings: string[] }
  | { type: 'saveError'; error: string }
  | { type: 'activated' }
  | { type: 'antDetected'; found: boolean; hints: string[] }
  | { type: 'loginOutput'; url?: string }
  | { type: 'loginExit'; ok: boolean; reason?: string; warnings: string[] };

export type AuthEffect =
  | { kind: 'none' }
  | { kind: 'test' }
  | { kind: 'save' }
  | { kind: 'activate' }
  | { kind: 'detectAnt' }
  | { kind: 'runLogin' }
  | { kind: 'cancelLogin' }
  | { kind: 'close' };

export function buildMenu(statuses: ProviderStatus[]): MenuItem[] {
  return CONNECTION_METHODS.map((method) => ({
    method,
    status: methodStatus(method, statuses),
    provider: statuses.find((s) => s.id === method.providerId),
  }));
}

export function initialAuthFlow(statuses: ProviderStatus[], preselect?: MethodId): AuthFlowState {
  const items = buildMenu(statuses);
  const idx = preselect ? items.findIndex((i) => i.method.id === preselect) : 0;
  return { step: 'menu', selected: idx >= 0 ? idx : 0, items };
}

const cycle = (i: number, len: number, delta: number) => (i + delta + len) % len;

function startFields(
  method: ConnectionMethod,
  settings: Settings,
  item: MenuItem | undefined,
): AuthFlowState {
  const values = currentValues(method, settings);
  const editing = Boolean(item?.provider?.maskedKey);
  return { step: 'fields', method, index: 0, values, editing, keepCurrentKey: editing };
}

/**
 * After a choice changes, dependent fields still holding an untouched default
 * (empty or one of `knownDefaults`) follow the new default.
 */
function applyDependentDefaults(method: ConnectionMethod, values: Values): Values {
  const out = { ...values };
  for (const f of method.fields) {
    if (!f.defaultFor) continue;
    const current = out[f.key] ?? '';
    const untouched = current === '' || (f.knownDefaults ?? []).includes(current);
    if (untouched) out[f.key] = fieldDefault(f, out);
  }
  return out;
}

/** Pure transitions (data-model.md § 3). `settings` is needed to pre-fill fields. */
export function authFlowReducer(
  state: AuthFlowState,
  event: AuthFlowEvent,
  settings: Settings,
): AuthFlowState {
  if (event.type === 'cancel') {
    // Cancel closes everywhere, except while a test or login runs (handled below as back).
    if (state.step === 'testing') return backToLastField(state);
    if (state.step === 'login.running') return menuFrom();
    return { step: 'closed' };
  }

  switch (state.step) {
    case 'menu': {
      if (event.type === 'up')
        return { ...state, selected: cycle(state.selected, state.items.length, -1) };
      if (event.type === 'down')
        return { ...state, selected: cycle(state.selected, state.items.length, 1) };
      if (event.type === 'back') return { step: 'closed' };
      if (event.type === 'enter') {
        const item = state.items[state.selected]!;
        if (item.method.kind === 'login') return { step: 'login.detect', method: item.method };
        return startFields(item.method, settings, item);
      }
      return state;
    }

    case 'fields': {
      const field = state.method.fields[state.index]!;
      const isChoice = field.kind === 'choice' && field.options && field.options.length > 0;

      if ((event.type === 'up' || event.type === 'down') && isChoice) {
        const options = field.options!;
        const cur = Math.max(
          0,
          options.findIndex((o) => o.value === state.values[field.key]),
        );
        const next = options[cycle(cur, options.length, event.type === 'up' ? -1 : 1)]!;
        const values = applyDependentDefaults(state.method, {
          ...state.values,
          [field.key]: next.value,
        });
        return { ...state, values, error: undefined };
      }
      if (event.type === 'input') {
        if (isChoice) return state;
        return {
          ...state,
          values: { ...state.values, [field.key]: event.value },
          keepCurrentKey: field.secret ? false : state.keepCurrentKey,
          error: undefined,
        };
      }
      if (event.type === 'back') {
        if (state.index === 0) return menuFrom();
        return { ...state, index: state.index - 1, error: undefined };
      }
      if (event.type === 'enter') {
        const raw = state.values[field.key] ?? '';
        const value = field.secret ? raw.replace(/\s+/g, '') : raw.trim();
        const keepingKey = field.secret && value === '' && state.editing && state.keepCurrentKey;
        if (!keepingKey) {
          const error = field.validate(value);
          if (error) return { ...state, error };
        }
        const values = { ...state.values, [field.key]: value };
        const next = state.index + 1;
        if (next < state.method.fields.length)
          return { ...state, index: next, values, error: undefined };
        return {
          step: 'testing',
          method: state.method,
          values,
          keepCurrentKey: state.keepCurrentKey,
        };
      }
      return state;
    }

    case 'testing': {
      if (event.type === 'testResult') {
        if (event.result.ok) {
          return {
            step: 'saving',
            method: state.method,
            values: state.values,
            keepCurrentKey: state.keepCurrentKey,
            verified: true,
          };
        }
        return {
          step: 'testFailed',
          method: state.method,
          values: state.values,
          keepCurrentKey: state.keepCurrentKey,
          result: event.result,
          selected: 0,
        };
      }
      if (event.type === 'back') return backToLastField(state);
      return state;
    }

    case 'testFailed': {
      if (event.type === 'up')
        return { ...state, selected: cycle(state.selected, 3, -1) as 0 | 1 | 2 };
      if (event.type === 'down')
        return { ...state, selected: cycle(state.selected, 3, 1) as 0 | 1 | 2 };
      if (event.type === 'back') return menuFrom();
      if (event.type === 'enter') {
        if (state.selected === 0) {
          const idx = Math.max(
            0,
            state.method.fields.findIndex((f) => f.key === state.result.field),
          );
          return {
            step: 'fields',
            method: state.method,
            index: state.result.field ? idx : state.method.fields.length - 1,
            values: state.values,
            editing: state.keepCurrentKey,
            keepCurrentKey: state.keepCurrentKey,
            error: state.result.message,
          };
        }
        if (state.selected === 1) {
          return {
            step: 'saving',
            method: state.method,
            values: state.values,
            keepCurrentKey: state.keepCurrentKey,
            verified: false,
          };
        }
        return menuFrom();
      }
      return state;
    }

    case 'saving': {
      if (event.type === 'saved')
        return { step: 'activate', method: state.method, selected: 0, warnings: event.warnings };
      if (event.type === 'saveError')
        return { step: 'saveFailed', method: state.method, error: event.error };
      return state;
    }

    case 'saveFailed': {
      if (event.type === 'enter' || event.type === 'back') return menuFrom();
      return state;
    }

    case 'activate': {
      if (event.type === 'up' || event.type === 'down')
        return { ...state, selected: state.selected === 0 ? 1 : 0 };
      if (event.type === 'back')
        return { step: 'done', method: state.method, activated: false, warnings: state.warnings };
      if (event.type === 'enter') {
        if (state.selected === 0)
          return { step: 'activating', method: state.method, warnings: state.warnings };
        return { step: 'done', method: state.method, activated: false, warnings: state.warnings };
      }
      return state;
    }

    case 'activating': {
      if (event.type === 'activated')
        return { step: 'done', method: state.method, activated: true, warnings: state.warnings };
      return state;
    }

    case 'done': {
      if (event.type === 'enter' || event.type === 'back') return { step: 'closed' };
      return state;
    }

    case 'login.detect': {
      if (event.type === 'antDetected') {
        if (event.found)
          return { step: 'login.running', method: state.method, startedAt: Date.now() };
        return { step: 'login.missing', method: state.method, hints: event.hints, selected: 0 };
      }
      if (event.type === 'back') return menuFrom();
      return state;
    }

    case 'login.missing': {
      if (event.type === 'up' || event.type === 'down')
        return { ...state, selected: state.selected === 0 ? 1 : 0 };
      if (event.type === 'back') return menuFrom();
      if (event.type === 'enter') {
        if (state.selected === 0) return { step: 'login.detect', method: state.method };
        return menuFrom();
      }
      return state;
    }

    case 'login.running': {
      if (event.type === 'loginOutput') return event.url ? { ...state, url: event.url } : state;
      if (event.type === 'loginExit') {
        if (event.ok)
          return { step: 'activate', method: state.method, selected: 0, warnings: event.warnings };
        return {
          step: 'login.failed',
          method: state.method,
          reason: event.reason ?? 'login não concluído',
          selected: 0,
        };
      }
      if (event.type === 'back') return menuFrom();
      return state;
    }

    case 'login.failed': {
      if (event.type === 'up' || event.type === 'down')
        return { ...state, selected: state.selected === 0 ? 1 : 0 };
      if (event.type === 'back') return menuFrom();
      if (event.type === 'enter') {
        if (state.selected === 0) return { step: 'login.detect', method: state.method };
        return menuFrom();
      }
      return state;
    }

    case 'closed':
      return state;
  }
}

function backToLastField(state: Extract<AuthFlowState, { step: 'testing' }>): AuthFlowState {
  return {
    step: 'fields',
    method: state.method,
    index: state.method.fields.length - 1,
    values: state.values,
    editing: state.keepCurrentKey,
    keepCurrentKey: state.keepCurrentKey,
  };
}

/** Returns to an empty menu; the driver re-seeds items through `refreshMenu`. */
function menuFrom(): AuthFlowState {
  return { step: 'menu', selected: 0, items: [] };
}

/** Re-computes menu items from fresh statuses (used after returning to the menu or after saving). */
export function refreshMenu(state: AuthFlowState, statuses: ProviderStatus[]): AuthFlowState {
  if (state.step !== 'menu') return state;
  const items = buildMenu(statuses);
  return { ...state, items, selected: Math.min(state.selected, items.length - 1) };
}

/** Effect the driver must run when entering `state` (data-model § 3). */
export function effectsFor(state: AuthFlowState): AuthEffect {
  switch (state.step) {
    case 'testing':
      return { kind: 'test' };
    case 'saving':
      return { kind: 'save' };
    case 'activating':
      return { kind: 'activate' };
    case 'login.detect':
      return { kind: 'detectAnt' };
    case 'login.running':
      return { kind: 'runLogin' };
    case 'closed':
      return { kind: 'close' };
    default:
      return { kind: 'none' };
  }
}
