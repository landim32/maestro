import { describe, expect, it } from 'vitest';
import {
  extractText,
  idleSelection,
  isSelected,
  selectedRange,
  selectedSpan,
  selectionReducer,
} from '../../../src/ui/selection.js';
import type { SelectionState } from '../../../src/ui/selection.js';

const LINES: Record<number, string> = {
  0: 'first line here',
  1: '  second line',
  2: 'third',
  4: 'fifth after a gap',
};
const ctx = { lineText: (l: number) => LINES[l] };
const at = (line: number, col: number) => ({ line, col });

function run(
  events: Parameters<typeof selectionReducer>[1][],
  start: SelectionState = idleSelection,
) {
  return events.reduce((s, e) => selectionReducer(s, e, ctx), start);
}

describe('selectionReducer (contracts/mouse-selection.md § 2–3)', () => {
  it('press → drag → release on one line selects the cells between (inclusive)', () => {
    const s = run([
      { type: 'press', at: at(0, 6), time: 0 },
      { type: 'drag', at: at(0, 9) },
      { type: 'release', at: at(0, 9) },
    ]);
    expect(s.phase).toBe('done');
    if (s.phase !== 'done') return;
    expect(s.text).toBe('line');
    expect(s.lines).toBe(1);
    expect(isSelected(s, 0, 6)).toBe(true);
    expect(isSelected(s, 0, 9)).toBe(true);
    expect(isSelected(s, 0, 10)).toBe(false);
    expect(isSelected(s, 1, 7)).toBe(false);
  });

  it('a drag over several lines (upwards too) is normalized: whole lines in the middle', () => {
    const down = run([
      { type: 'press', at: at(0, 6), time: 0 },
      { type: 'drag', at: at(2, 2) },
      { type: 'release', at: at(2, 2) },
    ]);
    const up = run([
      { type: 'press', at: at(2, 2), time: 0 },
      { type: 'drag', at: at(0, 6) },
      { type: 'release', at: at(0, 6) },
    ]);
    for (const s of [down, up]) {
      expect(s.phase).toBe('done');
      if (s.phase !== 'done') return;
      expect(selectedRange(s)).toEqual({ start: at(0, 6), end: at(2, 2) });
      expect(s.text).toBe('line here\n  second line\nthi');
      expect(s.lines).toBe(3);
      expect(selectedSpan(s, 1)).toEqual({ from: 0, to: Number.MAX_SAFE_INTEGER });
    }
  });

  it('a click without movement selects nothing', () => {
    const s = run([
      { type: 'press', at: at(0, 3), time: 0 },
      { type: 'release', at: at(0, 3) },
    ]);
    expect(s.phase).toBe('idle');
    expect(selectedRange(s)).toBeUndefined();
  });

  it('double click selects the word, triple click the line (same cell within 400 ms)', () => {
    const dbl = run([
      { type: 'press', at: at(0, 7), time: 0 },
      { type: 'release', at: at(0, 7) },
      { type: 'press', at: at(0, 7), time: 300 },
      { type: 'release', at: at(0, 7) },
    ]);
    expect(dbl.phase).toBe('done');
    if (dbl.phase === 'done') expect(dbl.text).toBe('line');
    const triple = run(
      [
        { type: 'press', at: at(0, 7), time: 600 },
        { type: 'release', at: at(0, 7) },
      ],
      dbl,
    );
    expect(triple.phase).toBe('done');
    if (triple.phase === 'done') {
      expect(triple.mode).toBe('line');
      expect(triple.text).toBe('first line here');
    }
    // too slow → plain click again
    const slow = run(
      [
        { type: 'press', at: at(0, 7), time: 5000 },
        { type: 'release', at: at(0, 7) },
      ],
      triple,
    );
    expect(slow.phase).toBe('idle');
  });

  it('clear returns to idle and drag/release without a press are ignored', () => {
    const s = run([
      { type: 'press', at: at(0, 0), time: 0 },
      { type: 'drag', at: at(0, 4) },
    ]);
    expect(s.phase).toBe('dragging');
    expect(selectionReducer(s, { type: 'clear' }, ctx)).toEqual(idleSelection);
    expect(run([{ type: 'drag', at: at(0, 1) }])).toEqual(idleSelection);
    expect(run([{ type: 'release', at: at(0, 1) }])).toEqual(idleSelection);
  });
});

describe('extractText', () => {
  it('copies lines missing from the cache as empty and trims trailing padding', () => {
    const r = extractText({ start: at(2, 0), end: at(4, 4) }, (l) =>
      LINES[l] ? `${LINES[l]}    ` : undefined,
    );
    expect(r).toEqual({ text: 'third\n\nfifth', lines: 3 });
  });

  it('cuts the ends by column with an inclusive end', () => {
    expect(extractText({ start: at(0, 0), end: at(0, 4) }, ctx.lineText).text).toBe('first');
    expect(extractText({ start: at(0, 12), end: at(0, 99) }, ctx.lineText).text).toBe('ere');
  });
});
