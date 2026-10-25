import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { Text } from 'ink';
import {
  classifyMouse,
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
  // two lines: the FrameRecorder treats single-line chunks as control output, not frames
  return createElement(Text, null, 'probe\nsecond');
}

describe('contract: terminal I/O (contracts/terminal-io.md)', () => {
  it('parses SGR mouse reports and maps wheel buttons', () => {
    expect(parseSgrMouse('\x1b[<64;10;5M')).toEqual([
      { button: 64, x: 10, y: 5, release: false, kind: 'wheel' },
    ]);
    expect(parseSgrMouse('\x1b[<65;1;1M\x1b[<0;3;4m')).toEqual([
      { button: 65, x: 1, y: 1, release: false, kind: 'wheel' },
      { button: 0, x: 3, y: 4, release: true, kind: 'release' },
    ]);
    // press / drag / release of the left button; other buttons and modifiers are ignored (specs/007)
    expect(classifyMouse({ button: 0, release: false })).toBe('press');
    expect(classifyMouse({ button: 32, release: false })).toBe('drag');
    expect(classifyMouse({ button: 0, release: true })).toBe('release');
    expect(classifyMouse({ button: 2, release: false })).toBe('other'); // right button
    expect(classifyMouse({ button: 4, release: false })).toBe('other'); // shift+click
    expect(classifyMouse({ button: 35, release: false })).toBe('other'); // motion without a button
    expect(parseSgrMouse('plain text')).toEqual([]);
    expect(wheelDirection({ button: 64, release: false })).toBe(-1);
    expect(wheelDirection({ button: 65, release: false })).toBe(1);
    expect(wheelDirection({ button: 0, release: false })).toBe(0);
    expect(wheelDirection({ button: 64, release: true })).toBe(0);
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

  it('every write reaches the real stream through the FrameRecorder and the last frame is kept (specs/007 § 6)', async () => {
    const ui = renderSized(createElement(Probe, { enabled: true, onWheel: () => {} }), {
      columns: 60,
      rows: 10,
    });
    await tick();
    // the real stdout saw both the frame and the mouse enable sequence (written by the effect after it)
    expect(ui.writes()).toContain(MOUSE_ENABLE);
    expect(ui.stdout.writes.some((w) => w.includes('probe'))).toBe(true);
    expect(ui.frame.lines()).toEqual(ui.frameLines());
    expect(ui.frame.lines()[0]).toBe('probe');
    expect(ui.frame.stream.columns).toBe(60);
    expect(ui.frame.stream.rows).toBe(10);
    expect(ui.frame.stream.isTTY).toBe(true);
  });

  it(
    'with the session mouse off no tracking sequence is written; /mouse on and off toggle it (specs/007 § 5)',
    { timeout: 30_000 },
    async () => {
      const { mountApp } = await import('../helpers/appHarness.js');
      const { waitForFrame } = await import('../helpers/renderSized.js');
      const ui = mountApp({ columns: 100, rows: 30, settings: { ui: { mouse: false } } });
      await waitForFrame(ui, 'Type a message');
      expect(ui.writes()).not.toContain('\x1b[?1002');
      expect(ui.frameText()).toContain('mouse desligado');
      ui.stdin.write('/mouse on');
      await tick();
      ui.stdin.write('\r');
      await waitForFrame(ui, 'Mouse ligado');
      expect(ui.writes()).toContain(MOUSE_ENABLE);
      expect(ui.writes()).not.toContain(MOUSE_DISABLE);
      expect(ui.frameText()).not.toContain('mouse desligado');
      ui.stdin.write('/mouse off');
      await tick();
      ui.stdin.write('\r');
      await waitForFrame(ui, 'Mouse desligado:');
      expect(ui.writes()).toContain(MOUSE_DISABLE);
      expect(ui.frameText()).toContain('mouse desligado');
    },
  );
});
