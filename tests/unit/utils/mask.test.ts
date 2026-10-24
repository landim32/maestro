import { describe, expect, it } from 'vitest';
import { mask, redact } from '../../../src/utils/mask.js';

describe('mask', () => {
  it('keeps only the last 4 characters', () => {
    expect(mask('sk-ant-abcdef1234')).toBe('****1234');
  });
  it('fully masks short or empty keys', () => {
    expect(mask('abcd')).toBe('****');
    expect(mask('')).toBe('****');
    expect(mask(undefined)).toBe('****');
    expect(mask(null)).toBe('****');
  });
});

describe('redact', () => {
  it('replaces every occurrence of each secret', () => {
    const out = redact('key=sk-secret-9999 again sk-secret-9999', ['sk-secret-9999', undefined]);
    expect(out).toBe('key=****9999 again ****9999');
  });
  it('ignores very short secrets to avoid mangling text', () => {
    expect(redact('abc abc', ['abc'])).toBe('abc abc');
  });
});
