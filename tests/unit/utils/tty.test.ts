import { describe, expect, it } from 'vitest';
import { colorEnabled, isInteractive } from '../../../src/utils/tty.js';

describe('isInteractive', () => {
  it('requires both stdin and stdout to be TTYs', () => {
    expect(isInteractive({ stdout: { isTTY: true }, stdin: { isTTY: true } })).toBe(true);
    expect(isInteractive({ stdout: { isTTY: true }, stdin: { isTTY: false } })).toBe(false);
    expect(isInteractive({ stdout: { isTTY: undefined }, stdin: { isTTY: true } })).toBe(false);
  });
});

describe('colorEnabled', () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };
  it('is on for a TTY without NO_COLOR', () => {
    expect(colorEnabled({ env: {}, stdout: tty })).toBe(true);
  });
  it('is off without a TTY', () => {
    expect(colorEnabled({ env: {}, stdout: pipe })).toBe(false);
  });
  it('honours NO_COLOR and --no-color', () => {
    expect(colorEnabled({ env: { NO_COLOR: '1' }, stdout: tty })).toBe(false);
    expect(colorEnabled({ env: { NO_COLOR: '' }, stdout: tty })).toBe(true); // empty means unset per spec
    expect(colorEnabled({ noColorFlag: true, env: {}, stdout: tty })).toBe(false);
  });
  it('FORCE_COLOR turns color on even without a TTY, unless 0', () => {
    expect(colorEnabled({ env: { FORCE_COLOR: '1' }, stdout: pipe })).toBe(true);
    expect(colorEnabled({ env: { FORCE_COLOR: '0' }, stdout: pipe })).toBe(false);
  });
});
