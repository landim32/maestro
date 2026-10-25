import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../utils/logger.js';
import { noopLogger } from '../utils/logger.js';

/** Entries kept in memory and in the file after compaction (contracts/history.md § 1). */
export const HISTORY_LIMIT = 1000;
/** File line count that triggers a rewrite on load. */
export const HISTORY_COMPACT_AT = 2000;

/** Persistence seam: the file store in production, a memory store in tests and `-p`. */
export interface HistoryStore {
  /** Never throws; `[]` on error. Oldest first, consecutive duplicates collapsed, ≤ HISTORY_LIMIT. */
  load(): string[];
  /** Never throws. */
  append(text: string): void;
}

function parseLine(line: string): string | undefined {
  if (line.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === 'object' && parsed !== null && 'text' in parsed) {
      const text = (parsed as { text: unknown }).text;
      if (typeof text === 'string' && text.trim() !== '') return text;
    }
  } catch {
    /* malformed line: skipped */
  }
  return undefined;
}

/** Collapses consecutive duplicates and keeps the last `limit` entries. */
export function normalizeEntries(texts: readonly string[], limit = HISTORY_LIMIT): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (out.length > 0 && out[out.length - 1] === t) continue;
    out.push(t);
  }
  return out.length > limit ? out.slice(out.length - limit) : out;
}

const encode = (text: string) => JSON.stringify({ t: new Date().toISOString(), text }) + '\n';

/** JSON Lines file (`~/.maestro/history.jsonl`): one `{ t, text }` per line, append per submit. */
export function fileHistoryStore(file: string, logger: Logger = noopLogger): HistoryStore {
  const fail = (op: string, err: unknown) => {
    logger.log('history.error', {
      op,
      path: file,
      message: err instanceof Error ? err.message : String(err),
    });
  };
  return {
    load() {
      let raw: string;
      try {
        if (!fs.existsSync(file)) return [];
        raw = fs.readFileSync(file, 'utf8');
      } catch (err) {
        fail('load', err);
        return [];
      }
      const lines = raw.split('\n');
      const texts: string[] = [];
      for (const line of lines) {
        const t = parseLine(line);
        if (t !== undefined) texts.push(t);
      }
      const entries = normalizeEntries(texts);
      if (lines.length > HISTORY_COMPACT_AT) {
        try {
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, entries.map(encode).join(''));
          fs.renameSync(tmp, file);
        } catch (err) {
          fail('compact', err);
        }
      }
      return entries;
    },
    append(text) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, encode(text));
      } catch (err) {
        fail('append', err);
      }
    },
  };
}

export function memoryHistoryStore(initial: readonly string[] = []): HistoryStore {
  const lines = [...initial];
  return {
    load: () => normalizeEntries(lines),
    append: (text) => {
      lines.push(text);
    },
  };
}

/** In-memory history backed by a store; oldest first (data-model § 1.2). */
export class InputHistory {
  private items: string[];

  constructor(private readonly store: HistoryStore = memoryHistoryStore()) {
    this.items = normalizeEntries(store.load());
  }

  get entries(): readonly string[] {
    return this.items;
  }

  /** False for empty text or a repeat of the last entry; true when appended (and persisted). */
  push(text: string): boolean {
    if (text.trim() === '') return false;
    if (this.items.length > 0 && this.items[this.items.length - 1] === text) return false;
    this.items.push(text);
    if (this.items.length > HISTORY_LIMIT) this.items.splice(0, this.items.length - HISTORY_LIMIT);
    this.store.append(text);
    return true;
  }
}

// ----------------------------------------------------------------- navigation (pure)

export interface HistoryCursor {
  /** Index into the entries, or null while editing outside the history. */
  index: number | null;
  /** Text that was being edited when the user entered the history. */
  draft: string;
}

export const EDITING: HistoryCursor = { index: null, draft: '' };

export type HistoryDir = 'up' | 'down';

/**
 * ↑/↓ over `items` (oldest first) — data-model § 1.4. Returns the new cursor and prompt value;
 * the same cursor object is returned when nothing changes.
 */
export function historyNavigate(
  cursor: HistoryCursor,
  dir: HistoryDir,
  items: readonly string[],
  current: string,
): { cursor: HistoryCursor; value: string } {
  if (dir === 'up') {
    if (cursor.index === null) {
      if (items.length === 0) return { cursor, value: current };
      const index = items.length - 1;
      return { cursor: { index, draft: current }, value: items[index] ?? '' };
    }
    if (cursor.index === 0) return { cursor, value: current };
    const index = cursor.index - 1;
    return { cursor: { ...cursor, index }, value: items[index] ?? '' };
  }
  if (cursor.index === null) return { cursor, value: current };
  if (cursor.index >= items.length - 1) return { cursor: EDITING, value: cursor.draft };
  const index = cursor.index + 1;
  return { cursor: { ...cursor, index }, value: items[index] ?? '' };
}
