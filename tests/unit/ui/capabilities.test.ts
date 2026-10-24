import { describe, expect, it } from 'vitest';
import { computeCapabilities } from '../../../src/ui/hooks/useTerminalCapabilities.js';

const ui = { altScreen: true, mouse: true, color: undefined };
const base = { columns: 120, rows: 40, isTTY: true, ui, env: {} as NodeJS.ProcessEnv };

describe('computeCapabilities', () => {
  it('normal terminal: everything on, not compact, not too small', () => {
    expect(computeCapabilities(base)).toEqual({
      columns: 120,
      rows: 40,
      color: true,
      altScreen: true,
      mouse: true,
      compact: false,
      tooSmall: false,
    });
  });

  it.each([
    [{ columns: 99, rows: 40 }, true, false],
    [{ columns: 120, rows: 19 }, true, false],
    [{ columns: 39, rows: 40 }, true, true],
    [{ columns: 120, rows: 11 }, true, true],
    [{ columns: 100, rows: 20 }, false, false],
    [{ columns: 40, rows: 12 }, true, false],
  ])('size %o → compact=%s tooSmall=%s', (size, compact, tooSmall) => {
    const c = computeCapabilities({ ...base, ...size });
    expect(c.compact).toBe(compact);
    expect(c.tooSmall).toBe(tooSmall);
  });

  it('altScreen precedence: flag > env > settings, and never without a TTY', () => {
    expect(computeCapabilities({ ...base, flags: { altScreen: false } }).altScreen).toBe(false);
    expect(computeCapabilities({ ...base, env: { MAESTRO_NO_ALTSCREEN: '1' } }).altScreen).toBe(
      false,
    );
    expect(computeCapabilities({ ...base, env: { MAESTRO_NO_ALTSCREEN: '' } }).altScreen).toBe(
      true,
    );
    expect(computeCapabilities({ ...base, ui: { ...ui, altScreen: false } }).altScreen).toBe(false);
    expect(computeCapabilities({ ...base, isTTY: false }).altScreen).toBe(false);
  });

  it('mouse follows settings and TTY', () => {
    expect(computeCapabilities({ ...base, ui: { ...ui, mouse: false } }).mouse).toBe(false);
    expect(computeCapabilities({ ...base, isTTY: false }).mouse).toBe(false);
  });

  it('color follows NO_COLOR, --no-color, ui.color and TTY', () => {
    expect(computeCapabilities({ ...base, env: { NO_COLOR: '1' } }).color).toBe(false);
    expect(computeCapabilities({ ...base, flags: { color: false } }).color).toBe(false);
    expect(computeCapabilities({ ...base, ui: { ...ui, color: false } }).color).toBe(false);
    expect(computeCapabilities({ ...base, isTTY: false }).color).toBe(false);
  });

  it('guards against zero/undefined sizes', () => {
    const c = computeCapabilities({ ...base, columns: 0, rows: 0 });
    expect(c.columns).toBe(80);
    expect(c.rows).toBe(24);
  });
});
