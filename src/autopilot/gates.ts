/**
 * Exit gate of each step (specs/011 contracts/gates.md § 2). Pure over a snapshot of the disk
 * and the turn result; the driver builds the snapshot.
 */
import { detectQuestion } from './questions.js';
import type { GateVerdict, StepName, StepRun } from './types.js';

/** Text questions answered per step before giving up. */
export const MAX_ANSWERS = 3;
/** Fix rounds allowed for analyze (FR-012). */
export const MAX_ANALYZE_FIXES = 1;
/** implement turns in a row without a marked task before the step stops. */
export const MAX_IMPLEMENT_NUDGES = 2;

export const IMPLEMENT_NUDGE_PROMPT =
  'Nenhuma tarefa nova foi marcada como concluída em tasks.md. Marque com [X] as tarefas que você já concluiu e continue a implementação das restantes.';

export interface ArtifactInfo {
  exists: boolean;
  /** Content hash (absent when the file does not exist). */
  hash?: string;
}

export interface DiskView {
  /** Feature directories under specs/ (names). */
  featureDirs: string[];
  /** Feature recorded in .specify/feature.json (name), if any. */
  feature?: string;
  spec: ArtifactInfo;
  plan: ArtifactInfo;
  tasks: ArtifactInfo;
  /** Task checkboxes in tasks.md. */
  openTasks: number;
  doneTasks: number;
}

export interface GateSnapshot {
  step: Exclude<StepName, 'verify'>;
  before: DiskView;
  after: DiskView;
  /** Current git branch after the turn. */
  branch?: string;
  hasGit: boolean;
  text: string;
  stopReason: string;
  errorCategory?: string;
  /** Preflight refusal of a Spec Kit command (CommandBlocked). */
  blocked?: string;
  /** Feature an earlier attempt of this story's specify created (see claimFeature). */
  claimed?: string;
}

const TASK_LINE = /^\s*[-*]\s+\[([ xX])\]\s+T\d+/;

/** `- [ ] T001` / `- [X] T001` in tasks.md. */
export function countTasks(markdown: string): { open: number; done: number } {
  let open = 0;
  let done = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    if (m[1] === ' ') open++;
    else done++;
  }
  return { open, done };
}

/** The open task lines of tasks.md, trimmed, in file order (final report). */
export function openTaskLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => TASK_LINE.exec(line)?.[1] === ' ')
    .map((line) => line.trim());
}

/**
 * CRITICAL findings of /speckit.analyze (research R7): the "Critical Issues Count" metric when
 * present, otherwise report-table rows whose severity cell is CRITICAL.
 */
export function criticalCount(text: string): number {
  const metric = /critical issues count\D{0,20}(\d+)/i.exec(text);
  if (metric) return Number(metric[1]);
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|') || /severity/i.test(t) || /^\|[\s:-]+\|/.test(t)) continue;
    const cells = t
      .split('|')
      .map((c) => c.replace(/\*/g, '').trim())
      .filter(Boolean);
    if (cells.some((c) => c === 'CRITICAL')) n++;
  }
  return n;
}

const changed = (b: ArtifactInfo, a: ArtifactInfo) => a.exists && (!b.exists || a.hash !== b.hash);

export const FIX_ANALYZE_PROMPT =
  'Resolva os achados CRITICAL acima ajustando spec.md, plan.md e tasks.md; não altere código. Quando terminar, responda só "pronto".';

export function verifyFixPrompt(command: string, output: string): string {
  return `A verificação falhou. Corrija o código para que passe:\n\n$ ${command}\n${output}`;
}

/**
 * Verdict after a turn of `snapshot.step`. `run` is the step state before this turn (answers and
 * attempts already used). Order: interruption/error → preflight → text question → step gate.
 */
export function evaluateGate(
  s: GateSnapshot,
  run: Pick<StepRun, 'answers' | 'attempts' | 'resumed'>,
): GateVerdict {
  if (s.stopReason === 'cancelled')
    return { kind: 'interrupted', reason: 'cancelado pelo usuário' };
  if (s.stopReason === 'error') {
    if (s.errorCategory === 'rate_limit')
      return { kind: 'interrupted', reason: 'limite de uso do provedor' };
    return {
      kind: 'stop',
      reason: `erro no turno${s.errorCategory ? ` (${s.errorCategory})` : ''}`,
    };
  }
  if (s.blocked) return { kind: 'stop', reason: s.blocked };

  const question = detectQuestion(s.text);
  if (question && run.answers < MAX_ANSWERS)
    return { kind: 'question', question, reason: 'o turno terminou com uma pergunta' };

  const a = s.after;
  switch (s.step) {
    case 'specify': {
      const feature = a.feature;
      const isNew = feature !== undefined && !s.before.featureDirs.includes(feature);
      // A resumed specify finds the feature its first attempt created.
      const kept = run.resumed === true && feature !== undefined && feature === s.claimed;
      if (!(isNew || kept) || !a.spec.exists)
        return { kind: 'stop', reason: 'o specify não criou uma feature nova com spec.md' };
      if (s.hasGit && s.branch !== feature)
        return {
          kind: 'stop',
          reason: `a branch atual (${s.branch ?? '?'}) não é a da feature (${feature})`,
        };
      return { kind: 'advance', reason: `feature ${feature}` };
    }
    case 'clarify':
      return a.spec.exists
        ? { kind: 'advance', reason: 'spec.md presente' }
        : { kind: 'stop', reason: 'spec.md não existe' };
    case 'plan':
      return changed(s.before.plan, a.plan)
        ? { kind: 'advance', reason: 'plan.md criado/alterado' }
        : { kind: 'stop', reason: 'o plan não criou nem alterou plan.md' };
    case 'tasks':
      return a.openTasks + a.doneTasks > 0
        ? { kind: 'advance', reason: `${a.openTasks + a.doneTasks} tarefas` }
        : { kind: 'stop', reason: 'tasks.md sem tarefas' };
    case 'analyze': {
      const n = criticalCount(s.text);
      if (n === 0) return { kind: 'advance', reason: 'sem achados CRITICAL' };
      if (run.attempts < MAX_ANALYZE_FIXES)
        return { kind: 'fix', prompt: FIX_ANALYZE_PROMPT, reason: `${n} CRITICAL` };
      return { kind: 'stop', reason: `${n} achados CRITICAL depois da correção` };
    }
    case 'implement': {
      const total = a.openTasks + a.doneTasks;
      if (total > 0 && a.openTasks === 0)
        return { kind: 'advance', reason: `${total} tarefas concluídas` };
      if (a.doneTasks > s.before.doneTasks)
        return { kind: 'continue', reason: `${a.doneTasks}/${total} tarefas` };
      // Work may have been done without ticking tasks.md (or the turn ended early): remind first.
      if (run.attempts < MAX_IMPLEMENT_NUDGES)
        return {
          kind: 'nudge',
          prompt: IMPLEMENT_NUDGE_PROMPT,
          reason: `nenhuma tarefa marcada (${a.doneTasks}/${total})`,
        };
      return {
        kind: 'stop',
        reason: `sem progresso (${a.doneTasks}/${total} tarefas) depois de ${MAX_IMPLEMENT_NUDGES} lembretes`,
      };
    }
  }
}
