import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import stripAnsi from 'strip-ansi';
import { Markdown } from '../../../../src/ui/markdown/Markdown.js';
import { parseMarkdown } from '../../../../src/ui/markdown/parse.js';
import { cleanupSized, renderSized, tick } from '../../../helpers/renderSized.js';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/markdown');
const malformed = fs.readdirSync(FIXTURES).filter((f) => f.startsWith('malformed-'));

afterEach(() => cleanupSized());

/** Letters and digits only — what must survive any formatting. */
const alnum = (s: string) => stripAnsi(s).replace(/[^\p{L}\p{N}]/gu, '');

describe('malformed markdown never loses text (FR-018)', () => {
  for (const name of malformed) {
    it(name, async () => {
      const source = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
      const ui = renderSized(<Markdown source={source} width={80} color />, {
        columns: 80,
        rows: 100,
      });
      await tick(40);
      const out = alnum(ui.lastFrame() ?? '');
      // every alphanumeric run of the source appears in the output (order-insensitive check per token)
      for (const token of source.match(/[\p{L}\p{N}]+/gu) ?? []) expect(out).toContain(token);
    });
  }

  it('parseMarkdown never throws on random markdown-ish garbage', () => {
    const symbols = [
      '*',
      '_',
      '`',
      '#',
      '[',
      ']',
      '(',
      ')',
      '|',
      '-',
      '>',
      '\n',
      ' ',
      'a',
      '1',
      '!',
      '<',
      '>',
    ];
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 200; i++) {
      const len = 1 + Math.floor(rnd() * 60);
      let s = '';
      for (let j = 0; j < len; j++) s += symbols[Math.floor(rnd() * symbols.length)];
      expect(() => parseMarkdown(s)).not.toThrow();
      expect(parseMarkdown(s).type).toBe('root');
    }
  });
});
