import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EDITING,
  HISTORY_COMPACT_AT,
  HISTORY_LIMIT,
  InputHistory,
  fileHistoryStore,
  historyNavigate,
  memoryHistoryStore,
} from '../../../src/session/history.js';
import type { Logger } from '../../../src/utils/logger.js';

const dirs: string[] = [];
function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-hist-'));
  dirs.push(dir);
  return path.join(dir, 'nested', 'history.jsonl');
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const spyLogger = () => {
  const log = vi.fn<Logger['log']>();
  return { enabled: true, log } satisfies Logger;
};

describe('fileHistoryStore', () => {
  it('round-trips multi-line entries and creates the folder on first append', () => {
    const file = tmpFile();
    const store = fileHistoryStore(file);
    expect(store.load()).toEqual([]);
    store.append('line 1\nline 2');
    store.append('/model');
    expect(fs.existsSync(file)).toBe(true);
    expect(fileHistoryStore(file).load()).toEqual(['line 1\nline 2', '/model']);
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ text: 'line 1\nline 2' });
    expect(typeof JSON.parse(lines[0]!).t).toBe('string');
  });

  it('skips malformed lines, blank text and collapses consecutive duplicates', () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ t: 'x', text: 'a' }),
        'not json at all',
        JSON.stringify({ t: 'x', text: '   ' }),
        JSON.stringify({ nope: 1 }),
        JSON.stringify({ t: 'x', text: 'a' }),
        JSON.stringify({ t: 'x', text: 'b' }),
        '',
      ].join('\n'),
    );
    expect(fileHistoryStore(file).load()).toEqual(['a', 'b']);
  });

  it('compacts the file to the last HISTORY_LIMIT entries when it grows past HISTORY_COMPACT_AT lines', () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const n = HISTORY_COMPACT_AT + 50;
    fs.writeFileSync(
      file,
      Array.from({ length: n }, (_, i) => JSON.stringify({ t: 'x', text: `e${i}` })).join('\n') +
        '\n',
    );
    const entries = fileHistoryStore(file).load();
    expect(entries).toHaveLength(HISTORY_LIMIT);
    expect(entries[0]).toBe(`e${n - HISTORY_LIMIT}`);
    expect(entries.at(-1)).toBe(`e${n - 1}`);
    const after = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(after).toHaveLength(HISTORY_LIMIT);
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('never throws on I/O errors and logs history.error without the entry text', () => {
    const logger = spyLogger();
    // a path under an existing *file* cannot be created
    const blocker = tmpFile();
    fs.mkdirSync(path.dirname(blocker), { recursive: true });
    fs.writeFileSync(blocker, 'x');
    const store = fileHistoryStore(path.join(blocker, 'history.jsonl'), logger);
    expect(() => store.append('secret text')).not.toThrow();
    expect(store.load()).toEqual([]);
    expect(logger.log).toHaveBeenCalledWith(
      'history.error',
      expect.objectContaining({ op: 'append', path: expect.any(String) }),
    );
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('secret text');
  });
});

describe('InputHistory', () => {
  it('loads from the store, dedupes consecutive entries and persists pushes', () => {
    const store = memoryHistoryStore(['a', 'a', 'b']);
    const h = new InputHistory(store);
    expect(h.entries).toEqual(['a', 'b']);
    expect(h.push('b')).toBe(false);
    expect(h.push('')).toBe(false);
    expect(h.push('  ')).toBe(false);
    expect(h.push('c')).toBe(true);
    expect(h.push('b')).toBe(true); // non-consecutive repeat is fine
    expect(h.entries).toEqual(['a', 'b', 'c', 'b']);
    expect(store.load()).toEqual(['a', 'b', 'c', 'b']);
  });
  it('keeps at most HISTORY_LIMIT entries', () => {
    const h = new InputHistory(memoryHistoryStore());
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h.push(`e${i}`);
    expect(h.entries).toHaveLength(HISTORY_LIMIT);
    expect(h.entries[0]).toBe('e5');
  });
});

describe('historyNavigate', () => {
  const items = ['one', 'two', 'three'];
  it('↑ on empty history does nothing', () => {
    const r = historyNavigate(EDITING, 'up', [], 'draft');
    expect(r).toEqual({ cursor: EDITING, value: 'draft' });
  });
  it('↑ enters at the most recent entry and keeps the draft', () => {
    const r = historyNavigate(EDITING, 'up', items, 'dra');
    expect(r).toEqual({ cursor: { index: 2, draft: 'dra' }, value: 'three' });
  });
  it('↑ walks back and stops at the oldest', () => {
    let c = historyNavigate(EDITING, 'up', items, '');
    c = historyNavigate(c.cursor, 'up', items, c.value);
    expect(c).toMatchObject({ cursor: { index: 1 }, value: 'two' });
    c = historyNavigate(c.cursor, 'up', items, c.value);
    expect(c).toMatchObject({ cursor: { index: 0 }, value: 'one' });
    const same = historyNavigate(c.cursor, 'up', items, c.value);
    expect(same.cursor).toBe(c.cursor);
    expect(same.value).toBe('one');
  });
  it('↓ outside the history does nothing; ↓ past the newest restores the draft', () => {
    expect(historyNavigate(EDITING, 'down', items, 'typing')).toEqual({
      cursor: EDITING,
      value: 'typing',
    });
    let c = historyNavigate(EDITING, 'up', items, 'rasc');
    c = historyNavigate(c.cursor, 'up', items, c.value);
    c = historyNavigate(c.cursor, 'down', items, c.value);
    expect(c).toMatchObject({ cursor: { index: 2 }, value: 'three' });
    c = historyNavigate(c.cursor, 'down', items, c.value);
    expect(c).toEqual({ cursor: EDITING, value: 'rasc' });
  });
});
