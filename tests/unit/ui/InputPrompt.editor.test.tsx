import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import {
  completionFor,
  cursorLine,
  InputPrompt,
  layoutInput,
  suggestionsFor,
} from '../../../src/ui/components/InputPrompt.js';

const tick = () => new Promise((r) => setTimeout(r, 25));
const K = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  enter: '\r',
  bs: '\x7f',
  ctrlA: '\x01',
  ctrlE: '\x05',
};
const base = { active: true, historyItems: [] as string[], columns: 80, color: false };
const commands = [
  { name: 'help', description: 'List commands' },
  { name: 'speckit.analyze', description: 'Analyze' },
  { name: 'speckit.specify', usage: '/speckit.specify <descrição>', description: 'Specify' },
  { name: 'speckit.plan', description: 'Plan' },
];
/** The prompt line (first line with the › marker). */
const promptLine = (frame: string | undefined) =>
  (frame ?? '').split('\n').find((l) => l.includes('›')) ?? '';

/** fix/fix-console-editor — cursor movement inside the typed text */
describe('InputPrompt editor: cursor', () => {
  it('← and → move the cursor; typing inserts at the cursor; Backspace deletes before it', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<InputPrompt {...base} onSubmit={onSubmit} />);
    await tick();
    stdin.write('abd');
    await tick();
    stdin.write(K.left);
    await tick();
    stdin.write('c');
    await tick();
    expect(promptLine(lastFrame())).toContain('abcd');
    stdin.write(K.right); // back to the end
    await tick();
    stdin.write('e');
    await tick();
    expect(promptLine(lastFrame())).toContain('abcde');
    stdin.write(K.left);
    stdin.write(K.left);
    stdin.write(K.bs); // deletes 'c'
    await tick();
    expect(promptLine(lastFrame())).toContain('abde');
    stdin.write(K.ctrlA);
    stdin.write('X');
    stdin.write(K.ctrlE);
    stdin.write('Y');
    await tick();
    expect(promptLine(lastFrame())).toContain('XabdeY');
    stdin.write(K.enter);
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'XabdeY', display: 'XabdeY' }),
    );
  });

  it('layoutInput wraps at spaces and cursorLine finds the visual line', () => {
    const chars = Array.from('hello world again');
    const lines = layoutInput(chars, 8);
    expect(lines.map((l) => chars.slice(l.start, l.end).join(''))).toEqual([
      'hello',
      'world',
      'again',
    ]);
    expect(cursorLine(lines, 0)).toBe(0);
    expect(cursorLine(lines, 7)).toBe(1);
    expect(cursorLine(lines, chars.length)).toBe(2);
  });
});

/** fix/fix-console-editor — selecting a suggestion with ↑/↓ and accepting it */
describe('InputPrompt editor: suggestions', () => {
  it('suggestionsFor filters by prefix (exact match first); completionFor adds a space for commands with arguments', () => {
    expect(suggestionsFor('/spec', commands).map((c) => c.name)).toEqual([
      'speckit.analyze',
      'speckit.specify',
      'speckit.plan',
    ]);
    expect(suggestionsFor('/speckit.plan', commands).map((c) => c.name)).toEqual(['speckit.plan']);
    expect(suggestionsFor('/speckit.plan x', commands)).toEqual([]);
    expect(suggestionsFor('hello', commands)).toEqual([]);
    expect(completionFor(commands[2]!)).toBe('/speckit.specify ');
    expect(completionFor(commands[3]!)).toBe('/speckit.plan');
  });

  it('↓/↑ move the highlight, Enter runs the highlighted command without typing it in full', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <InputPrompt {...base} commands={commands} onSubmit={onSubmit} />,
    );
    await tick();
    stdin.write('/spec');
    await tick();
    const frame0 = lastFrame() ?? '';
    expect(frame0).toContain('/speckit.analyze');
    expect(frame0).toContain('/speckit.plan');
    // first suggestion highlighted with the › marker
    expect(frame0).toMatch(/› \/speckit\.analyze/);
    stdin.write(K.down);
    stdin.write(K.down);
    await tick();
    expect(lastFrame()).toMatch(/› \/speckit\.plan/);
    stdin.write(K.up);
    await tick();
    expect(lastFrame()).toMatch(/› \/speckit\.specify/);
    stdin.write(K.down); // → plan
    await tick();
    stdin.write(K.enter);
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ text: '/speckit.plan', display: '/speckit.plan' }),
    );
    expect(promptLine(lastFrame())).not.toContain('/speckit');
  });

  it('Enter on a command that takes arguments completes it and keeps editing; → accepts too', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <InputPrompt {...base} commands={commands} onSubmit={onSubmit} />,
    );
    await tick();
    stdin.write('/speckit.spe');
    await tick();
    stdin.write(K.enter);
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(promptLine(lastFrame())).toContain('/speckit.specify');
    stdin.write('Add login');
    await tick();
    stdin.write(K.enter);
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '/speckit.specify Add login',
        display: '/speckit.specify Add login',
      }),
    );

    stdin.write('/he');
    await tick();
    stdin.write(K.right);
    await tick();
    expect(promptLine(lastFrame())).toContain('/help');
    stdin.write(K.enter);
    await tick();
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: '/help', display: '/help' }),
    );
  });

  it('Tab accepts the highlighted suggestion (Shift+Tab does not touch the text)', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <InputPrompt {...base} commands={commands} onSubmit={onSubmit} />,
    );
    await tick();
    stdin.write('/spec');
    await tick();
    stdin.write(K.down); // → specify
    await tick();
    stdin.write('\x1b[Z'); // Shift+Tab: approval mode, not ours
    await tick();
    expect(promptLine(lastFrame())).toContain('› /spec');
    stdin.write('\t');
    await tick();
    expect(promptLine(lastFrame())).toContain('› /speckit.specify');
    expect(promptLine(lastFrame())).not.toContain('\t');
    stdin.write('\t'); // nothing highlighted anymore (text has a trailing space) → no-op
    await tick();
    expect(promptLine(lastFrame())).toContain('› /speckit.specify');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Enter on a fully typed command that takes arguments submits it without a trailing space', async () => {
    const onSubmit = vi.fn();
    const cmds = [
      ...commands,
      { name: 'model', usage: '/model [id] [model]', description: 'Model' },
    ];
    const { stdin } = render(<InputPrompt {...base} commands={cmds} onSubmit={onSubmit} />);
    await tick();
    stdin.write('/model');
    await tick();
    stdin.write(K.enter);
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ text: '/model', display: '/model' }),
    ); // not "/model " (it would pollute the history)
  });

  it('↑/↓ still browse the history when no suggestion is open', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <InputPrompt
        {...base}
        commands={commands}
        historyItems={['first', 'second']}
        onSubmit={onSubmit}
      />,
    );
    await tick();
    stdin.write(K.up);
    await tick();
    expect(promptLine(lastFrame())).toContain('second');
  });
});
