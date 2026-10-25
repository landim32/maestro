/**
 * Mouse selection over the transcript, as a pure reducer (specs/007 data-model.md § 5).
 * Coordinates are CONTENT coordinates (line = index into the scrollable content,
 * col = cell from the left edge of the transcript), so the selection survives scrolling.
 */

export interface Point {
  line: number;
  col: number;
}

export type SelectionMode = 'char' | 'word' | 'line';

export interface Range {
  /** First selected cell. */
  start: Point;
  /** Last selected cell (inclusive). */
  end: Point;
}

interface Click {
  at: Point;
  time: number;
  count: number;
}

export type SelectionState =
  | { phase: 'idle'; lastClick?: Click }
  | {
      phase: 'dragging';
      anchor: Point;
      head: Point;
      mode: SelectionMode;
      range: Range;
      lastClick: Click;
    }
  | {
      phase: 'done';
      anchor: Point;
      head: Point;
      mode: SelectionMode;
      range: Range;
      text: string;
      lines: number;
      lastClick: Click;
    };

export type SelectionEvent =
  | { type: 'press'; at: Point; time: number }
  | { type: 'drag'; at: Point }
  | { type: 'release'; at: Point }
  | { type: 'clear' };

export interface SelectionContext {
  /** Visible text of a content line (undefined when it was never displayed). */
  lineText: (line: number) => string | undefined;
}

/** Two presses on the same cell within this window count as a double (then triple) click. */
export const MULTI_CLICK_MS = 400;
const END_OF_LINE = Number.MAX_SAFE_INTEGER;

export const idleSelection: SelectionState = { phase: 'idle' };

const before = (a: Point, b: Point) => a.line < b.line || (a.line === b.line && a.col < b.col);
const samePoint = (a: Point, b: Point) => a.line === b.line && a.col === b.col;

function wordBounds(text: string, col: number): { start: number; end: number } | undefined {
  const chars = Array.from(text);
  if (col >= chars.length || /\s/.test(chars[col] ?? ' ')) return undefined;
  let s = col;
  let e = col;
  while (s > 0 && !/\s/.test(chars[s - 1]!)) s--;
  while (e + 1 < chars.length && !/\s/.test(chars[e + 1]!)) e++;
  return { start: s, end: e };
}

/** Normalized range (start ≤ end), expanded to word or line bounds in those modes. */
export function computeRange(
  anchor: Point,
  head: Point,
  mode: SelectionMode,
  lineText: SelectionContext['lineText'],
): Range {
  let start = before(head, anchor) ? head : anchor;
  let end = before(head, anchor) ? anchor : head;
  if (mode === 'line') {
    start = { line: start.line, col: 0 };
    end = { line: end.line, col: END_OF_LINE };
  } else if (mode === 'word') {
    const ws = wordBounds(lineText(start.line) ?? '', start.col);
    const we = wordBounds(lineText(end.line) ?? '', end.col);
    start = { line: start.line, col: ws ? ws.start : start.col };
    end = { line: end.line, col: we ? we.end : end.col };
  }
  return { start, end };
}

/** Normalized range of a non-idle selection. */
export function selectedRange(sel: SelectionState): Range | undefined {
  return sel.phase === 'idle' ? undefined : sel.range;
}

/**
 * Text covered by `range`: the ends cut by column (inclusive end), whole lines in between,
 * trailing padding removed. Lines never displayed are copied empty.
 */
export function extractText(
  range: Range,
  lineText: SelectionContext['lineText'],
): { text: string; lines: number } {
  const out: string[] = [];
  for (let line = range.start.line; line <= range.end.line; line++) {
    const chars = Array.from(lineText(line) ?? '');
    const from = line === range.start.line ? range.start.col : 0;
    const to = line === range.end.line ? Math.min(range.end.col + 1, chars.length) : chars.length;
    out.push(chars.slice(from, to).join('').trimEnd());
  }
  return { text: out.join('\n'), lines: out.length };
}

/** True when the cell (line, col) is inside the selection (for the overlay). */
export function isSelected(sel: SelectionState, line: number, col: number): boolean {
  const r = selectedRange(sel);
  if (!r) return false;
  if (line < r.start.line || line > r.end.line) return false;
  if (line === r.start.line && col < r.start.col) return false;
  if (line === r.end.line && col > r.end.col) return false;
  return true;
}

/** Selected column span `[from, to]` (inclusive) on a content line, if any. */
export function selectedSpan(
  sel: SelectionState,
  line: number,
): { from: number; to: number } | undefined {
  const r = selectedRange(sel);
  if (!r || line < r.start.line || line > r.end.line) return undefined;
  return {
    from: line === r.start.line ? r.start.col : 0,
    to: line === r.end.line ? r.end.col : END_OF_LINE,
  };
}

export function selectionReducer(
  state: SelectionState,
  event: SelectionEvent,
  ctx: SelectionContext,
): SelectionState {
  switch (event.type) {
    case 'press': {
      const last = state.lastClick;
      const count =
        last && samePoint(last.at, event.at) && event.time - last.time <= MULTI_CLICK_MS
          ? last.count + 1
          : 1;
      const mode: SelectionMode = count === 1 ? 'char' : count === 2 ? 'word' : 'line';
      const lastClick = { at: event.at, time: event.time, count };
      return {
        phase: 'dragging',
        anchor: event.at,
        head: event.at,
        mode,
        range: computeRange(event.at, event.at, mode, ctx.lineText),
        lastClick,
      };
    }
    case 'drag': {
      if (state.phase !== 'dragging') return state;
      return {
        ...state,
        head: event.at,
        range: computeRange(state.anchor, event.at, state.mode, ctx.lineText),
      };
    }
    case 'release': {
      if (state.phase !== 'dragging') return state;
      const head = event.at;
      if (state.mode === 'char' && samePoint(state.anchor, head)) {
        return { phase: 'idle', lastClick: state.lastClick };
      }
      const range = computeRange(state.anchor, head, state.mode, ctx.lineText);
      const { text, lines } = extractText(range, ctx.lineText);
      if (text.trim() === '') return { phase: 'idle', lastClick: state.lastClick };
      return {
        phase: 'done',
        anchor: state.anchor,
        head,
        mode: state.mode,
        range,
        text,
        lines,
        lastClick: state.lastClick,
      };
    }
    case 'clear':
      return idleSelection;
    default:
      return state;
  }
}
