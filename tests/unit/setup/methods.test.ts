import { describe, expect, it } from 'vitest';
import { listStatuses } from '../../../src/providers/index.js';
import {
  CONNECTION_METHODS,
  currentValues,
  fieldDefault,
  methodById,
  methodStatus,
  methodStatusLabel,
} from '../../../src/setup/methods.js';
import { makeCtx, makeSettings } from '../../helpers/context.js';

const OPENAI_URL = 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1';
const ANTHROPIC_URL = 'https://token-plan.maas.qwencloudapi.com/apps/anthropic';

describe('connection methods catalogue (contracts/dialog-flows.md § 3)', () => {
  it('lists the three methods in order with the expected fields', () => {
    expect(CONNECTION_METHODS.map((m) => m.id)).toEqual([
      'claude-api',
      'claude-login',
      'qwen',
      'claude-code',
      'codex',
    ]);
    expect(methodById('codex')).toMatchObject({ kind: 'login', providerId: 'codex', fields: [] });
    expect(methodById('claude-api').fields.map((f) => f.key)).toEqual([
      'apiKey',
      'baseUrl',
      'model',
    ]);
    expect(methodById('claude-login').fields).toEqual([]);
    expect(methodById('claude-login').kind).toBe('login');
    expect(methodById('qwen').fields.map((f) => f.key)).toEqual([
      'protocol',
      'baseUrl',
      'apiKey',
      'model',
    ]);
  });

  it('has defaults and hints', () => {
    const qwen = methodById('qwen');
    const [protocol, url, key, model] = qwen.fields;
    expect(protocol?.kind).toBe('choice');
    expect(protocol?.default).toBe('openai');
    expect(protocol?.options?.map((o) => o.value)).toEqual(['openai', 'anthropic']);
    expect(protocol?.options?.map((o) => o.description)).toEqual([OPENAI_URL, ANTHROPIC_URL]);
    // the endpoint default follows the protocol
    const base = { protocol: '', apiKey: '', baseUrl: '', model: '' };
    expect(fieldDefault(url!, { ...base, protocol: 'openai' })).toBe(OPENAI_URL);
    expect(fieldDefault(url!, { ...base, protocol: 'anthropic' })).toBe(ANTHROPIC_URL);
    expect(fieldDefault(url!, base)).toBe(OPENAI_URL);
    expect(url?.knownDefaults).toContain('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(url?.hint).toContain('dashscope-intl');
    expect(key?.secret).toBe(true);
    expect(model?.default).toBe('qwen3-coder-plus');
    expect(methodById('claude-api').fields[2]?.default).toBe('claude-opus-5-5');
    expect(methodById('claude-api').fields[1]?.required).toBe(false);
  });

  it('validators', () => {
    const [protocol, url, key, model] = methodById('qwen').fields;
    expect(protocol!.validate('openai')).toBeUndefined();
    expect(protocol!.validate('anthropic')).toBeUndefined();
    expect(protocol!.validate('grpc')).toMatch(/protocolo/);
    expect(url!.validate('dashscope.aliyuncs.com')).toMatch(/http/);
    expect(url!.validate('https://x.example/v1')).toBeUndefined();
    expect(key!.validate('')).toMatch(/informe/);
    expect(key!.validate('sk 123')).toMatch(/espaços/);
    expect(key!.validate('sk-123')).toBeUndefined();
    expect(model!.validate('  ')).toMatch(/informe/);
    const optionalUrl = methodById('claude-api').fields[1]!;
    expect(optionalUrl.validate('')).toBeUndefined();
    expect(optionalUrl.validate('ftp://x')).toMatch(/http/);
  });

  it('methodStatus derives from provider statuses and credential source', () => {
    const none = listStatuses(makeCtx({}, { credentials: { claude: 'none', qwen: 'none' } }));
    expect(methodStatus(methodById('claude-api'), none)).toBe('not_configured');
    expect(methodStatus(methodById('claude-login'), none)).toBe('not_configured');
    expect(methodStatus(methodById('qwen'), none)).toBe('not_configured');

    const env = listStatuses(makeCtx({}, { credentials: { claude: 'env' } }));
    expect(methodStatus(methodById('claude-api'), env)).toBe('active');
    expect(methodStatus(methodById('claude-login'), env)).toBe('not_configured');

    const profile = listStatuses(makeCtx({}, { credentials: { claude: 'profile' } }));
    expect(methodStatus(methodById('claude-login'), profile)).toBe('active');
    expect(methodStatus(methodById('claude-api'), profile)).toBe('not_configured');

    const qwenReady = listStatuses(
      makeCtx(
        { providers: { qwen: { enabled: true, apiKey: 'sk-q-7777' } } },
        { credentials: { qwen: 'config' } },
      ),
    );
    expect(methodStatus(methodById('qwen'), qwenReady)).toBe('configured');
    expect(methodStatusLabel('configured', qwenReady[1], methodById('qwen'))).toBe(
      'configurado (chave ****7777)',
    );
    expect(methodStatusLabel('active', profile[0], methodById('claude-login'))).toBe(
      'ativo (perfil)',
    );
    expect(methodStatusLabel('not_configured', undefined, methodById('qwen'))).toBe(
      'não configurado',
    );
  });

  it('currentValues never returns the key, but returns protocol/url/model or defaults', () => {
    const settings = makeSettings({
      providers: {
        qwen: { apiKey: 'sk-secret', baseUrl: 'https://x.example/v1', model: 'qwen-max' },
      },
    });
    expect(currentValues(methodById('qwen'), settings)).toEqual({
      protocol: 'openai',
      apiKey: '',
      baseUrl: 'https://x.example/v1',
      model: 'qwen-max',
    });
    // no baseUrl stored → the protocol's default endpoint
    expect(
      currentValues(
        methodById('qwen'),
        makeSettings({ providers: { qwen: { protocol: 'anthropic' } } }),
      ),
    ).toEqual({
      protocol: 'anthropic',
      apiKey: '',
      baseUrl: ANTHROPIC_URL,
      model: 'qwen3-coder-plus',
    });
    expect(currentValues(methodById('claude-api'), makeSettings())).toEqual({
      protocol: '',
      apiKey: '',
      baseUrl: '',
      model: 'claude-opus-5-5',
    });
  });
});
