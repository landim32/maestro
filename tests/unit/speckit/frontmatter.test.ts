import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseFrontmatter,
  parseYamlSubset,
  YamlSubsetError,
} from '../../../src/speckit/frontmatter.js';

const root = path.resolve(import.meta.dirname, '../../..');

/** specs/006 research R8 — minimal YAML for Spec Kit files */
describe('parseFrontmatter', () => {
  it('reads description, scripts and handoffs of every bundled command', () => {
    const dir = path.join(root, 'assets', 'speckit', 'templates', 'commands');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(10);
    for (const f of files) {
      const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      expect(typeof data['description'], f).toBe('string');
      expect(body, f).toContain('## User Input');
      if (f !== 'constitution.md' && f !== 'checklist.md') {
        const scripts = data['scripts'] as Record<string, string> | undefined;
        if (scripts) expect(scripts['sh'], f).toMatch(/^scripts\/bash\//);
      }
    }
    const specify = parseFrontmatter(fs.readFileSync(path.join(dir, 'specify.md'), 'utf8'));
    expect(specify.data['handoffs']).toEqual([
      {
        label: 'Build Technical Plan',
        agent: 'speckit.plan',
        prompt: 'Create a plan for the spec. I am building with...',
      },
      {
        label: 'Clarify Spec Requirements',
        agent: 'speckit.clarify',
        prompt: 'Clarify specification requirements',
        send: true,
      },
    ]);
    expect(specify.data['scripts']).toEqual({
      sh: 'scripts/bash/create-new-feature.sh --json',
      ps: 'scripts/powershell/create-new-feature.ps1 -Json',
      py: 'scripts/python/create_new_feature.py --json',
    });
  });

  it("reads this repository's installed 0.4.x commands (tools list, description)", () => {
    const dir = path.join(root, '.claude', 'commands');
    const issues = parseFrontmatter(
      fs.readFileSync(path.join(dir, 'speckit.taskstoissues.md'), 'utf8'),
    );
    expect(issues.data['tools']).toEqual(['github/github-mcp-server/issue_write']);
    expect(issues.data['description']).toMatch(/GitHub issues/);
  });

  it('handles no frontmatter, quoted scalars with colons, booleans, numbers and comments', () => {
    expect(parseFrontmatter('# just markdown\n')).toEqual({ data: {}, body: '# just markdown\n' });
    const y = parseYamlSubset(
      [
        'title: "a: b" # comment',
        "name: 'it''s'",
        'enabled: false',
        'priority: 3',
        'list:',
        '  - one',
        '  - two',
        'nested:',
        '  inner: value',
        '  deeper:',
        '    - k: v',
        '      n: 2',
      ].join('\n'),
    );
    expect(y).toEqual({
      title: 'a: b',
      name: "it's",
      enabled: false,
      priority: 3,
      list: ['one', 'two'],
      nested: { inner: 'value', deeper: [{ k: 'v', n: 2 }] },
    });
  });

  it('reports the line of invalid indentation', () => {
    expect(() => parseYamlSubset('a: 1\n   b: 2')).toThrow(YamlSubsetError);
    expect(() => parseYamlSubset('a: 1\n   b: 2')).toThrow(/line 2/);
  });
});
