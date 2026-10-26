import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  codexError,
  codexRetryAfterMs,
  imageExtension,
  MIN_CODEX_VERSION,
  newCodexParserState,
  parseCodexLine,
  parseVersion,
  versionAtLeast,
} from '../../../src/providers/codexStream.js';
import type { Message } from '../../../src/providers/types.js';

const msg = (role: Message['role'], content: Message['content'], extra = {}): Message => ({
  id: Math.random().toString(36),
  role,
  content,
  createdAt: new Date(0),
  ...extra,
});
const line = (o: unknown) => JSON.stringify(o);
const clean = (s: string) => s;

describe('parseCodexLine (contracts/codex-events.md)', () => {
  it('agent messages become text blocks separated by a blank line', () => {
    const st = newCodexParserState();
    expect(
      parseCodexLine(
        line({ type: 'item.completed', item: { type: 'agent_message', text: 'A' } }),
        st,
      ),
    ).toEqual([{ type: 'text_delta', text: 'A' }]);
    expect(
      parseCodexLine(
        line({ type: 'item.completed', item: { type: 'agent_message', text: 'B' } }),
        st,
      ),
    ).toEqual([{ type: 'text_delta', text: '\n\nB' }]);
    expect(st.messages).toBe(2);
  });

  it('turn.completed records usage (reasoning tokens count as output) and completion', () => {
    const st = newCodexParserState();
    const out = parseCodexLine(
      line({
        type: 'turn.completed',
        usage: {
          input_tokens: 100,
          cached_input_tokens: 40,
          output_tokens: 7,
          reasoning_output_tokens: 3,
        },
      }),
      st,
    );
    expect(out).toEqual([]);
    expect(st).toMatchObject({ completed: true, usage: { inputTokens: 100, outputTokens: 10 } });
  });

  it('error items are non-fatal warnings; error / turn.failed are failures (first one wins)', () => {
    const st = newCodexParserState();
    parseCodexLine(line({ type: 'item.completed', item: { type: 'error', message: 'aviso' } }), st);
    expect(st.warnings).toBe(1);
    expect(st.failure).toBeUndefined();
    parseCodexLine(line({ type: 'error', message: 'primeiro' }), st);
    parseCodexLine(line({ type: 'turn.failed', error: { message: 'segundo' } }), st);
    expect(st.failure).toBe('primeiro');
  });

  it('ignores other events, tool items, reasoning and garbage', () => {
    const st = newCodexParserState();
    for (const l of [
      line({ type: 'thread.started', thread_id: 'x' }),
      line({ type: 'turn.started' }),
      line({ type: 'item.started', item: { type: 'mcp_tool_call', tool: 'read_file' } }),
      line({ type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'read_file' } }),
      line({ type: 'item.completed', item: { type: 'reasoning', text: 'pensando' } }),
      line({ type: 'item.completed', item: { type: 'agent_message', text: '' } }),
      'Shell cwd was reset',
      '{not json',
      '[]',
    ]) {
      expect(parseCodexLine(l, st)).toEqual([]);
    }
    expect(st).toMatchObject({ completed: false, messages: 0 });
    expect(st.failure).toBeUndefined();
  });
});

describe('buildPrompt (research R11)', () => {
  it('only the user text when there is no history', () => {
    expect(buildPrompt([msg('user', [{ type: 'text', text: 'oi' }])])).toEqual({
      text: 'oi',
      images: [],
    });
  });

  it('earlier messages go in <conversation_history>, with the provider of each reply', () => {
    const p = buildPrompt([
      msg('user', [{ type: 'text', text: 'primeira' }]),
      msg('assistant', [{ type: 'text', text: 'resposta do qwen' }], {
        providerId: 'qwen',
        model: 'qwen3-max',
      }),
      msg('user', [
        { type: 'text', text: 'segunda' },
        { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'a.png' },
      ]),
    ]);
    expect(p.text).toMatch(/^Histórico da conversa até aqui/);
    expect(p.text).toContain('<conversation_history>');
    expect(p.text).toContain('### assistente (qwen / qwen3-max)\nresposta do qwen');
    expect(p.text.endsWith('</conversation_history>\n\nsegunda')).toBe(true);
    expect(p.images).toEqual([
      { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'a.png' },
    ]);
  });

  it('a continuation without a final user text asks to continue', () => {
    const p = buildPrompt([
      msg('user', [{ type: 'text', text: 'leia' }]),
      msg('assistant', [{ type: 'tool_call', callId: 'c', name: 'read_file', input: {} }]),
    ]);
    expect(p.text).toContain('inclui ações já executadas');
    expect(p.text.endsWith('leia')).toBe(true);
  });

  it('image extensions', () => {
    expect(imageExtension('image/png')).toBe('png');
    expect(imageExtension('image/jpeg')).toBe('jpg');
    expect(imageExtension('image/webp')).toBe('webp');
    expect(imageExtension('weird')).toBe('png');
  });
});

