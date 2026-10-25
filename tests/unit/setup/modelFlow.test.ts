import { describe, expect, it } from 'vitest';
import { listStatuses } from '../../../src/providers/index.js';
import {
  buildModelEntries,
  initialModelFlow,
  modelEffectsFor,
  modelFlowReducer,
} from '../../../src/setup/modelFlow.js';
import type {
  ModelFlowContext,
  ModelFlowEvent,
  ModelFlowState,
} from '../../../src/setup/modelFlow.js';
import { makeCtx, makeSettings } from '../../helpers/context.js';

const CLAUDE = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const QWEN = ['qwen3-coder-plus', 'qwen3-coder-flash', 'qwen3-max'];
/** Claude Code group (specs/010): listed after qwen, disabled until /auth enables it. */
const CC = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

const bothSettings = { providers: { qwen: { enabled: true, apiKey: 'sk-q-1111' } } };
const both: ModelFlowContext = {
  statuses: listStatuses(
    makeCtx(bothSettings, { credentials: { claude: 'profile', qwen: 'config' } }),
  ),
  settings: makeSettings(bothSettings),
  activeModel: 'claude-opus-5-5',
};
const onlyClaude: ModelFlowContext = {
  statuses: listStatuses(makeCtx({}, { credentials: { claude: 'env', qwen: 'none' } })),
  settings: makeSettings(),
  activeModel: 'claude-opus-5-5',
};
const none: ModelFlowContext = {
  statuses: listStatuses(makeCtx({}, { credentials: { claude: 'none', qwen: 'none' } })),
  settings: makeSettings(),
  activeModel: 'claude-opus-5-5',
};

const run = (ctx: ModelFlowContext, s: ModelFlowState, ...events: ModelFlowEvent[]) =>
  events.reduce((st, e) => modelFlowReducer(st, e, ctx), s);
const CUSTOM = 9; // 3 claude + 3 qwen + 3 claude-code models → custom entry index

