import { describe, expect, it } from 'vitest';
import { listStatuses } from '../../../src/providers/index.js';
import {
  initialModelFlow,
  modelEffectsFor,
  modelFlowReducer,
} from '../../../src/setup/modelFlow.js';
import type { ModelFlowEvent, ModelFlowState } from '../../../src/setup/modelFlow.js';
import { makeCtx } from '../../helpers/context.js';

const both = listStatuses(
  makeCtx(
    { providers: { qwen: { enabled: true, apiKey: 'sk-q-1111' } } },
    { credentials: { claude: 'profile', qwen: 'config' } },
  ),
);
const onlyClaude = listStatuses(makeCtx({}, { credentials: { claude: 'env', qwen: 'none' } }));

const run = (s: ModelFlowState, ...events: ModelFlowEvent[]) => events.reduce(modelFlowReducer, s);

describe('modelFlow', () => {
  it('lists providers with the active one selected and the custom entry last', () => {
    const s = initialModelFlow(both, 'claude-opus-5-5');
    expect(s).toMatchObject({ step: 'list', selected: 0 });
    if (s.step === 'list') {
      expect(s.items.map((i) => [i.providerId, i.model, i.active, i.configured])).toEqual([
        ['claude', 'claude-opus-5-5', true, true],
        ['qwen', 'qwen3-coder-plus', false, true],
      ]);
      expect(s.items[1]?.maskedKey).toBe('****1111');
      expect(s.items[0]?.credentialSource).toBe('profile');
    }
  });
  it('navigation skips unconfigured items and wraps through the custom entry', () => {
    const s = initialModelFlow(onlyClaude, 'm');
    expect(run(s, { type: 'down' })).toMatchObject({ selected: 2 }); // skips qwen (index 1) → custom
    expect(run(s, { type: 'down' }, { type: 'down' })).toMatchObject({ selected: 0 });
    expect(run(s, { type: 'up' })).toMatchObject({ selected: 2 });
  });
  it('enter applies a configured item; enter on the custom entry opens the text field', () => {
    const s = initialModelFlow(both, 'claude-opus-5-5');
    const applying = run(s, { type: 'down' }, { type: 'enter' });
    expect(applying).toMatchObject({
      step: 'applying',
      providerId: 'qwen',
      model: 'qwen3-coder-plus',
    });
    expect(modelEffectsFor(applying)).toEqual({ kind: 'apply' });
    const custom = run(s, { type: 'up' }, { type: 'enter' });
    expect(custom).toMatchObject({
      step: 'custom',
      providerId: 'claude',
      value: 'claude-opus-5-5',
    });
  });
  it('custom: validates non-empty, applies the typed model, back returns to the list', () => {
    const custom = run(initialModelFlow(both, 'm'), { type: 'up' }, { type: 'enter' });
    expect(run(custom, { type: 'input', value: '   ' }, { type: 'enter' })).toMatchObject({
      step: 'custom',
      error: 'informe o modelo',
    });
    expect(
      run(custom, { type: 'input', value: ' claude-sonnet-5-5 ' }, { type: 'enter' }),
    ).toMatchObject({ step: 'applying', model: 'claude-sonnet-5-5' });
    expect(run(custom, { type: 'back' }).step).toBe('list');
  });
  it('applying → applied → done → closed; applyError → failed → closed', () => {
    const applying = run(initialModelFlow(both, 'm'), { type: 'down' }, { type: 'enter' });
    const done = run(applying, { type: 'applied' });
    expect(done.step).toBe('done');
    expect(run(done, { type: 'enter' }).step).toBe('closed');
    const failed = run(applying, { type: 'applyError', error: 'boom' });
    expect(failed).toMatchObject({ step: 'failed', error: 'boom' });
    expect(run(failed, { type: 'enter' }).step).toBe('closed');
  });
  it('cancel closes from any step', () => {
    expect(run(initialModelFlow(both, 'm'), { type: 'cancel' }).step).toBe('closed');
    expect(run(initialModelFlow(both, 'm'), { type: 'back' }).step).toBe('closed');
  });
});
