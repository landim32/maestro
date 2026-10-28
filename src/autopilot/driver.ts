/**
 * Autopilot driver (specs/011 plan.md): the only module with effects. It runs the pure flow over
 * the SessionController (one `submit` per turn), the disk, git, the verification commands and the
 * decider, and persists the state after every action.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AutopilotSettings } from '../config/schema.js';
import type { SessionController } from '../session/controller.js';
import {
  findSpecifyRoot,
  isFeatureName,
  readFeatureJson,
  writeFeatureJson,
} from '../speckit/feature.js';
import type { GitCommitPort, GitPort } from '../speckit/git.js';
import { resolveInsideCwd } from '../tools/sandbox.js';
import { runCommandTool } from '../tools/runCommand.js';
import { formatElapsed } from '../session/activity.js';
import { answerText } from '../tools/askUser.js';
import { asAskUserHandler, createDecider, DeciderError, toDecisionOptions } from './decider.js';
import type { Decider, DeciderFailure, DecisionContext } from './decider.js';
import {
  claimFeature,
  onAnswer,
  onCancelled,
  onCommitted,
  onDecisionFailed,
  onPublished,
  onTurn,
  onVerify,
  start,
} from './flow.js';
import type { FlowContext, NextAction, Step } from './flow.js';
import { countTasks, openTaskLines } from './gates.js';
import type { ArtifactInfo, DiskView } from './gates.js';
import type { AskUserOutcome, AskUserRequest, ToolResult } from '../tools/types.js';
import {
  appendJsonl,
  decisionsPath,
  interruptedStashName,
  jsonlPath,
  rewriteProtected,
} from './log.js';
import type { RemotePort } from './remote.js';
import { decisionFailedProgress, decisionProgress, formatReport } from './report.js';
import { checkResume, resumeBranch } from './resume.js';
import { isPidAlive, readRunState, writeRunState } from './state.js';
import { looksLikePath, parseStories, promptStoriesFile, sectionLikeTitles } from './stories.js';
import { emptyStep, emptyStory, STEPS } from './types.js';
import { adoptedStoryText, detectProgress, newestFeature, pickFeature } from './adopt.js';
import type { Decision, Run, Story } from './types.js';

/** Option of a text question shown to the user: leave the answer to the decider. */
export const AUTO_ANSWER_LABEL = 'Deixar o autopiloto decidir';

export interface VerifyPort {
  run(command: string, cwd: string, timeoutMs: number): Promise<{ code: number; output: string }>;
}

/** Runs a verification command with the same shell as `run_command`, outside the approval policy. */
export const shellVerify: VerifyPort = {
  async run(command, cwd, timeoutMs) {
    const r = await runCommandTool.run(
      { command },
      {
        cwd,
        signal: new AbortController().signal,
        settings: {
          enabled: true,
          commandTimeoutMs: timeoutMs,
          maxOutputChars: 200_000,
          maxToolIterations: 1,
          approvalMode: 'default',
        },
      },
    );
    const m = /^exit code (\d+)/.exec(r.output);
    const code = m ? Number(m[1]) : r.isError ? 1 : 0;
    return { code, output: r.output.replace(/^exit code \S+\n?/, '') };
  },
};

export interface AutopilotDeps {
  controller: SessionController;
  git: GitPort;
  gitCommit: GitCommitPort;
  remote: RemotePort;
  verify: VerifyPort;
  now?: () => number;
  pid?: number;
  /** Progress lines (stderr in -p; notices in the interactive session). */
  progress?: (line: string) => void;
}

