import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => import('../../helpers/anthropicMock.js'));
vi.mock('openai', () => import('../../helpers/openaiMock.js'));

import * as anthropic from '../../helpers/anthropicMock.js';
import * as openai from '../../helpers/openaiMock.js';
import { testConnection } from '../../../src/setup/connectionTest.js';
import { methodById } from '../../../src/setup/methods.js';
import { makeCtx } from '../../helpers/context.js';

const ctx = makeCtx({ providers: { qwen: { enabled: true } } });
const qwenValues = {
  protocol: 'openai',
  baseUrl: 'https://dash.example/v1',
  apiKey: 'sk-q-1',
  model: 'qwen3-coder-plus',
};
const claudeValues = { protocol: '', baseUrl: '', apiKey: 'sk-ant-1', model: 'claude-opus-5-5' };

beforeEach(() => {
  anthropic.ctorSpy.mockClear();
  openai.ctorSpy.mockClear();
  anthropic.modelsRetrieve.mockReset();
  anthropic.messagesCreate.mockReset();
  openai.scriptCompletions([]);
});

describe('testConnection — Claude (models.retrieve)', () => {
  it('succeeds and passes key/baseURL/model with a timeout', async () => {
    anthropic.modelsRetrieve.mockResolvedValue({ id: 'claude-opus-5-5' });
    const r = await testConnection(
      methodById('claude-api'),
      { ...claudeValues, baseUrl: 'https://proxy.example' },
      { ctx },
    );
    expect(r.ok).toBe(true);
    expect(anthropic.ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-ant-1',
        baseURL: 'https://proxy.example',
        maxRetries: 0,
      }),
    );
    expect(anthropic.modelsRetrieve).toHaveBeenCalledWith(
      'claude-opus-5-5',
      undefined,
      expect.objectContaining({ timeout: 10_000 }),
    );
  });
  it('uses the zero-arg client for the login method (profile resolution)', async () => {
    anthropic.modelsRetrieve.mockResolvedValue({});
    await testConnection(
      methodById('claude-login'),
      { protocol: '', apiKey: '', baseUrl: '', model: '' },
      { ctx },
    );
    expect(anthropic.ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined, baseURL: undefined }),
    );
    expect(anthropic.modelsRetrieve).toHaveBeenCalledWith(
      'claude-opus-5-5',
      undefined,
      expect.anything(),
    );
  });
  it.each([
    [new anthropic.AuthenticationError(401, 'bad key'), 'auth', 'apiKey'],
    [new anthropic.APIConnectionError('ENOTFOUND'), 'network', 'baseUrl'],
    [new anthropic.APIConnectionTimeoutError(), 'timeout', 'baseUrl'],
    [new anthropic.NotFoundError(404, 'model: claude-x not found'), 'model', 'model'],
    [new anthropic.APIError(500, 'boom'), 'provider', undefined],
  ])('maps %s → %s / %s', async (err, category, field) => {
    anthropic.modelsRetrieve.mockRejectedValue(err);
    const r = await testConnection(methodById('claude-api'), claudeValues, { ctx });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.category).toBe(category);
      expect(r.field).toBe(field);
    }
  });
});

describe('testConnection — Qwen (1-token completion)', () => {
  it('succeeds with a minimal completion', async () => {
    openai.scriptCompletions([{ chunks: [] }]);
    const r = await testConnection(methodById('qwen'), qwenValues, { ctx });
    expect(r.ok).toBe(true);
    expect(openai.ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-q-1', baseURL: 'https://dash.example/v1' }),
    );
    expect(openai.calls[0]?.params).toMatchObject({
      model: 'qwen3-coder-plus',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
  });
  it.each([
    [new openai.AuthenticationError(401, 'Incorrect API key'), 'auth', 'apiKey'],
    [new openai.APIConnectionError('ECONNREFUSED'), 'network', 'baseUrl'],
    [new openai.APIConnectionTimeoutError(), 'timeout', 'baseUrl'],
    [new openai.NotFoundError(404, 'The model `x` does not exist'), 'model', 'model'],
  ])('maps %s → %s / %s', async (err, category, field) => {
    openai.scriptCompletions([{ chunks: [], rejectWith: err }]);
    const r = await testConnection(methodById('qwen'), qwenValues, { ctx });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.category).toBe(category);
      expect(r.field).toBe(field);
    }
  });
});

describe('testConnection — Qwen, Anthropic-compatible endpoint (1-token message)', () => {
  const values = { ...qwenValues, protocol: 'anthropic', baseUrl: 'https://anth.example/apps' };
  it('uses the Anthropic client against the configured endpoint', async () => {
    anthropic.messagesCreate.mockResolvedValue({ id: 'msg' });
    const r = await testConnection(methodById('qwen'), values, { ctx });
    expect(r.ok).toBe(true);
    expect(openai.ctorSpy).not.toHaveBeenCalled();
    expect(anthropic.ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-q-1',
        baseURL: 'https://anth.example/apps',
        maxRetries: 0,
      }),
    );
    expect(anthropic.messagesCreate).toHaveBeenCalledWith(
      { model: 'qwen3-coder-plus', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
      expect.objectContaining({ timeout: 10_000 }),
    );
  });
  it.each([
    [new anthropic.AuthenticationError(401, 'invalid key'), 'auth', 'apiKey'],
    [new anthropic.APIConnectionError('ENOTFOUND'), 'network', 'baseUrl'],
    [new anthropic.APIConnectionTimeoutError(), 'timeout', 'baseUrl'],
    [new anthropic.NotFoundError(404, 'model not found'), 'model', 'model'],
  ])('maps %s → %s / %s', async (err, category, field) => {
    anthropic.messagesCreate.mockRejectedValue(err);
    const r = await testConnection(methodById('qwen'), values, { ctx });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.category).toBe(category);
      expect(r.field).toBe(field);
    }
  });
});
