/**
 * Autopilot state machine (specs/011 data-model.md § 7). Pure: every function takes the state and
 * what just happened, and returns the new state plus the next action for the driver.
 */
import type { AutopilotSettings } from '../config/schema.js';
import { evaluateGate, verifyFixPrompt } from './gates.js';
import type { GateSnapshot } from './gates.js';
import { specifyText } from './stories.js';
import { emptyStep, STEPS } from './types.js';
import type { Run, StepName, StepRun, Story, StoryRun } from './types.js';

export interface FlowState {
  run: Run;
  /** 0-based index of the current story. */
  story: number;
  step: StepName;
}

export interface FlowContext {
  stories: Story[];
  settings: AutopilotSettings;
  /** Clock of the run (ms epoch), used for the time limit. */
  now: number;
}

export type NextAction =
  /** Run a turn; `clear` starts a fresh conversation (new step). */
  | { type: 'turn'; text: string; clear: boolean }
  /** Ask the decider to answer a text question, then call `onAnswer`. */
  | { type: 'decide'; question: string }
  | { type: 'verify' }
  | { type: 'commit'; message: string }
  /** Story done: push/PR when enabled, then call `onPublished`. */
  | { type: 'publish' }
  /** The run ended (`run.status` says how). */
  | { type: 'finish' };

export interface Step {
  state: FlowState;
  next: NextAction;
}

export interface TurnOutcome {
  snapshot: GateSnapshot;
  usage: { inputTokens: number; outputTokens: number };
  ms: number;
}

const clone = (r: Run): Run => structuredClone(r);
const cur = (s: FlowState): StoryRun => s.run.stories[s.story]!;
const curStep = (s: FlowState): StepRun => cur(s).steps[s.step];

export function initialTurnText(step: Exclude<StepName, 'verify'>, story: Story): string {
  return step === 'specify' ? `/speckit.specify ${specifyText(story)}` : `/speckit.${step}`;
}

export function commitMessage(prefix: string, story: StoryRun, step: StepName): string {
  const num = story.feature?.split('-')[0] ?? '???';
  return `${prefix} autopilot(${num}): ${step}\n\n${story.title}`;
}

function enterStep(s: FlowState, ctx: FlowContext): Step {
  const step = curStep(s);
  if (step.status === 'failed' || step.status === 'interrupted') {
    cur(s).steps[s.step] = emptyStep();
  }
  cur(s).steps[s.step].status = 'running';
  if (s.step === 'verify') return { state: s, next: { type: 'verify' } };
  const story = ctx.stories[s.story]!;
  return { state: s, next: { type: 'turn', text: initialTurnText(s.step, story), clear: true } };
}

/** Positions the cursor on the first story/step not done and returns its first action. */
export function start(run: Run, ctx: FlowContext): Step {
  const r = clone(run);
  r.status = 'active';
  delete r.stopped;
  const si = r.stories.findIndex((st) => st.status !== 'done');
  if (si < 0) {
    r.status = 'done';
    return {
      state: { run: r, story: Math.max(0, r.stories.length - 1), step: 'verify' },
      next: { type: 'finish' },
    };
  }
  const story = r.stories[si]!;
  story.status = 'running';
  const step = STEPS.find((x) => story.steps[x].status !== 'done') ?? 'verify';
  return enterStep({ run: r, story: si, step }, ctx);
}

function fail(s: FlowState, reason: string): Step {
  curStep(s).status = 'failed';
  curStep(s).gate = { ok: false, reason };
  cur(s).status = 'stopped';
  s.run.status = 'stopped';
  s.run.stopped = { story: s.story + 1, step: s.step, reason };
  return { state: s, next: { type: 'finish' } };
}

function interrupt(s: FlowState, reason: string): Step {
  curStep(s).status = 'interrupted';
  curStep(s).gate = { ok: false, reason };
  s.run.status = 'interrupted';
  return { state: s, next: { type: 'finish' } };
}

/** Per-story limits (FR-019); returns the reason when one is exceeded. */
export function limitExceeded(story: StoryRun, settings: AutopilotSettings): string | undefined {
  const l = settings.limits;
  if (story.usage.turns > l.turns) return `teto de ${l.turns} turnos atingido`;
  if (story.usage.ms > l.minutes * 60_000) return `teto de ${l.minutes} minutos atingido`;
  const tokens = story.usage.inputTokens + story.usage.outputTokens;
  if (l.tokens > 0 && tokens > l.tokens) return `teto de ${l.tokens} tokens atingido`;
  return undefined;
}

function account(s: FlowState, o: Pick<TurnOutcome, 'usage' | 'ms'>): void {
  const story = cur(s);
  const step = curStep(s);
  story.usage.turns += 1;
  story.usage.ms += o.ms;
  story.usage.inputTokens += o.usage.inputTokens;
  story.usage.outputTokens += o.usage.outputTokens;
  step.ms += o.ms;
  step.tokens += o.usage.inputTokens + o.usage.outputTokens;
}

