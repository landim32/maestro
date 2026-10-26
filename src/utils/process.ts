import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/** Kills the whole process tree: on Windows killing cmd.exe alone leaves grandchildren alive. */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => child.kill());
    return;
  }
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 500).unref();
}

export interface FindExecutableOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Extra directories searched after PATH (e.g. a default install location). */
  extraDirs?: string[];
}

function isExecutableFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Resolves `name` to an absolute path by scanning PATH (honouring PATHEXT on Windows) and `extraDirs`. */
export function findExecutable(name: string, opts: FindExecutableOptions = {}): string | undefined {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const pathVar = env['PATH'] ?? env['Path'] ?? '';
  const dirs = [...pathVar.split(path.delimiter).filter(Boolean), ...(opts.extraDirs ?? [])];
  const exts =
    platform === 'win32'
      ? ['', ...(env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (isExecutableFile(candidate)) return candidate;
      if (ext && ext !== ext.toLowerCase()) {
        const upper = path.join(dir, name + ext);
        if (isExecutableFile(upper)) return upper;
      }
    }
  }
  return undefined;
}

type LocateOptions = { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform };

/**
 * Locates a user-installed CLI: the configured `command` (a path, or a name looked up on PATH),
 * else the first of `names` found on PATH.
 */
export function locateCli(
  command: string | undefined,
  names: string[],
  opts: LocateOptions = {},
): string | undefined {
  if (command) {
    if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
      return isExecutableFile(command) ? command : undefined;
    }
    return findExecutable(command, opts);
  }
  for (const name of names) {
    const found = findExecutable(name, opts);
    if (found) return found;
  }
  return undefined;
}

/**
 * Locates the user's Claude Code executable (specs/010 research R7): the configured `command`,
 * else `claude` on PATH. On Windows only `claude.exe`, then the npm `claude.cmd`: the extensionless
 * POSIX shim npm installs next to it cannot run there.
 */
export function locateClaudeCode(
  command: string | undefined,
  opts: LocateOptions = {},
): string | undefined {
  const win = (opts.platform ?? process.platform) === 'win32';
  return locateCli(command, win ? ['claude.exe', 'claude.cmd'] : ['claude'], opts);
}

/**
 * Locates the user's Codex CLI (specs/012 research R7). npm installs ship `codex.cmd` next to an
 * extensionless POSIX shell shim that Windows cannot run, so on Windows only `.exe`/`.cmd` count.
 */
export function locateCodex(
  command: string | undefined,
  opts: LocateOptions = {},
): string | undefined {
  const win = (opts.platform ?? process.platform) === 'win32';
  return locateCli(command, win ? ['codex.exe', 'codex.cmd'] : ['codex'], opts);
}

/** `.cmd`/`.bat` shims need cmd.exe; every argument we pass is a flag, a name or a file path. */
export function spawnSpec(
  exe: string,
  args: string[],
  platform: NodeJS.Platform,
): { file: string; args: string[]; shell: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    const quote = (a: string) => `"${a.replace(/"/g, '""')}"`;
    return { file: quote(exe), args: args.map(quote), shell: true };
  }
  return { file: exe, args, shell: false };
}
