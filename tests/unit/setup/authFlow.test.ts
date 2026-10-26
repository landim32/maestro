import { describe, expect, it } from 'vitest';
import { listStatuses } from '../../../src/providers/index.js';
import {
  authFlowReducer,
  effectsFor,
  initialAuthFlow,
  refreshMenu,
} from '../../../src/setup/authFlow.js';
import type { AuthFlowEvent, AuthFlowState } from '../../../src/setup/authFlow.js';
import { makeCtx, makeSettings } from '../../helpers/context.js';

const OPENAI_URL = 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1';
const ANTHROPIC_URL = 'https://token-plan.maas.qwencloudapi.com/apps/anthropic';

const settings = makeSettings({ providers: { qwen: { enabled: true, apiKey: 'sk-old-1234' } } });
const statuses = listStatuses(
  makeCtx(
    { providers: { qwen: { enabled: true, apiKey: 'sk-old-1234' } } },
    { credentials: { claude: 'env', qwen: 'config' } },
  ),
);
const noQwen = listStatuses(makeCtx({}, { credentials: { claude: 'none', qwen: 'none' } }));

function run(state: AuthFlowState, ...events: AuthFlowEvent[]): AuthFlowState {
  return events.reduce((s, e) => authFlowReducer(s, e, settings), state);
}
const menu = () => initialAuthFlow(statuses);
/** Qwen fields: 0 protocol (choice) · 1 baseUrl · 2 apiKey · 3 model. */
const toQwenFields = () => run(menu(), { type: 'down' }, { type: 'down' }, { type: 'enter' });
const toQwenUrl = () => run(toQwenFields(), { type: 'enter' });

describe('authFlow — menu', () => {
  it('starts on the first method (or the preselected one) with statuses', () => {
    const m = menu();
    expect(m.step).toBe('menu');
    if (m.step === 'menu') {
      expect(m.items.map((i) => i.method.id)).toEqual([
        'claude-api',
        'claude-login',
        'qwen',
        'claude-code',
        'codex',
      ]);
      expect(m.items.map((i) => i.status)).toEqual([
        'active',
        'not_configured',
        'configured',
        'not_configured',
        'not_configured',
      ]);
      expect(m.selected).toBe(0);
    }
    const pre = initialAuthFlow(statuses, 'qwen');
    expect(pre.step === 'menu' && pre.selected).toBe(2);
  });
  it('navigates circularly and closes on back/cancel', () => {
    const m = menu();
    expect(run(m, { type: 'up' })).toMatchObject({ selected: 4 });
    expect(
      run(
        m,
        { type: 'down' },
        { type: 'down' },
        { type: 'down' },
        { type: 'down' },
        { type: 'down' },
      ),
    ).toMatchObject({
      selected: 0,
    });
    expect(run(m, { type: 'back' }).step).toBe('closed');
    expect(run(m, { type: 'cancel' }).step).toBe('closed');
  });
  it('enter on a fields method opens the first field pre-filled; enter on login detects ant', () => {
    const f = toQwenFields();
    expect(f).toMatchObject({ step: 'fields', index: 0, editing: true, keepCurrentKey: true });
    if (f.step === 'fields') {
      expect(f.values.protocol).toBe('openai');
      expect(f.values.baseUrl).toBe(OPENAI_URL);
      expect(f.values.apiKey).toBe('');
      expect(f.values.model).toBe('qwen3-coder-plus');
    }
    const login = run(menu(), { type: 'down' }, { type: 'enter' });
    expect(login.step).toBe('login.detect');
    expect(effectsFor(login)).toEqual({ kind: 'detectAnt' });
  });
});

