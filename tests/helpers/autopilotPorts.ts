/** Test doubles for the autopilot (specs/011): verification, remote and a scripted Spec Kit model. */
import type { ProviderEvent, ProviderRequest } from '../../src/providers/types.js';
import type { RemotePort } from '../../src/autopilot/remote.js';
import type { VerifyPort } from '../../src/autopilot/driver.js';
import { DECIDER_SYSTEM } from '../../src/autopilot/decider.js';
import { createFakeProvider } from './fakeProvider.js';

/** Exit codes in sequence (the last one repeats); records the commands. */
export function fakeVerify(
  codes: number[],
  output = 'FAIL  greet.test.js\n  expected "Olá"',
): VerifyPort & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async run(command) {
      calls.push(command);
      const code = codes[Math.min(calls.length - 1, codes.length - 1)] ?? 0;
      return { code, output: code === 0 ? 'ok' : output };
    },
  };
}

export function fakeRemote(): RemotePort & {
  prs: Array<{ base: string; head: string }>;
  merged: number[];
} {
  const prs: Array<{ base: string; head: string }> = [];
  const merged: number[] = [];
  return {
    prs,
    merged,
    createPr(_root, pr) {
      prs.push({ base: pr.base, head: pr.head });
      return { url: `https://example.test/pull/${prs.length}`, number: prs.length };
    },
    merge(_root, n) {
      merged.push(n);
    },
  };
}

const tool = (callId: string, name: string, input: unknown): ProviderEvent[] => [
  { type: 'tool_call', callId, name, input },
  { type: 'done', stopReason: 'tool_use' },
];
const say = (text: string, out = 20): ProviderEvent[] => [
  { type: 'text_delta', text },
  { type: 'usage', inputTokens: 100, outputTokens: out },
  { type: 'done', stopReason: 'end_turn' },
];

export interface ScriptOptions {
  /** Called once the specify turn has written spec.md, before it ends (e.g. to cancel there). */
  onSpecWritten?: () => void;
  /** Fixed answer of the decider to every question (e.g. one that is not valid JSON). */
  deciderAnswer?: string;
  /** Text the implement step ends with on its first round (e.g. a "(yes/no)" question). */
  implementQuestion?: string;
  /** Analyze report of each analyze turn, in order (default: no CRITICAL). */
  analyzeReports?: string[];
  /** Tasks marked done per implement round (default: all at once). */
  tasksPerRound?: number;
  /** The clarify step asks this ask_user question (default: one question with a recommended option). */
  noClarifyQuestion?: boolean;
  /** load_skill inputs called at the start of a step's first round, before its usual script (specs/013). */
  skillCalls?: Partial<Record<string, unknown[]>>;
  /** Feature already on disk (a run that continues it skips specify). */
  feature?: string;
}

/**
 * A provider that behaves like a model following the Spec Kit commands: it runs the (native)
 * scripts, writes the artifacts, asks a clarification and implements the tasks. The step is read
 * from the transcript label (`display`) of the last user message; the decider (DECIDER_SYSTEM)
 * always picks the recommended option / answers "yes".
 */
