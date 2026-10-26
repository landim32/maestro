/**
 * Autopilot end to end (specs/011 US1–US4) in a real temporary git repository with the native
 * Spec Kit: a scripted model, the real controller, real git commits; no network, no real shell
 * verification (fakeVerify), no remote (fakeRemote).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { bundledAssets } from '../../../src/speckit/assets.js';
import { systemGit, systemGitCommit } from '../../../src/speckit/git.js';
import { SpecKitService } from '../../../src/speckit/service.js';
import { allTools } from '../../../src/tools/registry.js';
import { readRunState } from '../../../src/autopilot/state.js';
import type { SettingsInput } from '../../../src/config/schema.js';
import type { Run } from '../../../src/autopilot/types.js';
import { createLogger } from '../../../src/utils/logger.js';
import { makeCtx } from '../../helpers/context.js';
import { withTempRepo } from '../../helpers/tempRepo.js';
import type { TempRepo } from '../../helpers/tempRepo.js';
import { fakeRemote, fakeVerify, speckitModel } from '../../helpers/autopilotPorts.js';
import type { ScriptOptions } from '../../helpers/autopilotPorts.js';

let repo: TempRepo;
beforeEach(() => {
  // Commits in the temp repo: identity and no signing, like tests/helpers/tempRepo.ts.
  vi.stubEnv('GIT_AUTHOR_NAME', 'Maestro Tests');
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'test@example.com');
  vi.stubEnv('GIT_COMMITTER_NAME', 'Maestro Tests');
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'test@example.com');
  vi.stubEnv('GIT_CONFIG_COUNT', '1');
  vi.stubEnv('GIT_CONFIG_KEY_0', 'commit.gpgsign');
  vi.stubEnv('GIT_CONFIG_VALUE_0', 'false');
  repo = withTempRepo({ git: true, specify: 'none' });
});
afterEach(() => {
  vi.unstubAllEnvs();
  repo.cleanup();
});

const ONE = '## Saudação\nComo usuário, quero uma função greet(name) que devolve "Olá, <name>!".\n';
const TWO = `${ONE}\n## Despedida\nComo usuário, quero bye(name) que devolve "Tchau, <name>!".\n`;

async function setup(
  script: ScriptOptions = {},
  extra: { settings?: SettingsInput; verify?: number[]; logFile?: string } = {},
) {
  const model = speckitModel(script);
  const verify = fakeVerify(extra.verify ?? [0]);
  const remote = fakeRemote();
  const progress: string[] = [];
  const specKit = new SpecKitService({
    cwd: repo.root,
    env: {},
    git: systemGit,
    assets: bundledAssets(),
    settings: { createBranch: true },
  });
  const controller = new SessionController({
    session: new Session({ cwd: repo.root, activeProviderId: 'claude' }),
    ctx: makeCtx(extra.settings ?? {}),
    tools: allTools(),
    system: 'sys',
    interactive: false,
    providerOverride: () => model.provider,
    specKit,
    logger: extra.logFile ? createLogger({ enabled: true, filePath: extra.logFile }) : undefined,
    autopilotDeps: {
      verify,
      remote,
      gitCommit: systemGitCommit,
      progress: (l) => progress.push(l),
    },
  });
  await controller.submit('/speckit.init');
  repo.git('add', '-A');
  repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'speckit');
  return { controller, model, verify, remote, progress };
}

const state = () => readRunState(repo.root) as Run;
const s0 = state;
const log = () => repo.git('log', '--format=%s', 'HEAD').split('\n');

describe('autopilot end to end', { timeout: 120_000 }, () => {
  it('one story: seven steps in order, one commit per step, decisions recorded, report', async () => {
    repo.write('historias.md', ONE);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    const { controller, model, verify, progress } = await setup({
      implementQuestion:
        'Some checklists have unchecked items. Do you want to proceed with implementation anyway? (yes/no)',
    });
    const r = await controller.createAutopilot().start('historias.md');
    expect(r.code).toBe(0);
    expect(model.steps.filter((s) => s !== 'round')).toEqual([
      'specify',
      'clarify',
      'plan',
      'tasks',
      'analyze',
      'implement',
    ]);
    expect(repo.branch()).toBe('001-saudao');
    // commits newest first; analyze (read-only) and verify (nothing to fix) change nothing → no commit
    expect(log().slice(0, 6)).toEqual([
      'fix: autopilot(001): implement',
      'fix: autopilot(001): tasks',
      'fix: autopilot(001): plan',
      'fix: autopilot(001): clarify',
      'fix: autopilot(001): specify',
      'speckit',
    ]);
    expect(s0().stories[0]!.steps.analyze.sha).toBe(s0().stories[0]!.steps.tasks.sha);
    expect(verify.calls).toEqual([]); // npm init-less temp repo: no package.json scripts
    const s = state();
    expect(s.status).toBe('done');
    expect(s.stories[0]!.steps.implement.answers).toBe(1);
    const decisions = repo.read(`specs/${model.feature()}/decisions.md`);
    expect(decisions).toContain('**Escolha:** Olá, nome! (Recommended)');
    expect(decisions).toContain('**Pergunta:** Some checklists have unchecked items.');
    expect(repo.read('specs/001-saudao/spec.md')).toContain('Formato: Olá');
    expect(r.report).toMatch(/✓ 1\/1 Saudação · 001-saudao/);
    expect(progress.some((l) => l.includes('história 1/1 "Saudação" · specify'))).toBe(true);
    // the state file is local: never committed, the tree stays clean
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(repo.git('ls-files', '.specify/autopilot.json')).toBe('');
    // overrides restored
    expect(controller.approvalMode).toBe('default');
    expect(controller.autopilotStatus).toBeUndefined();
  });

  it('refuses to start: dirty tree, missing file, no stories', async () => {
    const { controller } = await setup();
    repo.write('historias.md', ONE);
    let r = await controller.createAutopilot().start('historias.md');
    expect(r).toMatchObject({ code: 2 });
    expect(r.report).toMatch(/alterações não commitadas/);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'x');
    r = await controller.createAutopilot().start('nao-existe.md');
    expect(r.report).toMatch(/não encontrado/);
    repo.write('vazio.md', '\n\n');
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'y');
    r = await controller.createAutopilot().start('vazio.md');
    expect(r.report).toMatch(/Nenhuma história/);
    repo.write('hu.md', '# HU\n\n## 1. História\nquero\n\n## 2. Contexto\nx\n\n## 3. Escopo\ny\n');
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'z');
    r = await controller.createAutopilot().start('hu.md');
    expect(r).toMatchObject({ code: 2 });
    expect(r.report).toMatch(/parece uma única história dividida em seções .*Use "###" nas seções/);
  });

  it('verification: fixes until it passes, or stops after maxAttempts with the output', async () => {
    repo.write('package.json', '{"name":"x","scripts":{"test":"node --test"}}\n');
    repo.write('historias.md', ONE);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    const a = await setup({}, { verify: [1, 1, 0] });
    const ok = await a.controller.createAutopilot().start('historias.md');
    expect(ok.code).toBe(0);
    expect(a.verify.calls).toEqual(['npm test', 'npm test', 'npm test']);
    expect(state().stories[0]!.steps.verify).toMatchObject({ status: 'done', attempts: 2 });
    expect(log()[0]).toBe('fix: autopilot(001): verify');
  });

  it('verification that never passes stops the story and the run', async () => {
    repo.write('historias.md', ONE);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    const a = await setup(
      {},
      {
        verify: [1],
        settings: { autopilot: { verify: { command: ['node --test'], maxAttempts: 2 } } },
      },
    );
    const r = await a.controller.createAutopilot().start('historias.md');
    expect(r.code).toBe(1);
    expect(state()).toMatchObject({ status: 'stopped', stopped: { story: 1, step: 'verify' } });
    expect(r.report).toMatch(/parou em verify: node --test falhou depois de 2 tentativas/);
    expect(r.report).toContain('expected "Olá"');
    expect(r.report).toMatch(/Retomar: \/autopilot --resume/);
  });

  it('analyze with CRITICAL gets one fix round; still CRITICAL stops', async () => {
    repo.write('historias.md', ONE);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    const fixed = await setup({
      analyzeReports: ['Critical Issues Count: 2', 'Critical Issues Count: 0'],
    });
    expect((await fixed.controller.createAutopilot().start('historias.md')).code).toBe(0);
    expect(state().stories[0]!.steps.analyze.attempts).toBe(1);
  });

  it('analyze still CRITICAL after the fix stops the run', async () => {
    repo.write('historias.md', ONE);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    const bad = await setup({
      analyzeReports: ['Critical Issues Count: 2', 'Critical Issues Count: 1'],
    });
    const r = await bad.controller.createAutopilot().start('historias.md');
    expect(r.code).toBe(1);
    expect(state().stopped).toMatchObject({
      step: 'analyze',
      reason: '1 achados CRITICAL depois da correção',
    });
  });

  it('implement repeats "continue" while tasks progress', async () => {
    repo.write('historias.md', ONE);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    const a = await setup({ tasksPerRound: 1 });
    expect((await a.controller.createAutopilot().start('historias.md')).code).toBe(0);
    expect(state().stories[0]!.steps.implement.rounds).toBe(2);
  });

  it('two stories: stacked branches; publish only with push, PR base = previous story', async () => {
    repo.write('historias.md', TWO);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    const a = await setup();
    const r = await a.controller.createAutopilot().start('historias.md');
    expect(r.code).toBe(0);
    expect(repo.branch()).toBe('002-despedida');
    const s = state();
    expect(s.stories.map((x) => x.branch)).toEqual(['001-saudao', '002-despedida']);
    expect(
      systemGitCommit.isAncestor(repo.root, s.stories[0]!.steps.implement.sha!, '002-despedida'),
    ).toBe(true);
    expect(a.remote.prs).toEqual([]); // push is off by default
  });

  it('interrupt in the middle, then --resume continues from the interrupted step', async () => {
    repo.write('historias.md', TWO);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    const a = await setup();
    const driver = a.controller.createAutopilot();
    // cancel when the second story reaches plan
    const unsub = setInterval(() => {
      const st = a.controller.autopilotStatus;
      if (st && st.story === 2 && st.step === 'plan') driver.cancel();
    }, 1);
    const r1 = await driver.start('historias.md');
    clearInterval(unsub);
    expect(r1.code).toBe(1);
    const s1 = state();
    expect(s1.status).toBe('interrupted');
    expect(s1.stories[0]!.status).toBe('done');
    // partial work of the interrupted step is stashed, the tree is clean
    expect(r1.report).toMatch(/git stash "maestro autopilot .*002-despedida plan interrompido"/);
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(repo.git('stash', 'list')).toMatch(/002-despedida plan interrompido/);
    // uncommitted changes do not block the resume: they go into the next step's commit
    repo.write('notas.txt', 'ajuste manual\n');
    const stepsBefore = a.model.steps.length;
    const r2 = await a.controller.createAutopilot().start(undefined, { resume: true });
    expect(r2.code).toBe(0);
    const resumed = a.model.steps.slice(stepsBefore).filter((s) => s !== 'round');
    expect(resumed[0]).toBe('plan');
    expect(resumed).not.toContain('specify');
    expect(state().status).toBe('done');
    expect(repo.git('ls-files', 'notas.txt')).toBe('notas.txt');
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  it('push on: each story is pushed and gets a PR whose base is the previous story; merge only with merge', async () => {
    repo.write('historias.md', TWO);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    const pushes: string[] = [];
    const a = await setup({}, { settings: { autopilot: { push: true, merge: true } } });
    const realPush = systemGitCommit.push;
    (systemGitCommit as { push: typeof realPush }).push = (_root, branch) =>
      void pushes.push(branch);
    try {
      const r = await a.controller.createAutopilot().start('historias.md');
      expect(r.code).toBe(0);
    } finally {
      (systemGitCommit as { push: typeof realPush }).push = realPush;
    }
    expect(pushes).toEqual(['001-saudao', '002-despedida']);
    expect(a.remote.prs).toEqual([
      { base: 'main', head: '001-saudao' },
      { base: '001-saudao', head: '002-despedida' },
    ]);
    expect(a.remote.merged).toEqual([1, 2]);
    expect(state().stories[1]!.pr).toEqual({ url: 'https://example.test/pull/2', number: 2 });
  });

  it('-p runner: progress on stderr, report on stdout, exit codes 0 / 1 / 2', async () => {
    const { runAutopilotNonInteractive } = await import('../../../src/cli/nonInteractive.js');
    const sink = () => {
      const parts: string[] = [];
      return { write: (t: string) => parts.push(t), text: () => parts.join('') };
    };
    const a = await setup();
    let out = sink();
    let err = sink();
    expect(
      await runAutopilotNonInteractive({
        controller: a.controller,
        file: 'nada.md',
        stdout: out,
        stderr: err,
        handleSignals: false,
      }),
    ).toBe(2);
    expect(err.text()).toMatch(/maestro: Arquivo de histórias não encontrado/);
    repo.write('historias.md', ONE);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    out = sink();
    err = sink();
    const code = await runAutopilotNonInteractive({
      controller: a.controller,
      file: 'historias.md',
      stdout: out,
      stderr: err,
      handleSignals: false,
    });
    expect(code).toBe(0);
    expect(err.text()).toContain('autopiloto: história 1/1 "Saudação" · specify…');
    expect(out.text()).toMatch(/^Autopiloto .* · historias\.md · base main/);
    expect(out.text()).not.toContain('autopiloto: história');
  });

  it('debug log has events and counts only; the question text stays out of it', async () => {
    repo.write('historias.md', ONE);
    repo.git('add', '-A');
    repo.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'stories');
    const logFile = path.join(repo.root, '..', `ap-${path.basename(repo.root)}.log`);
    try {
      const a = await setup({}, { logFile });
      await a.controller.createAutopilot().start('historias.md');
      const text = fs.readFileSync(logFile, 'utf8');
      expect(text).toContain('autopilot.decision');
      expect(text).not.toContain('Qual formato de saudação');
      expect(text).not.toContain('Olá, nome!');
    } finally {
      fs.rmSync(logFile, { force: true });
    }
  });
});
