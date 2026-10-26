import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverSkills } from '../../../src/skills/catalog.js';
import {
  MAX_LISTED_FILES,
  MAX_SKILL_FILE_BYTES,
  createLoadSkillTool,
} from '../../../src/tools/loadSkill.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { makeSettings } from '../../helpers/context.js';

let cwd: string;
let home: string;
let dir: string;

const ctx = (): ToolContext => ({
  cwd,
  signal: new AbortController().signal,
  settings: makeSettings().tools,
});
const write = (rel: string, text: string | Buffer) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const tool = () => createLoadSkillTool(discoverSkills({ cwd, home }));

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-ls-cwd-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-ls-home-'));
  dir = path.join(cwd, '.claude', 'skills', 'revisao-pr');
  write(
    'SKILL.md',
    '---\nname: revisao-pr\ndescription: Checklist de PR\n---\n\n# Revisão\n\n1. Leia references/checklist.md\n',
  );
  write('references/checklist.md', '- testes passam\n- sem segredos\n');
  write('templates/pr.md', 'modelo');
  write('.git/HEAD', 'x');
  write('node_modules/pkg/index.js', 'x');
  write('a/b/c/d/fundo.md', 'fundo demais');
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe('load_skill (specs/013 contracts/load-skill-tool.md)', () => {
  it('without file: body without the header, source and the sorted reference list', async () => {
    const t = tool();
    expect(t.kind).toBe('read');
    const r = await t.run({ name: 'revisao-pr' }, ctx());
    expect(r.isError).toBe(false);
    expect(r.output).toBe(
      [
        '# Skill: revisao-pr',
        'Source: projeto (.claude/skills)',
        '',
        '# Revisão\n\n1. Leia references/checklist.md',
        '',
        '## Reference files (2)',
        '- references/checklist.md',
        '- templates/pr.md',
        '',
        'Read one with load_skill(name: "revisao-pr", file: "<path>").',
      ].join('\n'),
    );
    expect(r.output).not.toContain('description:');
    expect(r.display?.skill).toEqual({
      name: 'revisao-pr',
      source: 'project-claude',
      file: undefined,
      ok: true,
      lines: 3,
      files: 2,
    });
  });

  it('with file: the reference file; reads the disk at call time (FR-019)', async () => {
    const t = tool();
    let r = await t.run({ name: 'Revisao-PR', file: 'references/checklist.md' }, ctx());
    expect(r.output).toBe(
      '# Skill file: revisao-pr/references/checklist.md (2 lines)\n- testes passam\n- sem segredos\n',
    );
    expect(r.display?.skill).toMatchObject({ ok: true, lines: 2, file: 'references/checklist.md' });
    write('references/checklist.md', 'mudou\n');
    r = await t.run({ name: 'revisao-pr', file: 'references/checklist.md' }, ctx());
    expect(r.output).toContain('mudou');
  });

  it('lists at most MAX_LISTED_FILES reference files', async () => {
    for (let i = 0; i < MAX_LISTED_FILES + 5; i += 1)
      write(`refs/f${String(i).padStart(3, '0')}.md`, 'x');
    const r = await tool().run({ name: 'revisao-pr' }, ctx());
    expect(r.output).toContain(`## Reference files (${MAX_LISTED_FILES + 5 + 2})`);
    expect(r.output).toContain('- … +7 more');
  });

  it('errors keep the turn going and carry display.skill ok:false', async () => {
    const t = tool();
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ name: 'nada' }, /^unknown skill "nada"\. Available: revisao-pr$/],
      [{ name: 'revisao-pr', file: '../outra/SKILL.md' }, /^file outside the skill folder/],
      [{ name: 'revisao-pr', file: path.join(home, 'x.md') }, /^file outside the skill folder/],
      [{ name: 'revisao-pr', file: 'nao-existe.md' }, /^file not found in skill revisao-pr/],
      [{ name: 'revisao-pr', file: 'references' }, /is a directory/],
    ];
    for (const [input, re] of cases) {
      const r = await t.run(input as { name: string; file?: string }, ctx());
      expect(r.isError).toBe(true);
      expect(r.output).toMatch(re);
      expect(r.display?.skill?.ok).toBe(false);
    }
    expect((await t.run({ name: 'nada' }, ctx())).display?.skill?.source).toBeUndefined();

    write('grande.md', 'x'.repeat(MAX_SKILL_FILE_BYTES + 1));
    expect((await t.run({ name: 'revisao-pr', file: 'grande.md' }, ctx())).output).toMatch(
      /^file too large/,
    );
    write('bin.dat', Buffer.from([1, 0, 2]));
    expect((await t.run({ name: 'revisao-pr', file: 'bin.dat' }, ctx())).output).toBe(
      'not a text file: bin.dat',
    );
    fs.rmSync(path.join(dir, 'SKILL.md'));
    expect((await t.run({ name: 'revisao-pr' }, ctx())).output).toBe(
      'skill revisao-pr is no longer available (SKILL.md not found)',
    );
  });

  it('a symlink leading outside the skill folder is refused', async (c) => {
    const outside = path.join(home, 'segredo.txt');
    fs.writeFileSync(outside, 'segredo');
    try {
      fs.symlinkSync(outside, path.join(dir, 'link.txt'));
    } catch {
      c.skip(); // Windows without the symlink privilege
    }
    const r = await tool().run({ name: 'revisao-pr', file: 'link.txt' }, ctx());
    expect(r.output).toBe('file outside the skill folder: link.txt');
  });
});
