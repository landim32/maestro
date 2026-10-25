import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledAssets } from '../../../src/speckit/assets.js';
import { nullGit, systemGit } from '../../../src/speckit/git.js';
import { parseInvocation } from '../../../src/speckit/invocation.js';
import type { StepRequest } from '../../../src/speckit/invocation.js';
import { runStep } from '../../../src/speckit/steps/index.js';
import type { StepContext } from '../../../src/speckit/steps/index.js';
import { parsePlanFacts, updateAgentFile } from '../../../src/speckit/steps/agentContext.js';
import { withTempRepo } from '../../helpers/tempRepo.js';
import type { TempRepo } from '../../helpers/tempRepo.js';

let repo: TempRepo;
beforeEach(() => {
  repo = withTempRepo({ git: true, specify: '1.x' });
});
afterEach(() => repo.cleanup());

const assets = bundledAssets();
const ctx = (over: Partial<StepContext> = {}): StepContext => ({
  cwd: repo.root,
  env: {},
  git: systemGit,
  assets,
  settings: { createBranch: true },
  now: () => new Date(2026, 9, 25, 10, 0, 0),
  ...over,
});
const req = (cmd: string): StepRequest => parseInvocation(cmd) as StepRequest;
const PLAN = [
  '# Implementation Plan: X',
  '',
  '**Language/Version**: TypeScript 5.9  ',
  '**Primary Dependencies**: ink 8  ',
  '**Storage**: files  ',
  '**Project Type**: CLI  ',
].join('\n');

/** contracts/native-steps.md § 4 */
describe('create-feature', { timeout: 60_000 }, () => {
  it('creates dir, spec from template, feature.json and the git branch; returns the JSON', async () => {
    const r = await runStep(
      req('scripts/bash/create-new-feature.sh --json --short-name "user-auth" "Add user auth"'),
      ctx(),
    );
    expect(r.ok).toBe(true);
    const data = JSON.parse(r.output) as Record<string, unknown>;
    expect(data).toEqual({
      BRANCH_NAME: '001-user-auth',
      SPEC_FILE: path.join(repo.root, 'specs', '001-user-auth', 'spec.md'),
      FEATURE_NUM: '001',
      FEATURE_DIR: path.join(repo.root, 'specs', '001-user-auth'),
      HAS_GIT: true,
    });
    expect(repo.branch()).toBe('001-user-auth');
    expect(repo.read('specs/001-user-auth/spec.md')).toContain('# Feature Specification');
    expect(JSON.parse(repo.read('.specify/feature.json'))).toEqual({
      feature_directory: 'specs/001-user-auth',
    });
    expect(r.summary).toContain('branch criada');
  });

  it('numbers after existing branches/dirs, honours --number conflicts, --timestamp and --dry-run', async () => {
    repo.write('specs/004-old/spec.md', '');
    repo.git('branch', '007-remote-ish');
    const dry = await runStep(
      req('scripts/bash/create-new-feature.sh --json --dry-run "Next thing"'),
      ctx(),
    );
    expect(JSON.parse(dry.output)).toMatchObject({ BRANCH_NAME: '008-next-thing', DRY_RUN: true });
    expect(repo.exists('specs/008-next-thing')).toBe(false);

    const conflict = await runStep(
      req('scripts/bash/create-new-feature.sh --json --number 4 --short-name again "x"'),
      ctx(),
    );
    expect(JSON.parse(conflict.output)).toMatchObject({
      BRANCH_NAME: '005-again',
      FEATURE_NUM: '005',
    });
    expect(conflict.warnings?.join('\n')).toMatch(/--number 004 conflicts/);

    const ts = await runStep(
      req('scripts/bash/create-new-feature.sh --json --timestamp --short-name tsf "x"'),
      ctx(),
    );
    expect(JSON.parse(ts.output)).toMatchObject({ BRANCH_NAME: '20261025-100000-tsf' });
  });

  it('refuses an existing directory unless --allow-existing-branch; warns on a dirty tree', async () => {
    await runStep(req('scripts/bash/create-new-feature.sh --json --short-name dup "x"'), ctx());
    repo.git('checkout', '-q', 'main');
    const again = await runStep(
      req('scripts/bash/create-new-feature.sh --json --number 1 --short-name dup "x"'),
      ctx(),
    );
    // an explicit number that collides is treated as a preference: next free prefix + warning
    expect(again.ok).toBe(true);
    expect(JSON.parse(again.output)).toMatchObject({ BRANCH_NAME: '002-dup' });
    expect(again.warnings?.join('\n')).toMatch(/--number 001 conflicts/);
    repo.git('checkout', '-q', 'main');
    repo.write('dirty.txt', 'x');
    const allowed = await runStep(
      req(
        'scripts/bash/create-new-feature.sh --json --number 1 --allow-existing-branch --short-name dup "x"',
      ),
      ctx(),
    );
    expect(allowed.ok).toBe(true);
    expect(repo.branch()).toBe('001-dup');
    expect(allowed.warnings?.join('\n')).toMatch(/uncommitted changes/);
  });

  it('without git, or with createBranch=false, creates the folder only', async () => {
    const noGit = withTempRepo({ git: false, specify: '1.x' });
    try {
      const r = await runStep(
        req('scripts/bash/create-new-feature.sh --json --short-name solo "x"'),
        ctx({ cwd: noGit.root, git: nullGit }),
      );
      expect(JSON.parse(r.output)).toMatchObject({ BRANCH_NAME: '001-solo', HAS_GIT: false });
      expect(noGit.exists('specs/001-solo/spec.md')).toBe(true);
      expect(r.summary).toContain('sem git');
    } finally {
      noGit.cleanup();
    }
    const r2 = await runStep(
      req('scripts/bash/create-new-feature.sh --json --short-name nobranch "x"'),
      ctx({ settings: { createBranch: false } }),
    );
    expect(r2.ok).toBe(true);
    expect(repo.branch()).toBe('main');
    expect(repo.exists('specs/001-nobranch/spec.md')).toBe(true);
  });
});

