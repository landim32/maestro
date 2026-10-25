import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@anthropic-ai/sdk', () => import('../../helpers/anthropicMock.js'));

import * as mock from '../../helpers/anthropicMock.js';
import {
  createClaudeProvider,
  toAnthropicMessages,
  toAnthropicTools,
} from '../../../src/providers/claude.js';
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

beforeEach(() => {
  mock.ctorSpy.mockClear();
  mock.scriptStreams([]);
});

describe('claude provider — client construction', () => {
  it('uses the zero-arg client when no apiKey/baseUrl are configured (env/profile resolution)', () => {
    createClaudeProvider(makeCtx());
    expect(mock.ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined, baseURL: undefined }),
    );
  });
  it('passes apiKey and baseUrl from settings when present', () => {
    createClaudeProvider(
      makeCtx({
        providers: { claude: { apiKey: 'sk-cfg-1234', baseUrl: 'https://proxy.example/v1' } },
      }),
    );
    expect(mock.ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-cfg-1234', baseURL: 'https://proxy.example/v1' }),
    );
  });
});

describe('claude provider — status()', () => {
  it('is configured when credentials come from env, config or profile; not when none', () => {
    expect(
      createClaudeProvider(makeCtx({}, { credentials: { claude: 'env' } })).status().configured,
    ).toBe(true);
    expect(
      createClaudeProvider(makeCtx({}, { credentials: { claude: 'profile' } })).status().configured,
    ).toBe(true);
    const none = createClaudeProvider(makeCtx({}, { credentials: { claude: 'none' } })).status();
    expect(none.configured).toBe(false);
    expect(none.missing).toEqual(['credentials']);
    expect(none.hint).toMatch(/ant auth login/);
  });
  it('declares image support (specs/007 research R9)', () => {
    expect(createClaudeProvider(makeCtx()).capabilities).toEqual({ images: true });
  });
  it('masks the key and respects enabled=false', () => {
    const s = createClaudeProvider(
      makeCtx(
        { providers: { claude: { enabled: false, apiKey: 'sk-ant-abcdef9876' } } },
        { credentials: { claude: 'config' } },
      ),
    ).status();
    expect(s.enabled).toBe(false);
    expect(s.configured).toBe(false);
    expect(s.maskedKey).toBe('****9876');
  });
});

