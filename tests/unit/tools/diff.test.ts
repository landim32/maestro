import { describe, expect, it } from 'vitest';
import {
  DIFF_MAX_BYTES,
  diffHeader,
  diffRows,
  fileDiff,
  formatDiffText,
  numberWidth,
} from '../../../src/tools/diff.js';
import type { FileDiff } from '../../../src/tools/diff.js';

const lines = (n: number, f = (i: number) => `linha ${i}`) =>
  Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

const count = (d: FileDiff, t: '+' | '-' | ' ') =>
  d.hunks.flatMap((h) => h.lines).filter((l) => l.type === t).length;

describe('fileDiff (specs/009 contracts/diff-view.md § 1)', () => {
  it('new file: every line added, numbered from 1', () => {
    const d = fileDiff(null, 'a\nb\nc\n', 'x.txt');
    expect(d).toMatchObject({ kind: 'new', added: 3, removed: 0, newLines: 3, path: 'x.txt' });
    expect(d.hunks[0]!.lines.map((l) => [l.type, l.newNo, l.text])).toEqual([
      ['+', 1, 'a'],
      ['+', 2, 'b'],
      ['+', 3, 'c'],
    ]);
  });

  it('unchanged, eol-only, binary and large', () => {
    expect(fileDiff('a\n', 'a\n', 'f').kind).toBe('unchanged');
    expect(fileDiff('a\r\nb\r\n', 'a\nb\n', 'f')).toMatchObject({ kind: 'eol', hunks: [] });
    expect(fileDiff('a\0b', 'c', 'f').kind).toBe('binary');
    expect(fileDiff('a', 'c\0', 'f').kind).toBe('binary');
    const big = 'x'.repeat(DIFF_MAX_BYTES + 1);
    expect(fileDiff(big, 'y', 'f')).toMatchObject({ kind: 'large', added: 0, removed: 0 });
  });

  it('edit: two distant hunks with old/new numbers and at most 3 context lines', () => {
    const before = lines(200);
    const after = lines(200, (i) =>
      i === 50 ? 'MUDOU 50' : i === 150 ? 'MUDOU 150' : `linha ${i}`,
    );
    const d = fileDiff(before, after, 'big.txt');
    expect(d).toMatchObject({ kind: 'edit', added: 2, removed: 2 });
    expect(d.hunks).toHaveLength(2);
    const [h1] = d.hunks;
    expect(h1!.lines.map((l) => `${l.type}${l.oldNo ?? ''}/${l.newNo ?? ''}`)).toEqual([
      ' 47/47',
      ' 48/48',
      ' 49/49',
      '-50/',
      '+/50',
      ' 51/51',
      ' 52/52',
      ' 53/53',
    ]);
    expect(count(d, '+')).toBe(d.added);
    expect(count(d, '-')).toBe(d.removed);
  });

  it('insertions shift the new numbers', () => {
    const d = fileDiff('a\nb\nc\n', 'a\nNOVA\nb\nc\n', 'f');
    expect(d.hunks[0]!.lines.map((l) => `${l.type}${l.oldNo ?? ''}/${l.newNo ?? ''}`)).toEqual([
      ' 1/1',
      '+/2',
      ' 2/3',
      ' 3/4',
    ]);
  });

  it('a missing final newline never shows up as a "\\ No newline" row', () => {
    const d = fileDiff('a\nb', 'a\nc', 'f');
    expect(d.hunks.flatMap((h) => h.lines).some((l) => l.text.includes('No newline'))).toBe(false);
    expect(d).toMatchObject({ added: 1, removed: 1 });
    expect(fileDiff('a\nb', 'a\nb\n', 'f').kind).toBe('unchanged');
  });
});

describe('diff formatting', () => {
  it('headers per kind (§ 2)', () => {
    const edit = fileDiff('a\n', 'b\nc\n', 'src/a.ts');
    expect(diffHeader(edit, 'dialog')).toBe('src/a.ts · +2 −1');
    expect(diffHeader(edit, 'transcript')).toBe('+2 −1 linhas');
    expect(diffHeader(fileDiff(null, 'x\n', 'n.ts'), 'transcript')).toBe('arquivo novo · 1 linha');
    expect(diffHeader(fileDiff('x', 'x', 'u.ts'), 'dialog')).toBe('u.ts · sem alterações');
    expect(diffHeader(fileDiff('x\r\n', 'x\n', 'e.ts'), 'dialog')).toBe(
      'e.ts · só troca de fim de linha (CRLF ↔ LF)',
    );
    expect(diffHeader(fileDiff('\0', 'x', 'b.bin'), 'transcript')).toBe(
      'conteúdo binário ou grande demais para exibir',
    );
  });

  it('rows, number width, ⋮ between hunks and the plain-text form with a limit', () => {
    const before = lines(120);
    const after = lines(120, (i) => (i === 5 || i === 110 ? `X${i}` : `linha ${i}`));
    const d = fileDiff(before, after, 'f.txt');
    expect(numberWidth(d)).toBe(3);
    const rows = diffRows(d);
    expect(rows.filter((r) => r.kind === 'gap')).toHaveLength(1);
    const text = formatDiffText(d);
    expect(text.split('\n')[0]).toBe('f.txt · +2 −2');
    expect(text).toContain('  5 -   linha 5'.replace('-   ', '- '));
    expect(text).toContain('  5 + X5');
    expect(text).toContain('110 + X110');
    expect(text).toContain('     ⋮');
    const limited = formatDiffText(d, 3).split('\n');
    expect(limited).toHaveLength(5); // header + 3 rows + "… +N linhas"
    expect(limited.at(-1)).toMatch(/^… \+\d+ linhas$/);
  });
});
