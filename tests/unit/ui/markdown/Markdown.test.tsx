import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import stripAnsi from 'strip-ansi';
import { Markdown } from '../../../../src/ui/markdown/Markdown.js';
import { visualWidth } from '../../../../src/utils/width.js';
import { cleanupSized, renderSized, tick } from '../../../helpers/renderSized.js';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/markdown');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

afterEach(() => cleanupSized());

async function renderMd(source: string, color: boolean, width = 80) {
  const ui = renderSized(<Markdown source={source} width={width} color={color} />, {
    columns: width,
    rows: 200,
  });
  await tick();
  return (ui.lastFrame() ?? '').replace(/\n$/, '');
}

const FIXTURE_NAMES = fs
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.md'))
  .sort();

describe('Markdown renderer — snapshots (80 columns)', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} with color`, async () => {
      expect(await renderMd(read(name), true)).toMatchSnapshot();
    });
    it(`${name} without color`, async () => {
      const out = await renderMd(read(name), false);
      expect(out).toMatchSnapshot();
      expect(out).not.toMatch(/\x1b\[3\dm|\x1b\[38;/); // no color escapes
    });
  }
});

describe('Markdown renderer — explicit assertions', () => {
  it('headings: no raw # for levels 1–2, bold text present, h1 underlined', async () => {
    const out = stripAnsi(await renderMd(read('headings.md'), true));
    expect(out).toContain('Título principal');
    expect(out).toContain('═══');
    expect(out).not.toMatch(/^# /m);
    expect(out).not.toMatch(/^## /m);
    expect(out).toMatch(/### Subseção três/);
  });

  it('inline: no raw ** or backticks; link url shown only when it differs from the text', async () => {
    const out = stripAnsi(await renderMd(read('inline.md'), true));
    expect(out).not.toContain('**');
    expect(out).not.toContain('`');
    expect(out).toContain('negrito');
    expect(out).toContain('link para docs (https://example.com/docs)');
    expect(out).not.toContain('https://example.com (https://example.com)');
  });

  it('lists: bullets per level, numbering with start, task boxes', async () => {
    const out = stripAnsi(await renderMd(read('lists.md'), true));
    expect(out).toMatch(/• item um/);
    expect(out).toMatch(/◦ subitem a/);
    expect(out).toMatch(/▪ terceiro nível/);
    expect(out).toMatch(/1\. primeiro/);
    expect(out).toMatch(/5\. começa em cinco/); // second list starts at 5 (`5)` marker)
    expect(out).toMatch(/☐ tarefa aberta/);
    expect(out).toMatch(/☑ tarefa feita/);
  });

  it('code: frame with language label; unknown language still framed', async () => {
    const ts = stripAnsi(await renderMd(read('code-ts.md'), true));
    expect(ts).toContain('╭');
    expect(ts).toContain('typescript');
    expect(ts).toContain('export async function load');
    const unknown = stripAnsi(await renderMd(read('code-unknown.md'), true));
    expect(unknown).toContain('brainfuck');
    expect(unknown).toContain('text');
    expect(unknown.match(/╭/g)?.length).toBe(2);
  });

  it('table: columns aligned, header first, wide table fits in 80 columns with ellipsis', async () => {
    const out = stripAnsi(await renderMd(read('table.md'), true));
    const rows = out.split('\n').filter((l) => l.startsWith('│'));
    // separator positions measured in visual columns (CJK cells count 2)
    const positions = rows.map((l) => {
      let col = 0;
      const pos: number[] = [];
      for (const ch of l) {
        if (ch === '│') pos.push(col);
        col += visualWidth(ch);
      }
      return pos.join(',');
    });
    expect(new Set(positions).size).toBe(1); // every row has separators at the same columns
    expect(rows[0]).toContain('Nome');
    expect(out).toContain('李雷');

    const wide = stripAnsi(await renderMd(read('table-wide.md'), true));
    for (const line of wide.split('\n')) expect([...line].length).toBeLessThanOrEqual(80);
    expect(wide).toContain('…');
  });

  it('blockquote: bar and indentation', async () => {
    const out = stripAnsi(await renderMd(read('blockquote.md'), true));
    expect(out).toMatch(/│ Uma citação simples\./);
    expect(out).toMatch(/│ │ Nível dois/);
  });

  it('thematic break spans the width and html is literal', async () => {
    const out = stripAnsi(await renderMd('a\n\n---\n\n<b>raw</b>', true, 40));
    expect(out).toContain('─'.repeat(40));
    expect(out).toContain('<b>raw</b>');
  });

  it('never throws on arbitrary input and renders an empty source as nothing', async () => {
    expect(await renderMd('', true)).toBe('');
    expect(await renderMd('\x00\x01 ** ` [ ] | --- ```', true)).toBeTypeOf('string');
  });
});
