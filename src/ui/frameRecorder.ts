/**
 * Captures the last frame Ink wrote to stdout so the mouse selection can copy exactly what is
 * on the screen (specs/007 research R5, data-model.md § 6). The recorder is a transparent
 * proxy: every `write` reaches the real stream unchanged and in order.
 */
import type { SgrMouseEvent } from './hooks/useMouseWheel.js';
import type { Point } from './selection.js';

// CSI (ESC [ … final), OSC (ESC ] … BEL|ST), and two-byte ESC sequences.
const ANSI_RE =
  /\x1b\[[0-9;?<>=!]*[A-Za-z@`~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[A-Za-z=>]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export interface MouseGeometry {
  /** Screen row (0-based) of the first transcript line. */
  transcriptTop: number;
  /** Screen column (0-based) of the first transcript cell. */
  transcriptLeft: number;
  /** First visible content line. */
  viewportOffset: number;
  viewportHeight: number;
  /** Width of the transcript column (excludes the scroll indicator). */
  width: number;
}

export type FrameListener = (lines: string[]) => void;

/** Wraps a write stream; `stream` is what gets handed to Ink. */
export class FrameRecorder {
  readonly stream: NodeJS.WriteStream;
  private last = '';
  private readonly listeners = new Set<FrameListener>();

  constructor(private readonly real: NodeJS.WriteStream) {
    const write = (chunk: string | Uint8Array, ...rest: unknown[]) => this.write(chunk, ...rest);
    this.stream = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === 'write') return write;
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  /** Repasses the chunk untouched; keeps it when it looks like a whole frame (≥ 2 lines). */
  readonly write = (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    const result = (this.real.write as (...a: unknown[]) => boolean)(chunk, ...rest);
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (text.includes('\n')) {
      const stripped = stripAnsi(text);
      if (stripped.split('\n').length >= 2) {
        this.last = stripped;
        if (this.listeners.size > 0) {
          const lines = this.lines();
          for (const l of this.listeners) l(lines);
        }
      }
    }
    return result;
  };

  /** Last frame without escape sequences, one entry per screen row. */
  lines(): string[] {
    if (this.last === '') return [];
    return this.last.replace(/\n$/, '').split('\n');
  }

  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** Text of content lines, filled from the rows of each frame that fall inside the transcript. */
export class ContentLineCache {
  private readonly map = new Map<number, string>();

  update(frameLines: readonly string[], g: MouseGeometry): void {
    for (let i = 0; i < g.viewportHeight; i++) {
      const row = frameLines[g.transcriptTop + i];
      if (row === undefined) break;
      const cells = Array.from(row).slice(g.transcriptLeft, g.transcriptLeft + g.width);
      this.map.set(g.viewportOffset + i, cells.join('').trimEnd());
    }
  }

  get(line: number): string | undefined {
    return this.map.get(line);
  }

  clear(): void {
    this.map.clear();
  }
}

/** Screen cell of an SGR report (1-based) → content point; undefined outside the transcript. */
export function screenToContent(
  ev: Pick<SgrMouseEvent, 'x' | 'y'>,
  g: MouseGeometry,
): Point | undefined {
  const row = ev.y - 1 - g.transcriptTop;
  const col = ev.x - 1 - g.transcriptLeft;
  if (row < 0 || row >= g.viewportHeight || col < 0 || g.width <= 0) return undefined;
  return { line: g.viewportOffset + row, col: Math.min(col, g.width - 1) };
}

/** Like `screenToContent` but clamps a drag that leaves the rectangle to its nearest edge. */
export function clampToContent(ev: Pick<SgrMouseEvent, 'x' | 'y'>, g: MouseGeometry): Point {
  const row = Math.min(Math.max(ev.y - 1 - g.transcriptTop, 0), Math.max(0, g.viewportHeight - 1));
  const col = Math.min(Math.max(ev.x - 1 - g.transcriptLeft, 0), Math.max(0, g.width - 1));
  return { line: g.viewportOffset + row, col };
}
