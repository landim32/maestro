import { afterEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, linesProvider, mountApp } from '../../helpers/appHarness.js';

afterEach(() => cleanupSized());

describe('resize during streaming (FR-004)', () => {
  it(
    'reflows to each new size, never exceeds rows and loses no text',
    { timeout: 20_000 },
    async () => {
      const ui = mountApp({
        columns: 120,
        rows: 40,
        provider: linesProvider(120, { delayMs: 15, perDelta: 6 }),
      });
      await waitForFrame(ui, 'Type a message');
      ui.stdin.write('go');
      await tick();
      ui.stdin.write(KEYS.enter);
      await waitForFrame(ui, 'L0012');

      ui.resize(80, 25);
      await waitFor(() => ui.frameHeight() <= 25, 3000, 'shrink');
      expect(ui.frameLines()[0]).toContain('maestro');

      await waitForFrame(ui, 'L0048');
      ui.resize(100, 30);
      await waitFor(() => ui.frameHeight() <= 30, 3000, 'grow');

      await waitForFrame(ui, 'ready');
      await waitForFrame(ui, 'L0120'); // follow kept the view at the bottom through the resizes
      expect(ui.frameHeight()).toBeLessThanOrEqual(30);
      const text = ui.session.history[1]?.content[0];
      expect(text?.type === 'text' && text.text.split('\n').length).toBe(120);
    },
  );

  it('a user scrolled up keeps a clamped offset after the terminal shrinks', async () => {
    const ui = mountApp({ columns: 80, rows: 30, provider: linesProvider(80) });
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('go');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'L0080');
    ui.stdin.write(KEYS.home);
    await waitForFrame(ui, 'L0001');
    ui.resize(80, 14);
    await waitFor(() => ui.frameHeight() <= 14, 3000, 'shrink');
    expect(ui.lastFrame()).toContain('L0001'); // still at the top, not snapped to the end
    expect(ui.lastFrame()).not.toContain('L0080');
  });
});
