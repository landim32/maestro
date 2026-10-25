import { describe, expect, it } from 'vitest';
import {
  ATTACHMENTS_PREFIX,
  CHIP_BASE,
  ChipRegistry,
  chipChar,
  chipIdOf,
  chipLabel,
  chipsIn,
  countLines,
  expandChips,
  formatBytes,
  labelChips,
  relinkChips,
  sanitizePaste,
} from '../../../src/ui/chips.js';

const paste = (text: string) => ({ kind: 'paste' as const, text, lines: countLines(text) });

describe('chips: counting and sanitizing (contracts/paste-chips.md § 1)', () => {
  it('countLines counts one line per \\n, with or without a trailing newline', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\r\nb\r\nc')).toBe(3);
  });

  it('sanitizePaste normalizes CRLF and replaces private-use code points', () => {
    expect(sanitizePaste('a\r\nb\rc')).toBe('a\nb\nc');
    expect(sanitizePaste(`x${chipChar(0)}yz`)).toBe('x�y�z');
  });

  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(120 * 1024)).toBe('120 KB');
    expect(formatBytes(524288)).toBe('512 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
    expect(formatBytes(5242880)).toBe('5 MB');
    expect(formatBytes(6.1 * 1024 * 1024)).toBe('6.1 MB');
  });
});

describe('ChipRegistry', () => {
  it('assigns unique ids and a sequence per kind', () => {
    const reg = new ChipRegistry();
    const p1 = reg.add(paste('a\nb\nc\nd'));
    const f1 = reg.add({
      kind: 'file',
      path: '/w/x.log',
      rel: 'x.log',
      name: 'x.log',
      bytes: 10,
      lines: 3,
    });
    const p2 = reg.add(paste('1\n2\n3\n4\n5'));
    expect([p1.id, f1.id, p2.id]).toEqual([0, 1, 2]);
    expect([p1.seq, f1.seq, p2.seq]).toEqual([1, 1, 2]);
    expect(chipLabel(p1)).toBe('[Pasted text #1 +4 lines]');
    expect(chipLabel(p2)).toBe('[Pasted text #2 +5 lines]');
    expect(chipLabel(f1)).toBe('[Arquivo: x.log, 3 linhas]');
    expect(
      chipLabel(
        reg.add({
          kind: 'image',
          path: '/w/i.png',
          rel: 'i.png',
          name: 'i.png',
          bytes: 122880,
          mediaType: 'image/png',
        }),
      ),
    ).toBe('[Imagem: i.png, 120 KB]');
    expect(reg.get(1)).toBe(f1);
    expect(reg.byLabel('[Pasted text #2 +5 lines]')).toBe(p2);
    expect(reg.all()).toHaveLength(4);
  });

  it('chipChar/chipIdOf map ids to the private-use area and back', () => {
    expect(chipChar(0).codePointAt(0)).toBe(CHIP_BASE);
    expect(chipIdOf(chipChar(7))).toBe(7);
    expect(chipIdOf('a')).toBeUndefined();
    expect(chipIdOf('�')).toBeUndefined();
  });
});

describe('labelChips / relinkChips / expandChips (contracts/paste-chips.md § 3–4)', () => {
  it('labelChips and relinkChips are inverses for known labels; unknown labels stay text', () => {
    const reg = new ChipRegistry();
    const p = reg.add(paste('l1\nl2\nl3\nl4'));
    const text = `explique: ${chipChar(p.id)} por favor`;
    const labeled = labelChips(text, reg);
    expect(labeled).toBe('explique: [Pasted text #1 +4 lines] por favor');
    expect(relinkChips(labeled, reg)).toBe(text);
    const foreign = 'veja [Pasted text #9 +4 lines]';
    expect(relinkChips(foreign, reg)).toBe(foreign);
    // an unregistered private-use char never leaks as such
    expect(labelChips(`a${chipChar(42)}b`, reg)).toBe('a�b');
  });

  it('expandChips replaces markers by delimited blocks and keeps the surrounding text', () => {
    const reg = new ChipRegistry();
    const p = reg.add(paste('line 1\nline 2\nline 3\nline 4'));
    const f = reg.add({
      kind: 'file',
      path: '/w/src/a.ts',
      rel: 'src/a.ts',
      name: 'a.ts',
      bytes: 9,
      lines: 1,
    });
    const i = reg.add({
      kind: 'image',
      path: '/w/x.png',
      rel: 'x.png',
      name: 'x.png',
      bytes: 5,
      mediaType: 'image/png',
    });
    const text = `veja ${chipChar(p.id)} e ${chipChar(f.id)} e ${chipChar(i.id)} fim`;
    const out = expandChips(text, reg, (chip) =>
      chip.kind === 'file' ? { text: 'const a=1;', lines: 1 } : undefined,
    );
    expect(out).toBe(
      [
        'veja <pasted-text id="1" lines="4">',
        'line 1',
        'line 2',
        'line 3',
        'line 4',
        '</pasted-text> e <file path="src/a.ts" lines="1">',
        'const a=1;',
        '</file> e [Imagem: x.png] fim',
      ].join('\n'),
    );
    expect(out).not.toContain(ATTACHMENTS_PREFIX);
  });

  it('a message made only of markers gets the attachments prefix; a missing file is flagged', () => {
    const reg = new ChipRegistry();
    const p = reg.add(paste('a\nb\nc\nd'));
    const f = reg.add({
      kind: 'file',
      path: '/w/gone.txt',
      rel: 'gone.txt',
      name: 'gone.txt',
      bytes: 1,
      lines: 1,
    });
    const out = expandChips(` ${chipChar(p.id)} ${chipChar(f.id)}`, reg, () => undefined);
    expect(out.startsWith(`${ATTACHMENTS_PREFIX}\n`)).toBe(true);
    expect(out).toContain('<pasted-text id="1" lines="4">\na\nb\nc\nd\n</pasted-text>');
    expect(out).toContain('<file path="gone.txt" missing="true"/>');
  });

  it('chipsIn lists referenced chips once, in order', () => {
    const reg = new ChipRegistry();
    const a = reg.add(paste('1\n2\n3\n4'));
    const b = reg.add(paste('x\ny\nz\nw'));
    expect(
      chipsIn(`${chipChar(b.id)} ${chipChar(a.id)} ${chipChar(b.id)}`, reg).map((c) => c.id),
    ).toEqual([1, 0]);
    expect(chipsIn('plain', reg)).toEqual([]);
  });
});