/** A turn of the current step finished. */
export function onTurn(state: FlowState, ctx: FlowContext, o: TurnOutcome): Step {
  const s: FlowState = { ...state, run: clone(state.run) };
  account(s, o);
  const step = curStep(s);
  const sr = o.snapshot.stopReason;

  if (sr === 'cancelled') return interrupt(s, 'cancelado pelo usuário');
  if (sr === 'error' && o.snapshot.errorCategory === 'rate_limit')
    return interrupt(s, 'limite de uso do provedor');
  const limit = limitExceeded(cur(s), ctx.settings);
  if (limit) return fail(s, limit);

  // A fix turn was sent: re-run the check instead of gating the fix itself.
  if (step.fixing) {
    if (sr === 'error')
      return fail(
        s,
        `erro no turno de correção${o.snapshot.errorCategory ? ` (${o.snapshot.errorCategory})` : ''}`,
      );
    step.fixing = false;
    if (s.step === 'verify') return { state: s, next: { type: 'verify' } };
    return { state: s, next: { type: 'turn', text: `/speckit.${s.step}`, clear: false } };
  }

  if (s.step === 'verify') return fail(s, 'turno inesperado no passo verify');
  const verdict = evaluateGate({ ...o.snapshot, step: s.step }, step);
  switch (verdict.kind) {
    case 'advance':
      step.gate = { ok: true, reason: verdict.reason };
      if (s.step === 'specify') {
        cur(s).feature = o.snapshot.after.feature;
        cur(s).branch = o.snapshot.hasGit ? o.snapshot.branch : undefined;
      }
      return {
        state: s,
        next: { type: 'commit', message: commitMessage(ctx.settings.commitPrefix, cur(s), s.step) },
      };
    case 'continue':
      step.rounds += 1;
      return { state: s, next: { type: 'turn', text: 'continue', clear: false } };
    case 'question':
      return { state: s, next: { type: 'decide', question: verdict.question } };
    case 'fix':
      step.rounds += 1;
      step.attempts += 1;
      step.fixing = true;
      return { state: s, next: { type: 'turn', text: verdict.prompt, clear: false } };
    case 'interrupted':
      return interrupt(s, verdict.reason);
    case 'stop':
      return fail(s, verdict.reason);
  }
}

/** The decider answered the text question; the answer is the next turn of the step. */
export function onAnswer(state: FlowState, answer: string): Step {
  const s: FlowState = { ...state, run: clone(state.run) };
  const step = curStep(s);
  step.answers += 1;
  step.rounds += 1;
  return { state: s, next: { type: 'turn', text: answer, clear: false } };
}

/** The decider could not answer (FR-010). */
export function onDecisionFailed(state: FlowState, reason: string): Step {
  return fail({ ...state, run: clone(state.run) }, `o decisor falhou: ${reason}`);
}

/** The verification commands finished. */
export function onVerify(
  state: FlowState,
  ctx: FlowContext,
  v: { ok: boolean; command: string; output: string; skipped?: boolean },
): Step {
  const s: FlowState = { ...state, run: clone(state.run) };
  const step = curStep(s);
  if (v.ok) {
    step.gate = {
      ok: true,
      reason: v.skipped ? 'não verificado (nenhum comando)' : 'verificação passou',
    };
    return {
      state: s,
      next: { type: 'commit', message: commitMessage(ctx.settings.commitPrefix, cur(s), 'verify') },
    };
  }
  if (step.attempts < ctx.settings.verify.maxAttempts) {
    step.attempts += 1;
    step.rounds += 1;
    step.fixing = true;
    return {
      state: s,
      next: { type: 'turn', text: verifyFixPrompt(v.command, v.output), clear: false },
    };
  }
  return fail(
    s,
    `${v.command} falhou depois de ${step.attempts} ${step.attempts === 1 ? 'tentativa' : 'tentativas'} de correção`,
  );
}

/** The step was committed (sha = HEAD after the commit, or the current HEAD when nothing changed). */
export function onCommitted(state: FlowState, ctx: FlowContext, sha: string | undefined): Step {
  const s: FlowState = { ...state, run: clone(state.run) };
  const step = curStep(s);
  step.status = 'done';
  step.fixing = undefined;
  if (sha) step.sha = sha;
  if (s.step === 'verify') {
    cur(s).status = 'done';
    return { state: s, next: { type: 'publish' } };
  }
  const next = STEPS[STEPS.indexOf(s.step) + 1]!;
  return enterStep({ ...s, step: next }, ctx);
}

/** Push/PR of the story finished (or was skipped); moves to the next story or ends the run. */
export function onPublished(
  state: FlowState,
  ctx: FlowContext,
  pr?: { url: string; number: number },
): Step {
  const s: FlowState = { ...state, run: clone(state.run) };
  if (pr) cur(s).pr = pr;
  const nextStory = s.story + 1;
  if (nextStory >= s.run.stories.length) {
    s.run.status = 'done';
    return { state: s, next: { type: 'finish' } };
  }
  s.run.stories[nextStory]!.status = 'running';
  return enterStep({ run: s.run, story: nextStory, step: 'specify' }, ctx);
}

/** Marks the run interrupted from outside a turn (Esc between actions, process signal). */
export function onCancelled(state: FlowState): Step {
  return interrupt({ ...state, run: clone(state.run) }, 'cancelado pelo usuário');
}
