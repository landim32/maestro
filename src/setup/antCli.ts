import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { findExecutable, killTree } from '../utils/process.js';

export interface AntLocation {
  path: string;
  source: 'PATH' | 'default-dir';
}

export type LoginResult =
  { ok: true; summary: string } | { ok: false; reason: string; cancelled?: boolean };

export interface LoginRun {
  promise: Promise<LoginResult>;
  cancel(): void;
}

export interface AntStatus {
  loggedIn: boolean;
  summary: string;
}

export interface AntCli {
  locate(): AntLocation | undefined;
  runLogin(antPath: string, opts: { onOutput?: (text: string, url?: string) => void }): LoginRun;
  readStatus(antPath: string): Promise<AntStatus>;
}

export const LOGIN_ARGS = ['auth', 'login', '--timeout', '5m'] as const;
export const STATUS_ARGS = ['auth', 'status'] as const;
const LOGGED_IN_RE = /Logged in to/;
const URL_RE = /https?:\/\/[^\s'"<>]+/;

export interface AntCliDeps {
  spawn?: typeof nodeSpawn;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** Default install dir used by the Windows instructions (research R3). */
export function defaultAntDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform === 'win32' && env['LOCALAPPDATA']) {
    return [path.join(env['LOCALAPPDATA'], 'Programs', 'ant')];
  }
  return ['/usr/local/bin', '/opt/homebrew/bin'];
}

/** Warning text when an API key in the environment shadows the OAuth profile. */
export function envShadowWarning(env: NodeJS.ProcessEnv): string | undefined {
  if (env['ANTHROPIC_API_KEY']) {
    return 'ANTHROPIC_API_KEY está definida e tem precedência sobre o perfil; remova-a para usar o login.';
  }
  if (env['ANTHROPIC_AUTH_TOKEN']) {
    return 'ANTHROPIC_AUTH_TOKEN está definida e tem precedência sobre o perfil; remova-a para usar o login.';
  }
  return undefined;
}

function lastNonEmptyLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

/** Real implementation over `child_process` (research R2). */
export function createAntCli(deps: AntCliDeps = {}): AntCli {
  const spawn = deps.spawn ?? nodeSpawn;
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;

  return {
    locate() {
      const onPath = findExecutable('ant', { env, platform });
      if (onPath) return { path: onPath, source: 'PATH' };
      const extra = findExecutable('ant', {
        env,
        platform,
        extraDirs: defaultAntDirs(env, platform),
      });
      return extra ? { path: extra, source: 'default-dir' } : undefined;
    },

    runLogin(antPath, opts) {
      let child: ChildProcess | undefined;
      let cancelled = false;
      let output = '';
      const promise = new Promise<LoginResult>((resolve) => {
        try {
          child = spawn(antPath, [...LOGIN_ARGS], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env,
          });
        } catch (err) {
          resolve({ ok: false, reason: err instanceof Error ? err.message : String(err) });
          return;
        }
        const onData = (buf: Buffer | string) => {
          const text = buf.toString();
          output += text;
          const url = URL_RE.exec(text)?.[0];
          opts.onOutput?.(text, url);
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (err) => resolve({ ok: false, reason: err.message }));
        child.on('close', (code) => {
          if (cancelled) return resolve({ ok: false, reason: 'cancelado', cancelled: true });
          if (code === 0) return resolve({ ok: true, summary: lastNonEmptyLine(output) });
          resolve({
            ok: false,
            reason: lastNonEmptyLine(output) || `ant terminou com código ${code}`,
          });
        });
      });
      return {
        promise,
        cancel() {
          cancelled = true;
          if (child) killTree(child, platform);
        },
      };
    },

    readStatus(antPath) {
      return new Promise<AntStatus>((resolve) => {
        let output = '';
        let child: ChildProcess;
        try {
          child = spawn(antPath, [...STATUS_ARGS], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env,
          });
        } catch (err) {
          return resolve({
            loggedIn: false,
            summary: err instanceof Error ? err.message : String(err),
          });
        }
        const onData = (buf: Buffer | string) => (output += buf.toString());
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (err) => resolve({ loggedIn: false, summary: err.message }));
        child.on('close', () => {
          const loggedIn = LOGGED_IN_RE.test(output);
          const line = output
            .split(/\r?\n/)
            .find((l) => LOGGED_IN_RE.test(l))
            ?.trim();
          resolve({ loggedIn, summary: line ?? lastNonEmptyLine(output) });
        });
      });
    },
  };
}
