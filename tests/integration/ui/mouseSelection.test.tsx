import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CopyResult } from '../../../src/utils/clipboard.js';

// Ink only emits SGR styles (the inverse highlight) when chalk sees a colour-capable terminal;
// set before any ink import, hence the dynamic imports below (vitest isolates modules per file).
process.env['FORCE_COLOR'] = '3';

const INVERSE = '\x1b[7m';
const copier = (result: CopyResult) =>
  vi.fn<(text: string) => Promise<CopyResult>>(async () => result);

async function helpers() {
  const sized = await import('../../helpers/renderSized.js');
  const harness = await import('../../helpers/appHarness.js');
  const { COPY_FAILED_NOTICE } = await import('../../../src/ui/App.js');
  return { ...sized, ...harness, COPY_FAILED_NOTICE };
}

afterEach(async () => (await helpers()).cleanupSized());

async function mountWithLines(copy: (text: string) => Promise<CopyResult>, n = 40) {
  const { mountApp, linesProvider, waitForFrame, tick, KEYS } = await helpers();
  const ui = mountApp({ columns: 80, rows: 24, provider: linesProvider(n), copy });
  await waitForFrame(ui, 'Type a message');
  ui.stdin.write('lista');
  await tick();
  ui.stdin.write(KEYS.enter);
  await waitForFrame(ui, `L${String(n).padStart(4, '0')} content`);
  await tick(60); // let the frame recorder see the settled frame
  return ui;
}

/** 1-based screen row of the frame line containing `text`. */
function rowOf(ui: { frameText: () => string }, text: string): number {
  const idx = ui
    .frameText()
    .split('\n')
    .findIndex((l) => l.includes(text));
  if (idx < 0) throw new Error(`row with ${text} not visible`);
  return idx + 1;
}

