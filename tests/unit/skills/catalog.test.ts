import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX,
  LIST_MAX_ITEMS,
  SPECKIT_REASON,
  discoverSkills,
  findSkill,
  skillsReport,
  skillsSection,
} from '../../../src/skills/catalog.js';
import type { SkillEntry } from '../../../src/skills/catalog.js';

let cwd: string;
let home: string;

const skill = (root: string, name: string, header: string, body = '# Corpo\nsegredo do corpo') => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${header}\n---\n\n${body}\n`);
  return dir;
};
const project = (kind: '.claude' | '.agents') => path.join(cwd, kind, 'skills');
const user = () => path.join(home, '.claude', 'skills');

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-skills-cwd-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-skills-home-'));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe('discoverSkills (contract § 1)', () => {
  it('precedence .claude → .agents → user, shadowed, folder name fallback, ignored ones', () => {
    skill(project('.claude'), 'revisao-pr', 'name: revisao-pr\ndescription: Checklist de PR');
    skill(project('.agents'), 'padroes-api', 'description: >\n  Convenções\n  de API');
    skill(user(), 'revisao', 'name: Revisao-PR\ndescription: versão do usuário');
    skill(user(), 'commit-msg', 'name: commit-msg\ndescription: Mensagens de commit');
    skill(project('.claude'), 'rascunho', 'name: rascunho');
    skill(project('.claude'), 'speckit-plan', 'name: speckit-plan\ndescription: x');
    skill(project('.agents'), 'tasks', 'name: speckit.tasks\ndescription: x');
    fs.mkdirSync(path.join(project('.claude'), 'sem-arquivo'), { recursive: true });
    // claude.ai synced skills live two levels down and are not found (research R2)
    skill(path.join(user(), 'synced', 'bucket'), 'pdf', 'name: pdf\ndescription: x');

    const c = discoverSkills({ cwd, home });
    expect(c.skills.map((s) => [s.name, s.source, s.description])).toEqual([
      ['revisao-pr', 'project-claude', 'Checklist de PR'],
      ['padroes-api', 'project-agents', 'Convenções de API'],
      ['commit-msg', 'user', 'Mensagens de commit'],
    ]);
    expect(c.shadowed).toMatchObject([
      { name: 'Revisao-PR', source: 'user', by: 'project-claude' },
    ]);
    expect(c.ignored.map((i) => [path.basename(path.dirname(i.path)), i.reason])).toEqual([
      ['rascunho', 'sem description no cabeçalho'],
      ['speckit-plan', SPECKIT_REASON],
      ['tasks', SPECKIT_REASON],
    ]);
    expect(findSkill(c, 'REVISAO-PR')?.name).toBe('revisao-pr');
    expect(findSkill(c, 'nada')).toBeUndefined();
  });

  it('missing roots → empty catalog; read errors become ignored; never throws', () => {
    expect(discoverSkills({ cwd, home })).toEqual({ skills: [], shadowed: [], ignored: [] });
    skill(project('.claude'), 'trancada', 'name: t\ndescription: d');
    const denied = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    const c = discoverSkills({
      cwd,
      home,
      fs: {
        readdirSync: fs.readdirSync,
        statSync: fs.statSync,
        readFileSync: (() => {
          throw denied;
        }) as typeof fs.readFileSync,
      },
    });
    expect(c.ignored).toMatchObject([{ reason: 'não foi possível ler (EACCES)' }]);
    const broken = {
      readdirSync: () => {
        throw denied;
      },
      statSync: fs.statSync,
      readFileSync: fs.readFileSync,
    } as unknown as Parameters<typeof discoverSkills>[0]['fs'];
    expect(discoverSkills({ cwd, home, fs: broken }).skills).toEqual([]);
  });

  it('50 skills are discovered in under 200 ms (SC-002)', () => {
    for (let i = 0; i < 50; i += 1)
      skill(project('.claude'), `s${String(i).padStart(2, '0')}`, `description: skill ${i}`);
    // Best of five: the full suite runs in parallel with git-heavy tests, so one sample is noise.
    let best = Infinity;
    let c = discoverSkills({ cwd, home });
    for (let k = 0; k < 5; k += 1) {
      const t = performance.now();
      c = discoverSkills({ cwd, home });
      best = Math.min(best, performance.now() - t);
    }
    expect(best).toBeLessThan(200);
    expect(c.skills).toHaveLength(50);
  });
});

const entry = (name: string, description: string): SkillEntry => ({
  name,
  description,
  source: 'project-claude',
  dir: `/x/${name}`,
  file: `/x/${name}/SKILL.md`,
});

describe('skillsSection (contract § 2)', () => {
  it('empty → empty string; rule and items; long descriptions cut', () => {
    expect(skillsSection([])).toBe('');
    const long = 'palavra '.repeat(100);
    const text = skillsSection([entry('a', 'Uso   curto.\n Segunda linha'), entry('b', long)]);
    expect(text.startsWith('# Skills\n')).toBe(true);
    expect(text).toContain('call load_skill with its name');
    expect(text).toContain('- a: Uso curto. Segunda linha');
    const b = text.split('\n').find((l) => l.startsWith('- b: '))!;
    expect(b.length).toBeLessThanOrEqual('- b: '.length + DESCRIPTION_MAX);
    expect(b.endsWith('…')).toBe(true);
    expect(skillsSection([entry('a', 'x')])).toBe(skillsSection([entry('a', 'x')]));
  });

  it('20 skills with 800-char descriptions fit in 7 000 chars (SC-001); item limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => entry(`skill-${i}`, 'd'.repeat(800)));
    expect(skillsSection(many).length).toBeLessThanOrEqual(7000);
    const lots = Array.from({ length: LIST_MAX_ITEMS + 7 }, (_, i) => entry(`s${i}`, 'x'));
    const lines = skillsSection(lots).split('\n');
    expect(lines.filter((l) => /^- s\d+:/.test(l))).toHaveLength(LIST_MAX_ITEMS);
    expect(lines.at(-1)).toBe(
      '- … mais 7 skills (use /skills para ver todas; load_skill aceita qualquer nome válido)',
    );
  });
});

describe('skillsReport (contract § 3)', () => {
  it('available, shadowed and ignored blocks; states', () => {
    skill(project('.claude'), 'revisao-pr', 'name: revisao-pr\ndescription: Checklist de PR');
    skill(user(), 'revisao-pr', 'name: revisao-pr\ndescription: outra');
    skill(user(), 'rascunho', 'name: rascunho');
    const text = skillsReport(discoverSkills({ cwd, home }), 'on', { cwd, home });
    expect(text).toMatch(
      /^Skills disponíveis \(1\):\n {2}revisao-pr +projeto \(\.claude\/skills\) +Checklist de PR/,
    );
    expect(text).toMatch(
      /Sombreadas \(1\):\n {2}revisao-pr +usuário \(~\/\.claude\/skills\) +→ vale projeto/,
    );
    expect(text).toMatch(
      /Ignoradas \(1\):\n {2}~\/\.claude\/skills\/rascunho\/SKILL\.md +sem description/,
    );
    expect(skillsReport({ skills: [], shadowed: [], ignored: [] }, 'on', { cwd, home })).toMatch(
      /^Nenhuma skill encontrada/,
    );
    expect(skillsReport(discoverSkills({ cwd, home }), 'disabled', { cwd, home })).toBe(
      'Skills desligadas (skills.enabled: false).',
    );
    expect(skillsReport(discoverSkills({ cwd, home }), 'no-tools', { cwd, home })).toBe(
      'Skills indisponíveis sem ferramentas (--no-tools).',
    );
  });
});
