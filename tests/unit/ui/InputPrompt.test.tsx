import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { InputPrompt } from '../../../src/ui/components/InputPrompt.js';

const tick = () => new Promise((r) => setTimeout(r, 20));
const base = { active: true, historyItems: [] as string[], columns: 80, color: true };

describe('InputPrompt', () => {
  it('shows typed text and submits on Enter, clearing the field', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<InputPrompt {...base} onSubmit={onSubmit} />);
    await tick();
    stdin.write('hel');
    await tick();
    stdin.write('lo');
    await tick();
    expect(lastFrame()).toContain('hello');
    stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello', display: 'hello' }),
    );
    expect(lastFrame()).not.toContain('hello');
  });

  it('ignores Enter on empty or whitespace input', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<InputPrompt {...base} onSubmit={onSubmit} />);
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('   ');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not accept input while inactive', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <InputPrompt {...base} active={false} onSubmit={onSubmit} />,
    );
    await tick();
    stdin.write('abc');
    await tick();
    expect(lastFrame()).not.toContain('abc');
  });

  it('navigates previous messages with the arrow keys', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <InputPrompt {...base} historyItems={['first', 'second']} onSubmit={onSubmit} />,
    );
    await tick();
    stdin.write('\u001B[A'); // up
    await tick();
    expect(lastFrame()).toContain('second');
    stdin.write('\u001B[A');
    await tick();
    expect(lastFrame()).toContain('first');
    stdin.write('\u001B[B'); // down
    await tick();
    expect(lastFrame()).toContain('second');
  });

  it('grows up to 10 lines and then shows only the last 10 with a ⋮ marker', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<InputPrompt {...base} columns={40} onSubmit={onSubmit} />);
    await tick();
    stdin.write('word '.repeat(30)); // ~150 chars → 5 lines at width 33
    await tick();
    const lines5 = (lastFrame() ?? '').split('\n').length;
    expect(lines5).toBeGreaterThan(4); // border(2) + ≥3 text lines
    stdin.write('word '.repeat(90)); // → ~18 lines total
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame.split('\n').length).toBe(12); // 10 text lines + 2 border lines
    expect(frame).toContain('⋮');
  });

  it('ignores scroll keys and mouse reports', async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<InputPrompt {...base} onSubmit={onSubmit} />);
    await tick();
    stdin.write('\x1b[5~'); // PageUp
    stdin.write('\x1b[<64;5;5M'); // wheel
    stdin.write('\x1b[1;2A'); // Shift+Up
    await tick();
    expect(lastFrame()).toContain('Type a message');
    expect(lastFrame()).not.toContain('[<');
  });
});
