/** specs/011 data-model.md § 7 — the pure flow of the autopilot. */
import { describe, expect, it } from 'vitest';
import {
  commitMessage,
  claimFeature,
  onAnswer,
  onDecisionFailed,
  onCommitted,
  onPublished,
  onTurn,
  onVerify,
  resumeSpecifyText,
  start,
} from '../../../src/autopilot/flow.js';
import type { FlowContext, Step, TurnOutcome } from '../../../src/autopilot/flow.js';
import type { DiskView } from '../../../src/autopilot/gates.js';
import { emptyStory } from '../../../src/autopilot/types.js';
import type { Run, Story } from '../../../src/autopilot/types.js';
import { makeSettings } from '../../helpers/context.js';

const stories: Story[] = [
  { index: 1, title: 'Login', body: 'quero entrar', hash: 'a' },
  { index: 2, title: 'Export', body: 'csv', hash: 'b' },
];
const settings = makeSettings({
  autopilot: { verify: { maxAttempts: 2 }, limits: { turns: 8 } },
}).autopilot;
const ctx: FlowContext = { stories, settings, now: 0 };
const run = (): Run => ({
  version: 1,
  id: 'r',
  input: 'h.md',
  inputHash: 'x',
  baseBranch: 'main',
  status: 'active',
  pid: 1,
  startedAt: '',
  stories: stories.map(emptyStory),
});
const view = (o: Partial<DiskView> = {}): DiskView => ({
  featureDirs: [],
  spec: { exists: false },
  plan: { exists: false },
  tasks: { exists: false },
  openTasks: 0,
  doneTasks: 0,
  ...o,
});
const turn = (
  after: Partial<DiskView>,
  o: Partial<TurnOutcome['snapshot']> = {},
  before: Partial<DiskView> = {},
): TurnOutcome => ({
  snapshot: {
    step: 'specify',
    before: view(before),
    after: view(after),
    branch: '001-login',
    hasGit: true,
    text: 'ok',
    stopReason: 'end_turn',
    ...o,
  },
  usage: { inputTokens: 10, outputTokens: 5 },
  ms: 1000,
});

