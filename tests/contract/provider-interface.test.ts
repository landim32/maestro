import { describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => import('../helpers/anthropicMock.js'));
vi.mock('openai', () => import('../helpers/openaiMock.js'));

import * as anthropic from '../helpers/anthropicMock.js';
import * as openai from '../helpers/openaiMock.js';
import { createClaudeProvider } from '../../src/providers/claude.js';
import { createQwenProvider } from '../../src/providers/qwen.js';
import type { ModelProvider, ProviderEvent, ProviderRequest } from '../../src/providers/types.js';
import { MaestroError } from '../../src/utils/errors.js';
import { makeCtx } from '../helpers/context.js';
import { createFakeProvider } from '../helpers/fakeProvider.js';

const TERMINAL = new Set(['done', 'error']);

function req(signal = new AbortController().signal): ProviderRequest {
  return {
    messages: [
      { id: '1', role: 'user', content: [{ type: 'text', text: 'hi' }], createdAt: new Date() },
    ],
    system: 's',
    tools: [],
    signal,
  };
}

async function drain(p: ModelProvider, r: ProviderRequest) {
  const out: ProviderEvent[] = [];
  for await (const e of p.stream(r)) out.push(e);
  return out;
}

interface Subject {
  name: string;
  make(): ModelProvider;
  scriptText(): void;
  scriptTool(): void;
  scriptHang(): void;
  scriptError(): void;
}

const subjects: Subject[] = [
  {
    name: 'claude',
    make: () => createClaudeProvider(makeCtx()),
    scriptText: () =>
      anthropic.scriptStreams([
        {
          events: [
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } },
          ],
        },
      ]),
    scriptTool: () =>
      anthropic.scriptStreams([
        {
          events: [
            {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', id: 't', name: 'read_file', input: {} },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: '{"path":"p"}' },
            },
            { type: 'content_block_stop', index: 0 },
          ],
          final: { stop_reason: 'tool_use' },
        },
      ]),
    scriptHang: () =>
      anthropic.scriptStreams([
        {
          events: [
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } },
          ],
          hangUntilAbort: true,
        },
      ]),
    scriptError: () =>
      anthropic.scriptStreams([{ events: [], throwDuring: new anthropic.APIError(500, 'x') }]),
  },
  {
    name: 'qwen',
    make: () =>
      createQwenProvider(makeCtx({ providers: { qwen: { enabled: true, apiKey: 'k-1234' } } })),
    scriptText: () =>
      openai.scriptCompletions([
        { chunks: [{ choices: [{ index: 0, delta: { content: 'a' }, finish_reason: 'stop' }] }] },
      ]),
    scriptTool: () =>
      openai.scriptCompletions([
        {
          chunks: [
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 't',
                        function: { name: 'read_file', arguments: '{"path":"p"}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            },
          ],
        },
      ]),
    scriptHang: () =>
      openai.scriptCompletions([
        {
          chunks: [{ choices: [{ index: 0, delta: { content: 'a' }, finish_reason: null }] }],
          hangUntilAbort: true,
        },
      ]),
    scriptError: () =>
      openai.scriptCompletions([{ chunks: [], rejectWith: new openai.APIError(500, 'x') }]),
  },
  {
    name: 'fake',
    make: () =>
      createFakeProvider(
        (_r, i) => {
          if (i === 0)
            return [
              { type: 'text_delta', text: 'a' },
              { type: 'done', stopReason: 'end_turn' },
            ];
          if (i === 1)
            return [
              { type: 'tool_call', callId: 't', name: 'read_file', input: { path: 'p' } },
              { type: 'done', stopReason: 'tool_use' },
            ];
          if (i === 2)
            return [
              { type: 'text_delta', text: 'a' },
              { type: 'text_delta', text: 'b' },
              { type: 'text_delta', text: 'c' },
              { type: 'done', stopReason: 'end_turn' },
            ];
          return [
            {
              type: 'error',
              error: new MaestroError({ category: 'provider', message: 'x', providerId: 'claude' }),
            },
          ];
        },
        { delayMs: 30 },
      ),
    scriptText: () => {},
    scriptTool: () => {},
    scriptHang: () => {},
    scriptError: () => {},
  },
];

describe.each(subjects)('contract: ModelProvider guarantees — $name', (s) => {
  it('G1: zero+ deltas, at most one usage, exactly one terminal event, nothing after it', async () => {
    const p = s.make();
    s.scriptText();
    const events = await drain(p, req());
    const terminals = events.filter((e) => TERMINAL.has(e.type));
    expect(terminals).toHaveLength(1);
    expect(TERMINAL.has(events.at(-1)!.type)).toBe(true);
    expect(events.filter((e) => e.type === 'usage').length).toBeLessThanOrEqual(1);
  });

  it('G3: tool_call carries a parsed object input and done tool_use follows', async () => {
    const p = s.make();
    if (s.name === 'fake') await drain(p, req()); // advance script to call #1
    s.scriptTool();
    const events = await drain(p, req());
    const call = events.find((e) => e.type === 'tool_call');
    expect(call).toMatchObject({
      type: 'tool_call',
      callId: 't',
      name: 'read_file',
      input: { path: 'p' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'tool_use' });
  });

  it('G2: aborting the signal ends the stream with done cancelled within 500ms (no error event)', async () => {
    const p = s.make();
    if (s.name === 'fake') {
      await drain(p, req());
      await drain(p, req());
    }
    s.scriptHang();
    const ac = new AbortController();
    const events: ProviderEvent[] = [];
    const started = Date.now();
    for await (const e of p.stream(req(ac.signal))) {
      events.push(e);
      if (e.type === 'text_delta') ac.abort();
    }
    expect(Date.now() - started).toBeLessThan(500);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'cancelled' });
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('G4: failures surface as a MaestroError event with providerId, never as a thrown SDK error', async () => {
    const p = s.make();
    if (s.name === 'fake') for (let i = 0; i < 3; i++) await drain(p, req());
    s.scriptError();
    const events = await drain(p, req());
    const last = events.at(-1);
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.error).toBeInstanceOf(MaestroError);
      expect(last.error.providerId).toBeDefined();
    }
  });

  it('G7: status() works without network', () => {
    const st = s.make().status();
    expect(typeof st.configured).toBe('boolean');
    expect(Array.isArray(st.missing)).toBe(true);
  });
});
