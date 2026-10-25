/**
 * Claude Code CLI helpers for `/auth` (specs/010 research R8): locate the executable and read
 * `claude auth status`. Maestro never starts a login and never reads Claude Code's credentials;
 * the status output is used only to tell the user how Claude Code is signed in.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { locateClaudeCode } from '../utils/process.js';

export interface ClaudeCodeStatus {
  loggedIn: boolean;
  /** e.g. `claude.ai` (subscription) or an API-key method. */
  authMethod?: string;
  /** Masked for display; never logged. */
  maskedEmail?: string;
}

export interface ClaudeCodeCli {
  locate(command?: string): string | undefined;
  readStatus(exe: string): Promise<ClaudeCodeStatus | { error: string }>;
}

export const CLAUDE_CODE_INSTALL_HINTS = [
  'Instale o Claude Code e faça login nele com a sua conta do claude.ai:',
  '  https://code.claude.com/docs/en/setup',
  '  ou: npm install -g @anthropic-ai/claude-code',
  'Depois rode `claude` num terminal e use /login.',
  'Se ele estiver fora do PATH, defina providers.claude-code.command no settings.json.',
];

/** `r***@example.com`; anything that does not look like an e-mail is hidden entirely. */
export function maskEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export function isSubscriptionLogin(s: ClaudeCodeStatus): boolean {
  return s.loggedIn && (s.authMethod ?? '').toLowerCase() === 'claude.ai';
}

export function parseAuthStatus(stdout: string): ClaudeCodeStatus | { error: string } {
  const start = stdout.indexOf('{');
  if (start < 0) return { error: 'saída inesperada de `claude auth status`' };
  try {
    const o = JSON.parse(stdout.slice(start)) as Record<string, unknown>;
    return {
      loggedIn: o['loggedIn'] === true,
      authMethod: typeof o['authMethod'] === 'string' ? o['authMethod'] : undefined,
      maskedEmail: maskEmail(typeof o['email'] === 'string' ? o['email'] : undefined),
    };
  } catch {
    return { error: 'saída inesperada de `claude auth status`' };
  }
}

export interface ClaudeCodeCliDeps {
  execFile?: typeof nodeExecFile;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export function createClaudeCodeCli(deps: ClaudeCodeCliDeps = {}): ClaudeCodeCli {
  const execFile = deps.execFile ?? nodeExecFile;
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  return {
    locate: (command) => locateClaudeCode(command, { env, platform }),
    readStatus: (exe) =>
      new Promise((resolve) => {
        execFile(
          exe,
          ['auth', 'status'],
          {
            timeout: 30_000,
            windowsHide: true,
            env,
            shell: platform === 'win32' && /\.(cmd|bat)$/i.test(exe),
          },
          (err, stdout) => {
            const out = String(stdout ?? '');
            if (out.includes('{')) {
              resolve(parseAuthStatus(out));
              return;
            }
            resolve({
              error: err
                ? `não foi possível consultar o Claude Code (${err.message})`
                : 'sem resposta',
            });
          },
        );
      }),
  };
}
