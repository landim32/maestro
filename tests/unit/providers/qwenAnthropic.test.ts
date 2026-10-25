import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => import('../../helpers/anthropicMock.js'));
vi.mock('openai', () => import('../../helpers/openaiMock.js'));

import * as anthropic from '../../helpers/anthropicMock.js';
import * as openai from '../../helpers/openaiMock.js';
import { createQwenProvider } from '../../../src/providers/qwen.js';
import type { ProviderEvent, ProviderRequest } from '../../../src/providers/types.js';
import { makeCtx } from '../../helpers/context.js';

async function drain(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function req(partial: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    messages: [
      { id: '1', role: 'user', content: [{ type: 'text', text: 'hi' }], createdAt: new Date() },
    ],
    system: 'sys',
    tools: [],
    signal: new AbortController().signal,
    ...partial,
  };
}

const cfg = (extra: Record<string, unknown> = {}) => ({
  providers: {
    qwen: { enabled: true, apiKey: 'sk-qwen-anth-1111', protocol: 'anthropic' as const, ...extra },
  },
});

beforeEach(() => {
  anthropic.ctorSpy.mockClear();
  openai.ctorSpy.mockClear();
  anthropic.scriptStreams([]);
});

describe('qwen provider — Anthropic-compatible protocol', () => {
  it('builds an Anthropic client on the Qwen Cloud anthropic endpoint by default', () => {
    createQwenProvider(makeCtx(cfg(), { credentials: { qwen: 'config' } }));
    expect(openai.ctorSpy).not.toHaveBeenCalled();
    expect(anthropic.ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-qwen-anth-1111',
        baseURL: 'https://token-plan.maas.qwencloudapi.com/apps/anthropic',
      }),
    );
  });
  it('honours a custom baseUrl and DASHSCOPE_API_KEY', () => {
    createQwenProvider(
      makeCtx(cfg({ baseUrl: 'https://mine.example/anthropic' }), {
        env: { DASHSCOPE_API_KEY: 'sk-env-2222' },
        credentials: { qwen: 'env' },
      }),
    );
    expect(anthropic.ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-env-2222', baseURL: 'https://mine.example/anthropic' }),
    );
  });
  it('streams through the plain Messages API without Anthropic-only extras', async () => {
    anthropic.scriptStreams([
      {
        events: [
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi ' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'there' } },
        ],
        final: { stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } },
      },
    ]);
    const p = createQwenProvider(makeCtx(cfg(), { credentials: { qwen: 'config' } }));
    const events = await drain(p.stream(req({ model: 'qwen3-max' })));
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hi ' },
      { type: 'text_delta', text: 'there' },
      { type: 'usage', inputTokens: 5, outputTokens: 2 },
      { type: 'done', stopReason: 'end_turn', detail: undefined },
    ]);
    expect(anthropic.calls).toHaveLength(1);
    expect(anthropic.calls[0]?.path).toBe('plain');
    expect(anthropic.calls[0]?.params).toMatchObject({
      model: 'qwen3-max',
      max_tokens: 16000,
      system: 'sys',
    });
    expect(anthropic.calls[0]?.params).not.toHaveProperty('betas');
    expect(anthropic.calls[0]?.params).not.toHaveProperty('fallbacks');
    expect(anthropic.calls[0]?.params).not.toHaveProperty('output_config');
  });
  it('emits tool calls from tool_use blocks', async () => {
    anthropic.scriptStreams([
      {
        events: [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"path":"a.txt"}' },
          },
          { type: 'content_block_stop', index: 0 },
        ],
        final: { stop_reason: 'tool_use' },
      },
    ]);
    const p = createQwenProvider(makeCtx(cfg(), { credentials: { qwen: 'config' } }));
    const events = await drain(p.stream(req()));
    expect(events[0]).toEqual({
      type: 'tool_call',
      callId: 'toolu_1',
      name: 'read_file',
      input: { path: 'a.txt' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'tool_use' });
  });
  it('maps errors with providerId qwen and never leaks the key', async () => {
    anthropic.scriptStreams([
      { events: [], throwDuring: new anthropic.AuthenticationError(401, 'bad sk-qwen-anth-1111') },
    ]);
    const p = createQwenProvider(makeCtx(cfg(), { credentials: { qwen: 'config' } }));
    const events = await drain(p.stream(req()));
    const err = events[0];
    expect(err?.type).toBe('error');
    if (err?.type === 'error') {
      expect(err.error.providerId).toBe('qwen');
      expect(err.error.category).toBe('auth');
      expect(err.error.hint).toMatch(/DASHSCOPE_API_KEY/);
      expect(JSON.stringify(err.error)).not.toContain('sk-qwen-anth-1111');
    }
  });
  it('streams an auth error without network when there is no key', async () => {
    const p = createQwenProvider(makeCtx(cfg({ apiKey: undefined })));
    const ev = await drain(p.stream(req()));
    expect(ev).toHaveLength(1);
    expect(ev[0]?.type === 'error' && ev[0].error.category).toBe('auth');
    expect(anthropic.ctorSpy).not.toHaveBeenCalled();
  });
});
