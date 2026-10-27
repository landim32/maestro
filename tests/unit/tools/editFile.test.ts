import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { editFileTool } from '../../../src/tools/editFile.js';
import type { EditFileInput } from '../../../src/tools/editFile.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { makeSettings } from '../../helpers/context.js';

let cwd: string;
let ctx: ToolContext;
const file = (rel: string) => path.join(cwd, rel);
const read = (rel: string) => fs.readFileSync(file(rel), 'utf8');
const run = (input: EditFileInput) => editFileTool.run(input, ctx);

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-ef-'));
  fs.writeFileSync(file('a.ts'), 'const a = 1;\nconst b = 2;\nconst a2 = 1;\n');
  ctx = { cwd, signal: new AbortController().signal, settings: makeSettings().tools };
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('edit_file', () => {
  it('is an edit tool whose schema keeps replace_all optional', () => {
    expect(editFileTool.kind).toBe('edit');
    const js = z.toJSONSchema(editFileTool.inputSchema) as { required: string[] };
    expect(js.required).toEqual(['path', 'old_string', 'new_string']);
  });

  it('replaces a unique occurrence and leaves the rest untouched', async () => {
    const r = await run({ path: 'a.ts', old_string: 'const b = 2;', new_string: 'const b = 3;' });
    expect(r).toEqual({ isError: false, output: 'edited a.ts (1 replacement)' });
    expect(read('a.ts')).toBe('const a = 1;\nconst b = 3;\nconst a2 = 1;\n');
  });

  it('refuses an ambiguous match unless replace_all, and then replaces every one', async () => {
    const amb = await run({ path: 'a.ts', old_string: '= 1;', new_string: '= 9;' });
    expect(amb.isError).toBe(true);
    expect(amb.output).toMatch(/matches 2 places .* replace_all/);
    expect(read('a.ts')).toContain('const a = 1;');
    const all = await run({
      path: 'a.ts',
      old_string: '= 1;',
      new_string: '= 9;',
      replace_all: true,
    });
    expect(all.output).toBe('edited a.ts (2 replacements)');
    expect(read('a.ts')).toBe('const a = 9;\nconst b = 2;\nconst a2 = 9;\n');
  });

  it('fails without changes when old_string is not found or equals new_string', async () => {
    const miss = await run({ path: 'a.ts', old_string: 'nope', new_string: 'x' });
    expect(miss.isError).toBe(true);
    expect(miss.output).toMatch(/0 occurrences .* read_file/);
    const same = await run({ path: 'a.ts', old_string: 'const b', new_string: 'const b' });
    expect(same.output).toMatch(/identical/);
    expect(read('a.ts')).toBe('const a = 1;\nconst b = 2;\nconst a2 = 1;\n');
  });

  it('matches a CRLF file with LF strings and keeps CRLF', async () => {
    fs.writeFileSync(file('w.cs'), 'class A\r\n{\r\n    int X;\r\n}\r\n');
    const r = await run({
      path: 'w.cs',
      old_string: '{\n    int X;',
      new_string: '{\n    int Y;\n    int Z;',
    });
    expect(r.isError).toBe(false);
    expect(read('w.cs')).toBe('class A\r\n{\r\n    int Y;\r\n    int Z;\r\n}\r\n');
  });

  it('creates a new file only with an empty old_string', async () => {
    expect((await run({ path: 'n/x.md', old_string: 'a', new_string: 'b' })).output).toMatch(
      /Use an empty old_string to create/,
    );
    expect(await run({ path: 'n/x.md', old_string: '', new_string: '# x\n' })).toEqual({
      isError: false,
      output: 'created n/x.md',
    });
    expect(read('n/x.md')).toBe('# x\n');
    expect((await run({ path: 'n/x.md', old_string: '', new_string: 'y' })).output).toMatch(
      /already exists/,
    );
  });

  it('diff and preview describe the change before it is applied', async () => {
    const input = { path: 'a.ts', old_string: 'const b = 2;', new_string: 'const b = 3;' };
    const d = await editFileTool.diff!(input, ctx);
    expect(d).toMatchObject({ kind: 'edit', added: 1, removed: 1 });
    expect(await editFileTool.preview!(input, ctx)).toMatch(/^edit: a\.ts \(\+1 −1\)\n/);
    expect(read('a.ts')).toContain('const b = 2;');
    const bad = { ...input, old_string: 'nope' };
    await expect(editFileTool.diff!(bad, ctx)).rejects.toThrow(/0 occurrences/);
    expect(await editFileTool.preview!(bad, ctx)).toMatch(/will fail: 0 occurrences/);
  });

  it('stays inside the working directory', async () => {
    await expect(run({ path: '../fora.txt', old_string: '', new_string: 'x' })).rejects.toThrow();
  });
});