describe('setup-plan / setup-tasks / check-prerequisites / resolve-template', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await runStep(req('scripts/bash/create-new-feature.sh --json --short-name feat "x"'), ctx());
  });

  it('setup-plan copies the template once and returns the 0.4.x/1.x JSON', async () => {
    const r = await runStep(req('.specify/scripts/powershell/setup-plan.ps1 -Json'), ctx());
    expect(JSON.parse(r.output)).toEqual({
      FEATURE_SPEC: path.join(repo.root, 'specs', '001-feat', 'spec.md'),
      IMPL_PLAN: path.join(repo.root, 'specs', '001-feat', 'plan.md'),
      FEATURE_DIR: path.join(repo.root, 'specs', '001-feat'),
      BRANCH: '001-feat',
      HAS_GIT: true,
    });
    expect(repo.read('specs/001-feat/plan.md')).toContain('# Implementation Plan');
    repo.write('specs/001-feat/plan.md', 'edited');
    const again = await runStep(req('scripts/bash/setup-plan.sh --json'), ctx());
    expect(again.summary).toMatch(/already exists/);
    expect(repo.read('specs/001-feat/plan.md')).toBe('edited');
  });

  it('check-prerequisites validates artifacts with the scripts messages and lists docs in order', async () => {
    const noPlan = await runStep(
      req('.specify/scripts/powershell/check-prerequisites.ps1 -Json'),
      ctx(),
    );
    expect(noPlan.ok).toBe(false);
    expect(noPlan.output).toBe(
      `ERROR: plan.md not found in ${path.join(repo.root, 'specs', '001-feat')}\nRun /speckit.plan first to create the implementation plan.`,
    );
    repo.write('specs/001-feat/plan.md', PLAN);
    const noTasks = await runStep(
      req('scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks'),
      ctx(),
    );
    expect(noTasks.output).toMatch(/tasks\.md not found[\s\S]*Run \/speckit\.tasks first/);
    repo.write('specs/001-feat/quickstart.md', 'q');
    repo.write('specs/001-feat/research.md', 'r');
    repo.write('specs/001-feat/contracts/a.md', 'c');
    repo.write('specs/001-feat/tasks.md', 't');
    const okRes = await runStep(
      req('scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks'),
      ctx(),
    );
    expect(JSON.parse(okRes.output)).toEqual({
      FEATURE_DIR: path.join(repo.root, 'specs', '001-feat'),
      AVAILABLE_DOCS: ['research.md', 'contracts/', 'quickstart.md', 'tasks.md'],
    });
    const paths = await runStep(
      req('.specify/scripts/powershell/check-prerequisites.ps1 -Json -PathsOnly'),
      ctx(),
    );
    expect(Object.keys(JSON.parse(paths.output))).toEqual([
      'REPO_ROOT',
      'BRANCH',
      'FEATURE_DIR',
      'FEATURE_SPEC',
      'IMPL_PLAN',
      'TASKS',
    ]);
    const text = await runStep(req('scripts/bash/check-prerequisites.sh --include-tasks'), ctx());
    expect(text.output).toContain('  ✓ research.md');
    expect(text.output).toContain('  ✗ data-model.md');
  });

  it('setup-tasks requires spec and plan and returns the composed tasks template', async () => {
    repo.write('specs/001-feat/plan.md', PLAN);
    fs.rmSync(path.join(repo.root, 'specs', '001-feat', 'spec.md'));
    const noSpec = await runStep(req('scripts/bash/setup-tasks.sh --json'), ctx());
    expect(noSpec.output).toMatch(/spec\.md not found/);
    repo.write('specs/001-feat/spec.md', 's');
    const r = await runStep(req('scripts/bash/setup-tasks.sh --json'), ctx());
    const data = JSON.parse(r.output) as Record<string, unknown>;
    expect(data['AVAILABLE_DOCS']).toEqual([]);
    expect(data['TASKS_TEMPLATE']).toContain('tasks-template.md');
    expect(data['TASKS_TEMPLATE_CONTENT']).toContain('# Tasks:');
  });

  it('resolve-template returns the content (json or raw)', async () => {
    const r = await runStep(req('scripts/bash/resolve-template.sh spec-template --json'), ctx());
    expect(JSON.parse(r.output)).toMatchObject({ TEMPLATE_NAME: 'spec-template' });
    const raw = await runStep(req('scripts/bash/resolve-template.sh spec-template'), ctx());
    expect(raw.output).toContain('# Feature Specification');
    const missing = await runStep(req('scripts/bash/resolve-template.sh nope'), ctx());
    expect(missing.ok).toBe(false);
  });
});

