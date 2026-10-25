import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('openai', () => import('../../helpers/openaiMock.js'));

import * as mock from '../../helpers/openaiMock.js';
import {
  createQwenProvider,
  toOpenAIMessages,
  toOpenAITools,
} from '../../../src/providers/qwen.js';
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

const qwenCfg = { providers: { qwen: { enabled: true, apiKey: 'sk-qwen-config-1111' } } };
const chunk = (
  delta: Record<string, unknown>,
  finish: string | null = null,
  usage?: Record<string, number>,
) => ({
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(usage ? { usage } : {}),
});

beforeEach(() => {
  mock.ctorSpy.mockClear();
  mock.scriptCompletions([]);
});

describe('qwen provider — construction and status', () => {
  it('prefers DASHSCOPE_API_KEY over the config key and uses the configured baseUrl', () => {
    createQwenProvider(
      makeCtx(qwenCfg, { env: { DASHSCOPE_API_KEY: 'sk-env-2222' }, credentials: { qwen: 'env' } }),
    );
    expect(mock.ctorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-env-2222',
        baseURL: 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
      }),
    );
  });
  it('status is not configured without a key, disabled when enabled=false, ready otherwise', () => {
    const none = createQwenProvider(makeCtx({ providers: { qwen: { enabled: true } } })).status();
    expect(none.configured).toBe(false);
    expect(none.missing).toEqual(['apiKey']);
    expect(none.hint).toMatch(/DASHSCOPE_API_KEY/);
    const disabled = createQwenProvider(
      makeCtx({ providers: { qwen: { apiKey: 'k-9999' } } }, { credentials: { qwen: 'config' } }),
    ).status();
    expect(disabled.enabled).toBe(false);
    expect(disabled.configured).toBe(false);
    const ready = createQwenProvider(
      makeCtx(qwenCfg, { credentials: { qwen: 'config' } }),
    ).status();
    expect(ready.configured).toBe(true);
    expect(ready.maskedKey).toBe('****1111');
    expect(ready.credentialSource).toBe('config');
  });
  it('streams an auth error without network when there is no key', async () => {
    const p = createQwenProvider(makeCtx({ providers: { qwen: { enabled: true } } }));
    const ev = await drain(p.stream(req()));
    expect(ev).toHaveLength(1);
    expect(ev[0]?.type === 'error' && ev[0].error.category).toBe('auth');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('qwen provider — streaming', () => {
  it('emits text deltas, usage (include_usage) and done end_turn', async () => {
    mock.scriptCompletions([
      {
        chunks: [
          chunk({ role: 'assistant', content: '' }),
          chunk({ content: 'Hel' }),
          chunk({ content: 'lo' }, 'stop'),
          { choices: [], usage: { prompt_tokens: 9, completion_tokens: 3 } },
        ],
      },
    ]);
    const p = createQwenProvider(makeCtx(qwenCfg));
    const events = await drain(p.stream(req({ model: 'qwen-max' })));
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'usage', inputTokens: 9, outputTokens: 3 },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    expect(mock.calls[0]?.params).toMatchObject({
      model: 'qwen-max',
      max_tokens: 16000,
      stream: true,
      stream_options: { include_usage: true },
    });
    const msgs = mock.calls[0]?.params['messages'] as Array<Record<string, unknown>>;
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys' });
    expect(mock.calls[0]?.options.signal).toBeInstanceOf(AbortSignal);
  });

  it('accumulates tool call fragments by index and emits tool_call + done tool_use', async () => {
    mock.scriptCompletions([
      {
        chunks: [
          chunk({
            tool_calls: [
              {
                index: 0,
                id: 'call_a',
                type: 'function',
                function: { name: 'read_file', arguments: '' },
              },
            ],
          }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: '"x.txt"}' } }] }),
          chunk({
            tool_calls: [
              {
                index: 1,
                id: 'call_b',
                type: 'function',
                function: { name: 'list_directory', arguments: '{}' },
              },
            ],
          }),
          chunk({}, 'tool_calls'),
        ],
      },
    ]);
    const tool = {
      name: 'read_file' as const,
      description: 'd',
      inputSchema: z.object({ path: z.string() }),
      requiresConfirmation: false,
      run: async () => ({ output: '', isError: false }),
    };
    const events = await drain(createQwenProvider(makeCtx(qwenCfg)).stream(req({ tools: [tool] })));
    expect(events).toEqual([
      { type: 'tool_call', callId: 'call_a', name: 'read_file', input: { path: 'x.txt' } },
      { type: 'tool_call', callId: 'call_b', name: 'list_directory', input: {} },
      { type: 'done', stopReason: 'tool_use' },
    ]);
    const tools = mock.calls[0]?.params['tools'] as Array<Record<string, unknown>>;
    expect(tools[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'd',
        parameters: { type: 'object', required: ['path'] },
      },
    });
  });

  it('maps finish reasons length → max_tokens and content_filter → refusal', async () => {
    mock.scriptCompletions([
      { chunks: [chunk({ content: 'x' }, 'length')] },
      { chunks: [chunk({}, 'content_filter')] },
    ]);
    const p = createQwenProvider(makeCtx(qwenCfg));
    expect((await drain(p.stream(req()))).at(-1)).toEqual({
      type: 'done',
      stopReason: 'max_tokens',
    });
    expect((await drain(p.stream(req()))).at(-1)).toEqual({ type: 'done', stopReason: 'refusal' });
  });

  it('emits done cancelled quickly when aborted mid-stream', async () => {
    mock.scriptCompletions([{ chunks: [chunk({ content: 'partial' })], hangUntilAbort: true }]);
    const ac = new AbortController();
    const it = createQwenProvider(makeCtx(qwenCfg))
      .stream(req({ signal: ac.signal }))
      [Symbol.asyncIterator]();
    expect((await it.next()).value).toEqual({ type: 'text_delta', text: 'partial' });
    const started = Date.now();
    const next = it.next();
    ac.abort();
    expect((await next).value).toEqual({ type: 'done', stopReason: 'cancelled' });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('maps SDK errors (thrown by create or during iteration) without leaking the key', async () => {
    const key = 'sk-qwen-config-1111';
    const cases: Array<[unknown, string, boolean]> = [
      [new mock.AuthenticationError(401, `Incorrect API key provided: ${key}`), 'auth', true],
      [new mock.RateLimitError(429, 'rate'), 'rate_limit', true],
      [new mock.APIConnectionError(`connect ECONNREFUSED ${key}`), 'network', false],
      [
        new mock.BadRequestError(400, "This model's maximum context length is 32768 tokens"),
        'context_length',
        true,
      ],
      [new mock.BadRequestError(400, 'bad param'), 'provider', false],
      [new mock.APIError(503, `upstream ${key}`), 'provider', true],
    ];
    for (const [err, category, viaCreate] of cases) {
      mock.scriptCompletions([
        viaCreate ? { chunks: [], rejectWith: err } : { chunks: [], throwDuring: err },
      ]);
      const last = (await drain(createQwenProvider(makeCtx(qwenCfg)).stream(req()))).at(-1);
      expect(last?.type).toBe('error');
      if (last?.type === 'error') {
        expect(last.error.category).toBe(category);
        expect(last.error.providerId).toBe('qwen');
        expect(last.error.message).not.toContain(key);
      }
    }
  });
});

