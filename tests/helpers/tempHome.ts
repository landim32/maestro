import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TempHome {
  home: string;
  globalPath: string;
  env: NodeJS.ProcessEnv;
  readSettings(): Record<string, unknown>;
  cleanup(): void;
}

/** Isolated `~/.maestro` for tests that write settings. */
export function withTempHome(initial?: Record<string, unknown>): TempHome {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-home-'));
  const dir = path.join(home, '.maestro');
  const globalPath = path.join(dir, 'settings.json');
  if (initial) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(globalPath, JSON.stringify(initial, null, 2) + '\n');
  }
  return {
    home,
    globalPath,
    env: { PATH: process.env['PATH'], MAESTRO_HOME: home },
    readSettings: () => JSON.parse(fs.readFileSync(globalPath, 'utf8')) as Record<string, unknown>,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}
