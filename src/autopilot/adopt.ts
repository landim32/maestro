import { countTasks } from './gates.js';
import { STEPS } from './types.js';
import type { StepName } from './types.js';

/**
 * `/autopilot --continue` (pure): where a feature started outside the autopilot (by hand in
 * Maestro, in Claude Code, in any Spec Kit agent) stands, read from its artifacts only.
 */
export interface FeatureFiles {
  spec?: string;
  plan?: string;
  tasks?: string;
}

export interface FeatureProgress {
  /** Steps taken as done, in flow order. */
  done: StepName[];
  /** First step the autopilot runs. */
  next: StepName;
  /** One line per step, for the progress output (why it counts as done or not). */
  reasons: string[];
}

/** A Spec Kit template copied but never filled keeps its `[FEATURE…]` placeholder in the title. */
const filled = (text: string | undefined): text is string => {
  if (text === undefined || text.trim() === '') return false;
  const title = text.split(/\r?\n/).find((l) => /^#\s/.test(l)) ?? '';
  return !/\[FEATURE/i.test(title);
};

export function detectProgress(files: FeatureFiles): FeatureProgress | { error: string } {
  if (!filled(files.spec))
    return { error: 'a feature não tem spec.md preenchido; comece pelo /speckit.specify' };
  const done = new Set<StepName>(['specify']);
  const reasons = ['specify: spec.md presente'];
  const plan = filled(files.plan);
  const tasks = filled(files.tasks) ? countTasks(files.tasks) : undefined;
  const hasTasks = tasks !== undefined && tasks.open + tasks.done > 0;

  if (/^##\s+Clarifications\b/im.test(files.spec)) {
    done.add('clarify');
    reasons.push('clarify: spec.md tem "## Clarifications"');
  } else if (plan) {
    done.add('clarify');
    reasons.push('clarify: pulado (já existe plan.md)');
  }
  if (plan) {
    done.add('plan');
    reasons.push('plan: plan.md presente');
  }
  if (hasTasks) {
    done.add('tasks');
    reasons.push(`tasks: ${tasks.open + tasks.done} tarefas em tasks.md`);
    // analyze leaves no artifact: a started implement means it was run (or skipped) already.
    if (tasks.done > 0) {
      done.add('analyze');
      reasons.push(`implement: ${tasks.done}/${tasks.open + tasks.done} tarefas marcadas`);
    }
    if (tasks.open === 0) done.add('implement');
  }
  const next = STEPS.find((s) => !done.has(s)) ?? 'verify';
  return { done: STEPS.filter((s) => done.has(s)), next, reasons };
}

/** Story title from the spec's `# Feature Specification: X` heading, else the feature name. */
export function specTitle(spec: string, feature: string): string {
  const h = spec.split(/\r?\n/).find((l) => /^#\s/.test(l));
  const t = h
    ?.replace(/^#\s+/, '')
    .replace(/^Feature Specification:\s*/i, '')
    .trim();
  return t || feature;
}

/** Story body: the original request (`**Input**: User description: "…"`) and where the spec is. */
export function adoptedStoryText(spec: string, feature: string): string {
  const input = /\*\*Input\*\*:\s*(?:User description:\s*)?"?([^\n]*?)"?\s*$/m.exec(spec)?.[1];
  return [
    specTitle(spec, feature),
    '',
    `Feature já iniciada fora do autopiloto: a especificação está em specs/${feature}/spec.md.`,
    ...(input ? ['', `Pedido original: ${input}`] : []),
  ].join('\n');
}

/** Newest feature name: timestamps win over numbers; otherwise the highest number. */
export function newestFeature(names: string[]): string | undefined {
  const ts = names.filter((n) => /^\d{8}-\d{6}-/.test(n)).sort();
  if (ts.length) return ts.at(-1);
  let best: string | undefined;
  let max = -1;
  for (const n of names) {
    const m = /^(\d{3,})-/.exec(n);
    if (m && Number(m[1]) > max) {
      max = Number(m[1]);
      best = n;
    }
  }
  return best;
}

/**
 * The feature to continue: `arg` names it (full name or its number, `003` / `3`); otherwise the
 * active one (`active`, from feature.json or the branch), else the newest.
 */
export function pickFeature(
  dirs: string[],
  arg: string | undefined,
  active: string | undefined,
  newest: string | undefined,
): string | { error: string } {
  if (arg) {
    const a = arg
      .trim()
      .replace(/^specs[\/]/, '')
      .replace(/[\/]$/, '');
    if (dirs.includes(a)) return a;
    if (/^\d+$/.test(a)) {
      const n = Number(a);
      const hit = dirs.filter((d) => /^\d+-/.test(d) && Number(d.split('-')[0]) === n);
      if (hit.length === 1) return hit[0]!;
    }
    return { error: `feature não encontrada em specs/: ${arg}` };
  }
  if (active && dirs.includes(active)) return active;
  if (newest) return newest;
  return { error: 'nenhuma feature em specs/ para continuar' };
}