/** contracts/native-steps.md § 4 — update-agent-context */
describe('update-agent-context', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await runStep(req('scripts/bash/create-new-feature.sh --json --short-name ctx "x"'), ctx());
    repo.write('specs/001-ctx/plan.md', PLAN);
  });

  it('parses plan facts and creates MAESTRO.md plus the requested agent file from the template', async () => {
    expect(parsePlanFacts(PLAN)).toEqual({
      language: 'TypeScript 5.9',
      framework: 'ink 8',
      storage: 'files',
      projectType: 'CLI',
    });
    const r = await runStep(
      req('.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude'),
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ created: ['MAESTRO.md', 'CLAUDE.md'], updated: [] });
    const claude = repo.read('CLAUDE.md');
    expect(claude).toContain('Last updated: 2026-10-25');
    expect(claude).toContain('- TypeScript 5.9 + ink 8 (001-ctx)');
    expect(claude).toContain('- 001-ctx: Added TypeScript 5.9 + ink 8');
    expect(claude).toContain('<!-- MANUAL ADDITIONS START -->');
    expect(r.output).toContain('✓ Created new Claude Code context file');
  });

  it('updates existing files without duplicating, keeps three recent changes and the manual section', async () => {
    await runStep(req('scripts/bash/update-agent-context.sh'), ctx());
    let text = repo
      .read('MAESTRO.md')
      .replace(/\r\n/g, '\n')
      .replace('<!-- MANUAL ADDITIONS START -->', '<!-- MANUAL ADDITIONS START -->\nkeep me');
    text = text.replace(
      '## Recent Changes\n',
      '## Recent Changes\n- old-1: a\n- old-2: b\n- old-3: c\n',
    );
    repo.write('MAESTRO.md', text);
    repo.write('specs/001-ctx/plan.md', PLAN.replace('ink 8', 'ink 9'));
    const r = await runStep(req('scripts/bash/update-agent-context.sh'), ctx());
    expect(r.data).toMatchObject({ created: [], updated: ['MAESTRO.md'] });
    const after = repo.read('MAESTRO.md');
    expect(after).toContain('keep me');
    expect(after).toContain('- TypeScript 5.9 + ink 9 (001-ctx)');
    expect(after).toContain('- TypeScript 5.9 + ink 8 (001-ctx)');
    const changes = after
      .split('## Recent Changes')[1]!
      .split('##')[0]!
      .split('\n')
      .filter((l) => l.startsWith('- '));
    expect(changes).toEqual([
      '- 001-ctx: Added TypeScript 5.9 + ink 9',
      '- old-1: a',
      '- old-2: b',
    ]);
    // pure helper: a second update with the same facts adds no tech entry (already present)
    const twice = updateAgentFile(
      after,
      parsePlanFacts(PLAN.replace('ink 8', 'ink 9')),
      '001-ctx',
      new Date(),
    );
    expect(twice.match(/- TypeScript 5\.9 \+ ink 9 \(001-ctx\)/g)).toHaveLength(1);
  });

  it('fails clearly without a plan', async () => {
    fs.rmSync(path.join(repo.root, 'specs', '001-ctx', 'plan.md'));
    const r = await runStep(req('scripts/bash/update-agent-context.sh'), ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/No plan\.md found/);
  });
});
