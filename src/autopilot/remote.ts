/**
 * Pull requests through the user's authenticated `gh` (specs/011 research R11). Used only with
 * `autopilot.push` (and `autopilot.merge` for the merge).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RemotePort {
  createPr(
    root: string,
    pr: { base: string; head: string; title: string; body: string },
  ): {
    url: string;
    number: number;
  };
  merge(root: string, number: number): void;
}

export const ghRemote: RemotePort = {
  createPr(root, pr) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-pr-'));
    try {
      const body = path.join(dir, 'BODY.md');
      fs.writeFileSync(body, pr.body, 'utf8');
      const out = execFileSync(
        'gh',
        [
          'pr',
          'create',
          '--base',
          pr.base,
          '--head',
          pr.head,
          '--title',
          pr.title,
          '--body-file',
          body,
        ],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      ).trim();
      const url = out.split(/\s+/).find((t) => /^https?:\/\//.test(t)) ?? out;
      const number = Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0);
      return { url, number };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  merge(root, number) {
    execFileSync('gh', ['pr', 'merge', String(number), '--merge'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  },
};