describe('qwen provider — history conversion', () => {
  it('emits one tool message per result and stringifies tool arguments', () => {
    const now = new Date();
    const out = toOpenAIMessages('S', [
      { id: '1', role: 'user', content: [{ type: 'text', text: 'go' }], createdAt: now },
      {
        id: '2',
        role: 'assistant',
        content: [
          { type: 'tool_call', callId: 'c1', name: 'read_file', input: { path: 'a' } },
          { type: 'tool_call', callId: 'c2', name: 'list_directory', input: {} },
        ],
        createdAt: now,
      },
      {
        id: '3',
        role: 'tool',
        content: [
          { type: 'tool_result', callId: 'c1', output: 'A', isError: false },
          { type: 'tool_result', callId: 'c2', output: 'nope', isError: true },
        ],
        createdAt: now,
      },
      { id: '4', role: 'assistant', content: [{ type: 'text', text: 'done' }], createdAt: now },
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a"}' },
          },
          { id: 'c2', type: 'function', function: { name: 'list_directory', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'A' },
      { role: 'tool', tool_call_id: 'c2', content: 'ERROR: nope' },
      { role: 'assistant', content: 'done' },
    ]);
  });
  it('converts tools to function definitions without $schema', () => {
    const t = toOpenAITools([
      {
        name: 'run_command',
        description: 'sh',
        inputSchema: z.object({ command: z.string() }),
        requiresConfirmation: true,
        run: async () => ({ output: '', isError: false }),
      },
    ]);
    expect(t[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'run_command',
        parameters: { type: 'object', additionalProperties: false },
      },
    });
    expect((t[0] as { function: { parameters: object } }).function.parameters).not.toHaveProperty(
      '$schema',
    );
  });
});
