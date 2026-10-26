/**
 * Codex CLI helpers for `/auth` and the provider (specs/012 research R9): locate the executable,
 * read `codex --version` and `codex login status`. Maestro never starts a login and never reads
 * Codex's credential files. From the login status only the method is kept: the API-key variant
 * prints part of the key, so the rest of the line is discarded.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { locateCodex } from '../utils/process.js';
import { parseVersion } from '../providers/codexStream.js';

export type CodexLoginMethod = 'chatgpt' | 'api-key' | 'other';

export interface CodexLoginStatus {
  loggedIn: boolean;
  method?: CodexLoginMethod;
}

export interface CodexCli {
  locate(command?: string): string | undefined;
  readVersion(exe: string): Promise<string | undefined>;
  readLoginStatus(exe: string): Promise<CodexLoginStatus | { error: string }>;
}

export const CODEX_INSTALL_HINTS = [
  'Instale o Codex CLI e faça login nele com a sua conta do ChatGPT:',
  '  npm install -g @openai/codex',
  'Depois rode `codex login` num terminal.',
  'Se ele estiver fora do PATH, defina providers.codex.command no settings.json.',
];

export function parseLoginStatus(stdout: string): CodexLoginStatus | { error: string } {
  if (/not logged in/i.test(stdout)) return { loggedIn: false };
  const m = /logged in using\s+(.*)/i.exec(stdout);
  if (!m) return { error: 'saída inesperada de `codex login status`' };
  const rest = m[1]!.toLowerCase();
  const method: CodexLoginMethod = rest.startsWith('chatgpt')
    ? 'chatgpt'
    : rest.startsWith('an api key')
      ? 'api-key'
      : 'other';
  return { loggedIn: true, method };
}

export interface CodexCliDeps {
  execFile?: typeof nodeExecFile;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export function createCodexCli(deps: CodexCliDeps = {}): CodexCli {
  const execFile = deps.execFile ?? nodeExecFile;
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const run = (exe: string, args: string[]) =>
    new Promise<{ out: string; err?: Error }>((resolve) => {
      execFile(
        exe,
        args,
        {
          timeout: 30_000,
          windowsHide: true,
          env,
          shell: platform === 'win32' && /\.(cmd|bat)$/i.test(exe),
        },
        (err, stdout, stderr) =>
          // `login status` writes to stderr on some versions
          resolve({
            out: `${String(stdout ?? '')}\n${String(stderr ?? '')}`,
            err: err ?? undefined,
          }),
      );
    });
  return {
    locate: (command) => locateCodex(command, { env, platform }),
    readVersion: async (exe) => parseVersion((await run(exe, ['--version'])).out),
    readLoginStatus: async (exe) => {
      const { out, err } = await run(exe, ['login', 'status']);
      const parsed = parseLoginStatus(out);
      if ('error' in parsed && err) {
        // err.message repeats the output, which may contain part of an API key: never shown.
        const code = (err as NodeJS.ErrnoException).code;
        return { error: `não foi possível consultar o Codex (${code ?? 'falha'})` };
      }
      return parsed;
    },
  };
}
