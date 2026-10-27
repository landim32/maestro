import { afterEach, describe, expect, it } from 'vitest';
import { LARGE_BANNER, LARGE_BANNER_WIDTH, pickBannerVariant } from '../../../src/ui/banner.js';
import { visualWidth } from '../../../src/utils/width.js';
import { VERSION } from '../../../src/version.js';
import { cleanupSized, waitForFrame } from '../../helpers/renderSized.js';
import { mountApp } from '../../helpers/appHarness.js';

afterEach(() => cleanupSized());

describe('banner art', () => {
  it('every line of the large banner has the same visual width (≤ 70)', () => {
    const widths = LARGE_BANNER.map((l) => visualWidth(l));
    expect(new Set(widths).size).toBe(1);
    expect(LARGE_BANNER_WIDTH).toBeLessThanOrEqual(70);
    expect(LARGE_BANNER).toHaveLength(6);
  });

  it('picks the variant from capabilities', () => {
    expect(pickBannerVariant({ columns: 120, rows: 40, compact: false, tooSmall: false })).toBe(
      'large',
    );
    expect(pickBannerVariant({ columns: 80, rows: 40, compact: true, tooSmall: false })).toBe(
      'compact',
    );
    expect(pickBannerVariant({ columns: 120, rows: 15, compact: true, tooSmall: false })).toBe(
      'compact',
    );
    expect(pickBannerVariant({ columns: 30, rows: 10, compact: true, tooSmall: true })).toBe(
      'none',
    );
  });
});

describe('Banner in the App', () => {
  it('120x40 shows the block-letter logo with colors', async () => {
    const ui = mountApp({ columns: 120, rows: 40 });
    await waitForFrame(ui, 'Type a message');
    const frame = ui.lastFrame() ?? '';
    for (const line of LARGE_BANNER) expect(frame).toContain(line.trimEnd()); // Ink trims trailing spaces
    expect(frame).toContain(`v${VERSION} · claude / claude-opus-5-5`);
  });

  it('80x24 shows the compact mark without block art', async () => {
    const ui = mountApp({ columns: 80, rows: 24 });
    await waitForFrame(ui, '♪ Maestro');
    expect(ui.lastFrame()).not.toContain('███');
  });

  it('30x10 shows no banner at all', async () => {
    const ui = mountApp({ columns: 30, rows: 10 });
    await waitForFrame(ui, 'terminal too small');
    expect(ui.lastFrame()).not.toContain('♪');
    expect(ui.lastFrame()).not.toContain('███');
  });

  it('NO_COLOR renders the banner without color escapes', async () => {
    const ui = mountApp({ columns: 120, rows: 40, env: { NO_COLOR: '1' } });
    await waitForFrame(ui, 'Type a message');
    const frame = ui.lastFrame() ?? '';
    expect(frame).toContain(LARGE_BANNER[0]!.trimEnd());
    expect(frame).not.toMatch(/\x1b\[38;2;/); // no truecolor gradient sequences
  });
});
