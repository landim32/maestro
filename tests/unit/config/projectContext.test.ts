import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProjectContext, PROJECT_CONTEXT_LIMIT } from '../../../src/config/projectContext.js';
import { buildSystemPrompt } from '../../../src/session/systemPrompt.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-ctx-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** specs/006 contracts/init-and-context.md § 3 */
describe('project context', () => {
  it('prefers MAESTRO.md over CLAUDE.md and reports size', () => {
    expect(loadProjectContext(dir)).toBeUndefined();
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# claude rules');
    expect(loadProjectContext(dir)).toMatchObject({
      file: 'CLAUDE.md',
      text: '# claude rules',
      large: false,
    });
    fs.writeFileSync(path.join(dir, 'MAESTRO.md'), 'x'.repeat(PROJECT_CONTEXT_LIMIT + 1));
    const ctx = loadProjectContext(dir)!;
    expect(ctx.file).toBe('MAESTRO.md');
    expect(ctx.large).toBe(true);
    expect(ctx.bytes).toBe(PROJECT_CONTEXT_LIMIT + 1);
  });

  it('is appended to the system prompt under a heading naming the file; absent → prompt unchanged', () => {
    const base = buildSystemPrompt({ cwd: dir, toolsEnabled: true, platform: 'linux' });
    const withCtx = buildSystemPrompt({
      cwd: dir,
      toolsEnabled: true,
      platform: 'linux',
      projectContext: {
        file: 'MAESTRO.md',
        path: 'x',
        text: 'Always answer with OK first.\n',
        bytes: 29,
        large: false,
      },
    });
    expect(withCtx.startsWith(base)).toBe(true);
    expect(withCtx).toContain('# Project guidelines (MAESTRO.md)');
    expect(withCtx.endsWith('Always answer with OK first.')).toBe(true);
  });
});
