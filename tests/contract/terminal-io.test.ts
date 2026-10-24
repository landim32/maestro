import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { Text } from 'ink';
import {
  isMouseSequence,
  MOUSE_DISABLE,
  MOUSE_ENABLE,
  parseSgrMouse,
  useMouseWheel,
  wheelDirection,
} from '../../src/ui/hooks/useMouseWheel.js';
import { computeCapabilities } from '../../src/ui/hooks/useTerminalCapabilities.js';
import { cleanupSized, renderSized, tick } from '../helpers/renderSized.js';

afterEach(() => cleanupSized());

function Probe({ enabled, onWheel }: { enabled: boolean; onWheel: (n: number) => void }) {
  useMouseWheel({ enabled, onWheel });
  return createElement(Text, null, 'probe');
}

describe('contract: terminal I/O (contracts/terminal-io.md)', () => {
  it('parses SGR mouse reports and maps wheel buttons', () => {
    expect(parseSgrMouse('\x1b[<64;10;5M')).toEqual([{ button: 64, x: 10, y: 5, release: false }]);
    expect(parseSgrMouse('\x1b[<65;1;1M\x1b[<0;3;4m')).toEqual([
      { button: 65, x: 1, y: 1, release: false },
      { button: 0, x: 3, y: 4, release: true },
    ]);
    expect(parseSgrMouse('plain text')).toEqual([]);
    expect(wheelDirection({ button: 64, x: 0, y: 0, release: false })).toBe(-1);
    expect(wheelDirection({ button: 65, x: 0, y: 0, release: false })).toBe(1);
    expect(wheelDirection({ button: 0, x: 0, y: 0, release: false })).toBe(0);
    expect(wheelDirection({ button: 64, x: 0, y: 0, release: true })).toBe(0);
    expect(isMouseSequence('\x1b[<64;10;5M')).toBe(true);
    expect(isMouseSequence('hello')).toBe(false);
  });

  it('writes the enable sequence on mount and the disable sequence on unmount when enabled', async () => {
    const onWheel = vi.fn();
    const ui = renderSized(createElement(Probe, { enabled: true, onWheel }), {
      columns: 80,
      rows: 24,
    });
    await tick();
    expect(ui.writes()).toContain(MOUSE_ENABLE);
    expect(ui.writes()).not.toContain(MOUSE_DISABLE);
    ui.stdin.write('\x1b[<64;10;5M');
    ui.stdin.write('\x1b[<65;10;5M\x1b[<65;10;5M');
    ui.stdin.write('\x1b[<0;10;5M');
    await tick();
    expect(onWheel.mock.calls.map((c) => c[0])).toEqual([-3, 6]);
    ui.unmount();
    await tick();
    expect(ui.writes()).toContain(MOUSE_DISABLE);
  });

  it('writes nothing when disabled', async () => {
    const ui = renderSized(createElement(Probe, { enabled: false, onWheel: () => {} }), {
      columns: 80,
      rows: 24,
    });
    await tick();
    ui.unmount();
    await tick();
    expect(ui.writes()).not.toContain('\x1b[?1002');
  });

  it('alt screen precedence: flag > env > settings; never in non-interactive mode', () => {
    const base = {
      columns: 100,
      rows: 30,
      isTTY: true,
      ui: { altScreen: true, mouse: true },
      env: {},
    };
    expect(computeCapabilities(base).altScreen).toBe(true);
    expect(computeCapabilities({ ...base, flags: { altScreen: false } }).altScreen).toBe(false);
    expect(computeCapabilities({ ...base, env: { MAESTRO_NO_ALTSCREEN: '1' } }).altScreen).toBe(
      false,
    );
    expect(computeCapabilities({ ...base, ui: { altScreen: false, mouse: true } }).altScreen).toBe(
      false,
    );
    expect(computeCapabilities({ ...base, isTTY: false }).altScreen).toBe(false);
  });
});
