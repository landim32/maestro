import { afterEach, describe, expect, it } from 'vitest';
import { fileDiff } from '../../../src/tools/diff.js';
import { DiffView } from '../../../src/ui/components/DiffView.js';
import { cleanupSized, renderSized, waitFor } from '../../helpers/renderSized.js';

afterEach(() => cleanupSized());

const lines = (n: number, f = (i: number) => `linha ${i}`) =>
  Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

describe('DiffView (specs/009 contracts/diff-view.md § 2–4)', () => {
  it('dialog header, numbered rows, old number on -, new number on +, ⋮ between hunks', async () => {
    const before = lines(120);
    const after = lines(120, (i) => (i === 5 ? 'X5' : i === 110 ? 'X110' : `linha ${i}`));
    const diff = fileDiff(before, after, 'src/a.ts');
    const ui = renderSized(<DiffView diff={diff} color={false} maxLines={40} header="dialog" />, {
      columns: 60,
      rows: 40,
    });
    await waitFor(() => ui.frameText().includes('src/a.ts · +2 −2'), 3000, 'header');
    const t = ui.frameText();
    expect(t).toMatch(/ {2}5 - linha 5/);
    expect(t).toMatch(/ {2}5 \+ X5/);
    expect(t).toMatch(/110 \+ X110/);
    expect(t).toMatch(/ {2}2 {3}linha 2/); // context keeps the new number and no sign
    expect(t).toContain('⋮');
  });

  it('transcript variant has no header and limits the body', async () => {
    const diff = fileDiff(null, lines(30), 'novo.txt');
    const ui = renderSized(
      <DiffView diff={diff} color={false} maxLines={5} header="transcript" />,
      {
        columns: 60,
        rows: 20,
      },
    );
    await waitFor(() => ui.frameText().includes('… +25 linhas'), 3000, 'limit');
    expect(ui.frameText()).not.toContain('novo.txt');
    expect(ui.frameText()).toMatch(/ 1 \+ linha 1/);
  });

  it('long lines wrap inside the block without overflowing the width', async () => {
    const diff = fileDiff('a\n', `${'palavra '.repeat(20)}\n`, 'w.txt');
    const ui = renderSized(
      <DiffView diff={diff} color={false} maxLines={10} header="transcript" />,
      {
        columns: 40,
        rows: 20,
      },
    );
    await waitFor(() => ui.frameText().includes('palavra'), 3000, 'wrap');
    for (const l of ui.frameLines())
      expect(l.replace(/\x1b\[[0-9;]*m/g, '').length).toBeLessThanOrEqual(40);
    expect(
      ui
        .frameText()
        .split('\n')
        .filter((l) => l.includes('palavra')).length,
    ).toBeGreaterThan(1);
  });
});
