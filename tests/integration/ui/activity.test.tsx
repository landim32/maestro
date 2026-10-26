/** specs/009 US1 — activity line and turn summary in the real App (contracts/activity-line.md). */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp } from '../../helpers/appHarness.js';
import { createFakeProvider } from '../../helpers/fakeProvider.js';
import type { ProviderEvent } from '../../../src/providers/types.js';

afterEach(() => cleanupSized());

/** Streams `chunks` with a delay between events, then reports `usage` and ends. */
function slowProvider(chunks: string[], outputTokens: number, delayMs = 60) {
  const events: ProviderEvent[] = [
    ...chunks.map((text) => ({ type: 'text_delta' as const, text })),
    { type: 'usage', inputTokens: 7, outputTokens },
    { type: 'done', stopReason: 'end_turn' },
  ];
  return createFakeProvider([events], { delayMs });
}

async function send(ui: ReturnType<typeof mountApp>, text: string) {
  ui.stdin.write(text);
  await tick();
  ui.stdin.write(KEYS.enter);
}

const activity =
  /(Contemplando|Ponderando|Elaborando|Matutando|Raciocinando|Tramando|Conjecturando|Orquestrando|Cozinhando|Destrinchando)… \(/;

describe('activity line (US1)', () => {
  it('appears before the first token, counts tokens and becomes a summary at the end', async () => {
    const ui = mountApp({
      columns: 100,
      rows: 30,
      provider: slowProvider(['primeira ', 'parte ', 'final'], 42),
      controller: { random: () => 0 },
    });
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'oi');
    await waitFor(() => activity.test(ui.frameText()), 3000, 'activity line');
    expect(ui.frameText()).toContain('Esc para interromper');
    expect(ui.frameText()).not.toContain('▍');
    await waitFor(() => ui.frameText().includes('↓ ~'), 3000, 'estimated tokens');
    await waitFor(() => /✻ \d+s · ↓ 42 tokens/.test(ui.frameText()), 3000, 'summary');
    expect(activity.test(ui.frameText())).toBe(false);
    expect(ui.controller.activity).toBeUndefined();
    expect(ui.controller.lastUsage.outputTokens).toBe(42);
  });

  it('Esc interrupts and the summary says so', async () => {
    const ui = mountApp({
      columns: 100,
      rows: 30,
      provider: slowProvider(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 10, 150),
    });
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'longa');
    await waitFor(() => activity.test(ui.frameText()), 3000, 'activity line');
    ui.stdin.write(KEYS.esc);
    await waitFor(() => ui.frameText().includes('✻ interrompido'), 3000, 'interrupted summary');
  });

  it('local commands never show the activity line', async () => {
    const ui = mountApp({ columns: 100, rows: 30 });
    await waitForFrame(ui, 'Type a message');
    await send(ui, '/help');
    await waitForFrame(ui, 'Tools: read_file'); // end of the /help text
    expect(activity.test(ui.frameText())).toBe(false);
    expect(ui.frameText()).not.toMatch(/✻ \d+s/);
  });
});
