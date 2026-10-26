/** Resume checks (specs/011 contracts/state-file.md § 3). Pure over injected ports. */
import { emptyStory } from './types.js';
import type { Run, Story } from './types.js';

export interface ResumeDeps {
  isDirty: () => boolean;
  branchExists: (name: string) => boolean;
  isAncestor: (sha: string, branch: string) => boolean;
  isPidAlive: (pid: number) => boolean;
  ownPid: number;
}

export function checkResume(
  run: Run,
  input: { hash: string; stories: Story[] },
  deps: ResumeDeps,
): { ok: true; run: Run } | { ok: false; error: string } {
  if (run.status === 'done')
    return { ok: false, error: 'Essa execução já terminou; nada a retomar.' };
  if (run.status === 'active' && run.pid !== deps.ownPid && deps.isPidAlive(run.pid))
    return { ok: false, error: `Já existe uma execução ativa (pid ${run.pid}).` };
  if (deps.isDirty())
    return {
      ok: false,
      error: 'Há alterações não commitadas; faça commit ou stash antes de retomar o autopiloto.',
    };

  const out: Run = structuredClone(run);
  for (let i = 0; i < out.stories.length; i++) {
    const st = out.stories[i]!;
    const started = st.status !== 'pending';
    const fresh = input.stories[i];
    if (started && (!fresh || fresh.hash !== st.hash))
      return {
        ok: false,
        error: `A história ${i + 1} ("${st.title}") mudou no arquivo depois de iniciada; não é possível retomar.`,
      };
    if (st.branch) {
      if (!deps.branchExists(st.branch))
        return { ok: false, error: `A branch ${st.branch} da história ${i + 1} não existe mais.` };
      const last = Object.values(st.steps)
        .filter((s) => s.status === 'done' && s.sha)
        .map((s) => s.sha!)
        .pop();
      if (last && !deps.isAncestor(last, st.branch))
        return {
          ok: false,
          error: `O commit ${last.slice(0, 8)} da história ${i + 1} não está mais na branch ${st.branch}.`,
        };
    }
  }
  // Stories added at the end of the file after the run started are appended.
  for (let i = out.stories.length; i < input.stories.length; i++)
    out.stories.push(emptyStory(input.stories[i]!));
  // Pending stories that changed are simply refreshed.
  out.stories.forEach((st, i) => {
    const fresh = input.stories[i];
    if (st.status === 'pending' && fresh && fresh.hash !== st.hash)
      out.stories[i] = emptyStory(fresh);
  });
  out.inputHash = input.hash;
  out.pid = deps.ownPid;
  return { ok: true, run: out };
}

/** Branch to check out before continuing: the current story's, else the previous one's, else base. */
export function resumeBranch(run: Run): string {
  const i = run.stories.findIndex((s) => s.status !== 'done');
  const idx = i < 0 ? run.stories.length - 1 : i;
  for (let k = idx; k >= 0; k--) {
    const b = run.stories[k]?.branch;
    if (b) return b;
  }
  return run.baseBranch;
}
