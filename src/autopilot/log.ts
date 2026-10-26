/**
 * Decision and event logs (specs/011 contracts/decisions.md § 3–4): `specs/NNN/decisions.md`
 * (readable, versioned) and `.maestro/autopilot/<id>.jsonl` (structured, local).
 */
import fs from 'node:fs';
import path from 'node:path';
import { serializeRun, statePath } from './state.js';
import type { Decision, Run } from './types.js';

export function jsonlPath(root: string, id: string): string {
  return path.join(root, '.maestro', 'autopilot', `${id}.jsonl`);
}

export function appendJsonl(root: string, id: string, event: Record<string, unknown>): void {
  const file = jsonlPath(root, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    'utf8',
  );
}

const stamp = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export function renderDecisions(
  feature: string,
  run: Pick<Run, 'id' | 'stories'>,
  storyIndex: number,
  decisions: Decision[],
  /** Content written before this process (resume): kept, new entries are appended. */
  baseline?: string,
): string {
  const story = run.stories[storyIndex - 1];
  const out = baseline?.trim()
    ? [baseline.trimEnd()]
    : [
        `# Decisões do autopiloto — ${feature}`,
        '',
        `Execução ${run.id} · história ${storyIndex}/${run.stories.length} "${story?.title ?? ''}"`,
      ];
  for (const d of decisions) {
    out.push('', `## ${d.step} · ${stamp(d.at)}`);
    out.push(`**Pergunta:** ${d.question.replace(/\s*\n\s*/g, ' ')}`);
    if (d.options?.length) {
      out.push(
        `**Opções:** ${d.options.map((o) => `${o.label}${o.recommended ? ' (recomendada)' : ''}`).join(' · ')}`,
      );
    }
    out.push(`**Escolha:** ${Array.isArray(d.choice) ? d.choice.join(', ') : d.choice}`);
    out.push(`**Por quê:** ${d.rationale}`);
    if (d.followedRecommendation === false) {
      const rec = d.options?.find((o) => o.recommended)?.label;
      if (rec) out.push(`**Atenção:** a opção recomendada era ${rec}`);
    }
    out.push(`_${d.provider}${d.model ? ` / ${d.model}` : ''}_`);
  }
  return `${out.join('\n')}\n`;
}

/** Name of the stash where older versions kept the partial work of an interrupted step. */
export function interruptedStashName(
  runId: string,
  story: { feature?: string },
  index: number,
  step: string,
): string {
  return `maestro autopilot ${runId}: ${story.feature ?? `história ${index + 1}`} ${step} interrompido`;
}

export function decisionsPath(root: string, feature: string): string {
  return path.join(root, 'specs', feature, 'decisions.md');
}

/**
 * Rewrites the files only the autopilot may write (FR-020) from memory, discarding whatever a
 * model turn did to them: the state file and the current feature's decisions.md.
 */
export function rewriteProtected(
  root: string,
  run: Run,
  storyIndex: number,
  decisions: Decision[],
  baseline?: string,
): void {
  const file = statePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeRun(run), 'utf8');
  const feature = run.stories[storyIndex - 1]?.feature;
  if (!feature) return;
  const target = decisionsPath(root, feature);
  const mine = decisions.filter((d) => d.story === storyIndex);
  if (mine.length === 0 && !baseline?.trim()) {
    // Nothing decided yet: a decisions.md written by the model is not ours to keep.
    if (fs.existsSync(target)) fs.rmSync(target);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderDecisions(feature, run, storyIndex, mine, baseline), 'utf8');
}
