/**
 * Activity of the turn in progress (specs/009 data-model § 1, contracts/activity-line.md):
 * phase, phrase, elapsed time and live token count. Pure — the controller feeds events and the
 * ActivityLine renders `phraseOf` / `formatElapsed` / `formatTokens`.
 */

export type ActivityPhase = 'waiting' | 'responding' | 'tool' | 'confirm' | 'question';

/** Waiting phrases in the style of Claude Code, in the UI language (research R3). */
export const WAIT_VERBS = [
  'Contemplando',
  'Ponderando',
  'Elaborando',
  'Matutando',
  'Raciocinando',
  'Tramando',
  'Conjecturando',
  'Orquestrando',
  'Cozinhando',
  'Destrinchando',
] as const;

export interface Activity {
  phase: ActivityPhase;
  verb: string;
  /** Label of the tool running (phase `tool`). */
  tool?: string;
  startedAt: number;
  realIn: number;
  realOut: number;
  /** Characters received since the last real usage. */
  estChars: number;
  anyReal: boolean;
}

export type ActivityEvent =
  | { type: 'delta'; chars: number }
  | { type: 'usage'; input: number; output: number }
  | { type: 'toolStart'; label: string }
  | { type: 'toolEnd' }
  | { type: 'confirm'; pending: boolean }
  | { type: 'question'; pending: boolean };

export function initialActivity(at: number, random: () => number = Math.random): Activity {
  const i = Math.min(WAIT_VERBS.length - 1, Math.floor(random() * WAIT_VERBS.length));
  return {
    phase: 'waiting',
    verb: WAIT_VERBS[Math.max(0, i)]!,
    startedAt: at,
    realIn: 0,
    realOut: 0,
    estChars: 0,
    anyReal: false,
  };
}

/** Phases that a text delta must not override (the user or a tool is what we wait for). */
const STICKY: ReadonlySet<ActivityPhase> = new Set(['tool', 'confirm', 'question']);

export function activityReducer(s: Activity, e: ActivityEvent): Activity {
  switch (e.type) {
    case 'delta':
      return {
        ...s,
        estChars: s.estChars + e.chars,
        phase: STICKY.has(s.phase) ? s.phase : 'responding',
      };
    case 'usage':
      return {
        ...s,
        realIn: s.realIn + e.input,
        realOut: s.realOut + e.output,
        estChars: 0,
        anyReal: true,
      };
    case 'toolStart':
      return { ...s, phase: 'tool', tool: e.label };
    case 'toolEnd':
      return { ...s, phase: 'waiting', tool: undefined };
    case 'confirm':
      return e.pending
        ? { ...s, phase: 'confirm' }
        : s.phase === 'confirm'
          ? { ...s, phase: 'waiting' }
          : s;
    case 'question':
      return e.pending
        ? { ...s, phase: 'question' }
        : s.phase === 'question'
          ? { ...s, phase: 'waiting' }
          : s;
  }
}

export function outTokens(s: Activity): number {
  return s.realOut + Math.ceil(s.estChars / 4);
}

/** True while only the estimate is known (no usage reported yet). */
export function isApproximate(s: Activity): boolean {
  return !s.anyReal;
}

export function phraseOf(s: Activity): string {
  switch (s.phase) {
    case 'tool':
      return `Executando ${s.tool ?? 'ferramenta'}…`;
    case 'confirm':
      return 'Aguardando sua confirmação…';
    case 'question':
      return 'Aguardando sua resposta…';
    default:
      return `${s.verb}…`;
  }
}

/** `0s` … `59s`, then `1m 05s` (contracts/activity-line.md § 2). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

/** `↓ 304 tokens` / `↓ ~304 tokens`; empty when there is nothing to show. */
export function formatTokens(n: number, approximate: boolean): string {
  if (n <= 0) return '';
  return `↓ ${approximate ? '~' : ''}${n} tokens`;
}

export interface TurnSummary {
  elapsedMs: number;
  outTokens: number;
  approximate: boolean;
  cancelled: boolean;
}

export function summarize(s: Activity, end: { at: number; cancelled: boolean }): TurnSummary {
  return {
    elapsedMs: end.at - s.startedAt,
    outTokens: outTokens(s),
    approximate: isApproximate(s),
    cancelled: end.cancelled,
  };
}

/** `✻ 13s · ↓ 304 tokens` / `✻ interrompido · 4s · ↓ ~20 tokens`. */
export function formatSummary(t: TurnSummary): string {
  const parts = [
    ...(t.cancelled ? ['interrompido'] : []),
    formatElapsed(t.elapsedMs),
    formatTokens(t.outTokens, t.approximate),
  ].filter(Boolean);
  return `✻ ${parts.join(' · ')}`;
}

/**
 * The activity line text for a width (contracts/activity-line.md § 2–3): drops the hint, then the
 * tokens; below 20 columns only `<symbol> <time>` is kept. `measure` gives the display width.
 */
export function activityText(
  s: Activity,
  o: { now: number; symbol: string; width: number; measure: (t: string) => number },
): string {
  const time = formatElapsed(o.now - s.startedAt);
  const tokens = formatTokens(outTokens(s), isApproximate(s));
  const hint = 'Esc para interromper';
  const phrase = phraseOf(s);
  const build = (parts: string[]) => `${o.symbol} ${phrase} (${parts.filter(Boolean).join(' · ')})`;
  const candidates = [build([time, tokens, hint]), build([time, tokens]), build([time])];
  if (o.width >= 20) {
    for (const c of candidates) if (o.measure(c) <= o.width) return c;
    return candidates[candidates.length - 1]!;
  }
  return `${o.symbol} ${time}`;
}
