import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TempHome {
  home: string;
  globalPath: string;
  historyPath: string;
  env: NodeJS.ProcessEnv;
  readSettings(): Record<string, unknown>;
  /** `text` of every valid line of history.jsonl (oldest first); [] when the file is absent. */
  readHistory(): string[];
  cleanup(): void;
}

/** Isolated `~/.maestro` for tests that write settings or history. */
export function withTempHome(initial?: Record<string, unknown>): TempHome {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-home-'));
  const dir = path.join(home, '.maestro');
  const globalPath = path.join(dir, 'settings.json');
  const historyPath = path.join(dir, 'history.jsonl');
  if (initial) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(globalPath, JSON.stringify(initial, null, 2) + '\n');
  }
  return {
    home,
    globalPath,
    historyPath,
    env: { PATH: process.env['PATH'], MAESTRO_HOME: home },
    readSettings: () => JSON.parse(fs.readFileSync(globalPath, 'utf8')) as Record<string, unknown>,
    readHistory: () => {
      if (!fs.existsSync(historyPath)) return [];
      const out: string[] = [];
      for (const line of fs.readFileSync(historyPath, 'utf8').split('\n')) {
        if (line.trim() === '') continue;
        try {
          const parsed = JSON.parse(line) as { text?: unknown };
          if (typeof parsed.text === 'string') out.push(parsed.text);
        } catch {
          /* ignore malformed line */
        }
      }
      return out;
    },
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}
