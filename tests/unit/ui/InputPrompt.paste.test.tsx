import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { InputPrompt } from '../../../src/ui/components/InputPrompt.js';
import { ChipRegistry, chipChar } from '../../../src/ui/chips.js';

const tick = () => new Promise((r) => setTimeout(r, 25));
const K = {
  right: '\x1b[C',
  left: '\x1b[D',
  up: '\x1b[A',
  enter: '\r',
  bs: '\x7f',
  ctrlO: '\x0f',
  paste: (t: string) => `\x1b[200~${t}\x1b[201~`,
};
const base = { active: true, historyItems: [] as string[], columns: 80, color: false };
const promptLine = (frame: string | undefined) =>
  (frame ?? '').split('\n').find((l) => l.includes('›')) ?? '';
const FIVE = 'l1\nl2\nl3\nl4\nl5';

describe('InputPrompt paste (contracts/paste-chips.md § 1–3)', () => {
  it('a short paste is inserted literally; a long one becomes a numbered marker', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<InputPrompt {...base} onSubmit={onSubmit} />);
    await tick();
    stdin.write(K.paste('a\nb'));
    await tick();
    expect(lastFrame()).toContain('a');
    expect(lastFrame()).not.toContain('[Pasted text');
    stdin.write(K.paste(FIVE));
    await tick();
    expect(lastFrame()).toContain('[Pasted text #1 +5 lines]');
    stdin.write(K.paste('x\ny\nz\nw'));
    await tick();
    expect(lastFrame()).toContain('[Pasted text #2 +4 lines]');
    expect(lastFrame()).not.toContain('l3'); // the content never shows in the prompt
  });

  it('a paste with exactly pasteCollapseLines lines stays literal (CRLF normalized)', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <InputPrompt
        {...base}
        onSubmit={onSubmit}
        limits={{
          pasteCollapseLines: 3,
          attachMaxBytes: 1024,
          attachMaxTotalBytes: 2048,
          imageMaxBytes: 1024,
        }}
      />,
    );
    await tick();
    stdin.write(K.paste('a\r\nb\r\nc\r\n'));
    await tick();
    expect(lastFrame()).not.toContain('[Pasted text');
    stdin.write(K.enter);
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ text: 'a\nb\nc\n' }));
  });

  it('← → jump over the marker, Backspace removes it whole, Ctrl+O shows and hides the content', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<InputPrompt {...base} onSubmit={onSubmit} />);
    await tick();
    stdin.write('ab');
    stdin.write(K.paste(FIVE));
    await tick();
    stdin.write('cd');
    await tick();
    expect(promptLine(lastFrame())).toContain('ab[Pasted text #1 +5 lines]cd');
    stdin.write(K.left);
    stdin.write(K.left);
    stdin.write(K.left); // cursor on the marker
    await tick();
    stdin.write(K.ctrlO);
    await tick();
    expect(lastFrame()).toContain('l1');
    expect(lastFrame()).toContain('l5');
    expect(lastFrame()).toContain('Ctrl+O fecha');
    stdin.write(K.ctrlO);
    await tick();
    expect(lastFrame()).not.toContain('l1');
    stdin.write(K.right); // one key step crosses the whole marker
    await tick();
    stdin.write('X');
    await tick();
    expect(promptLine(lastFrame())).toContain('ab[Pasted text #1 +5 lines]Xcd');
    stdin.write(K.bs);
    stdin.write(K.bs); // removes the marker in one keystroke
    await tick();
    expect(promptLine(lastFrame())).toContain('abcd');
    expect(lastFrame()).not.toContain('[Pasted text');
  });

  it('Enter sends the labels as display and the delimited block as text', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<InputPrompt {...base} onSubmit={onSubmit} />);
    await tick();
    stdin.write('explique: ');
    stdin.write(K.paste(FIVE));
    await tick();
    stdin.write(K.enter);
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const s = onSubmit.mock.calls[0]![0];
    expect(s.display).toBe('explique: [Pasted text #1 +5 lines]');
    expect(s.text).toBe(`explique: <pasted-text id="1" lines="5">\n${FIVE}\n</pasted-text>`);
    expect(s.parts).toEqual([]);
    expect(s.warnings).toEqual([]);
    expect(s.sent).toEqual([{ kind: 'paste', lines: 5 }]);
  });

  it('a message made only of a marker gets the attachments prefix', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<InputPrompt {...base} onSubmit={onSubmit} />);
    await tick();
    stdin.write(K.paste(FIVE));
    await tick();
    stdin.write(K.enter);
    await tick();
    expect(onSubmit.mock.calls[0]![0].text).toMatch(
      /^The user attached the following content:\n<pasted-text/,
    );
  });

  it("↑ relinks this session's labels into markers; foreign labels stay text", async () => {
    const chips = new ChipRegistry();
    const chip = chips.add({ kind: 'paste', text: FIVE, lines: 5 });
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <InputPrompt
        {...base}
        chips={chips}
        historyItems={['veja [Pasted text #7 +2 lines]', 'ok [Pasted text #1 +5 lines] fim']}
        onSubmit={onSubmit}
      />,
    );
    await tick();
    stdin.write(K.up);
    await tick();
    expect(promptLine(lastFrame())).toContain('ok [Pasted text #1 +5 lines] fim');
    stdin.write(K.enter);
    await tick();
    expect(onSubmit.mock.calls[0]![0].text).toContain('<pasted-text id="1" lines="5">');
    expect(chipChar(chip.id)).toHaveLength(1);
    stdin.write(K.up);
    stdin.write(K.up);
    await tick();
    stdin.write(K.enter);
    await tick();
    expect(onSubmit.mock.calls[1]![0].text).toBe('veja [Pasted text #7 +2 lines]');
  });

  it('private-use code points in a paste are sanitized and never become markers', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<InputPrompt {...base} onSubmit={onSubmit} />);
    await tick();
    stdin.write(K.paste(`x${chipChar(0)}y`));
    await tick();
    stdin.write(K.enter);
    await tick();
    expect(onSubmit.mock.calls[0]![0].text).toBe('x�y');
  });

  it('refuses to send when the expanded content exceeds attachMaxTotalBytes', async () => {
    const onSubmit = vi.fn();
    const onNotice = vi.fn();
    const { stdin, lastFrame } = render(
      <InputPrompt
        {...base}
        onSubmit={onSubmit}
        onNotice={onNotice}
        limits={{
          pasteCollapseLines: 3,
          attachMaxBytes: 1024,
          attachMaxTotalBytes: 1024,
          imageMaxBytes: 1024,
        }}
      />,
    );
    await tick();
    stdin.write(K.paste(Array.from({ length: 50 }, () => 'x'.repeat(40)).join('\n')));
    await tick();
    stdin.write(K.enter);
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith(
      expect.stringMatching(/acima do limite \(1 KB\)/),
      'warn',
    );
    expect(lastFrame()).toContain('[Pasted text #1 +50 lines]'); // the prompt keeps the text
  });
});
