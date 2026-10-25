import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledAssets } from '../../src/speckit/assets.js';
import { systemGit } from '../../src/speckit/git.js';
import { isInvocationError, parseInvocation } from '../../src/speckit/invocation.js';
import { runStep } from '../../src/speckit/steps/index.js';
import type { StepContext } from '../../src/speckit/steps/index.js';
import { withTempRepo } from '../helpers/tempRepo.js';
import type { TempRepo } from '../helpers/tempRepo.js';

const root = path.resolve(import.meta.dirname, '../..');

let repo: TempRepo;
beforeEach(() => {
  repo = withTempRepo({ git: true, specify: '0.4', commandsDir: '.claude/commands' });
});
afterEach(() => repo.cleanup());

const ctx = (): StepContext => ({
  cwd: repo.root,
  env: {},
  git: systemGit,
  assets: bundledAssets(),
  settings: { createBranch: true },
});

/** The JSON keys the official scripts print, per step (contracts/native-steps.md § 4). */
const KEYS: Record<string, string[]> = {
  'create-feature': ['BRANCH_NAME', 'SPEC_FILE', 'FEATURE_NUM', 'FEATURE_DIR', 'HAS_GIT'],
  'setup-plan': ['FEATURE_SPEC', 'IMPL_PLAN', 'FEATURE_DIR', 'BRANCH', 'HAS_GIT'],
  'setup-tasks': ['FEATURE_DIR', 'AVAILABLE_DOCS', 'TASKS_TEMPLATE', 'TASKS_TEMPLATE_CONTENT'],
  'check-prerequisites': ['FEATURE_DIR', 'AVAILABLE_DOCS'],
  'check-prerequisites:paths': [
    'REPO_ROOT',
    'BRANCH',
    'FEATURE_DIR',
    'FEATURE_SPEC',
    'IMPL_PLAN',
    'TASKS',
  ],
  'resolve-template': ['TEMPLATE_NAME', 'TEMPLATE_CONTENT'],
};

/** contracts/native-steps.md — native steps produce the scripts' JSON for the invocations the command files use */
describe('contract: native steps vs Spec Kit scripts', () => {
  it("runs every script invocation of this repository's 0.4.x command files with the documented JSON", { timeout: 60_000 }, async () => {
    // specify → plan → tasks in the order the workflow uses them
    const create = await runStep(
      parseInvocation(
        '.specify/scripts/powershell/create-new-feature.ps1 -Json -ShortName "contract-test" "Contract test feature"',
      ) as never,
      ctx(),
    );
    expect(create.ok).toBe(true);
    expect(Object.keys(JSON.parse(create.output))).toEqual(KEYS['create-feature']);
    expect(repo.branch()).toBe('001-contract-test');

    const plan = await runStep(
      parseInvocation('.specify/scripts/powershell/setup-plan.ps1 -Json') as never,
      ctx(),
    );
    expect(Object.keys(JSON.parse(plan.output))).toEqual(KEYS['setup-plan']);
    repo.write(
      'specs/001-contract-test/plan.md',
      '**Language/Version**: TypeScript 5.9\n**Primary Dependencies**: ink\n',
    );

    const agent = await runStep(
      parseInvocation(
        '.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude',
      ) as never,
      ctx(),
    );
    expect(agent.ok).toBe(true);
    expect(repo.exists('CLAUDE.md')).toBe(true);
    expect(repo.exists('MAESTRO.md')).toBe(true);

    for (const [cmd, key] of [
      ['.specify/scripts/powershell/check-prerequisites.ps1 -Json', 'check-prerequisites'],
      [
        '.specify/scripts/powershell/check-prerequisites.ps1 -Json -PathsOnly',
        'check-prerequisites:paths',
      ],
      [
        '.specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks',
        'check-prerequisites',
      ],
    ] as const) {
      if (key === 'check-prerequisites' && cmd.includes('RequireTasks'))
        repo.write('specs/001-contract-test/tasks.md', '- [ ] T001');
      const r = await runStep(parseInvocation(cmd) as never, ctx());
      expect(r.ok, cmd).toBe(true);
      expect(Object.keys(JSON.parse(r.output)), cmd).toEqual(KEYS[key]);
    }
  });

  it('runs the bundled 1.x invocations (bash/python) and setup-tasks/resolve-template too', { timeout: 60_000 }, async () => {
    await runStep(
      parseInvocation('scripts/bash/create-new-feature.sh --json --short-name one "x"') as never,
      ctx(),
    );
    await runStep(parseInvocation('scripts/bash/setup-plan.sh --json') as never, ctx());
    repo.write('specs/001-one/plan.md', 'p');
    const tasks = await runStep(
      parseInvocation('scripts/python/setup_tasks.py --json') as never,
      ctx(),
    );
    expect(Object.keys(JSON.parse(tasks.output))).toEqual(KEYS['setup-tasks']);
    const tpl = await runStep(
      parseInvocation('scripts/bash/resolve-template.sh checklist-template --json') as never,
      ctx(),
    );
    expect(Object.keys(JSON.parse(tpl.output))).toEqual(KEYS['resolve-template']);
    const withTpl = await runStep(
      parseInvocation(
        'scripts/bash/check-prerequisites.sh --json --require-spec --template tasks-template',
      ) as never,
      ctx(),
    );
    expect(Object.keys(JSON.parse(withTpl.output))).toEqual([
      'FEATURE_DIR',
      'AVAILABLE_DOCS',
      'TEMPLATE_CONTENT',
    ]);
  });

  it('every bundled command frontmatter script line parses into a step', () => {
    const dir = path.join(root, 'assets', 'speckit', 'templates', 'commands');
    for (const f of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of text.matchAll(/^\s+(sh|ps|py): (.+)$/gm)) {
        const req = parseInvocation(m[2]!);
        expect(req, `${f}: ${m[2]}`).toBeDefined();
        expect(req && isInvocationError(req), `${f}: ${m[2]}`).toBe(false);
      }
    }
  });
});
