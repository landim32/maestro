import { EventEmitter } from 'node:events';
import type { ReactElement } from 'react';
import { render as inkRender } from 'ink';
import type { RenderOptions } from 'ink';
import { FrameRecorder } from '../../src/ui/frameRecorder.js';

/** Fake stdout with a controllable size; emits `resize` like a real TTY. */
export class SizedStdout extends EventEmitter {
  columns: number;
  rows: number;
  isTTY = true;
  frames: string[] = [];
  /** Everything written, including escape sequences (for contract tests). */
  writes: string[] = [];
  private last: string | undefined;

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write = (chunk: string): boolean => {
    this.writes.push(chunk);
    this.frames.push(chunk);
    // Control-only chunks (mouse / bracketed-paste toggles, OSC 52) are not frames.
    if (
      chunk.includes('\n') ||
      chunk.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '') !== ''
    )
      this.last = chunk;
    return true;
  };

  lastFrame = (): string | undefined => this.last;

  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write = (data: string) => {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  };
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read = () => {
    const d = this.data;
    this.data = null;
    return d;
  };
}

export interface RenderSizedOptions {
  columns?: number;
  rows?: number;
  /** Extra Ink render options (e.g. alternateScreen). */
  ink?: Partial<RenderOptions>;
}

const instances: Array<{ unmount: () => void; cleanup: () => void }> = [];

/**
 * Like ink-testing-library's render, but with a sized stdout and access to raw writes.
 * Ink writes through a FrameRecorder (as in production), so every test also exercises its
 * pass-through; `tree` may be a function receiving the recorder (the App takes it as a prop).
 */
export function renderSized(
  tree: ReactElement | ((frame: FrameRecorder) => ReactElement),
  opts: RenderSizedOptions = {},
) {
  const stdout = new SizedStdout(opts.columns ?? 80, opts.rows ?? 24);
  const stderr = new SizedStdout(opts.columns ?? 80, opts.rows ?? 24);
  const stdin = new FakeStdin();
  const frame = new FrameRecorder(stdout as unknown as NodeJS.WriteStream);
  const instance = inkRender(typeof tree === 'function' ? tree(frame) : tree, {
    stdout: frame.stream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
    ...opts.ink,
  });
  instances.push(instance);
  return {
    stdout,
    stderr,
    stdin,
    frame,
    rerender: instance.rerender,
    unmount: instance.unmount,
    /** Rejects when a React render error unmounted the tree (useful while debugging). */
    waitUntilExit: () => instance.waitUntilExit(),
    lastFrame: stdout.lastFrame,
    /** Number of lines in the last frame (ignoring one trailing newline). */
    frameHeight: () => (stdout.lastFrame() ?? '').replace(/\n$/, '').split('\n').length,
    frameLines: () => (stdout.lastFrame() ?? '').replace(/\n$/, '').split('\n'),
    /** Last frame without escape sequences (specs/007 tests compare visible text). */
    frameText: () => (stdout.lastFrame() ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''),
    writes: () => stdout.writes.join(''),
    resize: (columns: number, rows: number) => stdout.resize(columns, rows),
  };
}

export function cleanupSized(): void {
  for (const i of instances) {
    i.unmount();
    i.cleanup();
  }
  instances.length = 0;
}

export const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** Polls `predicate` every 20 ms until it returns true (or the timeout elapses → throws). */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
  label = 'condition',
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - started > timeoutMs)
      throw new Error(`waitFor: ${label} not met within ${timeoutMs} ms`);
    await tick(20);
  }
}

/** Waits until the last frame contains `text`. */
export function waitForFrame(
  ui: { lastFrame: () => string | undefined },
  text: string,
  timeoutMs = 3000,
) {
  return waitFor(
    () => (ui.lastFrame() ?? '').includes(text),
    timeoutMs,
    `frame contains ${JSON.stringify(text)}`,
  );
}
