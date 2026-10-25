import { describe, expect, it } from 'vitest';
import { listStatuses } from '../../src/providers/index.js';
import { LOGIN_ARGS, STATUS_ARGS } from '../../src/setup/antCli.js';
import { authFlowReducer, initialAuthFlow } from '../../src/setup/authFlow.js';
import type { AuthFlowEvent, AuthFlowState } from '../../src/setup/authFlow.js';
import {
  CONNECTION_METHODS,
  fieldDefault,
  methodById,
  methodStatusLabel,
} from '../../src/setup/methods.js';
import { makeCtx, makeSettings } from '../helpers/context.js';

const settings = makeSettings();
const statuses = listStatuses(makeCtx({}, { credentials: { claude: 'env', qwen: 'none' } }));
const run = (s: AuthFlowState, ...ev: AuthFlowEvent[]) =>
  ev.reduce((x, e) => authFlowReducer(x, e, settings), s);

describe('contract: dialog flows (contracts/dialog-flows.md)', () => {
  it('§3 field order, labels and pre-fill per method', () => {
    expect(methodById('claude-api').fields.map((f) => f.label)).toEqual([
      'Chave de API (sk-ant-…)',
      'Endpoint (opcional)',
      'Modelo',
    ]);
    expect(methodById('qwen').fields.map((f) => f.label)).toEqual([
      'Protocolo',
      'Endpoint',
      'Chave de API (sk-…)',
      'Modelo',
    ]);
    const [protocol, endpoint] = methodById('qwen').fields;
    expect(protocol?.default).toBe('openai');
    expect(protocol?.options?.map((o) => o.description)).toEqual([
      'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
      'https://token-plan.maas.qwencloudapi.com/apps/anthropic',
    ]);
    const blank = { protocol: '', apiKey: '', baseUrl: '', model: '' };
    expect(fieldDefault(endpoint!, { ...blank, protocol: 'openai' })).toBe(
      'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
    );
    expect(fieldDefault(endpoint!, { ...blank, protocol: 'anthropic' })).toBe(
      'https://token-plan.maas.qwencloudapi.com/apps/anthropic',
    );
    expect(methodById('qwen').fields[3]?.default).toBe('qwen3-coder-plus');
    expect(methodById('claude-api').fields[2]?.default).toBe('claude-opus-5-5');
    expect(CONNECTION_METHODS.map((m) => m.label)).toEqual([
      'Claude API',
      'Claude Auth Login',
      'Qwen',
    ]);
  });

  it('§2 menu status texts', () => {
    expect(methodStatusLabel('not_configured', undefined, methodById('qwen'))).toBe(
      'não configurado',
    );
    expect(
      methodStatusLabel(
        'configured',
        { ...statuses[1]!, maskedKey: '****wxyz' },
        methodById('qwen'),
      ),
    ).toBe('configurado (chave ****wxyz)');
    expect(methodStatusLabel('active', statuses[0], methodById('claude-login'))).toBe(
      'ativo (perfil)',
    );
  });

  it('§1 keys per step via the reducer: up/down/enter/back(Esc)/cancel(Ctrl+C)', () => {
    const menu = initialAuthFlow(statuses);
    expect(run(menu, { type: 'down' })).toMatchObject({ selected: 1 });
    expect(run(menu, { type: 'back' }).step).toBe('closed'); // Esc on the menu closes
    const fields = run(menu, { type: 'down' }, { type: 'down' }, { type: 'enter' });
    expect(fields.step).toBe('fields');
    expect(run(fields, { type: 'back' }).step).toBe('menu'); // Esc on the first field → menu
    expect(run(fields, { type: 'cancel' }).step).toBe('closed'); // Ctrl+C closes
    expect(run(fields, { type: 'down' })).toMatchObject({ values: { protocol: 'anthropic' } }); // ↓ on a choice
    const testing = run(
      fields,
      { type: 'enter' }, // protocol
      { type: 'enter' }, // endpoint
      { type: 'input', value: 'k' },
      { type: 'enter' },
      { type: 'enter' },
    );
    expect(run(testing, { type: 'cancel' }).step).toBe('fields'); // Esc cancels the test, back to the field
    const failed = run(testing, {
      type: 'testResult',
      result: { ok: false, category: 'auth', message: 'x', field: 'apiKey' },
    });
    expect(run(failed, { type: 'down' }, { type: 'down' }, { type: 'up' })).toMatchObject({
      selected: 1,
    });
    const activate = run(
      testing,
      { type: 'testResult', result: { ok: true, latencyMs: 1 } },
      { type: 'saved', warnings: [] },
    );
    expect(run(activate, { type: 'down' })).toMatchObject({ selected: 1 });
    const running = run(
      menu,
      { type: 'down' },
      { type: 'enter' },
      { type: 'antDetected', found: true, hints: [] },
    );
    expect(run(running, { type: 'back' }).step).toBe('menu'); // Esc cancels the login
  });

  it('§4 messages and target field per category', () => {
    const cases: Array<[string, string | undefined]> = [
      ['auth', 'apiKey'],
      ['network', 'baseUrl'],
      ['timeout', 'baseUrl'],
      ['model', 'model'],
      ['provider', undefined],
    ];
    const fields = run(
      initialAuthFlow(statuses),
      { type: 'down' },
      { type: 'down' },
      { type: 'enter' },
    );
    const testing = run(
      fields,
      { type: 'enter' },
      { type: 'enter' },
      { type: 'input', value: 'k' },
      { type: 'enter' },
      { type: 'enter' },
    );
    for (const [category, field] of cases) {
      const failed = run(testing, {
        type: 'testResult',
        result: {
          ok: false,
          category: category as 'auth',
          message: 'm',
          field: field as 'apiKey' | undefined,
        },
      });
      const fix = run(failed, { type: 'enter' });
      const expectedIndex = field
        ? methodById('qwen').fields.findIndex((f) => f.key === field)
        : methodById('qwen').fields.length - 1;
      expect(fix).toMatchObject({ step: 'fields', index: expectedIndex, error: 'm' });
    }
  });

  it('§6 exact ant arguments', () => {
    expect([...LOGIN_ARGS]).toEqual(['auth', 'login', '--timeout', '5m']);
    expect([...STATUS_ARGS]).toEqual(['auth', 'status']);
  });
});