describe('mouse selection and copy (contracts/mouse-selection.md)', () => {
  it(
    'press → drag → release over three lines copies exactly the visible text and highlights it',
    { timeout: 30_000 },
    async () => {
      const { KEYS, tick, waitFor, waitForFrame } = await helpers();
      const copy = copier({ ok: true, method: 'xclip' });
      const ui = await mountWithLines(copy);
      const y = rowOf(ui, 'L0030 content');
      // text starts at column 4 (1-based): one cell of padding + the 2-column ⏺ marker (specs/009)
      ui.stdin.write(KEYS.mouse(0, 4, y));
      ui.stdin.write(KEYS.mouse(32, 8, y + 1));
      await tick(60);
      expect(ui.lastFrame()).toContain(`${INVERSE}L0030 content`); // live highlight while dragging
      ui.stdin.write(KEYS.mouse(32, 8, y + 2));
      ui.stdin.write(KEYS.mouse(0, 8, y + 2, true));
      await waitFor(() => copy.mock.calls.length === 1, 3000, 'copy called');
      // continuation rows start at column 1: padding + the ⏺ column + the markdown indent are visible text
      expect(copy).toHaveBeenCalledWith('L0030 content\n   L0031 content\n   L0032');
      await waitForFrame(ui, 'copiado (3 linhas)');
      expect(ui.lastFrame()).toContain(`${INVERSE}L0030 content`);
      expect(ui.lastFrame()).toContain(`${INVERSE}   L0032`);
      // typing clears the highlight
      ui.stdin.write('x');
      await tick(60);
      expect(ui.lastFrame()).not.toContain(`${INVERSE}L0030`);
    },
  );

  it(
    'a click without movement copies nothing; a double click on the same cell copies the word',
    { timeout: 30_000 },
    async () => {
      const { KEYS, tick, waitFor, waitForFrame } = await helpers();
      const copy = copier({ ok: true, method: 'pbcopy' });
      const ui = await mountWithLines(copy);
      const y = rowOf(ui, 'L0035 content');
      ui.stdin.write(KEYS.mouse(0, 4, y));
      ui.stdin.write(KEYS.mouse(0, 4, y, true));
      await tick();
      expect(copy).not.toHaveBeenCalled();
      ui.stdin.write(KEYS.mouse(0, 10, y));
      ui.stdin.write(KEYS.mouse(0, 10, y, true));
      ui.stdin.write(KEYS.mouse(0, 10, y));
      ui.stdin.write(KEYS.mouse(0, 10, y, true));
      await waitFor(() => copy.mock.calls.length === 1, 3000, 'word copied');
      expect(copy).toHaveBeenCalledWith('content');
      await waitForFrame(ui, 'copiado (1 linha)');
      expect(ui.lastFrame()).toContain(`${INVERSE}content`);
    },
  );

  it(
    'clicks outside the transcript (prompt, status bar) start no selection',
    { timeout: 30_000 },
    async () => {
      const { KEYS, tick } = await helpers();
      const copy = copier({ ok: true });
      const ui = await mountWithLines(copy);
      const promptRow = rowOf(ui, '› ');
      ui.stdin.write(KEYS.mouse(0, 3, promptRow));
      ui.stdin.write(KEYS.mouse(32, 20, promptRow));
      ui.stdin.write(KEYS.mouse(0, 20, promptRow, true));
      ui.stdin.write(KEYS.mouse(0, 3, 24));
      ui.stdin.write(KEYS.mouse(32, 20, 24));
      ui.stdin.write(KEYS.mouse(0, 20, 24, true));
      await tick(60);
      expect(copy).not.toHaveBeenCalled();
      expect(ui.lastFrame()).not.toContain(INVERSE);
    },
  );

  it(
    'scrolling with the wheel while dragging keeps the anchor on its content line',
    { timeout: 30_000 },
    async () => {
      const { KEYS, tick, waitFor } = await helpers();
      const copy = copier({ ok: true, method: 'wl-copy' });
      const ui = await mountWithLines(copy);
      const y = rowOf(ui, 'L0034 content');
      ui.stdin.write(KEYS.mouse(0, 4, y));
      ui.stdin.write(KEYS.wheelUp); // content moves down by 3 lines
      await tick(60);
      ui.stdin.write(KEYS.mouse(32, 4, y)); // same screen row → an earlier content line (upward drag)
      ui.stdin.write(KEYS.mouse(0, 4, y, true));
      await waitFor(() => copy.mock.calls.length === 1, 3000, 'copy called');
      expect(copy.mock.calls[0]![0]).toBe(
        'L0031 content\n   L0032 content\n   L0033 content\n   L',
      );
    },
  );

  it(
    '/mouse off ignores reports and shows the state; /mouse on restores selection',
    { timeout: 30_000 },
    async () => {
      const { KEYS, tick, waitFor, waitForFrame } = await helpers();
      const copy = copier({ ok: true });
      const ui = await mountWithLines(copy);
      ui.stdin.write('/mouse off');
      await tick();
      ui.stdin.write(KEYS.enter);
      await waitForFrame(ui, 'mouse desligado');
      const y = rowOf(ui, 'L0038 content');
      ui.stdin.write(KEYS.mouse(0, 4, y));
      ui.stdin.write(KEYS.mouse(32, 10, y + 1));
      ui.stdin.write(KEYS.mouse(0, 10, y + 1, true));
      await tick(60);
      expect(copy).not.toHaveBeenCalled();
      expect(ui.lastFrame()).not.toContain(`${INVERSE}L0038`);
      ui.stdin.write('/mouse on');
      await tick();
      ui.stdin.write(KEYS.enter);
      await waitForFrame(ui, 'Mouse ligado');
      await tick(60);
      const y2 = rowOf(ui, 'L0038 content');
      ui.stdin.write(KEYS.mouse(0, 4, y2));
      ui.stdin.write(KEYS.mouse(32, 10, y2));
      ui.stdin.write(KEYS.mouse(0, 10, y2, true));
      await waitFor(() => copy.mock.calls.length === 1, 3000, 'copy after /mouse on');
      expect(copy).toHaveBeenCalledWith('L0038 c');
    },
  );

  it('a failed copy warns and points to /mouse off', { timeout: 30_000 }, async () => {
    const { KEYS, waitForFrame, COPY_FAILED_NOTICE } = await helpers();
    const copy = copier({ ok: false, error: 'no clipboard' });
    const ui = await mountWithLines(copy);
    const y = rowOf(ui, 'L0036 content');
    ui.stdin.write(KEYS.mouse(0, 2, y));
    ui.stdin.write(KEYS.mouse(32, 8, y));
    ui.stdin.write(KEYS.mouse(0, 8, y, true));
    await waitForFrame(ui, COPY_FAILED_NOTICE.slice(0, 30));
    expect(
      ui.controller.notices.some((n) => n.level === 'warn' && n.text === COPY_FAILED_NOTICE),
    ).toBe(true);
  });
});
