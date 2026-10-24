import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listDirectoryTool } from '../../../src/tools/listDirectory.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { makeSettings } from '../../helpers/context.js';

let cwd: string;
let ctx: ToolContext;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-ls-'));
  fs.mkdirSync(path.join(cwd, 'src', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'node_modules', 'x'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.git'));
  fs.writeFileSync(path.join(cwd, 'b.txt'), '');
  fs.writeFileSync(path.join(cwd, 'a.txt'), '');
  fs.writeFileSync(path.join(cwd, 'src', 'index.ts'), '');
  fs.writeFileSync(path.join(cwd, 'src', 'deep', 'z.ts'), '');
  ctx = { cwd, signal: new AbortController().signal, settings: makeSettings().tools };
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('list_directory', () => {
  it('lists directories first (with trailing slash), then files, skipping ignored names', async () => {
    const r = await listDirectoryTool.run({}, ctx);
    expect(r.isError).toBe(false);
    expect(r.output.split('\n').slice(1)).toEqual(['src/', 'a.txt', 'b.txt']);
  });
  it('lists recursively with path prefixes', async () => {
    const r = await listDirectoryTool.run({ path: '.', recursive: true }, ctx);
    expect(r.output.split('\n').slice(1)).toEqual([
      'src/',
      'src/deep/',
      'src/deep/z.ts',
      'src/index.ts',
      'a.txt',
      'b.txt',
    ]);
  });
  it('lists a subdirectory', async () => {
    const r = await listDirectoryTool.run({ path: 'src' }, ctx);
    expect(r.output).toBe('src (2 entries)\ndeep/\nindex.ts');
  });
  it('errors on missing directories and files', async () => {
    expect((await listDirectoryTool.run({ path: 'nope' }, ctx)).output).toMatch(/not found/);
    expect((await listDirectoryTool.run({ path: 'a.txt' }, ctx)).output).toMatch(/is a file/);
  });
  it('refuses to leave the workspace', async () => {
    await expect(listDirectoryTool.run({ path: '..' }, ctx)).rejects.toThrow(/outside workspace/);
  });
});
