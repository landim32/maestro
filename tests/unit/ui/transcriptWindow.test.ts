import { describe, expect, it } from 'vitest';
import type { Message } from '../../../src/providers/types.js';
import {
  firstVisible,
  messageRows,
  textRows,
  TRANSCRIPT_DIFF_LINES,
} from '../../../src/ui/components/MessageList.js';

const msg = (over: Partial<Message>): Message => ({
  id: 'm',
  role: 'assistant',
  content: [],
  createdAt: new Date(0),
  ...over,
});

describe('transcript scroll limit', () => {
  it('textRows counts lines and wrapping', () => {
    expect(textRows('a\nb\n', 10)).toBe(3);
    expect(textRows('x'.repeat(25), 10)).toBe(3);
    expect(textRows('', 10)).toBe(1);
  });

  it('messageRows estimates text, tool calls and write diffs', () => {
    expect(messageRows(msg({ role: 'user', content: [{ type: 'text', text: 'oi' }] }), 80)).toBe(1);
    const calls = msg({
      content: [
        { type: 'text', text: 'l1\nl2' },
        { type: 'tool_call', callId: 'a', name: 'read_file', input: {} },
        { type: 'tool_call', callId: 'b', name: 'write_file', input: {} },
      ],
    });
    expect(messageRows(calls, 80)).toBe(2 + 2 + 3 + TRANSCRIPT_DIFF_LINES);
  });

  it('firstVisible keeps the newest items within the budget, and always the newest one', () => {
    expect(firstVisible([], 10)).toBe(0);
    expect(firstVisible([3, 3, 3], 100)).toBe(0);
    // each item costs rows + 1 (gap): the last two take 8 of 9
    expect(firstVisible([3, 3, 3], 9)).toBe(1);
    expect(firstVisible([3, 3, 50], 10)).toBe(2);
  });
});
