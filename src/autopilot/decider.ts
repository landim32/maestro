/**
 * Decider of the autopilot (specs/011 contracts/decisions.md): answers `ask_user` questions and
 * text questions left at the end of a turn, through the `autopilot.decide` route, without tools.
 * Request building and response parsing are pure; `createDecider` does the provider call.
 */
import { z } from 'zod';
import type { ModelProvider, ProviderRequest } from '../providers/types.js';
import type { AskUserAnswer, AskUserOutcome, AskUserRequest } from '../tools/types.js';
import type { Decision, DecisionOption, StepName } from './types.js';

export const DECIDER_SYSTEM = [
  'Você decide pelo usuário durante uma execução autônoma do Spec Kit. Política:',
  '1) se uma opção estiver marcada como recomendada, escolha-a;',
  '2) senão, escolha a que menos amplia escopo e risco e mais se alinha à história;',
  '3) nunca invente opções.',
  'Responda só com JSON.',
].join('\n');

const SPEC_EXCERPT = 4000;

export interface DecisionContext {
  storyTitle: string;
  storyBody: string;
  step: StepName;
  /** Current spec.md content, if any. */
  spec?: string;
}

const RECOMMENDED = /\((?:recommended|recomendad[oa])\)|\b(?:recommended|recomendad[oa])\b/i;

export function recommendedOf(
  options: Array<{ label: string; description: string }>,
): string | undefined {
  return options.find((o) => RECOMMENDED.test(o.label) || RECOMMENDED.test(o.description))?.label;
}

export function toDecisionOptions(
  options: Array<{ label: string; description: string }>,
): DecisionOption[] {
  const rec = recommendedOf(options);
  return options.map((o) => ({
    label: o.label,
    description: o.description,
    recommended: o.label === rec,
  }));
}

function header(c: DecisionContext): string {
  const spec = c.spec ? `\nResumo da spec: ${c.spec.slice(0, SPEC_EXCERPT)}` : '';
  return `História: ${c.storyTitle}\n${c.storyBody}\nPasso: ${c.step}${spec}`;
}

export function buildOptionsRequest(
  c: DecisionContext,
  q: { question: string; options: DecisionOption[]; multi: boolean },
): string {
  // Numbered: the number is the answer; labels often carry their own "A:" or ":" and models
  // paraphrase them ("Aberta" for "B: Cadastro aberto").
  const opts = q.options
    .map(
      (o, i) => `${i + 1}. ${o.label} — ${o.description}${o.recommended ? ' [recomendada]' : ''}`,
    )
    .join('\n');
  const answer = q.multi
    ? '{"choices": [<número>, ...], "rationale": "<até 3 frases>"}'
    : '{"choice": <número>, "rationale": "<até 3 frases>"}';
  return `${header(c)}\n\nPergunta: ${q.question}\nOpções:\n${opts}\nResponda: ${answer}\n<número> é o número de uma das opções da lista (1 a ${q.options.length}).`;
}

export function buildTextRequest(c: DecisionContext, question: string): string {
  return `${header(c)}\n\nO assistente perguntou: ${question}\nResponda: {"answer": "<resposta curta ao assistente>", "rationale": "<até 3 frases>"}`;
}

