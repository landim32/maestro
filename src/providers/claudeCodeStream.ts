/**
 * Pure helpers for the Claude Code provider (specs/010 research R1–R6): command-line arguments,
 * the stdin message carrying the conversation, and the stdout stream-json parser.
 */
import { looksLikeNetworkError, MaestroError } from '../utils/errors.js';
import type { ContentPart, Message, ProviderEvent } from './types.js';
import type { Effort } from '../config/schema.js';

/** Name of the MCP server exposing Maestro's tools; Claude Code prefixes tools with it. */
export const MCP_SERVER_NAME = 'maestro';
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** Longest tool input/output quoted per call in the serialized history. */
export const HISTORY_SNIPPET_CHARS = 2_000;

export interface ArgsOptions {
  model: string;
  effort?: Effort;
  systemPromptFile: string;
  /** Path of the MCP config file; absent when the turn has no tools. */
  mcpConfigFile?: string;
}

/**
 * Arguments for `claude -p` (R1/R2): stream-json in and out, no built-in tools, no user MCP
 * servers, commands or skills, no session written to disk, and nobody asked for permissions
 * (the approval policy runs in Maestro, inside the tool calls).
 */
export function buildArgs(o: ArgsOptions): string[] {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--permission-prompts',
    'none',
    '--model',
    o.model,
    '--system-prompt-file',
    o.systemPromptFile,
  ];
  if (o.effort) args.push('--effort', o.effort);
  if (o.mcpConfigFile) {
    args.push('--mcp-config', o.mcpConfigFile, '--allowedTools', `${MCP_TOOL_PREFIX}*`);
  }
  return args;
}

export function mcpConfigJson(url: string, token: string): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
    },
  });
}

/** Note appended to the system prompt so the model maps tool names correctly. */
export function toolNamingNote(toolNames: string[]): string {
  if (toolNames.length === 0) return '';
  const list = toolNames.map((n) => `${n} → ${MCP_TOOL_PREFIX}${n}`).join(', ');
  return `\n\nAs ferramentas do Maestro estão disponíveis com o prefixo ${MCP_TOOL_PREFIX} (${list}). Quando as instruções mencionarem uma ferramenta pelo nome curto, use o nome com o prefixo.`;
}

function clip(s: string, max = HISTORY_SNIPPET_CHARS): string {
  return s.length <= max ? s : `${s.slice(0, max)}… (+${s.length - max} caracteres)`;
}

function renderPart(p: ContentPart): string {
  switch (p.type) {
    case 'text':
      return p.text;
    case 'image':
      return `[imagem anexada${p.name ? `: ${p.name}` : ''}]`;
    case 'tool_call': {
      let input: string;
      try {
        input = JSON.stringify(p.input);
      } catch {
        input = String(p.input);
      }
      return `[chamada de ferramenta ${p.name} ${p.callId}] ${clip(input)}`;
    }
    case 'tool_result':
      return `[resultado ${p.callId}${p.isError ? ' (erro)' : ''}] ${clip(p.output)}`;
  }
}

/** Plain-text rendering of earlier messages (R5); assistant turns may come from other providers. */
export function renderHistory(messages: Message[]): string {
  const blocks = messages.map((m) => {
    const who =
      m.role === 'user'
        ? 'usuário'
        : m.role === 'assistant'
          ? `assistente${m.providerId ? ` (${m.providerId}${m.model ? ` / ${m.model}` : ''})` : ''}`
          : 'ferramenta';
    return `### ${who}\n${m.content.map(renderPart).join('\n')}`;
  });
  return blocks.join('\n\n');
}

type UserBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface StdinUserMessage {
  type: 'user';
  message: { role: 'user'; content: UserBlock[] };
}

/**
 * The single stdin message (R5): earlier messages as a `<conversation_history>` block, then the
 * last user message with its original parts (images included).
 */
export function buildUserMessage(messages: Message[]): StdinUserMessage {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUser = i;
      break;
    }
  }
  const earlier = lastUser >= 0 ? messages.slice(0, lastUser) : messages;
  const after = lastUser >= 0 ? messages.slice(lastUser + 1) : [];
  const content: UserBlock[] = [];
  const history = [...earlier, ...after];
  if (history.length > 0) {
    const label =
      after.length > 0
        ? 'Histórico da conversa (inclui ações já executadas depois do último pedido):'
        : 'Histórico da conversa até aqui (respostas anteriores podem ser de outros modelos):';
    content.push({
      type: 'text',
      text: `${label}\n<conversation_history>\n${renderHistory(history)}\n</conversation_history>`,
    });
  }
  if (lastUser >= 0) {
    for (const p of messages[lastUser]!.content) {
      if (p.type === 'text' && p.text !== '') content.push({ type: 'text', text: p.text });
      else if (p.type === 'image')
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: p.mediaType, data: p.data },
        });
    }
  }
  if (content.length === 0 || (lastUser < 0 && history.length > 0)) {
    content.push({ type: 'text', text: 'Continue.' });
  }
  return { type: 'user', message: { role: 'user', content } };
}

