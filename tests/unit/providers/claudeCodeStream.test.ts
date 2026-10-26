import { describe, expect, it } from 'vitest';
import {
  buildArgs,
  buildUserMessage,
  mcpConfigJson,
  MCP_TOOL_PREFIX,
  newParserState,
  parseLine,
  resultError,
  toolNamingNote,
  usageOf,
} from '../../../src/providers/claudeCodeStream.js';
import type { ResultLine } from '../../../src/providers/claudeCodeStream.js';
import type { Message } from '../../../src/providers/types.js';

const msg = (role: Message['role'], content: Message['content'], extra: Partial<Message> = {}) =>
  ({ id: Math.random().toString(36), role, content, createdAt: new Date(), ...extra }) as Message;

const clean = (s: string) => s;

describe('claudeCodeStream — arguments (research R1/R2)', () => {
  it('isolates Claude Code: no built-in tools, no user MCP, no commands, no session on disk', () => {
    const args = buildArgs({ model: 'claude-opus-5-5', systemPromptFile: '/t/s.txt' });
    expect(args.slice(0, 7)).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]);
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    for (const flag of [
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
    ])
      expect(args).toContain(flag);
    expect(args[args.indexOf('--permission-prompts') + 1]).toBe('none');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5-5');
    expect(args[args.indexOf('--system-prompt-file') + 1]).toBe('/t/s.txt');
    expect(args).not.toContain('--mcp-config');
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('--safe-mode');
    expect(args).not.toContain('--bare');
  });

  it('adds effort and the MCP bridge with only Maestro tools allowed', () => {
    const args = buildArgs({
      model: 'm',
      effort: 'high',
      systemPromptFile: 's',
      mcpConfigFile: '/t/mcp.json',
    });
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('/t/mcp.json');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(`${MCP_TOOL_PREFIX}*`);
  });

  it('MCP config points at the loopback bridge with a bearer token', () => {
    const cfg = JSON.parse(mcpConfigJson('http://127.0.0.1:5000/mcp', 'tok'));
    expect(cfg).toEqual({
      mcpServers: {
        maestro: {
          type: 'http',
          url: 'http://127.0.0.1:5000/mcp',
          headers: { Authorization: 'Bearer tok' },
        },
      },
    });
  });

  it('tool naming note maps short names to the prefixed ones', () => {
    expect(toolNamingNote([])).toBe('');
    expect(toolNamingNote(['read_file'])).toContain('read_file → mcp__maestro__read_file');
  });
});

describe('claudeCodeStream — stdin message (research R5)', () => {
  it('a single user message goes as is', () => {
    const m = buildUserMessage([msg('user', [{ type: 'text', text: 'oi' }])]);
    expect(m).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'oi' }] },
    });
  });

  it('earlier messages (any provider) become a history block; the last user keeps images', () => {
    const m = buildUserMessage([
      msg('user', [{ type: 'text', text: 'leia a.txt' }]),
      msg(
        'assistant',
        [{ type: 'tool_call', callId: 'c1', name: 'read_file', input: { path: 'a.txt' } }],
        {
          providerId: 'qwen',
          model: 'qwen3-max',
        },
      ),
      msg('tool', [{ type: 'tool_result', callId: 'c1', output: 'conteúdo', isError: false }]),
      msg('assistant', [{ type: 'text', text: 'feito' }], { providerId: 'qwen' }),
      msg('user', [
        { type: 'text', text: 'e agora?' },
        { type: 'image', mediaType: 'image/png', data: 'AAAA', name: 'x.png' },
      ]),
    ]);
    const [history, text, image] = m.message.content;
    expect(history?.type).toBe('text');
    const h = history?.type === 'text' ? history.text : '';
    expect(h).toContain('<conversation_history>');
    expect(h).toContain('### usuário\nleia a.txt');
    expect(h).toContain('### assistente (qwen / qwen3-max)');
    expect(h).toContain('[chamada de ferramenta read_file c1] {"path":"a.txt"}');
    expect(h).toContain('[resultado c1] conteúdo');
    expect(h).not.toContain('e agora?');
    expect(text).toEqual({ type: 'text', text: 'e agora?' });
    expect(image).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
  });

  it('long tool outputs are clipped in the history', () => {
    const m = buildUserMessage([
      msg('tool', [{ type: 'tool_result', callId: 'c', output: 'x'.repeat(5000), isError: true }]),
      msg('user', [{ type: 'text', text: 'ok' }]),
    ]);
    const h = m.message.content[0]?.type === 'text' ? m.message.content[0].text : '';
    expect(h).toContain('(erro)');
    expect(h).toContain('(+3000 caracteres)');
  });
});

