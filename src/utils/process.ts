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
