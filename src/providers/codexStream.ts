/**
 * Pure helpers of the Codex provider (specs/012): command-line arguments, child environment,
 * stdin prompt, the `codex exec --json` event parser and the error mapping. Every decision here
 * was validated with Codex CLI 0.161.0 (research.md).
 */
import { looksLikeNetworkError, MaestroError } from '../utils/errors.js';
import { renderHistory } from './claudeCodeStream.js';
import type { ContentPart, Message, ProviderEvent } from './types.js';
import type { Effort } from '../config/schema.js';

/** Oldest Codex CLI validated with these flags (research R3). */
export const MIN_CODEX_VERSION = '0.161.0';

/** Environment variable that carries the MCP bridge token (never on the command line, R4). */
export const MCP_TOKEN_ENV = 'MAESTRO_MCP_TOKEN';

/** Removed from the child's environment so Codex uses its own login, not an API key (R8). */
export const STRIPPED_ENV_CODEX = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'] as const;

/** Codex's own tools and integrations, all disabled: only Maestro's tools reach the model (R3). */
export const CODEX_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'view_image',
  'image_generation',
  'multi_agent',
  'multi_agent_v2',
  'browser_use',
  'computer_use',
  'apps',
  'plugins',
  'skill_search',
  'tool_suggest',
  'sleep_tool',
  'goals',
  'hooks',
  'memories',
] as const;

export const CODEX_LOGIN_HINT =
  'Faça login no Codex: rode `codex login` num terminal (com a sua conta do ChatGPT) e tente de novo.';

export const CODEX_UPDATE_HINT = `Atualize o Codex para a versão ${MIN_CODEX_VERSION} ou mais nova: npm install -g @openai/codex`;

export interface CodexArgsOptions {
  cwd: string;
  instructionsFile: string;
  model?: string;
  effort?: Effort;
  images?: string[];
  /** URL of the one-turn MCP bridge; absent = no tools. */
  mcpUrl?: string;
}

/**
 * `codex exec` arguments (contracts/codex-invocation.md). `-c` values carry no quotes: Codex
 * takes a value that is not valid TOML literally, and quotes would not survive `cmd /c` (R7).
 */
export function buildCodexArgs(o: CodexArgsOptions): string[] {
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '-C',
    o.cwd,
    '-s',
    'read-only',
    '-c',
    'approval_policy=never',
    '-c',
    'web_search=disabled',
    '-c',
    'project_doc_max_bytes=0',
    // Codex would tell the model its sandbox is read-only, and the model would stop using
    // Maestro's write_file / run_command (observed with 0.161.0); the sandbox still applies.
    '-c',
    'include_permissions_instructions=false',
    '-c',
    'include_environment_context=false',
    '-c',
    `model_instructions_file=${o.instructionsFile}`,
  ];
  for (const f of CODEX_DISABLED_FEATURES) args.push('--disable', f);
  if (o.model) args.push('-m', o.model);
  if (o.effort) args.push('-c', `model_reasoning_effort=${o.effort}`);
  for (const img of o.images ?? []) args.push('-i', img);
  if (o.mcpUrl) {
    args.push(
      '-c',
      `mcp_servers.maestro.url=${o.mcpUrl}`,
      '-c',
      `mcp_servers.maestro.bearer_token_env_var=${MCP_TOKEN_ENV}`,
      '-c',
      'mcp_servers.maestro.default_tools_approval_mode=approve',
      '-c',
      'mcp_servers.maestro.tool_timeout_sec=86400',
      '-c',
      'mcp_servers.maestro.required=true',
    );
  }
  args.push('-');
  return args;
}

export function childEnvCodex(env: NodeJS.ProcessEnv, token?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const k of STRIPPED_ENV_CODEX) delete out[k];
  delete out[MCP_TOKEN_ENV];
  if (token) out[MCP_TOKEN_ENV] = token;
  return out;
}

export type ImagePart = Extract<ContentPart, { type: 'image' }>;

/**
 * The stdin prompt (R11): earlier messages as a `<conversation_history>` block, then the text of
 * the last user message. Its images are returned apart, to be written to files and passed by `-i`.
 */
export function buildPrompt(messages: Message[]): { text: string; images: ImagePart[] } {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUser = i;
      break;
    }
  }
  const earlier = lastUser >= 0 ? messages.slice(0, lastUser) : messages;
  const after = lastUser >= 0 ? messages.slice(lastUser + 1) : [];
  const history = [...earlier, ...after];
  const blocks: string[] = [];
  if (history.length > 0) {
    const label =
      after.length > 0
        ? 'Histórico da conversa (inclui ações já executadas depois do último pedido):'
        : 'Histórico da conversa até aqui (respostas anteriores podem ser de outros modelos):';
    blocks.push(
      `${label}\n<conversation_history>\n${renderHistory(history)}\n</conversation_history>`,
    );
  }
  const images: ImagePart[] = [];
  if (lastUser >= 0) {
    const texts: string[] = [];
    for (const p of messages[lastUser]!.content) {
      if (p.type === 'text' && p.text !== '') texts.push(p.text);
      else if (p.type === 'image') images.push(p);
    }
    if (texts.length > 0) blocks.push(texts.join('\n'));
  }
  if (blocks.length === 0 || (lastUser < 0 && history.length > 0)) blocks.push('Continue.');
  return { text: blocks.join('\n\n'), images };
}

/** File extension for an attached image's media type. */
export function imageExtension(mediaType: string): string {
  const sub = mediaType.split('/')[1]?.toLowerCase() ?? 'png';
  return sub === 'jpeg' ? 'jpg' : /^[a-z0-9]+$/.test(sub) ? sub : 'png';
}