export function speckitModel(opts: ScriptOptions = {}) {
  let feature = opts.feature ?? '';
  let analyzeTurn = 0;
  let implementRound = 0;
  const steps: string[] = [];

  const script = (req: ProviderRequest): ProviderEvent[] => {
    if (req.system === DECIDER_SYSTEM) {
      const prompt = req.messages
        .at(-1)!
        .content.map((p) => (p.type === 'text' ? p.text : ''))
        .join('');
      if (opts.deciderAnswer !== undefined) return say(opts.deciderAnswer);
      if (prompt.includes('O assistente perguntou'))
        return say(
          '{"answer": "yes", "rationale": "A história pede para seguir com a implementação."}',
        );
      const rec = /^(\d+)\. [^\n]*\[recomendada\]$/m.exec(prompt)?.[1] ?? '1';
      return say(`{"choice": ${rec}, "rationale": "É a opção recomendada e a mais simples."}`);
    }
    const msgs = req.messages;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')!;
    const label = (
      lastUser.display ?? lastUser.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
    ).trim();
    let sinceUser = msgs
      .slice(msgs.lastIndexOf(lastUser) + 1)
      .filter((m) => m.role === 'tool').length;
    const lastResult = [...msgs].reverse().find((m) => m.role === 'tool')?.content[0];
    const resultText = lastResult?.type === 'tool_result' ? lastResult.output : '';
    const step = /^\/speckit\.(\w+)/.exec(label)?.[1] ?? 'round';
    if (sinceUser === 0) steps.push(step);
    const skillCalls = opts.skillCalls?.[step] ?? [];
    if (sinceUser < skillCalls.length)
      return tool('k' + sinceUser, 'load_skill', skillCalls[sinceUser]);
    sinceUser -= skillCalls.length;
    const dir = () => `specs/${feature}`;

    switch (step) {
      case 'specify': {
        if (sinceUser === 0) {
          const name =
            /^\/speckit\.specify\s+(\S+)/
              .exec(label)?.[1]
              ?.toLowerCase()
              .replace(/[^a-z]/g, '') || 'feat';
          return tool('s1', 'run_command', {
            command: `.specify/scripts/bash/create-new-feature.sh --json --short-name "${name}" "${name}"`,
          });
        }
        if (sinceUser === 1) {
          feature = (JSON.parse(resultText.split('\n').at(-1)!) as { BRANCH_NAME: string })
            .BRANCH_NAME;
          return tool('s2', 'write_file', {
            path: `${dir()}/spec.md`,
            content: `# Spec ${feature}\n`,
          });
        }
        opts.onSpecWritten?.();
        return say('spec pronta');
      }
      case 'clarify':
        if (sinceUser === 0 && !opts.noClarifyQuestion)
          return tool('c1', 'ask_user', {
            questions: [
              {
                question: 'Qual formato de saudação?',
                header: 'Formato',
                options: [
                  { label: 'Olá, nome! (Recommended)', description: 'mais simples' },
                  { label: 'Bom dia, nome', description: 'depende da hora' },
                ],
              },
            ],
          });
        if (sinceUser === 1 && !opts.noClarifyQuestion)
          return tool('c2', 'write_file', {
            path: `${dir()}/spec.md`,
            content: `# Spec ${feature}\n\n## Clarifications\n- Formato: ${resultText.includes('Olá') ? 'Olá' : '?'}\n`,
          });
        return say('clarificado');
      case 'plan':
        if (sinceUser === 0)
          return tool('p0', 'run_command', {
            command: '.specify/scripts/bash/setup-plan.sh --json',
          });
        if (sinceUser === 1)
          return tool('p1', 'write_file', {
            path: `${dir()}/plan.md`,
            content: `# Plan ${feature}\n`,
          });
        return say('plano pronto');
      case 'tasks':
        if (sinceUser === 0)
          return tool('t1', 'write_file', {
            path: `${dir()}/tasks.md`,
            content: '- [ ] T001 criar greet.js\n- [ ] T002 testar\n- [ ] T003 documentar\n',
          });
        return say('tarefas prontas');
      case 'analyze': {
        const reports = opts.analyzeReports ?? [];
        const report = reports[analyzeTurn] ?? 'Critical Issues Count: 0';
        analyzeTurn++;
        return say(`## Specification Analysis Report\n\n**Metrics:**\n- ${report}`);
      }
      case 'implement':
      case 'round': {
        if (
          step === 'round' &&
          !label.startsWith('continue') &&
          !label.startsWith('yes') &&
          !label.startsWith('A verificação')
        ) {
          // fix prompt of analyze or other round: just acknowledge
          return say('pronto');
        }
        if (sinceUser === 0) {
          implementRound++;
          if (implementRound === 1 && opts.implementQuestion) return say(opts.implementQuestion);
          const per = opts.tasksPerRound ?? 3;
          const done = Math.min(3, per * (implementRound - (opts.implementQuestion ? 1 : 0)));
          const lines = [1, 2, 3].map((n) => `- [${n <= done ? 'X' : ' '}] T00${n} tarefa`);
          return tool('i1', 'write_file', {
            path: `${dir()}/tasks.md`,
            content: `${lines.join('\n')}\n`,
          });
        }
        if (sinceUser === 1)
          return tool('i2', 'write_file', {
            path: 'greet.js',
            content: `export const greet = (n) => \`Olá, \${n}!\`; // ${feature} ${implementRound}\n`,
          });
        return say('implementado');
      }
      default:
        return say('ok');
    }
  };
  const provider = createFakeProvider((req) => script(req), { id: 'claude' });
  return { provider, steps, feature: () => feature };
}