describe('claude provider — streaming', () => {
  it('emits text deltas, usage and done end_turn in order, via the beta path with fallbacks on', async () => {
    mock.scriptStreams([
      {
        events: [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
          { type: 'content_block_stop', index: 0 },
        ],
      },
    ]);
    const p = createClaudeProvider(makeCtx());
    const events = await drain(p.stream(req()));
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'usage', inputTokens: 11, outputTokens: 7 },
      { type: 'done', stopReason: 'end_turn', detail: undefined },
    ]);
    expect(mock.calls[0]?.path).toBe('beta');
    expect(mock.calls[0]?.params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: 'sys',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
    });
    expect(mock.calls[0]?.params).not.toHaveProperty('thinking');
    expect(mock.calls[0]?.options.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the non-beta path without fallbacks when disabled, and honours model override', async () => {
    mock.scriptStreams([{ events: [] }]);
    const p = createClaudeProvider(
      makeCtx({ providers: { claude: { fallbacks: false, effort: 'high' } } }),
    );
    await drain(p.stream(req({ model: 'claude-sonnet-5-5' })));
    expect(mock.calls[0]?.path).toBe('plain');
    expect(mock.calls[0]?.params).not.toHaveProperty('betas');
    expect(mock.calls[0]?.params).not.toHaveProperty('fallbacks');
    expect(mock.calls[0]?.params).toMatchObject({
      model: 'claude-sonnet-5-5',
      output_config: { effort: 'high' },
    });
  });

  it('accumulates input_json_delta and emits tool_call with parsed input, then done tool_use', async () => {
    mock.scriptStreams([
      {
        events: [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Reading…' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"pa' },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: 'th":"a.txt"}' },
          },
          { type: 'content_block_stop', index: 1 },
        ],
        final: { stop_reason: 'tool_use' },
      },
    ]);
    const tool = {
      name: 'read_file' as const,
      description: 'd',
      inputSchema: z.object({ path: z.string() }),
      kind: 'read' as const,
      run: async () => ({ output: '', isError: false }),
    };
    const p = createClaudeProvider(makeCtx());
    const events = await drain(p.stream(req({ tools: [tool] })));
    expect(events).toEqual([
      { type: 'text_delta', text: 'Reading…' },
      { type: 'tool_call', callId: 'toolu_1', name: 'read_file', input: { path: 'a.txt' } },
      { type: 'usage', inputTokens: 11, outputTokens: 7 },
      { type: 'done', stopReason: 'tool_use', detail: undefined },
    ]);
    const tools = mock.calls[0]?.params['tools'] as Array<Record<string, unknown>>;
    expect(tools[0]).toMatchObject({ name: 'read_file', description: 'd' });
    expect(tools[0]?.['input_schema']).toMatchObject({
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    });
    expect(tools[0]?.['input_schema']).not.toHaveProperty('$schema');
  });

  it('maps max_tokens and refusal stop reasons (with explanation)', async () => {
    mock.scriptStreams([
      { events: [], final: { stop_reason: 'max_tokens' } },
      {
        events: [],
        final: {
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'cyber', explanation: 'nope' },
        },
      },
    ]);
    const p = createClaudeProvider(makeCtx());
    expect((await drain(p.stream(req()))).at(-1)).toEqual({
      type: 'done',
      stopReason: 'max_tokens',
      detail: undefined,
    });
    expect((await drain(p.stream(req()))).at(-1)).toEqual({
      type: 'done',
      stopReason: 'refusal',
      detail: 'nope',
    });
  });

  it('turns model_context_window_exceeded into a context_length error', async () => {
    mock.scriptStreams([{ events: [], final: { stop_reason: 'model_context_window_exceeded' } }]);
    const last = (await drain(createClaudeProvider(makeCtx()).stream(req()))).at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.error.category).toBe('context_length');
      expect(last.error.hint).toMatch(/\/clear/);
    }
  });

  it('emits done cancelled (not error) within 500ms when the signal aborts mid-stream', async () => {
    mock.scriptStreams([
      {
        events: [
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } },
        ],
        hangUntilAbort: true,
      },
    ]);
    const ac = new AbortController();
    const p = createClaudeProvider(makeCtx());
    const it = p.stream(req({ signal: ac.signal }))[Symbol.asyncIterator]();
    expect((await it.next()).value).toEqual({ type: 'text_delta', text: 'partial' });
    const started = Date.now();
    const pending = it.next();
    ac.abort();
    const r = await pending;
    expect(Date.now() - started).toBeLessThan(500);
    expect(r.value).toEqual({ type: 'done', stopReason: 'cancelled' });
    expect((await it.next()).done).toBe(true);
  });

  it('maps SDK errors to MaestroError categories without leaking the key', async () => {
    const key = 'sk-ant-supersecret-7777';
    const cases: Array<[unknown, string, RegExp?]> = [
      [
        new mock.AuthenticationError(401, `invalid x-api-key ${key}`),
        'auth',
        /ant auth login|ANTHROPIC_API_KEY/,
      ],
      [new mock.PermissionDeniedError(403, 'forbidden'), 'auth'],
      [new mock.RateLimitError(429, 'slow down'), 'rate_limit'],
      [new mock.APIConnectionError(`getaddrinfo ENOTFOUND api ${key}`), 'network'],
      [
        new mock.BadRequestError(400, 'prompt is too long: 250000 tokens > 200000 maximum'),
        'context_length',
      ],
      [new mock.BadRequestError(400, 'some other problem'), 'provider'],
      [new mock.APIError(500, `boom ${key}`), 'provider'],
      [new Error('weird'), 'unknown'],
    ];
    for (const [err, category, hint] of cases) {
      mock.scriptStreams([{ events: [], throwDuring: err }]);
      const p = createClaudeProvider(
        makeCtx({ providers: { claude: { apiKey: key } } }, { credentials: { claude: 'none' } }),
      );
      const last = (await drain(p.stream(req()))).at(-1);
      expect(last?.type).toBe('error');
      if (last?.type === 'error') {
        expect(last.error.category).toBe(category);
        expect(last.error.providerId).toBe('claude');
        expect(last.error.message).not.toContain(key);
        expect(last.error.hint ?? '').not.toContain(key);
        if (hint) expect(last.error.hint).toMatch(hint);
      }
    }
  });
});

describe('claude provider — history conversion', () => {
  it('converts user/assistant/tool messages; all tool results of a turn share one user message', () => {
    const now = new Date();
    const out = toAnthropicMessages([
      { id: '1', role: 'user', content: [{ type: 'text', text: 'read a and b' }], createdAt: now },
      {
        id: '2',
        role: 'assistant',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_call', callId: 't1', name: 'read_file', input: { path: 'a' } },
          { type: 'tool_call', callId: 't2', name: 'read_file', input: { path: 'b' } },
        ],
        createdAt: now,
      },
      {
        id: '3',
        role: 'tool',
        content: [
          { type: 'tool_result', callId: 't1', output: 'A', isError: false },
          { type: 'tool_result', callId: 't2', output: 'missing', isError: true },
        ],
        createdAt: now,
      },
      { id: '4', role: 'assistant', content: [{ type: 'text', text: 'done' }], createdAt: now },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'read a and b' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a' } },
          { type: 'tool_use', id: 't2', name: 'read_file', input: { path: 'b' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'A', is_error: false },
          { type: 'tool_result', tool_use_id: 't2', content: 'missing', is_error: true },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ]);
  });

  it('converts tool definitions to JSON schema without $schema', () => {
    const t = toAnthropicTools([
      {
        name: 'list_directory',
        description: 'ls',
        inputSchema: z.object({ path: z.string().optional() }),
        kind: 'read' as const,
        run: async () => ({ output: '', isError: false }),
      },
    ]);
    expect(t[0]).toMatchObject({
      name: 'list_directory',
      input_schema: { type: 'object', additionalProperties: false },
    });
    expect(t[0]?.input_schema).not.toHaveProperty('$schema');
  });
});