describe('claudeCodeStream — stdout parser (research R1)', () => {
  const delta = (text: string, id = 'msg_1', parent: string | null = null) =>
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      parent_tool_use_id: parent,
      api_message_id: id,
    });

  it('streams top-level text deltas only', () => {
    const st = newParserState();
    expect(parseLine(delta('Olá'), st)).toEqual([{ type: 'text_delta', text: 'Olá' }]);
    expect(parseLine(delta('sub', 'msg_2', 'toolu_1'), st)).toEqual([]);
    expect(parseLine('not json', st)).toEqual([]);
    expect(parseLine('{"type":"system","subtype":"init"}', st)).toEqual([]);
  });

  it('falls back to the full assistant message when it was not streamed', () => {
    const st = newParserState();
    parseLine(delta('a', 'msg_1'), st);
    const full = (id: string, model = 'claude-haiku-5-5') =>
      JSON.stringify({
        type: 'assistant',
        message: { id, model, content: [{ type: 'text', text: 'texto completo' }] },
        parent_tool_use_id: null,
      });
    expect(parseLine(full('msg_1'), st)).toEqual([]);
    expect(parseLine(full('msg_9'), st)).toEqual([{ type: 'text_delta', text: 'texto completo' }]);
    expect(parseLine(full('msg_x', '<synthetic>'), st)).toEqual([]);
  });

  it('keeps the result and a rejected rate limit', () => {
    const st = newParserState();
    parseLine(
      JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', resetsAt: 1 },
      }),
      st,
    );
    parseLine(JSON.stringify({ type: 'result', is_error: false, usage: { output_tokens: 3 } }), st);
    expect(st.rateLimitResetsAt).toBe(1);
    expect(st.result?.usage?.output_tokens).toBe(3);
  });

  it('usage counts cache tokens as input', () => {
    expect(
      usageOf({
        type: 'result',
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 600,
          cache_read_input_tokens: 10,
          output_tokens: 4,
        },
      }),
    ).toEqual({ inputTokens: 612, outputTokens: 4 });
  });
});

describe('claudeCodeStream — errors (research R6)', () => {
  const r = (partial: Partial<ResultLine>): ResultLine => ({ type: 'result', ...partial });

  it('success has no error', () => {
    expect(resultError(r({ is_error: false }), newParserState(), clean)).toBeUndefined();
  });
  it('401 → auth with the login hint', () => {
    const e = resultError(
      r({ is_error: true, api_error_status: 401, result: 'Invalid' }),
      newParserState(),
      clean,
    );
    expect(e?.category).toBe('auth');
    expect(e?.hint).toContain('/login');
    expect(e?.providerId).toBe('claude-code');
  });
  it('429 or a rejected rate limit → rate_limit with the reset time', () => {
    const st = newParserState();
    st.rateLimitResetsAt = Date.UTC(2026, 9, 25, 15, 30) / 1000;
    const e = resultError(r({ is_error: true, result: 'limit' }), st, clean);
    expect(e?.category).toBe('rate_limit');
    expect(e?.message).toMatch(/libera de novo às \d\d:\d\d/);
    expect(
      resultError(r({ is_error: true, api_error_status: 429 }), newParserState(), clean)?.category,
    ).toBe('rate_limit');
  });
  it('a connection failure → network (retried by runTurn)', () => {
    const e = resultError(
      r({ is_error: true, result: 'API Error: Connection error. (fetch failed)' }),
      newParserState(),
      clean,
    );
    expect(e).toMatchObject({ category: 'network', providerId: 'claude-code' });
  });
  it('anything else → provider with the CLI message', () => {
    const e = resultError(
      r({
        is_error: true,
        api_error_status: 404,
        result: 'There is an issue with the selected model',
      }),
      newParserState(),
      clean,
    );
    expect(e).toMatchObject({
      category: 'provider',
      message: 'There is an issue with the selected model',
    });
  });
});

describe('claudeCodeStream — usage limit wait (never stop)', () => {
  it('a rejected subscription limit carries the wait until its reset (+5 s)', () => {
    const st = newParserState();
    st.rateLimitResetsAt = Math.floor(Date.now() / 1000) + 600;
    const e = resultError({ type: 'result', is_error: true, result: 'usage limit' }, st, (s) => s);
    expect(e?.category).toBe('rate_limit');
    expect(e?.retryAfterMs).toBeGreaterThan(590_000);
    expect(e?.retryAfterMs).toBeLessThanOrEqual(606_000);
  });
});
