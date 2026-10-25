import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  ContentLineCache,
  FrameRecorder,
  clampToContent,
  screenToContent,
  stripAnsi,
} from '../../../src/ui/frameRecorder.js';
import type { MouseGeometry } from '../../../src/ui/frameRecorder.js';

class FakeTty extends EventEmitter {
  columns = 80;
  rows = 24;
  isTTY = true;
  chunks: unknown[] = [];
  write = vi.fn((chunk: unknown) => {
    this.chunks.push(chunk);
    return true;
  });
}

const geometry: MouseGeometry = {
  transcriptTop: 1,
  transcriptLeft: 0,
  viewportOffset: 10,
  viewportHeight: 3,
  width: 20,
};

describe('FrameRecorder (contracts/mouse-selection.md § 6)', () => {
  it('passes every write to the real stream unchanged and in order; exposes size, TTY and resize', () => {
    const real = new FakeTty();
    const rec = new FrameRecorder(real as unknown as NodeJS.WriteStream);
    const s = rec.stream;
    s.write('\x1b[?1049h');
    s.write('line a\nline b\n');
    s.write(Buffer.from('bytes'));
    expect(real.chunks).toEqual(['\x1b[?1049h', 'line a\nline b\n', Buffer.from('bytes')]);
    expect(s.columns).toBe(80);
    expect(s.rows).toBe(24);
    expect(s.isTTY).toBe(true);
    const onResize = vi.fn();
    s.on('resize', onResize);
    real.emit('resize');
    expect(onResize).toHaveBeenCalledTimes(1);
    s.off('resize', onResize);
    real.emit('resize');
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('keeps the last multi-line chunk as the frame, without escape sequences', () => {
    const real = new FakeTty();
    const rec = new FrameRecorder(real as unknown as NodeJS.WriteStream);
    const frames: string[][] = [];
    rec.onFrame((lines) => frames.push(lines));
    rec.stream.write('\x1b[?1002h'); // not a frame
    rec.stream.write('\x1b[H\x1b[J\x1b[36mhead\x1b[39m\nrow 1\n\x1b[7mrow 2\x1b[27m\n');
    rec.stream.write('\x1b]52;c;QUJD\x07'); // OSC, not a frame
    expect(rec.lines()).toEqual(['head', 'row 1', 'row 2']);
    expect(frames).toEqual([['head', 'row 1', 'row 2']]);
    expect(stripAnsi('\x1b[1;2A\x1b[?25lx\x1b[0my')).toBe('xy');
  });
});

describe('ContentLineCache and coordinates', () => {
  it('maps transcript rows to content lines with the viewport offset', () => {
    const cache = new ContentLineCache();
    cache.update(['header', 'c10 text   ', 'c11', 'c12', 'prompt'], geometry);
    expect(cache.get(10)).toBe('c10 text');
    expect(cache.get(12)).toBe('c12');
    expect(cache.get(13)).toBeUndefined();
    cache.update(['header', 'c11', 'c12', 'c13'], { ...geometry, viewportOffset: 11 });
    expect(cache.get(10)).toBe('c10 text'); // older lines are kept
    expect(cache.get(13)).toBe('c13');
    cache.update(['header', 'x'.repeat(40)], { ...geometry, viewportHeight: 1, transcriptLeft: 2 });
    expect(cache.get(10)).toBe('x'.repeat(20)); // cut at the transcript width
  });

  it('screenToContent returns undefined outside the transcript rectangle; clampToContent clamps', () => {
    expect(screenToContent({ x: 1, y: 2 }, geometry)).toEqual({ line: 10, col: 0 });
    expect(screenToContent({ x: 5, y: 4 }, geometry)).toEqual({ line: 12, col: 4 });
    expect(screenToContent({ x: 5, y: 1 }, geometry)).toBeUndefined(); // header row
    expect(screenToContent({ x: 5, y: 5 }, geometry)).toBeUndefined(); // prompt row
    expect(screenToContent({ x: 25, y: 2 }, geometry)).toEqual({ line: 10, col: 19 });
    expect(clampToContent({ x: 50, y: 9 }, geometry)).toEqual({ line: 12, col: 19 });
    expect(clampToContent({ x: 0, y: 0 }, geometry)).toEqual({ line: 10, col: 0 });
  });
});
