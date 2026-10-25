import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledAssets } from '../../../src/speckit/assets.js';
import {
  resolveTemplateContent,
  resolveTemplatePath,
  TemplateError,
} from '../../../src/speckit/templates.js';
import { withTempRepo } from '../../helpers/tempRepo.js';
import type { TempRepo } from '../../helpers/tempRepo.js';

let repo: TempRepo;
beforeEach(() => {
  repo = withTempRepo({ git: false, specify: '1.x' });
});
afterEach(() => repo.cleanup());

const assets = bundledAssets();

/** specs/006 research R6 — overrides → presets → extensions → core → bundled */
describe('template resolution stack', { timeout: 60_000 }, () => {
  it('uses the core template, then an override wins', () => {
    expect(resolveTemplatePath('spec-template', repo.root, assets)).toContain('.specify');
    expect(resolveTemplateContent('spec-template', repo.root, assets)).toContain(
      '# Feature Specification',
    );
    repo.write('.specify/templates/overrides/spec-template.md', '# Mine');
    expect(resolveTemplateContent('spec-template', repo.root, assets)).toBe('# Mine');
  });

  it('falls back to the bundled template when .specify/templates is missing', () => {
    const bare = withTempRepo({ git: false, specify: 'none' });
    try {
      expect(resolveTemplatePath('plan-template', bare.root, assets)).toBe(
        'bundled:templates/plan-template.md',
      );
      expect(resolveTemplateContent('plan-template', bare.root, assets)).toContain(
        '# Implementation Plan',
      );
      expect(resolveTemplateContent('nope', bare.root, assets)).toBeUndefined();
    } finally {
      bare.cleanup();
    }
  });

  it('composes preset layers with prepend/append/wrap on top of the core, ordered by registry priority', () => {
    repo.write('.specify/templates/plan-template.md', 'CORE');
    repo.write(
      '.specify/presets/.registry',
      JSON.stringify({ presets: { beta: { priority: 2 }, alpha: { priority: 1 } } }),
    );
    repo.write(
      '.specify/presets/alpha/preset.yml',
      [
        'provides:',
        '  templates:',
        '    - type: template',
        '      name: plan-template',
        '      file: templates/plan-template.md',
        '      strategy: prepend',
      ].join('\n'),
    );
    repo.write('.specify/presets/alpha/templates/plan-template.md', 'TOP');
    repo.write(
      '.specify/presets/beta/preset.yml',
      [
        'provides:',
        '  templates:',
        '    - type: template',
        '      name: plan-template',
        '      file: wrap.md',
        '      strategy: wrap',
      ].join('\n'),
    );
    repo.write('.specify/presets/beta/wrap.md', '<<{CORE_TEMPLATE}>>');
    expect(resolveTemplateContent('plan-template', repo.root, assets)).toBe('TOP\n\n<<CORE>>');

    repo.write('.specify/presets/beta/wrap.md', 'no placeholder');
    expect(() => resolveTemplateContent('plan-template', repo.root, assets)).toThrow(TemplateError);
  });

  it('a replace preset or an extension template shadows the core', () => {
    repo.write('.specify/templates/tasks-template.md', 'CORE');
    repo.write('.specify/extensions/ext-a/templates/tasks-template.md', 'EXT');
    expect(resolveTemplateContent('tasks-template', repo.root, assets)).toBe('EXT');
    repo.write('.specify/presets/p/templates/tasks-template.md', 'PRESET');
    expect(resolveTemplateContent('tasks-template', repo.root, assets)).toBe('PRESET');
  });
});
