/**
 * Types of the autopilot (specs/011 data-model.md): stories, the run state persisted in
 * `.specify/autopilot.json`, decisions and the verdicts the gates hand to the flow.
 */

export const STEPS = [
  'specify',
  'clarify',
  'plan',
  'tasks',
  'analyze',
  'implement',
  'verify',
] as const;
export type StepName = (typeof STEPS)[number];

export interface Story {
  index: number;
  title: string;
  body: string;
  /** sha256 of title + body (detects edits on resume). */
  hash: string;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'interrupted';

export interface StepRun {
  status: StepStatus;
  /** Extra turns in the step: "continue", answers to text questions, fixes. */
  rounds: number;
  /** Fix attempts (analyze, verify). */
  attempts: number;
  /** Text questions answered by the decider in this step. */
  answers: number;
  /** A fix turn was sent; the next turn re-runs the check (analyze) or the verification. */
  fixing?: boolean;
  sha?: string;
  ms: number;
  tokens: number;
  gate?: { ok: boolean; reason: string };
}

export interface StoryUsage {
  turns: number;
  ms: number;
  inputTokens: number;
  outputTokens: number;
}

export type StoryStatus = 'pending' | 'running' | 'done' | 'stopped';

export interface StoryRun {
  title: string;
  hash: string;
  feature?: string;
  branch?: string;
  status: StoryStatus;
  usage: StoryUsage;
  steps: Record<StepName, StepRun>;
  pr?: { url: string; number: number };
}

export type RunStatus = 'active' | 'interrupted' | 'stopped' | 'done';

export interface Run {
  version: 1;
  id: string;
  /** Stories file, relative to the project root, forward slashes. */
  input: string;
  inputHash: string;
  baseBranch: string;
  status: RunStatus;
  pid: number;
  startedAt: string;
  stopped?: { story: number; step: StepName; reason: string };
  stories: StoryRun[];
}

export interface DecisionOption {
  label: string;
  description: string;
  recommended: boolean;
}

export interface Decision {
  at: string;
  story: number;
  feature?: string;
  step: StepName;
  kind: 'options' | 'text';
  question: string;
  options?: DecisionOption[];
  choice: string | string[];
  rationale: string;
  followedRecommendation?: boolean;
  provider: string;
  model: string;
}

/** What a gate decides after a turn (contracts/gates.md § 2). */
export type GateVerdict =
  | { kind: 'advance'; reason: string }
  /** Send "continue" in the same step (implement with progress). */
  | { kind: 'continue'; reason: string }
  /** The turn ended with a question to the user; the decider answers it. */
  | { kind: 'question'; question: string; reason: string }
  /** Send a fix prompt in the same step (analyze CRITICAL, failed verification). */
  | { kind: 'fix'; prompt: string; reason: string }
  | { kind: 'stop'; reason: string }
  /** Cancelled or provider usage limit: resumable, not a failure. */
  | { kind: 'interrupted'; reason: string };

export function emptyStep(): StepRun {
  return { status: 'pending', rounds: 0, attempts: 0, answers: 0, ms: 0, tokens: 0 };
}

export function emptyStory(story: Pick<Story, 'title' | 'hash'>): StoryRun {
  const steps = {} as Record<StepName, StepRun>;
  for (const s of STEPS) steps[s] = emptyStep();
  return {
    title: story.title,
    hash: story.hash,
    status: 'pending',
    usage: { turns: 0, ms: 0, inputTokens: 0, outputTokens: 0 },
    steps,
  };
}
