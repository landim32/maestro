import { describe, expect, it } from 'vitest';
import {
  highlight,
  resolveLanguage,
  SUPPORTED_LANGUAGES,
} from '../../../../src/ui/markdown/highlight.js';

describe('resolveLanguage', () => {
  it('resolves every supported language and common aliases', () => {
    for (const l of SUPPORTED_LANGUAGES) expect(resolveLanguage(l)).toBe(l);
    expect(resolveLanguage('ts')).toBe('typescript');
    expect(resolveLanguage('TSX')).toBe('typescript');
    expect(resolveLanguage('js')).toBe('javascript');
    expect(resolveLanguage('py')).toBe('python');
    expect(resolveLanguage('sh')).toBe('bash');
    expect(resolveLanguage('shell')).toBe('bash');
    expect(resolveLanguage('ps1')).toBe('powershell');
    expect(resolveLanguage('html')).toBe('xml');
    expect(resolveLanguage('rs')).toBe('rust');
    expect(resolveLanguage('cs')).toBe('csharp');
    expect(resolveLanguage('toml')).toBe('ini');
    expect(resolveLanguage('python title=x')).toBe('python');
  });
  it('returns undefined for unknown or empty', () => {
    expect(resolveLanguage('brainfuck')).toBeUndefined();
    expect(resolveLanguage('')).toBeUndefined();
    expect(resolveLanguage(undefined)).toBeUndefined();
    expect(resolveLanguage(null)).toBeUndefined();
  });
});

describe('highlight', () => {
  it('tokenizes keywords and strings in TypeScript, Python and Go', () => {
    const ts = highlight('export const x: string = "a";', 'ts');
    const tokens = ts[0]!.spans.map((s) => s.token);
    expect(tokens).toContain('keyword');
    expect(tokens).toContain('string');
    expect(ts[0]!.spans.map((s) => s.text).join('')).toBe('export const x: string = "a";');

    const py = highlight('def f():\n    return "x"', 'python');
    expect(py).toHaveLength(2);
    expect(py[0]!.spans.some((s) => s.token === 'keyword')).toBe(true);
    expect(py[1]!.spans.some((s) => s.token === 'string')).toBe(true);

    const go = highlight('func main() { return }', 'go');
    expect(go[0]!.spans.some((s) => s.token === 'keyword')).toBe(true);
  });

  it('unknown language yields untokenized spans, preserving text and line count', () => {
    const out = highlight('a\nb\nc', 'brainfuck');
    expect(out).toHaveLength(3);
    expect(out.every((l) => l.spans.every((s) => s.token === undefined))).toBe(true);
    expect(out.map((l) => l.spans.map((s) => s.text).join(''))).toEqual(['a', 'b', 'c']);
  });

  it('a trailing newline does not add an extra line; empty lines are kept', () => {
    expect(highlight('x\n', 'json')).toHaveLength(1);
    expect(highlight('x\n\ny', 'json')).toHaveLength(3);
    expect(highlight('', 'json')).toHaveLength(1);
  });

  it('round-trips the text of every line', () => {
    const code = 'SELECT a, "b" FROM t -- c\nWHERE x = 1;';
    const lines = highlight(code, 'sql');
    expect(lines.map((l) => l.spans.map((s) => s.text).join('')).join('\n')).toBe(code);
  });
});