describe('codexError (research R6)', () => {
  const api = (status: number, message: string, code?: string) =>
    JSON.stringify({ type: 'error', status, error: { type: 'x', message, code } });

  it('model_not_found keeps the API message, without raw JSON', () => {
    const e = codexError(
      api(
        400,
        "The 'gpt-x' model is not supported when using Codex with a ChatGPT account.",
        'model_not_found',
      ),
      clean,
    );
    expect(e.category).toBe('provider');
    expect(e.message).toBe(
      "The 'gpt-x' model is not supported when using Codex with a ChatGPT account.",
    );
    expect(e.providerId).toBe('codex');
  });

  it('401 / not logged in → auth with the login hint', () => {
    for (const m of [api(401, 'Unauthorized'), 'Not logged in']) {
      const e = codexError(m, clean);
      expect(e.category).toBe('auth');
      expect(e.hint).toMatch(/codex login/);
    }
  });

  it('429 / usage limit → rate_limit with the wait when the message has one', () => {
    const now = Date.parse('2026-10-25T20:00:00Z');
    const a = codexError(api(429, 'Rate limit reached. Please try again in 30s.'), clean, now);
    expect(a).toMatchObject({ category: 'rate_limit', retryAfterMs: 30_000 });
    const b = codexError(
      "You've hit your usage limit. Upgrade to Plus or try again at 2026-10-25T20:10:00Z.",
      clean,
      now,
    );
    expect(b).toMatchObject({ category: 'rate_limit', retryAfterMs: 605_000 });
    const c = codexError(api(429, 'slow down', 'usage_limit_reached'), clean, now);
    expect(c.category).toBe('rate_limit');
    expect(c.retryAfterMs).toBeUndefined();
  });

  it('anything else is a provider error; the text always goes through clean()', () => {
    const net = codexError('stream disconnected before completion', (s) => s);
    expect(net).toMatchObject({ category: 'network', providerId: 'codex' });
    const e = codexError('something odd sk-secret', (s) => s.replace('sk-secret', '***'));
    expect(e).toMatchObject({ category: 'provider', message: 'something odd ***' });
  });

  it('retry-after parsing', () => {
    expect(codexRetryAfterMs('try again in 1.5 seconds')).toBe(1500);
    expect(codexRetryAfterMs('try again in 250ms')).toBe(250);
    expect(codexRetryAfterMs('try again in 2 minutes')).toBe(120_000);
    expect(codexRetryAfterMs('try again later')).toBeUndefined();
    expect(codexRetryAfterMs('try again at someday.')).toBeUndefined();
  });
});

describe('version (research R3)', () => {
  it('parses `codex --version` and compares with the minimum', () => {
    expect(parseVersion('codex-cli 0.161.0\n')).toBe('0.161.0');
    expect(parseVersion('garbage')).toBeUndefined();
    expect(versionAtLeast('0.161.0', MIN_CODEX_VERSION)).toBe(true);
    expect(versionAtLeast('0.162.3', MIN_CODEX_VERSION)).toBe(true);
    expect(versionAtLeast('1.0.0', MIN_CODEX_VERSION)).toBe(true);
    expect(versionAtLeast('0.160.9', MIN_CODEX_VERSION)).toBe(false);
  });
});
