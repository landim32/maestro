import { afterEach, describe, expect, it } from 'vitest';
import { activityReducer, initialActivity } from '../../../src/session/activity.js';
import type { Activity } from '../../../src/session/activity.js';
import { ActivityLine, SPINNER_FRAMES } from '../../../src/ui/components/ActivityLine.js';
import { cleanupSized, renderSized, waitFor } from '../../helpers/renderSized.js';

afterEach(() => cleanupSized());

const base = (): Activity =>
  activityReducer(
    initialActivity(1_000, () => 0),
    { type: 'usage', input: 0, output: 304 },
  );

describe('ActivityLine (specs/009 contracts/activity-line.md)', () => {
  it('shows symbol, phrase, time, tokens and the hint, using the injected clock', async () => {
    let now = 14_000;
    const ui = renderSized(
      <ActivityLine activity={base()} width={98} color={false} clock={() => now} />,
      { columns: 100, rows: 3 },
    );
    await waitFor(() => (ui.frameText() ?? '').includes('Contemplando'), 3000, 'first frame');
    expect(ui.frameText()).toContain('✻ Contemplando… (13s · ↓ 304 tokens · Esc para interromper)');
    now = 75_000;
    // without colour the line refreshes once per second
    await waitFor(() => ui.frameText().includes('(1m 14s'), 3000, 'time advanced');
  });

  it('phrases per phase and the ~ before the first real usage', async () => {
    const tool = activityReducer(
      initialActivity(0, () => 0),
      { type: 'toolStart', label: 'Bash' },
    );
    const ui = renderSized(
      <ActivityLine activity={tool} width={98} color={false} clock={() => 2_000} />,
      {
        columns: 100,
        rows: 3,
      },
    );
    await waitFor(() => ui.frameText().includes('Executando Bash…'), 3000, 'tool phase');
    const est = activityReducer(
      initialActivity(0, () => 0),
      { type: 'delta', chars: 40 },
    );
    ui.rerender(<ActivityLine activity={est} width={98} color={false} clock={() => 2_000} />);
    await waitFor(() => ui.frameText().includes('↓ ~10 tokens'), 3000, 'estimate');
    const conf = activityReducer(est, { type: 'confirm', pending: true });
    ui.rerender(<ActivityLine activity={conf} width={98} color={false} clock={() => 2_000} />);
    await waitFor(() => ui.frameText().includes('Aguardando sua confirmação…'), 3000, 'confirm');
  });

  it('narrow terminals drop the hint, then the tokens; very narrow keeps symbol and time', async () => {
    const ui = renderSized(
      <ActivityLine activity={base()} width={38} color={false} clock={() => 14_000} />,
      {
        columns: 40,
        rows: 3,
      },
    );
    await waitFor(() => ui.frameText().includes('Contemplando'), 3000, 'narrow');
    expect(ui.frameText()).toContain('✻ Contemplando… (13s · ↓ 304 tokens)');
    expect(ui.frameText()).not.toContain('Esc');
    ui.rerender(<ActivityLine activity={base()} width={16} color={false} clock={() => 14_000} />);
    await waitFor(
      () => /✻ 13s/.test(ui.frameText()) && !ui.frameText().includes('Contemplando'),
      3000,
      'tiny',
    );
  });

  it('with colour the symbol animates; without colour it stays ✻', async () => {
    const ui = renderSized(
      <ActivityLine activity={base()} width={98} color clock={() => 14_000} frameMs={20} />,
      { columns: 100, rows: 3 },
    );
    const symbols = new Set<string>();
    await waitFor(
      () => {
        const first = ui.frameText().trim()[0];
        if (first) symbols.add(first);
        return symbols.size >= 2;
      },
      3000,
      'animation',
    );
    for (const s of symbols) expect(SPINNER_FRAMES as readonly string[]).toContain(s);
  });
});