/** Appended to the system prompt: Maestro's tools are the only way to act on the workspace. */
export function codexToolsNote(toolNames: string[]): string {
  if (toolNames.length === 0) return '';
  return `\n\nAs ferramentas disponíveis (${toolNames.join(', ')}) são do Maestro e são a única forma de ler e escrever arquivos e de executar comandos na pasta de trabalho. Use-as normalmente quando a tarefa pedir: quem aprova cada ação é o Maestro, e qualquer limitação de sandbox ou somente leitura que você perceba não vale para elas.`;
}

// ---- event parser (contracts/codex-events.md)

export interface CodexParserState {
  completed: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  /** First fatal error message (`error` / `turn.failed`). */
  failure?: string;
  messages: number;
  /** Non-fatal warnings (`item.type = error`), counted for the log only. */
  warnings: number;
}

export function newCodexParserState(): CodexParserState {
  return { completed: false, messages: 0, warnings: 0 };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function parseCodexLine(line: string, st: CodexParserState): ProviderEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return [];
  let o: unknown;
  try {
    o = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!isObj(o)) return [];
  switch (o['type']) {
    case 'item.completed': {
      const item = isObj(o['item']) ? o['item'] : {};
      if (item['type'] === 'agent_message' && typeof item['text'] === 'string') {
        if (item['text'] === '') return [];
        const text = st.messages > 0 ? `\n\n${item['text']}` : item['text'];
        st.messages += 1;
        return [{ type: 'text_delta', text }];
      }
      if (item['type'] === 'error') st.warnings += 1;
      return [];
    }
    case 'turn.completed': {
      st.completed = true;
      const u = isObj(o['usage']) ? o['usage'] : {};
      st.usage = {
        inputTokens: num(u['input_tokens']),
        outputTokens: num(u['output_tokens']) + num(u['reasoning_output_tokens']),
      };
      return [];
    }
    case 'error': {
      if (typeof o['message'] === 'string') st.failure ??= o['message'];
      return [];
    }
    case 'turn.failed': {
      const e = isObj(o['error']) ? o['error'] : {};
      st.failure ??= typeof e['message'] === 'string' ? e['message'] : 'turn failed';
      return [];
    }
    default:
      return [];
  }
}

// ---- errors (research R6)

interface ApiError {
  status?: number;
  code?: string;
  message: string;
}

/** Codex embeds the API error as JSON in its message; falls back to the whole text. */
function apiErrorOf(message: string): ApiError {
  const start = message.indexOf('{');
  if (start >= 0) {
    try {
      const o = JSON.parse(message.slice(start)) as unknown;
      if (isObj(o)) {
        const e = isObj(o['error']) ? o['error'] : o;
        const status = typeof o['status'] === 'number' ? o['status'] : undefined;
        return {
          status,
          code: typeof e['code'] === 'string' ? e['code'] : undefined,
          message: typeof e['message'] === 'string' ? e['message'] : message,
        };
      }
    } catch {
      /* not JSON: use the text */
    }
  }
  return { message };
}

/** Milliseconds from "try again in 30s" / "try again at <date>"; undefined when absent. */
export function codexRetryAfterMs(text: string, now = Date.now()): number | undefined {
  const rel = /try again in\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?|m|minutes?)\b/i.exec(
    text,
  );
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.toLowerCase();
    const ms =
      unit.startsWith('ms') || unit.startsWith('milli')
        ? n
        : unit.startsWith('m')
          ? n * 60_000
          : n * 1000;
    return Math.ceil(ms);
  }
  const abs = /try again at\s+([^.]+?)(?:\.\s|\.$|$)/i.exec(text);
  if (abs) {
    const when = Date.parse(abs[1]!.replace(/(\d)(st|nd|rd|th)\b/g, '$1'));
    if (Number.isFinite(when)) return Math.max(0, when - now) + 5_000;
  }
  return undefined;
}

/** MaestroError of a failed Codex turn (contracts/codex-events.md). */
export function codexError(
  message: string,
  clean: (s: string) => string,
  now = Date.now(),
): MaestroError {
  const api = apiErrorOf(message);
  const text = clean(api.message.trim() || 'o Codex terminou com erro');
  if (
    api.status === 429 ||
    api.code === 'usage_limit_reached' ||
    api.code === 'rate_limit_exceeded' ||
    /usage limit|rate limit/i.test(text)
  ) {
    return new MaestroError({
      providerId: 'codex',
      category: 'rate_limit',
      message: `limite de uso do Codex atingido: ${text}`,
      retryAfterMs: codexRetryAfterMs(text, now),
    });
  }
  if (api.code === 'model_not_found') {
    return new MaestroError({ providerId: 'codex', category: 'provider', message: text });
  }
  if (
    api.status === 401 ||
    api.status === 403 ||
    /not logged in|log ?in|login|unauthori/i.test(text)
  ) {
    return new MaestroError({
      providerId: 'codex',
      category: 'auth',
      message: `o Codex não está autenticado: ${text}`,
      hint: CODEX_LOGIN_HINT,
    });
  }
  if (looksLikeNetworkError(text))
    return new MaestroError({
      providerId: 'codex',
      category: 'network',
      message: `falha de conexão do Codex: ${text}`,
    });
  return new MaestroError({ providerId: 'codex', category: 'provider', message: text });
}

// ---- version (research R3)

export function parseVersion(stdout: string): string | undefined {
  return /(\d+)\.(\d+)\.(\d+)/.exec(stdout)?.[0];
}

export function versionAtLeast(version: string, min: string): boolean {
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}