/** JSON from the first `{` to the last `}` (also inside a ```json block). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const rationale = z.string().trim().min(1).max(600);
const norm = (s: string) => s.trim().toLowerCase();
const MARKER = /\((?:recommended|recomendad[oa])\)/gi;
/** Label without the recommendation marker, quotes, markdown emphasis and final period. */
const bare = (s: string) =>
  norm(s.replace(MARKER, ' '))
    .replace(/^["'`*_\s]+|["'`*_.\s]+$/g, '')
    .replace(/\s+/g, ' ');
/** "A" of "A: Manter…", "Q2: B) …" or "1. …" (lowercase). */
const letterOf = (label: string) =>
  /^(?:q\d+\s*[:.-]\s*)?(?:op[çc][ãa]o\s+|option\s+)?([a-z]|\d+)(?:\s*[:).—-]|$)/i
    .exec(bare(label))?.[1]
    ?.toLowerCase();

/**
 * The option a decider answer refers to. Models rarely copy a label byte for byte, so besides the
 * exact label this accepts: the label without "(Recommended)", quotes or a final period; the
 * option letter or number alone ("B", "Opção B", "2"); or a unique prefix of the label.
 */
export function matchOption(choice: string, options: DecisionOption[]): string | undefined {
  const exact = options.find((o) => norm(o.label) === norm(choice));
  if (exact) return exact.label;
  const c = bare(choice);
  if (c === '') return undefined;
  const one = (found: DecisionOption[]) => (found.length === 1 ? found[0]!.label : undefined);
  const same = one(options.filter((o) => bare(o.label) === c));
  if (same) return same;
  const letter = letterOf(c);
  if (letter) {
    const lettered = options.filter((o) => letterOf(o.label) !== undefined);
    if (lettered.length > 0) {
      const byLetter = one(options.filter((o) => letterOf(o.label) === letter));
      if (byLetter && (c === letter || c.length <= 12 || bare(byLetter).startsWith(c.slice(0, 3))))
        return byLetter;
    } else if (/^(?:[a-z]|\d+)[:).]?$/.test(c)) {
      const i = /^\d/.test(c) ? Number.parseInt(c, 10) - 1 : c.charCodeAt(0) - 97;
      if (options[i]) return options[i].label;
    }
  }
  if (c.length >= 3)
    return one(
      options.filter((o) => {
        const l = bare(o.label);
        return l.startsWith(c) || c.startsWith(l);
      }),
    );
  return undefined;
}

export type ParsedDecision =
  { ok: true; choice: string | string[]; rationale: string } | { ok: false; error: string };

export function parseOptionsDecision(
  text: string,
  options: DecisionOption[],
  multi: boolean,
): ParsedDecision {
  const json = extractJson(text);
  if (json === undefined) return { ok: false, error: 'resposta sem JSON' };
  const pick = z.union([z.string(), z.number()]);
  const parsed = z
    .object(multi ? { choices: z.array(pick).min(1), rationale } : { choice: pick, rationale })
    .safeParse(json);
  if (!parsed.success) return { ok: false, error: 'JSON fora do formato' };
  const data = parsed.data as {
    choice?: string | number;
    choices?: Array<string | number>;
    rationale: string;
  };
  const picked = (multi ? data.choices! : [data.choice!]).map(String);
  const byNumber = (p: string) => {
    const n = /^\s*(\d+)\s*[.)]?\s*$/.exec(p)?.[1];
    return n === undefined ? undefined : options[Number(n) - 1]?.label;
  };
  const labels = picked.map((p) => byNumber(p) ?? matchOption(p, options));
  const wrong = picked.find((_, i) => labels[i] === undefined);
  if (wrong !== undefined) {
    const shown = wrong.length > 60 ? `${wrong.slice(0, 59)}…` : wrong;
    return { ok: false, error: `escolha fora das opções ("${shown}")` };
  }
  return {
    ok: true,
    choice: multi ? (labels as string[]) : labels[0]!,
    rationale: data.rationale.trim(),
  };
}

export function parseTextDecision(text: string): ParsedDecision {
  const json = extractJson(text);
  const parsed = z.object({ answer: z.string().trim().min(1), rationale }).safeParse(json);
  if (!parsed.success)
    return { ok: false, error: json === undefined ? 'resposta sem JSON' : 'JSON fora do formato' };
  return { ok: true, choice: parsed.data.answer.trim(), rationale: parsed.data.rationale.trim() };
}

/** What the decider was asked and answered, for the run log when it fails. */
export interface DeciderFailure {
  question: string;
  options?: string[];
  /** Raw answers of each attempt, cut to ANSWER_LOG_MAX characters. */
  answers: string[];
}

export const ANSWER_LOG_MAX = 500;

export class DeciderError extends Error {
  constructor(
    message: string,
    readonly detail?: DeciderFailure,
  ) {
    super(message);
    this.name = 'DeciderError';
  }
}

export interface DeciderTarget {
  provider: ModelProvider;
  model?: string;
  overrides?: ProviderRequest['overrides'];
}

export interface Decider {
  options(
    c: DecisionContext,
    q: { question: string; options: Array<{ label: string; description: string }>; multi: boolean },
  ): Promise<Decision>;
  text(c: DecisionContext, question: string): Promise<Decision>;
}