export interface AutopilotResult {
  /** 0 all done · 1 a story stopped or the run was interrupted · 2 invalid input/configuration. */
  code: 0 | 1 | 2;
  report: string;
  run?: Run;
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const LAST_LINES = 200;
const tail = (s: string, n = LAST_LINES) => s.split(/\r?\n/).slice(-n).join('\n');

function artifact(file: string): ArtifactInfo {
  try {
    return { exists: true, hash: sha256(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { exists: false };
  }
}

/** Default verification: the package.json scripts test/lint/build that exist (research R10). */
export function defaultVerifyCommands(root: string): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const s = pkg.scripts ?? {};
    const out: string[] = [];
    if (s['test'] && !/no test specified/.test(s['test'])) out.push('npm test');
    if (s['lint']) out.push('npm run lint');
    if (s['build']) out.push('npm run build');
    return out;
  } catch {
    return [];
  }
}

function runId(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * The state file is local to the clone (resume needs it, commits must not carry it, and writing it
 * after a commit must not dirty the tree): it is added to .git/info/exclude, never to .gitignore.
 */
export function excludeStateFile(root: string): void {
  const gitDir = path.join(root, '.git');
  try {
    if (!fs.statSync(gitDir).isDirectory()) return; // worktree/submodule: left as is
    const file = path.join(gitDir, 'info', 'exclude');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const lines = current.split(/\r?\n/);
    const missing = LOCAL_ONLY.filter((p) => !lines.includes(p));
    if (missing.length === 0) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sep = current === '' || current.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(file, `${sep}${missing.join('\n')}\n`);
  } catch {
    /* best effort */
  }
}

/** Local-only files of the autopilot: the run state and the structured log. */
const LOCAL_ONLY = ['.specify/autopilot.json', '.maestro/autopilot/'];

export class AutopilotDriver {
  private readonly ctl: SessionController;
  private readonly now: () => number;
  private readonly pid: number;
  private readonly progress: (line: string) => void;
  private cancelled = false;
  private abort = new AbortController();
  private decisions: Decision[] = [];
  /** decisions.md content from before this process (resume), by feature. */
  private baseline = new Map<string, string>();
  private askFailure?: string;
  private lastVerifyOutput?: string;

  constructor(private readonly deps: AutopilotDeps) {
    this.ctl = deps.controller;
    this.now = deps.now ?? Date.now;
    this.pid = deps.pid ?? process.pid;
    this.progress = deps.progress ?? ((l) => this.ctl.notice(l, 'info'));
  }

  /** Cancels the run (Esc): the turn in progress is cancelled and the step becomes interrupted. */
  cancel(): void {
    this.cancelled = true;
    this.abort.abort();
    this.ctl.cancel();
  }

  /**
   * `input` is a stories file or, when it is not one, a prompt: the prompt becomes a single story,
   * saved next to the run's log (`.maestro/autopilot/<id>.md`, local) so --resume works the same.
   */
  async start(
    input: string | undefined,
    /** `continue`: `input` is the feature (optional) started outside the autopilot. */
    opts: { resume?: boolean; continue?: boolean } = {},
  ): Promise<AutopilotResult> {
    const cwd = this.ctl.session.cwd;
    const git = this.deps.git;
    const root = findSpecifyRoot(cwd, git);
    const newId = runId(this.now());
    let promptFile: string | undefined;
    const refuse = (msg: string): AutopilotResult => {
      if (promptFile) fs.rmSync(promptFile, { force: true });
      return { code: 2, report: msg };
    };

    if (!git.hasGit(root))
      return refuse('O autopiloto precisa de um repositório git (commits por passo e retomada).');
    excludeStateFile(root);
    if (!fs.existsSync(path.join(root, '.specify')) || !this.ctl.specKit)
      return refuse('Spec Kit não instalado neste projeto; rode /speckit.init.');

    const saved = readRunState(root);
    if (saved && 'error' in saved) return refuse(saved.error);
    if (opts.continue) {
      if (opts.resume) return refuse('Use --continue ou --resume, não os dois.');
      if (saved && saved.status === 'active' && saved.pid !== this.pid && isPidAlive(saved.pid))
        return refuse(
          `Já existe uma execução ativa (pid ${saved.pid}, iniciada em ${saved.startedAt}).`,
        );
      const adopted = this.adopt(root, input?.trim() || undefined, newId);
      if ('error' in adopted) return refuse(adopted.error);
      return this.execute(root, adopted.run, adopted.stories, false);
    }
    let inputRel = input?.trim() || undefined;
    if (inputRel && !fs.existsSync(path.join(root, inputRel)) && !looksLikePath(inputRel)) {
      if (opts.resume)
        return refuse('--resume retoma a execução salva; não passe um prompt junto.');
      promptFile = path.join(path.dirname(jsonlPath(root, newId)), `${newId}.md`);
      fs.mkdirSync(path.dirname(promptFile), { recursive: true });
      fs.writeFileSync(promptFile, promptStoriesFile(inputRel));
      inputRel = path.relative(root, promptFile).split(path.sep).join('/');
    }
    if (!inputRel) {
      if (!opts.resume || !saved)
        return refuse('Uso: /autopilot <arquivo de histórias> [--resume]');
      inputRel = saved.input;
    }
    let abs: string;
    try {
      abs = resolveInsideCwd(root, inputRel);
    } catch (err) {
      return refuse(err instanceof Error ? err.message : String(err));
    }
    if (!fs.existsSync(abs)) return refuse(`Arquivo de histórias não encontrado: ${inputRel}`);
    const text = fs.readFileSync(abs, 'utf8');
    const parsed = parseStories(text);
    if ('error' in parsed)
      return refuse(
        `Nenhuma história em ${inputRel}: use um título "## " por história (${parsed.error}).`,
      );
    const stories = parsed;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const inputHash = sha256(text);

    let run: Run;
    const resuming =
      saved !== undefined &&
      saved.status !== 'done' &&
      (opts.resume || (saved.input === rel && saved.status !== 'active'));
    if (
      saved &&
      saved.status === 'active' &&
      saved.pid !== this.pid &&
      isPidAlive(saved.pid) &&
      !opts.resume
    )
      return refuse(
        `Já existe uma execução ativa (pid ${saved.pid}, iniciada em ${saved.startedAt}).`,
      );

    if (!resuming) {
      const sections = sectionLikeTitles(stories);
      if (sections.length >= 2)
        return refuse(
          `${inputRel} parece uma única história dividida em seções (${sections
            .slice(0, 3)
            .map((t) => `"## ${t}"`)
            .join(
              ', ',
            )}…): cada "## " vira uma história separada. Use "###" nas seções e "##" só no título de cada história.`,
        );
    }

    if (resuming) {
      const checked = checkResume(
        saved,
        { hash: inputHash, stories },
        {
          branchExists: (b) => git.branchExists(root, b),
          isAncestor: (sha, b) => this.deps.gitCommit.isAncestor(root, sha, b),
          isPidAlive,
          ownPid: this.pid,
        },
      );
      if (!checked.ok) return refuse(checked.error);
      run = checked.run;
      const branch = resumeBranch(run);
      if (git.currentBranch(root) !== branch) {
        try {
          git.checkoutExisting(root, branch);
        } catch {
          return refuse(
            `Não foi possível trocar para a branch ${branch}: as alterações não commitadas conflitam com ela.`,
          );
        }
      }
      // Runs interrupted by older versions stashed the step's partial work: bring it back to disk.
      const si = run.stories.findIndex((s) => s.status !== 'done');
      const story = run.stories[si];
      const halted = story && STEPS.find((x) => story.steps[x].status === 'interrupted');
      if (story && halted) {
        const name = interruptedStashName(run.id, story, si, halted);
        if (this.deps.gitCommit.unstash(root, name))
          this.progress(`autopiloto: trabalho parcial de ${halted} restaurado do stash "${name}"`);
      }
      for (const st of run.stories) {
        if (!st.feature) continue;
        try {
          this.baseline.set(st.feature, fs.readFileSync(decisionsPath(root, st.feature), 'utf8'));
        } catch {
          /* no decisions yet */
        }
      }
    } else {
      if (opts.resume) return refuse('Nenhuma execução do autopiloto para retomar.');
      if (git.isDirty(root))
        return refuse(
          'Há alterações não commitadas; faça commit ou stash antes de iniciar o autopiloto.',
        );
      run = {
        version: 1,
        id: newId,
        input: rel,
        inputHash,
        baseBranch: git.currentBranch(root) ?? 'main',
        status: 'active',
        pid: this.pid,
        startedAt: new Date(this.now()).toISOString(),
        stories: stories.map(emptyStory),
      };
    }

    return this.execute(root, run, stories, resuming);
  }

  /**
   * `/autopilot --continue [feature]`: a run of one story over a feature started elsewhere (by
   * hand, in Claude Code, in another Spec Kit agent). The steps its artifacts show as done are
   * marked done at HEAD; the run starts at the first one left. Uncommitted work stays on disk and
   * goes into the next step's commit.
   */
  private adopt(
    root: string,
    arg: string | undefined,
    id: string,
  ): { run: Run; stories: Story[] } | { error: string } {
    const git = this.deps.git;
    const specs = path.join(root, 'specs');
    let dirs: string[] = [];
    try {
      dirs = fs
        .readdirSync(specs, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      dirs = [];
    }
    // A feature also counts when only its branch has it (e.g. created in Claude Code, now on main).
    const names = [...new Set([...dirs, ...git.branches(root).filter(isFeatureName)])];
    const current = git.currentBranch(root);
    const fromJson = readFeatureJson(root);
    const picked = pickFeature(
      names,
      arg,
      fromJson ? path.basename(fromJson) : current,
      newestFeature(names),
    );
    if (typeof picked !== 'string') return picked;
    let branch = current;
    if (current !== picked && git.branchExists(root, picked)) {
      try {
        git.checkoutExisting(root, picked);
        branch = picked;
      } catch {
        return {
          error: `Não foi possível trocar para a branch ${picked}: as alterações não commitadas conflitam com ela.`,
        };
      }
    }
    const read = (file: string) => {
      try {
        return fs.readFileSync(path.join(specs, picked, file), 'utf8');
      } catch {
        return undefined;
      }
    };
    const spec = read('spec.md');
    const found = detectProgress({ spec, plan: read('plan.md'), tasks: read('tasks.md') });
    if ('error' in found) return { error: `${picked}: ${found.error}` };
    writeFeatureJson(root, `specs/${picked}`);

    const text = promptStoriesFile(adoptedStoryText(spec!, picked));
    const file = path.join(path.dirname(jsonlPath(root, id)), `${id}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    const stories = parseStories(text) as Story[];
    const story = emptyStory(stories[0]!);
    story.feature = picked;
    if (branch) story.branch = branch;
    const sha = this.deps.gitCommit.headSha(root);
    for (const s of found.done)
      story.steps[s] = {
        ...emptyStep(),
        status: 'done',
        ...(sha ? { sha } : {}),
        gate: { ok: true, reason: 'feito fora do autopiloto' },
      };
    this.progress(
      `autopiloto: continuando ${picked} a partir do ${found.next} (${found.reasons.join('; ')})`,
    );
    if (git.isDirty(root))
      this.progress(
        'autopiloto: as alterações não commitadas ficam no disco e entram no commit do próximo passo.',
      );
    const base =
      branch !== picked
        ? (branch ?? 'main')
        : (['main', 'master'].find((b) => git.branchExists(root, b)) ?? picked);
    return {
      run: {
        version: 1,
        id,
        input: path.relative(root, file).split(path.sep).join('/'),
        inputHash: sha256(text),
        baseBranch: base,
        status: 'active',
        pid: this.pid,
        startedAt: new Date(this.now()).toISOString(),
        stories: [story],
      },
      stories,
    };
  }

  private async execute(
    root: string,
    run: Run,
    stories: Story[],
    resuming: boolean,
  ): Promise<AutopilotResult> {
    const git = this.deps.git;
    const settings = this.ctl.settings.autopilot;
    const verifyCommands = settings.verify.command ?? defaultVerifyCommands(root);
    const specKit = this.ctl.specKit!;
    const prevCreateBranch = specKit.settings.createBranch;
    (specKit.settings as { createBranch: boolean }).createBranch = true;

    const specOnDisk = (feature: string) =>
      fs.existsSync(path.join(root, 'specs', feature, 'spec.md'));
    const ctx = (): FlowContext => ({ stories, settings, now: this.now(), specOnDisk });
    let step = start(run, ctx());
    const decider = this.makeDecider(() => step, stories, root);
    const autoAsk = asAskUserHandler(
      decider,
      () => this.decisionContext(step, stories, root),
      (d) => this.record(root, step.state.run.id, d),
      (reason, detail) => {
        this.askFailure = reason;
        this.decisionFailed(root, step, reason, detail);
      },
    );
    const restore = this.ctl.runOverrides({
      approvalMode: 'auto',
      // A dropped connection never stops the run: the turn waits and retries (Esc cancels).
      networkRetries: Number.POSITIVE_INFINITY,
      confirm: async () => false, // only destructive commands ask in "auto"; they are refused (FR-005)
      // Interactive: the question waits for the user first; the decider answers what is left.
      ask: async (request) => {
        const person = await this.askPerson(request);
        if (person) {
          request.questions.forEach((q, i) => {
            const a = person.answers[i];
            if (a)
              this.record(
                root,
                step.state.run.id,
                this.userDecision(step, q.question, answerText(a), toDecisionOptions(q.options)),
              );
          });
          return person;
        }
        if (this.cancelled) return { answered: false };
        return autoAsk(request);
      },
      onToolResult: (_name, result) => this.skillEvent(root, step, result),
    });
    this.ctl.autopilotCancel = () => this.cancel();
    this.ctl.logger.log('autopilot.start', {
      stories: stories.length,
      resume: resuming,
      verify: verifyCommands.length,
    });
    if (verifyCommands.length === 0)
      this.progress(
        'autopiloto: nenhum comando de verificação configurado; o passo verify não verifica nada.',
      );

    try {
      for (;;) {
        writeRunState(root, step.state.run);
        if (this.cancelled && step.next.type !== 'finish') step = onCancelled(step.state);
        if (step.next.type === 'finish') break;
        this.ctl.setAutopilotStatus({
          story: step.state.story + 1,
          total: step.state.run.stories.length,
          step: step.state.step,
        });
        step = await this.perform(step, step.next, {
          root,
          stories,
          settings,
          verifyCommands,
          decider,
          ctx,
        });
      }
    } finally {
      restore();
      (specKit.settings as { createBranch: boolean }).createBranch = prevCreateBranch;
      this.ctl.autopilotCancel = undefined;
      this.ctl.setAutopilotStatus(undefined);
      writeRunState(root, step.state.run);
    }

    const final = step.state.run;
    // An interrupted step's partial work stays on disk, uncommitted: the resume continues from it
    // and the step's commit takes it.
    const partial = final.status === 'interrupted' && git.isDirty(root);
    this.ctl.logger.log('autopilot.end', {
      status: final.status,
      stories: final.stories.length,
      done: final.stories.filter((s) => s.status === 'done').length,
    });
    const counts: Record<number, number> = {};
    for (const d of this.decisions) counts[d.story] = (counts[d.story] ?? 0) + 1;
    const decisionFiles: Record<number, string> = {};
    const openTasks: Record<number, string[]> = {};
    final.stories.forEach((s, i) => {
      if (!s.feature) return;
      if (fs.existsSync(decisionsPath(root, s.feature)))
        decisionFiles[i + 1] = `specs/${s.feature}/decisions.md`;
      try {
        const tasks = fs.readFileSync(path.join(root, 'specs', s.feature, 'tasks.md'), 'utf8');
        openTasks[i + 1] = openTaskLines(tasks);
      } catch {
        /* no tasks.md yet */
      }
    });
    const report = formatReport(final, {
      decisions: counts,
      decisionFiles,
      openTasks,
      jsonl: path.relative(root, jsonlPath(root, final.id)).split(path.sep).join('/'),
      lastOutput: final.stopped?.step === 'verify' ? this.lastVerifyOutput : undefined,
      partial,
    });
    return { code: final.status === 'done' ? 0 : 1, report, run: final };
  }

  // ------------------------------------------------------------------ actions

  private async perform(
    step: Step,
    next: NextAction,
    env: {
      root: string;
      stories: Story[];
      settings: AutopilotSettings;
      verifyCommands: string[];
      decider: Decider;
      ctx: () => FlowContext;
    },
  ): Promise<Step> {
    const { root } = env;
    const st = step.state;
    const label = `história ${st.story + 1}/${st.run.stories.length}`;
    switch (next.type) {
      case 'turn': {
        if (next.clear) {
          this.ctl.clearConversation({ quiet: true, keepTranscript: true });
          this.progress(`autopiloto: ${label} "${st.run.stories[st.story]!.title}" · ${st.step}…`);
        } else {
          this.progress(
            `autopiloto: ${label} · ${st.step} · ${next.text === 'continue' ? `continue (${this.taskProgress(root)})` : 'nova rodada'}`,
          );
        }
        this.ctl.logger.log('autopilot.step', {
          story: st.story + 1,
          step: st.step,
          clear: next.clear,
        });
        const before = this.disk(root);
        const t0 = this.now();
        this.askFailure = undefined;
        const result = await this.ctl.submit(next.text, { record: false });
        // Waiting for a provider rate limit does not count against the story's time cap.
        const ms = Math.max(0, this.now() - t0 - this.ctl.lastRetryWaitMs);
        const after = this.disk(root);
        const claimed = claimFeature(st, {
          before,
          after,
          branch: this.deps.git.currentBranch(root),
        });
        if (this.askFailure) return onDecisionFailed(claimed, this.askFailure);
        const blocked =
          result === undefined
            ? this.ctl.lastCommandBlocked
              ? (this.ctl.notices.filter((n) => n.level === 'warn').at(-1)?.text ??
                'comando bloqueado')
              : 'o turno não foi executado'
            : undefined;
        const out = onTurn(claimed, env.ctx(), {
          snapshot: {
            step: st.step === 'verify' ? 'implement' : st.step,
            before,
            after,
            branch: this.deps.git.currentBranch(root),
            hasGit: true,
            text: result?.text ?? '',
            stopReason: result?.stopReason ?? 'end_turn',
            errorCategory: result?.error?.category,
            blocked,
            planUncommitted:
              st.step === 'plan' && after.feature
                ? this.deps.gitCommit.uncommitted(root, `specs/${after.feature}/plan.md`)
                : undefined,
          },
          usage: result?.usage ?? { inputTokens: 0, outputTokens: 0 },
          ms,
        });
        this.gateEvent(root, out);
        return out;
      }
      case 'decide': {
        const person = await this.askPerson({
          questions: [
            {
              question: next.question,
              header: 'Autopiloto',
              options: [
                {
                  label: AUTO_ANSWER_LABEL,
                  description: 'O autopiloto escolhe a resposta, como faria sem você',
                },
              ],
              multiSelect: false,
            },
          ],
        });
        const typed = person?.answers[0]?.kind === 'other' ? person.answers[0].text : undefined;
        if (typed !== undefined) {
          this.record(root, st.run.id, this.userDecision(step, next.question, typed));
          return onAnswer(st, typed);
        }
        if (this.cancelled) return onCancelled(st);
        try {
          const d = await env.decider.text(
            this.decisionContext(step, env.stories, root),
            next.question,
          );
          this.record(root, st.run.id, d);
          return onAnswer(st, String(d.choice));
        } catch (err) {
          const reason = err instanceof DeciderError ? err.message : String(err);
          this.decisionFailed(
            root,
            step,
            reason,
            err instanceof DeciderError ? err.detail : undefined,
          );
          return onDecisionFailed(st, reason);
        }
      }
      case 'verify': {
        if (env.verifyCommands.length === 0)
          return onVerify(st, env.ctx(), { ok: true, command: '', output: '', skipped: true });
        for (const command of env.verifyCommands) {
          this.progress(`autopiloto: ${label} · verify · ${command}`);
          const r = await this.deps.verify.run(command, root, env.settings.verify.timeoutMs);
          if (r.code !== 0) {
            this.lastVerifyOutput = tail(r.output, 10);
            appendJsonl(root, st.run.id, {
              event: 'verify',
              story: st.story + 1,
              command,
              code: r.code,
            });
            return onVerify(st, env.ctx(), { ok: false, command, output: tail(r.output) });
          }
        }
        appendJsonl(root, st.run.id, { event: 'verify', story: st.story + 1, ok: true });
        return onVerify(st, env.ctx(), {
          ok: true,
          command: env.verifyCommands.join(' && '),
          output: '',
        });
      }
      case 'commit': {
        const story = st.run.stories[st.story]!;
        // Decisions made before the feature existed (specify) belong to it now.
        for (const d of this.decisions)
          if (d.story === st.story + 1 && !d.feature) d.feature = story.feature;
        const s0 = st.run.stories[st.story]!.steps[st.step];
        const spent = `${formatElapsed(s0.ms)}`;
        rewriteProtected(
          root,
          { ...st.run },
          st.story + 1,
          this.decisions,
          story.feature ? this.baseline.get(story.feature) : undefined,
        );
        this.deps.gitCommit.addAll(root);
        let sha: string | undefined;
        if (this.deps.gitCommit.hasStaged(root))
          sha = this.deps.gitCommit.commit(root, next.message);
        else sha = this.deps.gitCommit.headSha(root);
        appendJsonl(root, st.run.id, { event: 'commit', story: st.story + 1, step: st.step, sha });
        this.progress(`autopiloto: ${label} · ${st.step} ok (${spent})`);
        const out = onCommitted(st, env.ctx(), sha);
        writeRunState(root, out.state.run);
        return out;
      }
      case 'publish': {
        const story = st.run.stories[st.story]!;
        if (!env.settings.push || !story.branch) return onPublished(st, env.ctx());
        const base =
          st.story > 0
            ? (st.run.stories[st.story - 1]!.branch ?? env.settings.prBase ?? st.run.baseBranch)
            : (env.settings.prBase ?? st.run.baseBranch);
        try {
          this.deps.gitCommit.push(root, story.branch);
          const pr = this.deps.remote.createPr(root, {
            base,
            head: story.branch,
            title: `${env.settings.commitPrefix} ${story.title}`,
            body: `Gerado pelo autopiloto do Maestro (execução ${st.run.id}).\n\nDecisões: specs/${story.feature}/decisions.md\n`,
          });
          if (env.settings.merge) this.deps.remote.merge(root, pr.number);
          appendJsonl(root, st.run.id, {
            event: 'pr',
            story: st.story + 1,
            url: pr.url,
            merged: env.settings.merge,
          });
          this.progress(`autopiloto: ${label} · PR ${pr.url}`);
          return onPublished(st, env.ctx(), pr);
        } catch (err) {
          this.progress(
            `autopiloto: ${label} · push/PR falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
          return onPublished(st, env.ctx());
        }
      }
      case 'finish':
        return step;
    }
  }

  // ------------------------------------------------------------------ helpers

  private makeDecider(current: () => Step, _stories: Story[], _root: string): Decider {
    return createDecider({
      target: () => this.ctl.resolveRouteTarget('autopilot.decide'),
      meta: () => {
        const s = current().state;
        return {
          story: s.story + 1,
          feature: s.run.stories[s.story]?.feature,
          at: new Date(this.now()).toISOString(),
        };
      },
      signal: () => this.abort.signal,
    });
  }

  private decisionContext(step: Step, stories: Story[], root: string): DecisionContext {
    const s = step.state;
    const story = stories[s.story]!;
    const feature = readFeatureJson(root);
    let spec: string | undefined;
    if (feature) {
      try {
        spec = fs.readFileSync(path.join(root, feature, 'spec.md'), 'utf8');
      } catch {
        spec = undefined;
      }
    }
    return { storyTitle: story.title, storyBody: story.body, step: s.step, spec };
  }

  /** A decider failure goes to the run log with what was asked and answered (diagnosis). */
  private decisionFailed(root: string, step: Step, reason: string, detail?: DeciderFailure): void {
    const st = step.state;
    appendJsonl(root, st.run.id, {
      event: 'decision.failed',
      story: st.story + 1,
      feature: st.run.stories[st.story]?.feature,
      step: st.step,
      reason,
      ...detail,
    });
    this.progress(decisionFailedProgress(st.step, detail?.question, reason));
  }

  /**
   * Interactive run (`autopilot.questionTimeoutSeconds` > 0): shows the question in the dialog
   * and waits for the user; undefined when the time runs out, on Esc or without a user (`-p`),
   * so the decider answers it.
   */
  private async askPerson(
    request: AskUserRequest,
  ): Promise<Extract<AskUserOutcome, { answered: true }> | undefined> {
    const seconds = this.ctl.settings.autopilot.questionTimeoutSeconds;
    if (!this.ctl.interactive || seconds === 0 || this.cancelled) return undefined;
    const r = await this.ctl.askUntil(request, seconds * 1000, this.abort.signal);
    if (r === 'timeout')
      this.progress(`autopiloto: sem resposta em ${seconds} s; o autopiloto decide.`);
    return r !== 'timeout' && r.answered ? r : undefined;
  }

  /** A question the user answered in the dialog, recorded like a decision. */
  private userDecision(
    current: Step,
    question: string,
    choice: string,
    options?: Decision['options'],
  ): Decision {
    const s = current.state;
    return {
      at: new Date(this.now()).toISOString(),
      story: s.story + 1,
      feature: s.run.stories[s.story]?.feature,
      step: s.step,
      kind: options ? 'options' : 'text',
      question,
      ...(options ? { options } : {}),
      choice,
      rationale: 'Respondida pelo usuário.',
      by: 'user',
      provider: 'usuário',
      model: '',
    };
  }

  private record(root: string, runId: string, d: Decision): void {
    this.decisions.push(d);
    appendJsonl(root, runId, { event: 'decision', ...d });
    this.progress(decisionProgress(d));
    this.ctl.logger.log('autopilot.decision', {
      story: d.story,
      step: d.step,
      kind: d.kind,
      followedRecommendation: d.followedRecommendation,
    });
  }

  /** specs/013 contracts/autopilot-skill-event.md: one line per load_skill call, no content. */
  private skillEvent(root: string, current: Step, result: ToolResult): void {
    const d = result.display?.skill;
    if (!d) return;
    const s = current.state;
    const feature = s.run.stories[s.story]?.feature;
    appendJsonl(root, s.run.id, {
      event: 'skill.load',
      story: s.story + 1,
      ...(feature ? { feature } : {}),
      step: s.step,
      skill: d.name,
      ...(d.source ? { source: d.source } : {}),
      ...(d.file ? { file: d.file } : {}),
      ok: d.ok,
    });
    this.ctl.logger.log('autopilot.skill', { story: s.story + 1, step: s.step, ok: d.ok });
  }

  private gateEvent(root: string, out: Step): void {
    const s = out.state;
    const gate = s.run.stories[s.story]?.steps[s.step].gate;
    appendJsonl(root, s.run.id, {
      event: 'gate',
      story: s.story + 1,
      step: s.step,
      next: out.next.type,
      ok: gate?.ok,
      reason: gate?.reason,
    });
    this.ctl.logger.log('autopilot.gate', {
      story: s.story + 1,
      step: s.step,
      next: out.next.type,
    });
  }

  private disk(root: string): DiskView {
    const specs = path.join(root, 'specs');
    let featureDirs: string[] = [];
    try {
      featureDirs = fs
        .readdirSync(specs, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      featureDirs = [];
    }
    const rel = readFeatureJson(root);
    const feature = rel ? path.basename(rel) : undefined;
    const dir = rel ? path.join(root, rel) : undefined;
    const tasksFile = dir ? path.join(dir, 'tasks.md') : undefined;
    let open = 0;
    let done = 0;
    if (tasksFile) {
      try {
        const c = countTasks(fs.readFileSync(tasksFile, 'utf8'));
        open = c.open;
        done = c.done;
      } catch {
        /* no tasks yet */
      }
    }
    const none: ArtifactInfo = { exists: false };
    return {
      featureDirs,
      feature,
      spec: dir ? artifact(path.join(dir, 'spec.md')) : none,
      plan: dir ? artifact(path.join(dir, 'plan.md')) : none,
      tasks: tasksFile ? artifact(tasksFile) : none,
      openTasks: open,
      doneTasks: done,
    };
  }

  private taskProgress(root: string): string {
    const d = this.disk(root);
    return `${d.doneTasks}/${d.openTasks + d.doneTasks} tarefas`;
  }
}

/** Steps in order, for help texts. */
export const STEP_LIST = STEPS.join(' → ');