describe('authFlow — fields', () => {
  it('choice field: ↑/↓ cycle the protocol and the untouched endpoint follows; typing is ignored', () => {
    let s = toQwenFields();
    s = run(s, { type: 'down' });
    expect(s).toMatchObject({ step: 'fields', index: 0 });
    if (s.step === 'fields') {
      expect(s.values.protocol).toBe('anthropic');
      expect(s.values.baseUrl).toBe(ANTHROPIC_URL);
    }
    s = run(s, { type: 'down' }); // wraps around
    expect(s.step === 'fields' && s.values.protocol).toBe('openai');
    expect(s.step === 'fields' && s.values.baseUrl).toBe(OPENAI_URL);
    s = run(s, { type: 'up' });
    expect(s.step === 'fields' && s.values.protocol).toBe('anthropic');
    s = run(s, { type: 'input', value: 'x' });
    expect(s.step === 'fields' && s.values.protocol).toBe('anthropic');
    // a user-edited endpoint is kept when the protocol changes
    s = run(
      s,
      { type: 'enter' },
      { type: 'input', value: 'https://mine.example/v1' },
      { type: 'back' },
    );
    s = run(s, { type: 'down' });
    expect(s.step === 'fields' && s.values.protocol).toBe('openai');
    expect(s.step === 'fields' && s.values.baseUrl).toBe('https://mine.example/v1');
  });
  it('validates each field and advances; last field goes to testing', () => {
    let s = toQwenUrl();
    expect(s).toMatchObject({ step: 'fields', index: 1 });
    s = run(s, { type: 'input', value: 'dashscope.aliyuncs.com' }, { type: 'enter' });
    expect(s).toMatchObject({ step: 'fields', index: 1, error: 'use http:// ou https://' });
    s = run(s, { type: 'input', value: 'https://x.example/v1' }, { type: 'enter' });
    expect(s).toMatchObject({ step: 'fields', index: 2, error: undefined });
    // empty secret while editing keeps the current key
    s = run(s, { type: 'enter' });
    expect(s).toMatchObject({ step: 'fields', index: 3 });
    s = run(s, { type: 'input', value: 'qwen-max' }, { type: 'enter' });
    expect(s).toMatchObject({ step: 'testing', keepCurrentKey: true });
    expect(effectsFor(s)).toEqual({ kind: 'test' });
    if (s.step === 'testing')
      expect(s.values).toEqual({
        protocol: 'openai',
        baseUrl: 'https://x.example/v1',
        apiKey: '',
        model: 'qwen-max',
      });
  });
  it('typing a new key clears keepCurrentKey; whitespace is stripped from keys', () => {
    let s = run(toQwenUrl(), { type: 'enter' }); // to apiKey
    s = run(s, { type: 'input', value: ' sk-new 999 ' });
    expect(s).toMatchObject({ keepCurrentKey: false });
    s = run(s, { type: 'enter' });
    expect(s.step === 'fields' && s.values.apiKey).toBe('sk-new999');
  });
  it('an empty key without a stored one is rejected', () => {
    const fresh = initialAuthFlow(noQwen);
    let s = run(
      fresh,
      { type: 'down' },
      { type: 'down' },
      { type: 'enter' },
      { type: 'enter' }, // protocol ok → url
      { type: 'enter' }, // url ok → key
    );
    expect(s).toMatchObject({ step: 'fields', index: 2, editing: false });
    s = run(s, { type: 'enter' });
    expect(s).toMatchObject({ step: 'fields', index: 2, error: 'informe a chave' });
  });
  it('back goes to the previous field or to the menu; cancel closes', () => {
    const s = toQwenUrl();
    expect(run(s, { type: 'back' })).toMatchObject({ step: 'fields', index: 0 });
    expect(run(s, { type: 'back' }, { type: 'back' }).step).toBe('menu');
    expect(run(s, { type: 'cancel' }).step).toBe('closed');
  });
});

