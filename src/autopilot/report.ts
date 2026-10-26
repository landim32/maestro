/** Final report (specs/011 contracts/autopilot-cli.md § 3). Pure. */
import { formatElapsed } from '../session/activity.js';
import { STEPS } from './types.js';
import type { Run, StoryRun } from './types.js';

function stepLine(story: StoryRun): string {
  return STEPS.map((name) => {
    const s = story.steps[name];
    const mark =
      s.status === 'done'
        ? '✓'
        : s.status === 'failed'
          ? '✗'
          : s.status === 'interrupted'
            ? '‖'
            : '·';
    const extra: string[] = [];
    if (name === 'analyze' && s.attempts > 0) extra.push(`${s.attempts} correção`);
    if (name === 'verify' && s.attempts > 0)
      extra.push(`${s.attempts} ${s.attempts === 1 ? 'correção' : 'correções'}`);
    if (name === 'implement' && s.rounds > 0) extra.push(`${s.rounds} continues`);
    return `${name} ${mark}${extra.length ? ` (${extra.join(', ')})` : ''}`;
  }).join('  ');
}

/** Open tasks listed per story; the rest is summarised so the report stays readable. */
export const REPORT_MAX_OPEN_TASKS = 10;

function openTasksBlock(tasks: string[] | undefined): string[] {
  if (!tasks) return [];
  if (tasks.length === 0) return ['  - Nenhuma tarefa em aberto'];
  const shown = tasks.slice(0, REPORT_MAX_OPEN_TASKS).map((t) => `  ${t}`);
  const rest = tasks.length - shown.length;
  return [
    '  - Tarefas em aberto:',
    ...shown,
    ...(rest > 0 ? [`  - … mais ${rest} (veja o tasks.md)`] : []),
  ];
}

export function formatReport(
  run: Run,
  o: {
    decisions: Record<number, number>;
    /** Per story number: `specs/<feature>/decisions.md`, when the file exists. */
    decisionFiles: Record<number, string>;
    /** Per story number: open task lines of its tasks.md (absent = no tasks.md yet). */
    openTasks?: Record<number, string[]>;
    jsonl: string;
    lastOutput?: string;
    /** Message of the git stash holding the partial work of an interrupted step. */
    stashed?: string;
  },
): string {
  const lines = [`Autopiloto ${run.id} · ${run.input} · base ${run.baseBranch}`];
  run.stories.forEach((st, i) => {
    const n = i + 1;
    // Stories not started yet stay out of the report; /autopilot --status lists them.
    if (st.status === 'pending' && run.stopped?.story !== n) return;
    const head = `${n}. ${st.feature ?? st.title}`;
    const usage = `${st.usage.turns} turnos · ${formatElapsed(st.usage.ms)} · ${o.decisions[n] ?? 0} decisões`;
    if (st.status === 'done') {
      lines.push(`✓ ${head} · ${usage}`);
      lines.push(`    ${stepLine(st)}`);
      if (st.pr) lines.push(`    PR: ${st.pr.url}`);
    } else if (st.status === 'stopped' && run.stopped?.story === n) {
      lines.push(`✗ ${head} · parou em ${run.stopped.step}: ${run.stopped.reason}`);
      lines.push(`    ${stepLine(st)}`);
      if (o.lastOutput) {
        lines.push('    últimas linhas:');
        for (const l of o.lastOutput.split('\n').slice(-10)) lines.push(`      ${l}`);
      }
    } else if (st.status === 'running' && run.status === 'interrupted') {
      const step = STEPS.find((x) => st.steps[x].status === 'interrupted');
      lines.push(`‖ ${head} · interrompida${step ? ` em ${step}` : ''}`);
    } else {
      lines.push(`· ${head} · ${st.status === 'running' ? 'em andamento' : 'não iniciada'}`);
    }
    lines.push(...openTasksBlock(o.openTasks?.[n]));
    if (o.decisionFiles[n]) lines.push(`Decisões: ${o.decisionFiles[n]}`);
  });
  lines.push('---');
  lines.push(`Registro: ${o.jsonl}`);
  if (o.stashed)
    lines.push(
      `Alterações parciais do passo interrompido: git stash "${o.stashed}" (a retomada o devolve ao disco e continua o passo)`,
    );
  if (run.status === 'interrupted' || run.status === 'stopped')
    lines.push(`Retomar: /autopilot --resume   (ou maestro -p --autopilot ${run.input} --resume)`);
  return lines.join('\n');
}

/** `/autopilot --status`: the saved run, without executing anything. */
export function statusText(run: Run | undefined | { error: string }): string {
  if (!run) return 'Nenhuma execução do autopiloto neste projeto.';
  if ('error' in run) return run.error;
  const done = run.stories.filter((s) => s.status === 'done').length;
  const lines = [
    `Autopiloto ${run.id} · ${run.input} · ${run.status} · ${done}/${run.stories.length} histórias concluídas`,
  ];
  run.stories.forEach((st, i) => {
    const step = STEPS.find((x) => st.steps[x].status !== 'done');
    lines.push(
      `  ${i + 1}. ${st.title}${st.feature ? ` (${st.feature})` : ''} · ${st.status}${step && st.status !== 'done' ? ` · próximo: ${step}` : ''}`,
    );
  });
  if (run.status === 'interrupted' || run.status === 'stopped')
    lines.push('Retomar: /autopilot --resume');
  return lines.join('\n');
}
