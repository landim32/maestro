import { describe, expect, it } from 'vitest';
import {
  consoleCodePage,
  decodeCodePage,
  decodeCommandOutput,
} from '../../../src/utils/consoleEncoding.js';

const upper = Buffer.from(Array.from({ length: 128 }, (_, i) => 0x80 + i));
// "Página Número ação" as cmd writes it in code page 850
const cp850 = Buffer.from([
  0x50, 0xa0, 0x67, 0x69, 0x6e, 0x61, 0x20, 0x4e, 0xa3, 0x6d, 0x65, 0x72, 0x6f, 0x20, 0x61, 0x87,
  0xc6, 0x6f,
]);

describe('command output decoding (Windows code pages)', () => {
  it('the OEM tables cover the 128 upper bytes, one character each', () => {
    for (const cp of [437, 850]) expect(Array.from(decodeCodePage(upper, cp)!)).toHaveLength(128);
    expect(decodeCodePage(Buffer.from([0xff]), 850)).toBe(' ');
  });

  it('decodes cmd output in code page 850, and windows-1252 through TextDecoder', () => {
    expect(decodeCodePage(cp850, 850)).toBe('Página Número ação');
    expect(decodeCodePage(Buffer.from([0x61, 0xe7, 0xe3, 0x6f]), 1252)).toBe('ação');
    expect(decodeCodePage(Buffer.from([0x61]), 12345)).toBeUndefined();
  });

  it('UTF-8 first; the code page only for invalid UTF-8 on Windows', () => {
    const utf8 = Buffer.from('ação ✓', 'utf8');
    const codePage = () => 850;
    expect(decodeCommandOutput(utf8, { platform: 'win32', codePage })).toBe('ação ✓');
    expect(decodeCommandOutput(cp850, { platform: 'win32', codePage })).toBe('Página Número ação');
    expect(decodeCommandOutput(cp850, { platform: 'linux', codePage })).toContain('�');
    expect(decodeCommandOutput(cp850, { platform: 'win32', codePage: () => null })).toContain('�');
  });

  it.runIf(process.platform === 'win32')('reads the console code page with chcp', () => {
    expect(consoleCodePage()).toEqual(expect.any(Number));
  });
});