describe('autopilot flow', () => {
  it('starts with a clean specify turn carrying the story text', () => {
    const s = start(run(), ctx);
    expect(s.next).toEqual({
      type: 'turn',
      text: '/speckit.specify Login\n\nquero entrar',
      clear: true,
    });
    expect(s.state.run.stories[0]!.status).toBe('running');
    expect(s.state.run.stories[0]!.steps.specify.status).toBe('running');
  });

  it('advance → commit → next step with a clean session; feature recorded after specify', () => {
    let s = start(run(), ctx);
    s = onTurn(
      s.state,
      ctx,
      turn({ feature: '001-login', featureDirs: ['001-login'], spec: { exists: true } }),
    );
    expect(s.next).toEqual({ type: 'commit', message: 'fix: autopilot(001): specify\n\nLogin' });
    expect(s.state.run.stories[0]).toMatchObject({ feature: '001-login', branch: '001-login' });
    s = onCommitted(s.state, ctx, 'sha1');
    expect(s.state.run.stories[0]!.steps.specify).toMatchObject({ status: 'done', sha: 'sha1' });
    expect(s.next).toEqual({ type: 'turn', text: '/speckit.clarify', clear: true });
    expect(s.state.run.stories[0]!.usage).toMatchObject({ turns: 1, ms: 1000, inputTokens: 10 });
  });

  it('question → decide → answer as next turn in the same step', () => {
    let s = start(run(), ctx);
    s = onTurn(s.state, ctx, turn({}, { text: 'Should I create the branch?' }));
    expect(s.next).toEqual({ type: 'decide', question: 'Should I create the branch?' });
    s = onAnswer(s.state, 'yes');
    expect(s.next).toEqual({ type: 'turn', text: 'yes', clear: false });
    expect(s.state.run.stories[0]!.steps.specify).toMatchObject({ answers: 1, rounds: 1 });
  });

  const at = (step: 'analyze' | 'implement' | 'verify'): Step => {
    const r = run();
    for (const k of ['specify', 'clarify', 'plan', 'tasks', 'analyze', 'implement'] as const) {
      if (k === step) break;
      r.stories[0]!.steps[k].status = 'done';
    }
    r.stories[0]!.feature = '001-login';
    return start(r, ctx);
  };

  it('analyze CRITICAL: fix turn, then /speckit.analyze again without clearing', () => {
    let s = at('analyze');
    s = onTurn(s.state, ctx, turn({}, { step: 'analyze', text: 'Critical Issues Count: 1' }));
    expect(s.next).toMatchObject({ type: 'turn', clear: false });
    expect(s.next.type === 'turn' && s.next.text).toMatch(/Resolva os achados CRITICAL/);
    s = onTurn(s.state, ctx, turn({}, { step: 'analyze', text: 'pronto' }));
    expect(s.next).toEqual({ type: 'turn', text: '/speckit.analyze', clear: false });
    s = onTurn(s.state, ctx, turn({}, { step: 'analyze', text: 'Critical Issues Count: 1' }));
    expect(s.next).toEqual({ type: 'finish' });
    expect(s.state.run).toMatchObject({
      status: 'stopped',
      stopped: { story: 1, step: 'analyze' },
    });
  });

  it('implement: continue while progressing', () => {
    let s = at('implement');
    s = onTurn(s.state, ctx, turn({ openTasks: 2, doneTasks: 1 }, { step: 'implement' }));
    expect(s.next).toEqual({ type: 'turn', text: 'continue', clear: false });
    s = onTurn(
      s.state,
      ctx,
      turn({ openTasks: 0, doneTasks: 3 }, { step: 'implement' }, { doneTasks: 1 }),
    );
    expect(s.next.type).toBe('commit');
  });

  it('implement without marked tasks: two reminders, progress resets them, then stop', () => {
    let s = at('implement');
    const none = () => turn({ openTasks: 3, doneTasks: 0 }, { step: 'implement' });
    s = onTurn(s.state, ctx, none());
    expect(s.next).toMatchObject({ type: 'turn', clear: false });
    expect(s.next.type === 'turn' && s.next.text).toMatch(/Marque com \[X\]/);
    s = onTurn(s.state, ctx, none());
    expect(s.next.type).toBe('turn');
    // progress: "continue" and the reminders start over
    s = onTurn(s.state, ctx, turn({ openTasks: 2, doneTasks: 1 }, { step: 'implement' }));
    expect(s.next).toEqual({ type: 'turn', text: 'continue', clear: false });
    const stuck = () =>
      turn({ openTasks: 2, doneTasks: 1 }, { step: 'implement' }, { doneTasks: 1 });
    s = onTurn(s.state, ctx, stuck());
    s = onTurn(s.state, ctx, stuck());
    expect(s.next.type).toBe('turn');
    s = onTurn(s.state, ctx, stuck());
    expect(s.state.run.stopped).toMatchObject({
      step: 'implement',
      reason: 'sem progresso (1/3 tarefas) depois de 2 lembretes',
    });
  });

  it('verify: fix in the implement history, retry, stop after maxAttempts', () => {
    let s = at('verify');
    expect(s.next).toEqual({ type: 'verify' });
    s = onVerify(s.state, ctx, { ok: false, command: 'npm test', output: 'FAIL' });
    expect(s.next).toEqual({
      type: 'turn',
      text: 'A verificação falhou. Corrija o código para que passe:\n\n$ npm test\nFAIL',
      clear: false,
    });
    s = onTurn(s.state, ctx, turn({}, { step: 'implement', text: 'corrigido' }));
    expect(s.next).toEqual({ type: 'verify' });
    s = onVerify(s.state, ctx, { ok: false, command: 'npm test', output: 'FAIL' });
    s = onTurn(s.state, ctx, turn({}, { step: 'implement' }));
    s = onVerify(s.state, ctx, { ok: false, command: 'npm test', output: 'FAIL' });
    expect(s.state.run.stopped).toMatchObject({
      step: 'verify',
      reason: 'npm test falhou depois de 2 tentativas de correção',
    });
  });

  it('story done → publish → next story specify; last story → run done', () => {
    let s = at('verify');
    s = onVerify(s.state, ctx, { ok: true, command: 'npm test', output: '' });
    expect(s.next.type).toBe('commit');
    s = onCommitted(s.state, ctx, 's2');
    expect(s.next).toEqual({ type: 'publish' });
    s = onPublished(s.state, ctx, { url: 'u', number: 1 });
    expect(s.state.run.stories[0]).toMatchObject({ status: 'done', pr: { url: 'u', number: 1 } });
    expect(s.next).toEqual({ type: 'turn', text: '/speckit.specify Export\n\ncsv', clear: true });
    expect(s.state.story).toBe(1);
  });

  it('cancel and provider limit interrupt; per-story turn limit stops', () => {
    const s = start(run(), ctx);
    expect(onTurn(s.state, ctx, turn({}, { stopReason: 'cancelled' })).state.run.status).toBe(
      'interrupted',
    );
    expect(
      onTurn(s.state, ctx, turn({}, { stopReason: 'error', errorCategory: 'rate_limit' })).state.run
        .status,
    ).toBe('interrupted');
    let t = s;
    for (let i = 0; i < 9; i++) t = onTurn(t.state, ctx, turn({}, { text: 'Should I go on?' }));
    expect(t.state.run.stopped?.reason).toMatch(/teto de 8 turnos/);
  });

  it('by default there is no cap: many turns and hours never stop the story', () => {
    const free: FlowContext = { ...ctx, settings: makeSettings({}).autopilot };
    let t = start(run(), free);
    for (let i = 0; i < 200; i++) {
      t = onTurn(t.state, free, { ...turn({}, { text: 'Should I go on?' }), ms: 3_600_000 });
    }
    expect(t.state.run.status).toBe('active');
    expect(t.state.run.stopped).toBeUndefined();
  });

  it('a minutes cap, when set, stops the story', () => {
    const capped: FlowContext = {
      ...ctx,
      settings: makeSettings({ autopilot: { limits: { minutes: 2 } } }).autopilot,
    };
    let t = start(run(), capped);
    for (let i = 0; i < 3; i++) {
      t = onTurn(t.state, capped, { ...turn({}, { text: 'Should I go on?' }), ms: 60_000 });
    }
    expect(t.state.run.stopped?.reason).toMatch(/teto de 2 minutos/);
  });

  it('resuming a story stopped by a cap starts its usage from zero', () => {
    const r = run();
    r.stories[0]!.status = 'stopped';
    r.stories[0]!.usage = { turns: 9, ms: 9_000_000, inputTokens: 900, outputTokens: 90 };
    r.stories[0]!.steps.specify.status = 'failed';
    const s = start(r, ctx);
    expect(s.state.run.stories[0]!.usage).toEqual({
      turns: 0,
      ms: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    const t = onTurn(s.state, ctx, turn({}, { text: 'Should I go on?' }));
    expect(t.state.run.stopped).toBeUndefined();
  });

  it('resume of an orphan run (process died): the running step starts over', () => {
    const r = run();
    r.stories[0]!.status = 'running';
    r.stories[0]!.steps.specify.status = 'done';
    r.stories[0]!.steps.clarify = {
      ...r.stories[0]!.steps.clarify,
      status: 'running',
      answers: 3,
      rounds: 7,
    };
    const s = start(r, ctx);
    expect(s.next).toEqual({ type: 'turn', text: '/speckit.clarify', clear: true });
    expect(s.state.run.stories[0]!.steps.clarify).toMatchObject({
      status: 'running',
      answers: 0,
      rounds: 0,
    });
  });

  it('start resumes at the first step not done and resets a failed step', () => {
    const r = run();
    r.stories[0]!.steps.specify.status = 'done';
    r.stories[0]!.steps.clarify = { ...r.stories[0]!.steps.clarify, status: 'failed', attempts: 2 };
    const s = start(r, ctx);
    expect(s.next).toEqual({ type: 'turn', text: '/speckit.clarify', clear: true });
    expect(s.state.run.stories[0]!.steps.clarify).toMatchObject({ status: 'running', attempts: 0 });
  });

  it('resumed specify continues the feature its first attempt created, never resends the story', () => {
    // first attempt: the feature appears on disk, then the decider fails → the story keeps it
    let s = start(run(), ctx);
    const claimed = claimFeature(s.state, {
      before: view({ featureDirs: ['005-old'] }),
      after: view({ featureDirs: ['005-old', '006-login'], feature: '006-login' }),
      branch: '006-login',
    });
    expect(claimed === s.state).toBe(false);
    expect(claimed.run.stories[0]).toMatchObject({ feature: '006-login', branch: '006-login' });
    // a feature that already existed before the turn (e.g. feature.json of an older one) is not taken
    expect(
      claimFeature(s.state, {
        before: view({ featureDirs: ['002-old'] }),
        after: view({ featureDirs: ['002-old'], feature: '002-old' }),
      }).run.stories[0]!.feature,
    ).toBeUndefined();
    const failed = onDecisionFailed(claimed, 'o decisor falhou').state.run;
    s = start(failed, { ...ctx, specOnDisk: (f) => f === '006-login' });
    expect(s.next).toEqual({ type: 'turn', text: resumeSpecifyText('006-login'), clear: false });
    expect(s.state.run.stories[0]!.steps.specify).toMatchObject({
      status: 'running',
      resumed: true,
    });
    // the gate keeps that feature although it existed before the turn
    const out = onTurn(
      s.state,
      ctx,
      turn(
        { feature: '006-login', featureDirs: ['006-login'], spec: { exists: true, hash: 'h' } },
        { branch: '006-login' },
        { feature: '006-login', featureDirs: ['006-login'] },
      ),
    );
    expect(out.next.type).toBe('commit');
    // spec.md gone (removed by hand): the story goes to /speckit.specify again
    s = start(failed, ctx);
    expect(s.next).toMatchObject({ text: '/speckit.specify Login\n\nquero entrar', clear: true });
  });

  it('commit message uses the configured prefix and the feature number', () => {
    expect(
      commitMessage(
        'feat:',
        { ...emptyStory({ title: 'T', hash: 'h' }), feature: '012-x' },
        'plan',
      ),
    ).toBe('feat: autopilot(012): plan\n\nT');
  });
});
