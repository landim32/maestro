/** specs/013 contracts/load-skill-tool.md § 1 and skills-discovery-and-prompt.md § 2. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EMPTY_CATALOG } from '../../src/skills/catalog.js';
import type { SkillCatalog, SkillEntry } from '../../src/skills/catalog.js';
import { buildSystemPrompt } from '../../src/session/systemPrompt.js';
import { LOAD_SKILL_DESCRIPTION, createLoadSkillTool } from '../../src/tools/loadSkill.js';
import { toolsFor } from '../../src/tools/registry.js';
import { makeSettings } from '../helpers/context.js';

const entry: SkillEntry = {
  name: 'revisao-pr',
  description: 'Checklist de PR da equipe.',
  source: 'project-claude',
  dir: '/p/.claude/skills/revisao-pr',
  file: '/p/.claude/skills/revisao-pr/SKILL.md',
};
const catalog: SkillCatalog = { skills: [entry], shadowed: [], ignored: [] };
const base = { cwd: '/p', toolsEnabled: true, platform: 'linux' as const };

describe('load_skill definition', () => {
  it('name, description and schema: name required, file optional', () => {
    const t = createLoadSkillTool(catalog);
    expect(t.name).toBe('load_skill');
    expect(t.description).toBe(LOAD_SKILL_DESCRIPTION);
    const schema = z.toJSONSchema(t.inputSchema) as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toEqual(['name', 'file']);
    expect(schema.required).toEqual(['name']);
  });

  it('offered only when the catalogue has skills; never with tools disabled', () => {
    const tools = makeSettings().tools;
    const names = (skills?: SkillCatalog) => toolsFor(tools, { skills }).map((t) => t.name);
    const today = ['read_file', 'list_directory', 'write_file', 'run_command', 'ask_user'];
    expect(toolsFor(tools).map((t) => t.name)).toEqual(today);
    expect(names(EMPTY_CATALOG)).toEqual(today);
    expect(names(catalog)).toEqual([...today.slice(0, 4), 'load_skill', 'ask_user']);
    expect(toolsFor({ ...tools, enabled: false }, { skills: catalog }).map((t) => t.name)).toEqual([
      'ask_user',
    ]);
  });
});

describe('system prompt section', () => {
  it('without skills the prompt is unchanged byte for byte (SC-006)', () => {
    const today = buildSystemPrompt(base);
    expect(buildSystemPrompt({ ...base, skills: [] })).toBe(today);
    expect(buildSystemPrompt({ ...base, toolsEnabled: false, skills: [entry] })).toBe(
      buildSystemPrompt({ ...base, toolsEnabled: false }),
    );
    expect(today).not.toContain('# Skills');
  });

  it('with skills: section before the project guidelines, Language stays last', () => {
    const p = buildSystemPrompt({
      ...base,
      skills: [entry],
      language: 'pt-BR',
      projectContext: { file: 'MAESTRO.md', path: 'x', text: 'Regras.\n', bytes: 8, large: false },
    });
    const skills = p.indexOf('\n# Skills\n');
    expect(skills).toBeGreaterThan(0);
    expect(skills).toBeLessThan(p.indexOf('# Project guidelines (MAESTRO.md)'));
    expect(p).toContain('- revisao-pr: Checklist de PR da equipe.');
    expect(p.endsWith('Language: reply in Brazilian Portuguese (pt-BR).')).toBe(true);
  });
});
