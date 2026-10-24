import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileTool } from '../../../src/tools/writeFile.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { makeSettings } from '../../helpers/context.js';

let cwd: string;
let ctx: ToolContext;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-wf-'));
  fs.writeFileSync(path.join(cwd, 'existing.txt'), 'one\ntwo\nthree\n');
  ctx = { cwd, signal: new AbortController().signal, settings: makeSettings().tools };
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('write_file', () => {
  it('requires confirmation and previews a new file with + lines without writing it', async () => {
    expect(writeFileTool.requiresConfirmation).toBe(true);
    const preview = await writeFileTool.preview!(
      { path: 'new/hello.txt', content: 'olá\nmundo' },
      ctx,
    );
    expect(preview).toBe('new file: new/hello.txt (2 lines)\n+olá\n+mundo');
    expect(fs.existsSync(path.join(cwd, 'new', 'hello.txt'))).toBe(false);
  });
  it('previews a unified diff for an existing file', async () => {
    const preview = await writeFileTool.preview!(
      { path: 'existing.txt', content: 'one\n2\nthree\n' },
      ctx,
    );
    expect(preview).toContain('-two');
    expect(preview).toContain('+2');
    expect(preview).toContain('--- existing.txt');
  });
  it('reports no changes when content is identical', async () => {
    expect(
      await writeFileTool.preview!({ path: 'existing.txt', content: 'one\ntwo\nthree\n' }, ctx),
    ).toBe('existing.txt: no changes');
  });
  it('writes the file (creating parent directories) only on run', async () => {
    const r = await writeFileTool.run({ path: 'new/hello.txt', content: 'olá' }, ctx);
    expect(r).toEqual({ isError: false, output: 'wrote 4 bytes to new/hello.txt' });
    expect(fs.readFileSync(path.join(cwd, 'new', 'hello.txt'), 'utf8')).toBe('olá');
  });
  it('refuses paths outside the workspace in both preview and run', async () => {
    await expect(
      writeFileTool.preview!({ path: '../evil.txt', content: 'x' }, ctx),
    ).rejects.toThrow(/outside workspace/);
    await expect(writeFileTool.run({ path: '../evil.txt', content: 'x' }, ctx)).rejects.toThrow(
      /outside workspace/,
    );
    expect(fs.existsSync(path.join(cwd, '..', 'evil.txt'))).toBe(false);
  });
});
