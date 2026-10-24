import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileTool } from '../../../src/tools/readFile.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { makeSettings } from '../../helpers/context.js';

let cwd: string;
let ctx: ToolContext;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-rf-'));
  fs.writeFileSync(path.join(cwd, 'f.txt'), 'line1\nline2\nline3\nline4');
  fs.writeFileSync(path.join(cwd, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
  fs.mkdirSync(path.join(cwd, 'd'));
  ctx = { cwd, signal: new AbortController().signal, settings: makeSettings().tools };
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('read_file', () => {
  it('returns numbered lines with a header', async () => {
    const r = await readFileTool.run({ path: 'f.txt' }, ctx);
    expect(r.isError).toBe(false);
    expect(r.output).toBe('f.txt (4 lines)\n1\tline1\n2\tline2\n3\tline3\n4\tline4');
  });
  it('supports offset and limit', async () => {
    const r = await readFileTool.run({ path: 'f.txt', offset: 2, limit: 2 }, ctx);
    expect(r.output).toBe('f.txt (4 lines, showing 2-3)\n2\tline2\n3\tline3');
  });
  it('reports missing files, directories and binary files as errors', async () => {
    expect(await readFileTool.run({ path: 'nope.txt' }, ctx)).toMatchObject({
      isError: true,
      output: 'file not found: nope.txt',
    });
    expect((await readFileTool.run({ path: 'd' }, ctx)).output).toMatch(/is a directory/);
    expect((await readFileTool.run({ path: 'bin.dat' }, ctx)).output).toMatch(/binary/);
  });
  it('refuses paths outside the workspace', async () => {
    await expect(readFileTool.run({ path: '../x' }, ctx)).rejects.toThrow(/outside workspace/);
  });
  it('truncates to maxOutputChars', async () => {
    fs.writeFileSync(path.join(cwd, 'big.txt'), 'x'.repeat(5000));
    const r = await readFileTool.run(
      { path: 'big.txt' },
      { ...ctx, settings: { ...ctx.settings, maxOutputChars: 1000 } },
    );
    expect(r.output.length).toBeLessThan(1100);
    expect(r.output).toMatch(/truncated \d+ characters/);
  });
  it('validates input with its schema', () => {
    expect(readFileTool.inputSchema.safeParse({ path: 'a', offset: 0 }).success).toBe(false);
    expect(readFileTool.inputSchema.safeParse({}).success).toBe(false);
    expect(readFileTool.requiresConfirmation).toBe(false);
  });
});
