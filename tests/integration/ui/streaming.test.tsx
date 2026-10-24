import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import stripAnsi from 'strip-ansi';
import { Markdown } from '../../../src/ui/markdown/Markdown.js';
import { cleanupSized, renderSized, tick } from '../../helpers/renderSized.js';

const FIXTURES = path.resolve(__dirname, '../../fixtures/markdown');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

afterEach(() => cleanupSized());

async function incremental(source: string) {
  const ui = renderSized(<Markdown source="" width={80} color />, { columns: 80, rows: 200 });
  // Variable-size deltas (base + 1..7 chars), capped at ~40 re-renders so the test stays fast.
  const base = Math.max(1, Math.ceil(source.length / 40));
  let i = 0;
  let jitter = 1;
  while (i < source.length) {
    i = Math.min(source.length, i + base + jitter);
    ui.rerender(<Markdown source={source.slice(0, i)} width={80} color streaming />);
    jitter = (jitter % 7) + 1;
  }
  await tick(50);
  return ui.lastFrame() ?? '';
}

async function single(source: string) {
  const ui = renderSized(<Markdown source={source} width={80} color />, { columns: 80, rows: 200 });
  await tick(50);
  return ui.lastFrame() ?? '';
}

describe('streaming invariant (FR-017): incremental rendering ends identical to single rendering', () => {
  for (const name of ['mixed-real-answer.md', 'code-unclosed.md', 'lists.md', 'table.md']) {
    it(name, { timeout: 30_000 }, async () => {
      const source = read(name);
      expect(await incremental(source)).toBe(await single(source));
    });
  }

  it('an unclosed fence is already shown as a code block while streaming', async () => {
    const partial = 'Texto.\n\n```python\ndef hello(name):\n    print(f"hello {name}")';
    const ui = renderSized(<Markdown source={partial} width={80} color streaming />, {
      columns: 80,
      rows: 100,
    });
    await tick(50);
    const out = stripAnsi(ui.lastFrame() ?? '');
    expect(out).toContain('╭');
    expect(out).toContain('python');
    expect(out).toContain('def hello(name):');
    expect(out).not.toContain('```');
  });
});
