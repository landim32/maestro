import { describe, expect, it } from 'vitest';
import { padToWidth, truncateToWidth, visualWidth, wrapToWidth } from '../../../src/utils/width.js';

describe('visualWidth', () => {
  it('counts CJK and emoji as two cells, ASCII as one, ANSI as zero', () => {
    expect(visualWidth('abc')).toBe(3);
    expect(visualWidth('李雷')).toBe(4);
    expect(visualWidth('🎵')).toBe(2);
    expect(visualWidth('\u001b[31mred\u001b[0m')).toBe(3);
  });
});

describe('truncateToWidth', () => {
  it('returns short strings unchanged and truncates long ones with an ellipsis', () => {
    expect(truncateToWidth('hello', 10)).toBe('hello');
    expect(truncateToWidth('hello world', 8)).toBe('hello w…');
    expect(visualWidth(truncateToWidth('李雷李雷李雷', 7))).toBeLessThanOrEqual(7);
    expect(truncateToWidth('abc', 0)).toBe('');
  });
});

describe('padToWidth', () => {
  it('pads by alignment and truncates when longer', () => {
    expect(padToWidth('ab', 5)).toBe('ab   ');
    expect(padToWidth('ab', 5, 'right')).toBe('   ab');
    expect(padToWidth('ab', 5, 'center')).toBe(' ab  ');
    expect(padToWidth('李雷', 6)).toBe('李雷  ');
    expect(padToWidth('toolong', 4)).toBe('too…');
  });
});

describe('wrapToWidth', () => {
  it('wraps on spaces and hard-breaks long words', () => {
    expect(wrapToWidth('the quick brown fox', 9)).toEqual(['the quick', 'brown fox']);
    expect(wrapToWidth('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapToWidth('a\nb', 10)).toEqual(['a', 'b']);
  });
});