// ------------------------------------------------------------------ stdout parser

export interface ResultLine {
  type: 'result';
  is_error?: boolean;
  subtype?: string;
  result?: string;
  api_error_status?: number | null;
  terminal_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** State kept across lines of one run. */
export interface ParserState {
  /** api_message_id values whose text already arrived as partial deltas. */
  streamed: Set<string>;
  result?: ResultLine;
  /** Epoch seconds when a rejected rate limit resets, if Claude Code reported one. */
  rateLimitResetsAt?: number;
}

export function newParserState(): ParserState {
  return { streamed: new Set() };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * One stdout line → provider events. Only top-level text is surfaced (subagent output has a
 * `parent_tool_use_id`); tool calls are handled by the MCP bridge, not by this parser.
 */
export function parseLine(line: string, st: ParserState): ProviderEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return [];
  let o: unknown;
  try {
    o = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!isObj(o)) return [];
  if (o['parent_tool_use_id']) return [];

  switch (o['type']) {
    case 'stream_event': {
      const ev = o['event'];
      if (!isObj(ev) || ev['type'] !== 'content_block_delta') return [];
      const delta = ev['delta'];
      if (!isObj(delta) || delta['type'] !== 'text_delta' || typeof delta['text'] !== 'string')
        return [];
      if (typeof o['api_message_id'] === 'string') st.streamed.add(o['api_message_id']);
      return delta['text'] ? [{ type: 'text_delta', text: delta['text'] }] : [];
    }
    case 'assistant': {
      // Fallback when partial messages were not streamed for this message.
      const msg = o['message'];
      if (!isObj(msg)) return [];
      const id = typeof msg['id'] === 'string' ? msg['id'] : undefined;
      if (id && st.streamed.has(id)) return [];
      if (msg['model'] === '<synthetic>') return []; // error text; the result line reports it
      const content = Array.isArray(msg['content']) ? msg['content'] : [];
      const text = content
        .filter((b): b is Json => isObj(b) && b['type'] === 'text' && typeof b['text'] === 'string')
        .map((b) => b['text'] as string)
        .join('');
      return text ? [{ type: 'text_delta', text }] : [];
    }
    case 'rate_limit_event': {
      const info = o['rate_limit_info'];
      if (isObj(info) && info['status'] === 'rejected' && typeof info['resetsAt'] === 'number')
        st.rateLimitResetsAt = info['resetsAt'];
      return [];
    }
    case 'result':
      st.result = o as unknown as ResultLine;
      return [];
    default:
      return [];
  }
}

export function usageOf(r: ResultLine): { inputTokens: number; outputTokens: number } {
  const u = r.usage ?? {};
  return {
    inputTokens:
      (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
  };
}

function resetText(epochSeconds: number | undefined): string {
  if (!epochSeconds) return '';
  const d = new Date(epochSeconds * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `; libera de novo às ${hh}:${mm}`;
}

export const LOGIN_HINT =
  'Abra o Claude Code (comando claude) num terminal, faça /login com a sua conta do claude.ai e tente de novo.';

/** Error of a failed run (R6), or undefined when the run succeeded. */
export function resultError(
  r: ResultLine,
  st: ParserState,
  clean: (s: string) => string,
): MaestroError | undefined {
  if (!r.is_error) return undefined;
  const status = r.api_error_status ?? undefined;
  const text = clean(
    (r.result ?? '').trim() || `Claude Code terminou com erro (${r.subtype ?? '?'})`,
  );
  if (status === 401 || status === 403 || /log ?in|authenticat|\/login/i.test(text)) {
    return new MaestroError({
      providerId: 'claude-code',
      category: 'auth',
      message: `o Claude Code não está autenticado: ${text}`,
      hint: LOGIN_HINT,
    });
  }
  if (
    status === 429 ||
    st.rateLimitResetsAt ||
    /usage limit|rate limit|limit reached/i.test(text)
  ) {
    return new MaestroError({
      providerId: 'claude-code',
      category: 'rate_limit',
      message: `limite de uso da assinatura atingido${resetText(st.rateLimitResetsAt)}`,
      hint: text,
      // Wait until the subscription window resets (plus a small margin).
      retryAfterMs: st.rateLimitResetsAt
        ? Math.max(0, st.rateLimitResetsAt * 1000 - Date.now()) + 5_000
        : undefined,
    });
  }
  if (looksLikeNetworkError(text))
    return new MaestroError({
      providerId: 'claude-code',
      category: 'network',
      message: `falha de conexão do Claude Code: ${text}`,
    });
  return new MaestroError({ providerId: 'claude-code', category: 'provider', message: text });
}

/** Last non-empty line of stderr, shortened (used when the process ends without a result). */
export function lastLine(text: string, max = 300): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  return last.length > max ? `${last.slice(0, max)}…` : last;
}
