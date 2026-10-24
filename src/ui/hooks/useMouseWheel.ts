import { useEffect } from 'react';
import { useStdin, useStdout } from 'ink';

export const MOUSE_ENABLE = '\x1b[?1002h\x1b[?1006h';
export const MOUSE_DISABLE = '\x1b[?1002l\x1b[?1006l';

export interface SgrMouseEvent {
  button: number;
  x: number;
  y: number;
  release: boolean;
}

const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

/** Parses every SGR mouse report in `chunk` (contracts/terminal-io.md § 2). */
export function parseSgrMouse(chunk: string): SgrMouseEvent[] {
  const out: SgrMouseEvent[] = [];
  for (const m of chunk.matchAll(SGR_RE)) {
    out.push({ button: Number(m[1]), x: Number(m[2]), y: Number(m[3]), release: m[4] === 'm' });
  }
  return out;
}

/** -1 for wheel up, +1 for wheel down, 0 otherwise. */
export function wheelDirection(ev: SgrMouseEvent): -1 | 0 | 1 {
  if (ev.release) return 0;
  if (ev.button === 64) return -1;
  if (ev.button === 65) return 1;
  return 0;
}

/** True when the chunk looks like a mouse report (so text inputs can ignore it). */
export function isMouseSequence(input: string): boolean {
  return input.includes('\x1b[<');
}

export interface UseMouseWheelOptions {
  enabled: boolean;
  /** Called with the number of lines to scroll (negative = up). */
  onWheel: (lines: number) => void;
  linesPerNotch?: number;
}

/** Enables SGR mouse tracking while mounted and turns wheel events into scroll deltas. */
export function useMouseWheel({ enabled, onWheel, linesPerNotch = 3 }: UseMouseWheelOptions): void {
  const { stdout } = useStdout();
  const { stdin } = useStdin();

  useEffect(() => {
    if (!enabled) return;
    const out = stdout as { write?: (s: string) => unknown; isTTY?: boolean };
    if (!out.isTTY || typeof out.write !== 'function') return;

    out.write(MOUSE_ENABLE);
    const onData = (data: Buffer | string) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      let delta = 0;
      for (const ev of parseSgrMouse(text)) delta += wheelDirection(ev) * linesPerNotch;
      if (delta !== 0) onWheel(delta);
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
      out.write?.(MOUSE_DISABLE);
    };
  }, [enabled, stdout, stdin, onWheel, linesPerNotch]);
}
