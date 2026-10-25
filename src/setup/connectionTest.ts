import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { mapAnthropicError } from '../providers/claude.js';
import { mapOpenAIError, mapQwenAnthropicError } from '../providers/qwen.js';
import type { ProviderContext } from '../providers/types.js';
import type { MaestroError } from '../utils/errors.js';
import type { ConnectionTestResult, Values } from './authFlow.js';
import type { ConnectionMethod } from './methods.js';

export interface ConnectionTestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Used to map SDK errors with the existing provider mappers. */
  ctx: ProviderContext;
}

export type ConnectionTester = (
  method: ConnectionMethod,
  values: Values,
  opts: ConnectionTestOptions,
) => Promise<ConnectionTestResult>;

function fromMaestroError(err: MaestroError, timedOut: boolean): ConnectionTestResult {
  if (timedOut)
    return { ok: false, category: 'timeout', message: 'sem resposta em 10 s', field: 'baseUrl' };
  switch (err.category) {
    case 'auth':
      return {
        ok: false,
        category: 'auth',
        message: `chave rejeitada: ${err.message}`,
        field: 'apiKey',
      };
    case 'network':
      return {
        ok: false,
        category: 'network',
        message: `endpoint inacessível: ${err.message}`,
        field: 'baseUrl',
      };
    default: {
      const status = (err.cause as { status?: number } | undefined)?.status;
      if (status === 404 || /model|modelo/i.test(err.message)) {
        return {
          ok: false,
          category: 'model',
          message: `modelo desconhecido: ${err.message}`,
          field: 'model',
        };
      }
      return { ok: false, category: 'provider', message: `erro do provedor: ${err.message}` };
    }
  }
}

/** Minimal, cheap request per provider (research R4). Never throws. */
export const testConnection: ConnectionTester = async (method, values, opts) => {
  const timeout = opts.timeoutMs ?? 10_000;
  const started = Date.now();
  const model = values.model || opts.ctx.settings.providers[method.providerId].model;
  const qwenAnthropic = method.providerId === 'qwen' && values.protocol === 'anthropic';
  try {
    if (method.providerId === 'claude') {
      const client = new Anthropic({
        apiKey: values.apiKey || undefined,
        baseURL: values.baseUrl || undefined,
        maxRetries: 0,
      });
      await client.models.retrieve(model, undefined, { timeout, signal: opts.signal });
    } else if (qwenAnthropic) {
      // Compatible endpoints seldom implement /v1/models; a 1-token message is the reliable probe.
      const client = new Anthropic({
        apiKey: values.apiKey,
        baseURL: values.baseUrl,
        maxRetries: 0,
      });
      await client.messages.create(
        { model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
        { timeout, signal: opts.signal },
      );
    } else {
      const client = new OpenAI({ apiKey: values.apiKey, baseURL: values.baseUrl, maxRetries: 0 });
      await client.chat.completions.create(
        { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
        { timeout, signal: opts.signal },
      );
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    const timedOut =
      err instanceof Anthropic.APIConnectionTimeoutError ||
      err instanceof OpenAI.APIConnectionTimeoutError;
    const mapped =
      method.providerId === 'claude'
        ? mapAnthropicError(err, opts.ctx)
        : qwenAnthropic
          ? mapQwenAnthropicError(err, opts.ctx)
          : mapOpenAIError(err, opts.ctx);
    return fromMaestroError(mapped, timedOut);
  }
};