describe('modelFlow — list (US2)', () => {
  it('lists one entry per model, grouped in PROVIDER_IDS order, active one selected', () => {
    const s = initialModelFlow(both);
    expect(s).toMatchObject({ step: 'list', selected: 0 });
    if (s.step === 'list') {
      expect(s.items.map((i) => i.model)).toEqual([...CLAUDE, ...QWEN, ...CC]);
      expect(s.items.map((i) => i.providerId)).toEqual([
        'claude',
        'claude',
        'claude',
        'qwen',
        'qwen',
        'qwen',
        'claude-code',
        'claude-code',
        'claude-code',
      ]);
      expect(s.items.map((i) => i.active)).toEqual([
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(s.items[3]?.maskedKey).toBe('****1111');
      expect(s.items[0]?.credentialSource).toBe('profile');
    }
  });
  it('selects the active model even when it is not first; a model outside the catalogue is appended to its group', () => {
    const ctx = { ...both, activeModel: 'claude-haiku-5-5' };
    expect(initialModelFlow(ctx)).toMatchObject({ selected: 2 });
    const extra = { ...both, activeModel: 'claude-x' };
    const entries = buildModelEntries(extra);
    expect(entries.map((e) => e.model)).toEqual([...CLAUDE, 'claude-x', ...QWEN, ...CC]);
    expect(entries[3]).toMatchObject({ active: true, providerId: 'claude' });
    expect(initialModelFlow(extra)).toMatchObject({ selected: 3 });
  });
  it('navigation skips unconfigured groups and wraps through the custom entry', () => {
    const s = initialModelFlow(onlyClaude);
    expect(run(onlyClaude, s, { type: 'down' })).toMatchObject({ selected: 1 });
    expect(run(onlyClaude, s, { type: 'down' }, { type: 'down' }, { type: 'down' })).toMatchObject({
      selected: CUSTOM, // qwen and claude-code rows (3..8) are skipped
    });
    expect(
      run(onlyClaude, s, { type: 'down' }, { type: 'down' }, { type: 'down' }, { type: 'down' }),
    ).toMatchObject({ selected: 0 });
    expect(run(onlyClaude, s, { type: 'up' })).toMatchObject({ selected: CUSTOM });
    expect(run(onlyClaude, s, { type: 'up' }, { type: 'up' })).toMatchObject({ selected: 2 });
  });
  it('enter applies a configured entry (learn=false for catalogue models) and ignores disabled ones', () => {
    const s = initialModelFlow(both);
    const applying = run(
      both,
      s,
      { type: 'down' },
      { type: 'down' },
      { type: 'down' },
      { type: 'enter' },
    );
    expect(applying).toMatchObject({
      step: 'applying',
      providerId: 'qwen',
      model: 'qwen3-coder-plus',
      learn: false,
    });
    expect(modelEffectsFor(applying)).toEqual({ kind: 'apply' });
    const disabled = { ...initialModelFlow(onlyClaude), selected: 4 } as ModelFlowState;
    expect(run(onlyClaude, disabled, { type: 'enter' })).toBe(disabled);
  });
  it('an active model outside the catalogue is applied with learn=true', () => {
    const ctx = { ...both, activeModel: 'claude-x' };
    const s = initialModelFlow(ctx);
    expect(run(ctx, s, { type: 'enter' })).toMatchObject({
      step: 'applying',
      model: 'claude-x',
      learn: true,
    });
  });
});

describe('modelFlow — "Digitar outro modelo…" (US3)', () => {
  const toProvider = (ctx: ModelFlowContext) =>
    run(ctx, initialModelFlow(ctx), { type: 'up' }, { type: 'enter' });

  it('enter on the custom entry opens the provider choice on the active configured provider', () => {
    const s = toProvider(both);
    expect(s).toMatchObject({ step: 'customProvider', selected: 0 });
    if (s.step === 'customProvider') {
      expect(s.providers.map((p) => [p.id, p.configured])).toEqual([
        ['claude', true],
        ['qwen', true],
        ['claude-code', false],
      ]);
      expect(s.providers[1]?.maskedKey).toBe('****1111');
    }
  });
  it('↑/↓ move only between configured providers; enter on an unconfigured one is ignored', () => {
    const s = toProvider(both);
    expect(run(both, s, { type: 'down' })).toMatchObject({ selected: 1 });
    expect(run(both, s, { type: 'down' }, { type: 'down' })).toMatchObject({ selected: 0 });
    const single = toProvider(onlyClaude);
    expect(run(onlyClaude, single, { type: 'down' })).toMatchObject({ selected: 0 });
    const forced = { ...single, selected: 1 } as ModelFlowState; // qwen (unconfigured)
    expect(run(onlyClaude, forced, { type: 'enter' })).toBe(forced);
    // nothing configured at all: entry still opens, nothing selectable
    const empty = toProvider(none);
    expect(empty).toMatchObject({ step: 'customProvider', selected: 0 });
    expect(run(none, empty, { type: 'enter' })).toBe(empty);
  });
  it('enter on a provider opens the field pre-filled with its current model; Esc walks back', () => {
    const custom = run(both, toProvider(both), { type: 'down' }, { type: 'enter' });
    expect(custom).toMatchObject({ step: 'custom', providerId: 'qwen', value: 'qwen3-coder-plus' });
    const active = run(both, toProvider(both), { type: 'enter' });
    expect(active).toMatchObject({
      step: 'custom',
      providerId: 'claude',
      value: 'claude-opus-5-5',
    });
    const back = run(both, custom, { type: 'back' });
    expect(back).toMatchObject({ step: 'customProvider', selected: 1 }); // remembers qwen
    expect(run(both, back, { type: 'back' })).toMatchObject({ step: 'list', selected: 0 });
  });
  it('custom: validates non-empty; learn is true only for a name outside the catalogue', () => {
    const custom = run(both, toProvider(both), { type: 'down' }, { type: 'enter' });
    expect(run(both, custom, { type: 'input', value: '   ' }, { type: 'enter' })).toMatchObject({
      step: 'custom',
      error: 'informe o modelo',
    });
    expect(
      run(both, custom, { type: 'input', value: ' qwen3-max-preview ' }, { type: 'enter' }),
    ).toMatchObject({
      step: 'applying',
      providerId: 'qwen',
      model: 'qwen3-max-preview',
      learn: true,
    });
    expect(
      run(both, custom, { type: 'input', value: 'qwen3-max' }, { type: 'enter' }),
    ).toMatchObject({
      step: 'applying',
      learn: false,
    });
  });
  it('applying → applied(warning?) → done → closed; applyError → failed → closed; cancel closes anywhere', () => {
    const applying = run(both, initialModelFlow(both), { type: 'down' }, { type: 'enter' });
    const done = run(both, applying, { type: 'applied', warning: 'não gravado' });
    expect(done).toMatchObject({
      step: 'done',
      model: 'claude-sonnet-5-5',
      warning: 'não gravado',
    });
    expect(run(both, done, { type: 'enter' }).step).toBe('closed');
    const failed = run(both, applying, { type: 'applyError', error: 'boom' });
    expect(failed).toMatchObject({ step: 'failed', error: 'boom' });
    expect(run(both, failed, { type: 'enter' }).step).toBe('closed');
    expect(run(both, toProvider(both), { type: 'cancel' }).step).toBe('closed');
    expect(run(both, initialModelFlow(both), { type: 'back' }).step).toBe('closed');
  });
});
