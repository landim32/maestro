import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderEvent } from '../../../src/providers/types.js';
import { createFakeProvider } from '../../helpers/fakeProvider.js';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp } from '../../helpers/appHarness.js';

afterEach(() => cleanupSized());

/** 25 answers × 200 markdown lines ≈ 5,000 lines of transcript. */
const ANSWERS = 25;
function bigProvider() {
  const answer = Array.from(
    { length: 50 },
    (_, i) => `- item ${i} with **bold** and \`code\`\n\n## Section ${i}\n\nparagraph ${i}\n`,
  ).join('\n');
  const events: ProviderEvent[] = [
    { type: 'text_delta', text: answer },
    { type: 'done', stopReason: 'end_turn' },
  ];
  return createFakeProvider(() => events);
}

describe('performance with ~5,000 transcript lines (SC-004)', () => {
  it('scroll keys and typing stay responsive', { timeout: 120_000 }, async () => {
    const ui = mountApp({ columns: 100, rows: 30, provider: bigProvider() });
    await waitForFrame(ui, 'Type a message');
    for (let i = 0; i < ANSWERS; i++) {
      ui.stdin.write(`q${i}`);
      await tick(5);
      ui.stdin.write(KEYS.enter);
      await waitFor(
        () => ui.session.history.length === 2 * (i + 1) && (ui.lastFrame() ?? '').includes('ready'),
        // generous: the full suite also runs git-heavy Spec Kit tests in parallel (specs/006)
        30_000,
        `answer ${i}`,
      );
    }
    expect(ui.session.history).toHaveLength(ANSWERS * 2);

    // PageUp latency: time until the frame changes
    const before = ui.lastFrame();
    const t0 = performance.now();
    ui.stdin.write(KEYS.pageUp);
    await waitFor(() => ui.lastFrame() !== before, 5000, 'page up frame');
    const pageUpMs = performance.now() - t0;

    // Typing latency
    const t1 = performance.now();
    ui.stdin.write('z');
    await waitForFrame(ui, '› z');
    const typeMs = performance.now() - t1;

    // Generous CI budgets (spec targets: 100 ms / 50 ms on a dev machine); the test guards regressions.
    expect(pageUpMs).toBeLessThan(1000);
    expect(typeMs).toBeLessThan(1000);
    expect(ui.frameHeight()).toBeLessThanOrEqual(30);
  });
});
