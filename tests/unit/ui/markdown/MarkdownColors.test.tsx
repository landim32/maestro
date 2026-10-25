import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// chalk decides color support when it is first imported (by Ink); force it before any import.
vi.hoisted(() => {
  process.env['FORCE_COLOR'] = '3';
  delete process.env['NO_COLOR'];
});

import { Markdown } from '../../../../src/ui/markdown/Markdown.js';
import { cleanupSized, renderSized, tick } from '../../../helpers/renderSized.js';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/markdown');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

afterEach(() => cleanupSized());
// Workers are reused across files: restore the environment so other suites render without color.
afterAll(() => {
  delete process.env['FORCE_COLOR'];
});

async function renderMd(source: string, color: boolean) {
  const ui = renderSized(<Markdown source={source} width={80} color={color} />, {
    columns: 80,
    rows: 200,
  });
  await tick();
  return ui.lastFrame() ?? '';
}

describe('Markdown colors (FORCE_COLOR)', () => {
  it('TypeScript keywords are magenta and strings green', async () => {
    const out = await renderMd(read('code-ts.md'), true);
    expect(out).toMatch(/\x1b\[35m[^\x1b]*(export|async|function|const)/);
    expect(out).toMatch(/\x1b\[32m[^\x1b]*node:fs\/promises/);
  });

  it('headings are cyan+bold, inline code yellow, links underlined', async () => {
    const out = await renderMd('# T\n\nx `code` [l](https://u)', true);
    expect(out).toMatch(/\x1b\[1m[^\n]*\x1b\[36m|\x1b\[36m[^\n]*\x1b\[1m/); // bold + cyan on the heading
    expect(out).toMatch(/\x1b\[33m[^\x1b]*code/);
    expect(out).toMatch(/\x1b\[4m/); // underline present on the link
    expect(out).toMatch(/\x1b\[34m/); // blue link text
  });

  it('color=false renders the same structure with no color escapes', async () => {
    const out = await renderMd(read('code-ts.md'), false);
    expect(out).not.toMatch(/\x1b\[3[0-7]m|\x1b\[38;/);
    expect(out).toContain('╭');
    expect(out).toContain('typescript');
  });
});