describe('authFlow — testing / saving / activation', () => {
  const testing = () =>
    run(
      toQwenUrl(),
      { type: 'enter' },
      { type: 'input', value: 'sk-new-1' },
      { type: 'enter' },
      { type: 'enter' },
    );

  it('success → saving(verified) → activate → activating → done → closed', () => {
    let s = run(testing(), { type: 'testResult', result: { ok: true, latencyMs: 10 } });
    expect(s).toMatchObject({ step: 'saving', verified: true });
    expect(effectsFor(s)).toEqual({ kind: 'save' });
    s = run(s, { type: 'saved', warnings: ['w1'] });
    expect(s).toMatchObject({ step: 'activate', selected: 0, warnings: ['w1'] });
    s = run(s, { type: 'enter' });
    expect(s.step).toBe('activating');
    expect(effectsFor(s)).toEqual({ kind: 'activate' });
    s = run(s, { type: 'activated' });
    expect(s).toMatchObject({ step: 'done', activated: true });
    expect(run(s, { type: 'enter' }).step).toBe('closed');
  });
  it('activate "Não" skips activation', () => {
    const s = run(
      testing(),
      { type: 'testResult', result: { ok: true, latencyMs: 1 } },
      { type: 'saved', warnings: [] },
      { type: 'down' },
      { type: 'enter' },
    );
    expect(s).toMatchObject({ step: 'done', activated: false });
  });
  it('failure → testFailed; "Corrigir" returns to the field named by the result with the error shown', () => {
    const failed = run(testing(), {
      type: 'testResult',
      result: { ok: false, category: 'auth', message: 'chave rejeitada (401)', field: 'apiKey' },
    });
    expect(failed).toMatchObject({ step: 'testFailed', selected: 0 });
    const fix = run(failed, { type: 'enter' });
    expect(fix).toMatchObject({ step: 'fields', index: 2, error: 'chave rejeitada (401)' });
    const network = run(
      testing(),
      {
        type: 'testResult',
        result: { ok: false, category: 'network', message: 'x', field: 'baseUrl' },
      },
      { type: 'enter' },
    );
    expect(network).toMatchObject({ step: 'fields', index: 1 });
  });
  it('"Gravar sem testar" saves unverified; "Voltar" returns to the menu', () => {
    const failed = run(testing(), {
      type: 'testResult',
      result: { ok: false, category: 'provider', message: 'x' },
    });
    expect(run(failed, { type: 'down' }, { type: 'enter' })).toMatchObject({
      step: 'saving',
      verified: false,
    });
    expect(run(failed, { type: 'down' }, { type: 'down' }, { type: 'enter' }).step).toBe('menu');
    expect(run(failed, { type: 'up' })).toMatchObject({ selected: 2 });
  });
  it('cancel during testing returns to the last field (abort), save errors show saveFailed', () => {
    expect(run(testing(), { type: 'cancel' })).toMatchObject({ step: 'fields', index: 3 });
    const s = run(
      testing(),
      { type: 'testResult', result: { ok: true, latencyMs: 1 } },
      { type: 'saveError', error: 'EACCES' },
    );
    expect(s).toMatchObject({ step: 'saveFailed', error: 'EACCES' });
    expect(run(s, { type: 'enter' }).step).toBe('menu');
  });
  it('refreshMenu re-seeds items after returning to the menu', () => {
    const back = run(
      testing(),
      { type: 'testResult', result: { ok: false, category: 'provider', message: 'x' } },
      { type: 'back' },
    );
    expect(back.step === 'menu' && back.items.length).toBe(0);
    const refreshed = refreshMenu(back, statuses);
    expect(refreshed.step === 'menu' && refreshed.items.length).toBe(5);
  });
});

describe('authFlow — login branch', () => {
  const detect = () => run(menu(), { type: 'down' }, { type: 'enter' });
  it('found → running; missing → hints with retry/back', () => {
    const running = run(detect(), { type: 'antDetected', found: true, hints: [] });
    expect(running.step).toBe('login.running');
    expect(effectsFor(running)).toEqual({ kind: 'runLogin' });
    const missing = run(detect(), { type: 'antDetected', found: false, hints: ['h1'] });
    expect(missing).toMatchObject({ step: 'login.missing', hints: ['h1'], selected: 0 });
    expect(run(missing, { type: 'enter' }).step).toBe('login.detect');
    expect(run(missing, { type: 'down' }, { type: 'enter' }).step).toBe('menu');
    expect(run(missing, { type: 'back' }).step).toBe('menu');
  });
  it('running: output sets the url, exit ok → activate, exit failure → failed, cancel/back → menu', () => {
    const running = run(detect(), { type: 'antDetected', found: true, hints: [] });
    const withUrl = run(running, { type: 'loginOutput', url: 'https://auth.example/x' });
    expect(withUrl).toMatchObject({ step: 'login.running', url: 'https://auth.example/x' });
    expect(run(withUrl, { type: 'loginExit', ok: true, warnings: ['shadow'] })).toMatchObject({
      step: 'activate',
      warnings: ['shadow'],
    });
    const failed = run(withUrl, { type: 'loginExit', ok: false, reason: 'negado', warnings: [] });
    expect(failed).toMatchObject({ step: 'login.failed', reason: 'negado' });
    expect(run(failed, { type: 'enter' }).step).toBe('login.detect');
    expect(run(failed, { type: 'down' }, { type: 'enter' }).step).toBe('menu');
    expect(run(withUrl, { type: 'cancel' }).step).toBe('menu');
    expect(run(withUrl, { type: 'back' }).step).toBe('menu');
  });
});
