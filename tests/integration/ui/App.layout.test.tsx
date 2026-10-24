import { afterEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, linesProvider, mountApp } from '../../helpers/appHarness.js';

afterEach(() => cleanupSized());

describe('App layout (US1): the frame never exceeds the terminal height', () => {
  it.each([
    [80, 24],
    [120, 40],
  ])(
    '%dx%d: initial, after typing, after a long answer and after resize',
    async (columns, rows) => {
      const ui = mountApp({ columns, rows, provider: linesProvider(300) });
      await waitForFrame(ui, 'Type a message');
      expect(ui.frameHeight()).toBeLessThanOrEqual(rows);
      const before = ui.frameHeight();

      ui.stdin.write('x'.repeat(50));
      await waitForFrame(ui, 'x'.repeat(20));
      expect(ui.frameHeight()).toBe(before);

      ui.stdin.write('y'.repeat(150));
      await waitForFrame(ui, 'y'.repeat(20));
      expect(ui.frameHeight()).toBeLessThanOrEqual(rows);

      ui.stdin.write(KEYS.enter);
      await waitForFrame(ui, 'L0300');
      expect(ui.frameHeight()).toBeLessThanOrEqual(rows);
      // follows the end of the long answer; header, prompt and status still visible
      expect(ui.lastFrame()).not.toContain('L0001 ');
      expect(ui.frameLines()[0]).toContain('maestro');
      expect(ui.lastFrame()).toContain('ready');

      const newRows = Math.max(12, rows - 8);
      ui.resize(Math.max(40, columns - 30), newRows);
      await waitFor(
        () => ui.frameHeight() <= newRows && (ui.lastFrame() ?? '').includes('L0300'),
        3000,
        'reflow',
      );
      expect(ui.lastFrame()).toContain('ready');
    },
  );

  it('shows the header with provider/model/cwd on one line', async () => {
    const ui = mountApp({ columns: 100, rows: 30 });
    await waitForFrame(ui, 'maestro');
    const header = ui.frameLines()[0] ?? '';
    expect(header).toContain('maestro');
    expect(header).toContain('claude / claude-opus-5-5');
    expect(header).toContain('demo');
  });

  it('too small terminal: warns but keeps working', async () => {
    const ui = mountApp({ columns: 30, rows: 10 });
    await waitForFrame(ui, 'terminal too small');
    expect(ui.frameHeight()).toBeLessThanOrEqual(10);
    ui.stdin.write('hi');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Hello from fake');
    expect(ui.frameHeight()).toBeLessThanOrEqual(10);
  });

  it('reports "alt screen off" transiently when the alternate screen is disabled', async () => {
    const ui = mountApp({ columns: 80, rows: 24, ui: { altScreen: false, mouse: false } });
    await waitForFrame(ui, 'alt screen off');
  });
});
