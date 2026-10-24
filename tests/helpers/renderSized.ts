import { EventEmitter } from 'node:events';
import type { ReactElement } from 'react';
import { render as inkRender } from 'ink';
import type { RenderOptions } from 'ink';

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

/** Like ink-testing-library's render, but with a sized stdout and access to raw writes. */
export function renderSized(tree: ReactElement, opts: RenderSizedOptions = {}) {
  const stdout = new SizedStdout(opts.columns ?? 80, opts.rows ?? 24);
  const stderr = new SizedStdout(opts.columns ?? 80, opts.rows ?? 24);
  const stdin = new FakeStdin();
  const instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
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
    rerender: instance.rerender,
    unmount: instance.unmount,
    lastFrame: stdout.lastFrame,
    /** Number of lines in the last frame (ignoring one trailing newline). */
    frameHeight: () => (stdout.lastFrame() ?? '').replace(/\n$/, '').split('\n').length,
    frameLines: () => (stdout.lastFrame() ?? '').replace(/\n$/, '').split('\n'),
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