async function ask(t: DeciderTarget, prompt: string, signal: AbortSignal): Promise<string> {
  let out = '';
  for await (const ev of t.provider.stream({
    messages: [
      {
        id: 'decide',
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        createdAt: new Date(),
      },
    ],
    system: DECIDER_SYSTEM,
    tools: [],
    model: t.model,
    overrides: t.overrides,
    signal,
  })) {
    if (ev.type === 'text_delta') out += ev.text;
    else if (ev.type === 'error') throw new DeciderError(ev.error.message);
  }
  return out;
}

/**
 * Decider over the provider of `autopilot.decide`; one retry, then DeciderError (FR-010). The
 * retry tells the model what was wrong with its first answer instead of repeating the request.
 */
export function createDecider(opts: {
  target: () => DeciderTarget;
  meta: () => { story: number; feature?: string; at: string };
  signal: () => AbortSignal;
}): Decider {
  const run = async (
    prompt: string,
    parse: (t: string) => ParsedDecision,
    o: { question: string; options?: string[]; fix: string },
  ) => {
    let last = '';
    let request = prompt;
    const answers: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const target = opts.target();
      try {
        const answer = await ask(target, request, opts.signal());
        answers.push(answer.slice(0, ANSWER_LOG_MAX));
        const parsed = parse(answer);
        if (parsed.ok) return { parsed: parsed as Extract<ParsedDecision, { ok: true }>, target };
        last = parsed.error;
        request = `${prompt}\n\nSua resposta anterior não serviu: ${parsed.error}. ${o.fix}`;
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
      }
    }
    throw new DeciderError(last || 'sem resposta', {
      question: o.question,
      options: o.options,
      answers,
    });
  };
  const base = (c: DecisionContext, target: DeciderTarget) => {
    const m = opts.meta();
    return {
      at: m.at,
      story: m.story,
      feature: m.feature,
      step: c.step,
      provider: target.provider.id,
      model: target.model ?? '',
    };
  };
  return {
    async options(c, q) {
      const options = toDecisionOptions(q.options);
      const { parsed, target } = await run(
        buildOptionsRequest(c, { question: q.question, options, multi: q.multi }),
        (t) => parseOptionsDecision(t, options, q.multi),
        {
          question: q.question,
          options: options.map((o) => o.label),
          fix: `Responda só com o JSON pedido, usando o número de uma das opções (1 a ${options.length}).`,
        },
      );
      const rec = options.find((o) => o.recommended)?.label;
      const chosen = Array.isArray(parsed.choice) ? parsed.choice : [parsed.choice];
      return {
        ...base(c, target),
        kind: 'options',
        question: q.question,
        options,
        choice: parsed.choice,
        rationale: parsed.rationale,
        followedRecommendation: rec === undefined ? undefined : chosen.includes(rec),
      };
    },
    async text(c, question) {
      const { parsed, target } = await run(buildTextRequest(c, question), parseTextDecision, {
        question,
        fix: 'Responda só com o JSON pedido.',
      });
      return {
        ...base(c, target),
        kind: 'text',
        question,
        choice: parsed.choice,
        rationale: parsed.rationale,
      };
    },
  };
}

/**
 * `ToolContext.ask` replacement: each question goes to the decider; decisions are reported through
 * `record`. A failure is surfaced as "not answered" and remembered for the gate (FR-010).
 */
export function asAskUserHandler(
  decider: Decider,
  ctx: () => DecisionContext,
  record: (d: Decision) => void,
  onFailure: (reason: string, detail?: DeciderFailure) => void,
): (request: AskUserRequest) => Promise<AskUserOutcome> {
  return async (request) => {
    const answers: AskUserAnswer[] = [];
    try {
      for (const q of request.questions) {
        const d = await decider.options(ctx(), {
          question: q.question,
          options: q.options,
          multi: q.multiSelect,
        });
        record(d);
        answers.push({ kind: 'options', labels: Array.isArray(d.choice) ? d.choice : [d.choice] });
      }
      return { answered: true, answers };
    } catch (err) {
      onFailure(
        err instanceof Error ? err.message : String(err),
        err instanceof DeciderError ? err.detail : undefined,
      );
      return { answered: false };
    }
  };
}
