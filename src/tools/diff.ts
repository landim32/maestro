/**
 * Structured file diff for `write_file` (specs/009 research R8, contracts/diff-view.md): the same
 * value feeds the confirmation dialog, the transcript and the plain-text preview. Pure.
 */
import { structuredPatch } from 'diff';

/** Above this size (either side) the diff is replaced by a summary. */
export const DIFF_MAX_BYTES = 1024 * 1024;
/** Context lines around each change. */
export const DIFF_CONTEXT = 3;

export type DiffKind = 'new' | 'edit' | 'unchanged' | 'eol' | 'binary' | 'large';

export interface DiffLine {
  type: '+' | '-' | ' ';
  /** Line number in the old file (`-` and context). */
  oldNo?: number;
  /** Line number in the new file (`+` and context). */
  newNo?: number;
  text: string;
}

export interface DiffHunk {
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  kind: DiffKind;
  added: number;
  removed: number;
  /** Lines of the new content. */
  newLines: number;
  hunks: DiffHunk[];
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const normalizeEol = (s: string) => s.replace(/\r\n/g, '\n');
const tooLarge = (s: string) => Buffer.byteLength(s, 'utf8') > DIFF_MAX_BYTES;

export function fileDiff(oldText: string | null, newText: string, path: string): FileDiff {
  const newLines = newText === '' ? 0 : splitLines(newText).length;
  const base = { path, added: 0, removed: 0, newLines, hunks: [] as DiffHunk[] };
  if (newText.includes('\0') || (oldText ?? '').includes('\0')) return { ...base, kind: 'binary' };
  if (tooLarge(newText) || (oldText !== null && tooLarge(oldText)))
    return { ...base, kind: 'large' };

  if (oldText === null) {
    const lines = newText === '' ? [] : splitLines(newText);
    return {
      ...base,
      kind: 'new',
      added: lines.length,
      hunks: lines.length
        ? [{ lines: lines.map((text, i) => ({ type: '+' as const, newNo: i + 1, text })) }]
        : [],
    };
  }
  if (oldText === newText) return { ...base, kind: 'unchanged' };
  // A missing final newline is not a change worth showing (contracts/diff-view.md § 1).
  const finalNl = (s: string) => (s === '' || s.endsWith('\n') ? s : `${s}\n`);
  if (finalNl(oldText) === finalNl(newText)) return { ...base, kind: 'unchanged' };
  const a = finalNl(normalizeEol(oldText));
  const b = finalNl(normalizeEol(newText));
  if (a === b) return { ...base, kind: 'eol' };

  const patch = structuredPatch(path, path, a, b, '', '', { context: DIFF_CONTEXT });
  let added = 0;
  let removed = 0;
  const hunks: DiffHunk[] = patch.hunks.map((h) => {
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    const lines: DiffLine[] = [];
    for (const raw of h.lines) {
      const sign = raw[0];
      const text = raw.slice(1);
      if (sign === '\\') continue; // "\ No newline at end of file"
      if (sign === '-') {
        lines.push({ type: '-', oldNo: oldNo++, text });
        removed++;
      } else if (sign === '+') {
        lines.push({ type: '+', newNo: newNo++, text });
        added++;
      } else {
        lines.push({ type: ' ', oldNo: oldNo++, newNo: newNo++, text });
      }
    }
    return { lines };
  });
  // Only a trailing-newline difference: nothing visible changed.
  if (added === 0 && removed === 0) return { ...base, kind: 'unchanged' };
  return { ...base, kind: 'edit', added, removed, hunks };
}

/** Header text per kind (contracts/diff-view.md § 2). */
export function diffHeader(d: FileDiff, where: 'dialog' | 'transcript'): string {
  const body = (() => {
    switch (d.kind) {
      case 'edit':
        return where === 'dialog'
          ? `+${d.added} −${d.removed}`
          : `+${d.added} −${d.removed} linhas`;
      case 'new':
        return `arquivo novo · ${d.newLines} ${d.newLines === 1 ? 'linha' : 'linhas'}`;
      case 'unchanged':
        return 'sem alterações';
      case 'eol':
        return where === 'dialog'
          ? 'só troca de fim de linha (CRLF ↔ LF)'
          : 'só troca de fim de linha';
      case 'binary':
      case 'large':
        return 'conteúdo binário ou grande demais para exibir';
    }
  })();
  return where === 'dialog' ? `${d.path} · ${body}` : body;
}

/** Width of the line-number column. */
export function numberWidth(d: FileDiff): number {
  let max = 1;
  for (const h of d.hunks) for (const l of h.lines) max = Math.max(max, l.newNo ?? 0, l.oldNo ?? 0);
  return String(max).length;
}

/** Body rows (`⋮` between hunks) — shared by the text and the Ink renderings. */
export type DiffRow = { kind: 'line'; line: DiffLine } | { kind: 'gap' };

export function diffRows(d: FileDiff): DiffRow[] {
  const rows: DiffRow[] = [];
  d.hunks.forEach((h, i) => {
    if (i > 0) rows.push({ kind: 'gap' });
    for (const line of h.lines) rows.push({ kind: 'line', line });
  });
  return rows;
}

export function rowText(row: DiffRow, width: number): string {
  if (row.kind === 'gap') return `${' '.repeat(width)}  ⋮`;
  const l = row.line;
  const no = l.type === '-' ? l.oldNo : l.newNo;
  return `${String(no ?? '').padStart(width)} ${l.type} ${l.text}`;
}

/** Plain-text rendering (preview for `-p` and the generic format). */
export function formatDiffText(d: FileDiff, maxLines?: number): string {
  const out = [diffHeader(d, 'dialog')];
  const rows = diffRows(d);
  const width = numberWidth(d);
  const shown = maxLines !== undefined ? rows.slice(0, maxLines) : rows;
  for (const r of shown) out.push(rowText(r, width));
  if (shown.length < rows.length) out.push(`… +${rows.length - shown.length} linhas`);
  return out.join('\n');
}
