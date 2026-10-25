import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import {
  activityReducer,
  activityText,
  formatElapsed,
  formatSummary,
  formatTokens,
  initialActivity,
  isApproximate,
  outTokens,
  phraseOf,
  summarize,
  WAIT_VERBS,
} from '../../../src/session/activity.js';
import type { Activity, ActivityEvent } from '../../../src/session/activity.js';

const run = (s: Activity, ...events: ActivityEvent[]) => events.reduce(activityReducer, s);
const start = () => initialActivity(1000, () => 0);

describe('activity reducer (specs/009 data-model § 1)', () => {
  it('starts waiting with a verb drawn by the injected random', () => {
    expect(start()).toMatchObject({ phase: 'waiting', verb: WAIT_VERBS[0], startedAt: 1000 });
    expect(initialActivity(0, () => 0.999).verb).toBe(WAIT_VERBS[WAIT_VERBS.length - 1]);
    expect(phraseOf(start())).toBe('Contemplando…');
  });

  it('text deltas move to responding and feed the estimate', () => {
    const s = run(start(), { type: 'delta', chars: 9 });
    expect(s.phase).toBe('responding');
    expect(outTokens(s)).toBe(3); // ceil(9/4)
    expect(isApproximate(s)).toBe(true);
  });

  it('a real usage replaces the estimate and accumulates across model calls', () => {
    const s = run(
      start(),
      { type: 'delta', chars: 400 },
      { type: 'usage', input: 10, output: 120 },
      { type: 'delta', chars: 8 },
    );
    expect(outTokens(s)).toBe(122);
    expect(isApproximate(s)).toBe(false);
    const t = run(s, { type: 'usage', input: 5, output: 30 });
    expect(outTokens(t)).toBe(150);
    expect(t.realIn).toBe(15);
  });

  it('tool, confirmation and question phases set their phrases and return to waiting', () => {
    const tool = run(start(), { type: 'toolStart', label: 'Bash' });
    expect(phraseOf(tool)).toBe('Executando Bash…');
    expect(run(tool, { type: 'delta', chars: 3 }).phase).toBe('tool'); // sticky
    expect(run(tool, { type: 'toolEnd' })).toMatchObject({ phase: 'waiting', tool: undefined });
    const conf = run(start(), { type: 'confirm', pending: true });
    expect(phraseOf(conf)).toBe('Aguardando sua confirmação…');
    expect(run(conf, { type: 'confirm', pending: false }).phase).toBe('waiting');
    const q = run(start(), { type: 'question', pending: true });
    expect(phraseOf(q)).toBe('Aguardando sua resposta…');
    expect(run(q, { type: 'question', pending: false }).phase).toBe('waiting');
    // clearing a phase that is not current changes nothing
    expect(run(tool, { type: 'confirm', pending: false }).phase).toBe('tool');
  });
});

describe('activity formatting (contracts/activity-line.md)', () => {
  it('elapsed time', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(59_999)).toBe('59s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(720_000)).toBe('12m 00s');
  });

  it('tokens', () => {
    expect(formatTokens(0, true)).toBe('');
    expect(formatTokens(304, false)).toBe('↓ 304 tokens');
    expect(formatTokens(20, true)).toBe('↓ ~20 tokens');
  });

  it('turn summary, normal and interrupted', () => {
    const s = run(start(), { type: 'usage', input: 1, output: 304 });
    expect(formatSummary(summarize(s, { at: 14_000, cancelled: false }))).toBe(
      '✻ 13s · ↓ 304 tokens',
    );
    const c = run(start(), { type: 'delta', chars: 80 });
    expect(formatSummary(summarize(c, { at: 5_000, cancelled: true }))).toBe(
      '✻ interrompido · 4s · ↓ ~20 tokens',
    );
    expect(formatSummary(summarize(start(), { at: 3_000, cancelled: false }))).toBe('✻ 2s');
  });

  it('line text drops the hint, then the tokens; under 20 columns only symbol and time', () => {
    const s = run(start(), { type: 'usage', input: 0, output: 304 });
    const o = (width: number) => ({ now: 14_000, symbol: '✻', width, measure: stringWidth });
    expect(activityText(s, o(100))).toBe(
      '✻ Contemplando… (13s · ↓ 304 tokens · Esc para interromper)',
    );
    expect(activityText(s, o(40))).toBe('✻ Contemplando… (13s · ↓ 304 tokens)');
    expect(activityText(s, o(25))).toBe('✻ Contemplando… (13s)');
    expect(activityText(s, o(15))).toBe('✻ 13s');
    expect(activityText(start(), o(100))).toBe('✻ Contemplando… (13s · Esc para interromper)');
  });
});
