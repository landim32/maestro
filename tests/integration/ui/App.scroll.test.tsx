import { afterEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, linesProvider, mountApp } from '../../helpers/appHarness.js';

afterEach(() => cleanupSized());

async function askLong(ui: ReturnType<typeof mountApp>, lastLine = 'L0060') {
  await waitForFrame(ui, 'Type a message');
  ui.stdin.write('go');
  await tick();
  ui.stdin.write(KEYS.enter);
  await waitForFrame(ui, lastLine);
  await waitForFrame(ui, 'ready');
}

const frame = (ui: ReturnType<typeof mountApp>) => ui.lastFrame() ?? '';

describe('App scrolling (US2)', () => {
  it('shows the indicator only when content overflows', async () => {
    const short = mountApp({ columns: 80, rows: 24 });
    await waitForFrame(short, 'Type a message');
    expect(frame(short)).not.toContain('█');

    const long = mountApp({ columns: 80, rows: 24, provider: linesProvider(60) });
    await askLong(long);
    expect(frame(long)).toContain('█');
    await waitForFrame(long, 'PgUp/PgDn'); // status hint arrives one render after the measurement
  });

  it('PageUp reveals earlier content, End returns to the bottom, Home goes to the top', async () => {
    const ui = mountApp({ columns: 80, rows: 24, provider: linesProvider(60) });
    await askLong(ui);
    ui.stdin.write(KEYS.pageUp);
    await waitFor(() => !frame(ui).includes('L0060'), 3000, 'page up');
    expect(frame(ui)).toMatch(/L00[2-4]\d/);

    ui.stdin.write(KEYS.end);
    await waitForFrame(ui, 'L0060');

    ui.stdin.write(KEYS.home);
    await waitForFrame(ui, '› go');
    expect(frame(ui)).toContain('L0001');
  });

  it('Shift+arrows scroll one line and never type into the prompt', async () => {
    const ui = mountApp({ columns: 80, rows: 24, provider: linesProvider(60) });
    await askLong(ui);
    ui.stdin.write(KEYS.shiftUp);
    await waitFor(() => !frame(ui).includes('L0060'), 3000, 'shift up');
    expect(frame(ui)).toContain('L0059');
    ui.stdin.write(KEYS.shiftDown);
    await waitForFrame(ui, 'L0060');
    expect(frame(ui)).toContain('Type a message');
  });

  it('mouse wheel scrolls three lines and mouse reports never reach the prompt', async () => {
    const ui = mountApp({
      columns: 80,
      rows: 24,
      provider: linesProvider(60),
      ui: { altScreen: true, mouse: true },
    });
    await askLong(ui);
    ui.stdin.write(KEYS.wheelUp);
    await waitFor(() => !frame(ui).includes('L0060'), 3000, 'wheel up');
    expect(frame(ui)).toContain('L0057');
    ui.stdin.write(KEYS.wheelDown);
    await waitForFrame(ui, 'L0060');
    expect(frame(ui)).not.toContain('[<');
  });

  it('while scrolled up, new content shows a hint and does not move the view; End clears it', async () => {
    const ui = mountApp({
      columns: 80,
      rows: 24,
      provider: linesProvider(80, { delayMs: 40, perDelta: 10 }),
    });
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('go');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'L0030'); // part of the answer streamed
    ui.stdin.write(KEYS.pageUp);
    await waitFor(() => !frame(ui).includes('L0030'), 3000, 'page up during stream');
    const anchor = ui
      .frameLines()
      .find((l) => /L00\d\d/.test(l))
      ?.trim()
      .split(/\s+/)[0];
    expect(anchor).toBeDefined();
    await waitForFrame(ui, '↓ novo conteúdo');
    await waitForFrame(ui, 'ready'); // stream finished
    expect(frame(ui)).not.toContain('L0080');
    expect(frame(ui)).toContain(anchor!); // view did not jump

    ui.stdin.write(KEYS.end);
    await waitForFrame(ui, 'L0080');
    expect(frame(ui)).not.toContain('↓ novo conteúdo');
  });

  it('sending a message jumps to the bottom', async () => {
    const ui = mountApp({ columns: 80, rows: 24, provider: linesProvider(60) });
    await askLong(ui);
    ui.stdin.write(KEYS.home);
    await waitForFrame(ui, 'L0001');
    ui.stdin.write('again');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, '› again');
    await waitFor(
      () => frame(ui).includes('L0060') && frame(ui).includes('ready'),
      3000,
      'second answer at bottom',
    );
  });
});
