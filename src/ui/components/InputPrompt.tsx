import { useRef, useState } from 'react';
import { Box, Text, useInput, usePaste } from 'ink';
import { DEFAULTS } from '../../config/defaults.js';
import { EDITING, historyNavigate } from '../../session/history.js';
import type { HistoryCursor } from '../../session/history.js';
import type { PromptSubmission } from '../../session/controller.js';
import { visualWidth } from '../../utils/width.js';
import {
  classifyPath,
  readAttachment,
  readImageBase64,
  rejectionMessage,
  resolvePastedPath,
  splitPastedPaths,
} from '../attachments.js';
import type { AttachLimits } from '../attachments.js';
import {
  ChipRegistry,
  chipChar,
  chipIdOf,
  chipLabel,
  countLines,
  expandChips,
  formatBytes,
  labelChips,
  relinkChips,
  sanitizePaste,
} from '../chips.js';
import type { Chip } from '../chips.js';
import { isScrollKey } from '../hooks/useKeyboard.js';
import { isMouseSequence } from '../hooks/useMouseWheel.js';
import { ChipPanel } from './ChipPanel.js';

export const MAX_INPUT_LINES = 10;

type Command = { name: string; usage?: string; description: string };

export interface PasteLimits extends AttachLimits {
  pasteCollapseLines: number;
}

export const DEFAULT_PASTE_LIMITS: PasteLimits = { ...DEFAULTS.ui };

export interface InputPromptProps {
  active: boolean;
  placeholder?: string;
  /** Persistent input history for ↑/↓ navigation (oldest first) — contracts/history.md § 3. */
  historyItems: readonly string[];
  onSubmit: (submission: PromptSubmission) => void;
  /** Available columns for the whole prompt box. */
  columns: number;
  color: boolean;
  /** Slash commands for the suggestion list shown while typing `/…` (↑/↓ select, Enter/Tab/→ accept). */
  commands?: ReadonlyArray<Command>;
  /** Session chip registry (specs/007); a private one is used when absent (unit tests). */
  chips?: ChipRegistry;
  limits?: PasteLimits;
  /** Working directory for pasted file paths; absent → paths are never detected. */
  cwd?: string;
  /** The active provider accepts image attachments. */
  imagesOk?: boolean;
  providerId?: string;
  env?: NodeJS.ProcessEnv;
  /** Attachment warnings (refused files, limits) go to the transcript. */
  onNotice?: (text: string, level: 'info' | 'warn') => void;
}

export const MAX_SUGGESTIONS = 6;

/** Submission for plain text without markers. */
export function plainSubmission(text: string): PromptSubmission {
  return { display: text, text, parts: [], warnings: [] };
}

/** Commands whose name starts with the typed prefix (only while the text is a bare `/word`). */
export function suggestionsFor(value: string, commands: ReadonlyArray<Command>): Command[] {
  if (!value.startsWith('/') || /\s/.test(value)) return [];
  const prefix = value.slice(1).toLowerCase();
  const matches = commands.filter((c) => c.name.startsWith(prefix));
  // an exact match comes first so Enter on a fully typed command runs that command
  const exact = matches.findIndex((c) => c.name === prefix);
  if (exact > 0) matches.unshift(...matches.splice(exact, 1));
  return matches.slice(0, MAX_SUGGESTIONS);
}

/** Text that accepting a suggestion puts in the prompt (a trailing space when it takes arguments). */
export function completionFor(cmd: Command): string {
  const hasArgs = Boolean(cmd.usage && /[<[]/.test(cmd.usage));
  return `/${cmd.name}${hasArgs ? ' ' : ''}`;
}

/** One visual line of the prompt: code-point offsets `[start, end)` into the text. */
export interface InputLine {
  start: number;
  end: number;
}

/**
 * Wraps the text (as code points) into visual lines of at most `width` cells, breaking at the
 * last space when possible. Offsets are kept so the cursor can be placed on the right line.
 * A separator consumed by the break (space or `\n`) belongs to no line. `widthOf` lets a chip
 * code point take the width of its label.
 */
export function layoutInput(
  chars: readonly string[],
  width: number,
  widthOf: (ch: string) => number = visualWidth,
): InputLine[] {
  const lines: InputLine[] = [];
  const w = Math.max(1, width);
  let start = 0;
  let lineW = 0;
  let lastSpace = -1;
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    if (ch === '\n') {
      lines.push({ start, end: i });
      start = i + 1;
      lineW = 0;
      lastSpace = -1;
      i++;
      continue;
    }
    const cw = widthOf(ch);
    if (lineW + cw > w && i > start) {
      if (ch === ' ') {
        lines.push({ start, end: i });
        start = i + 1;
        i++;
      } else if (lastSpace > start) {
        lines.push({ start, end: lastSpace });
        start = lastSpace + 1;
        i = start;
      } else {
        lines.push({ start, end: i });
        start = i;
      }
      lineW = 0;
      lastSpace = -1;
      continue;
    }
    if (ch === ' ') lastSpace = i;
    lineW += cw;
    i++;
  }
  lines.push({ start, end: chars.length });
  return lines;
}

/** Index of the visual line that shows the cursor at code-point offset `pos`. */
export function cursorLine(lines: readonly InputLine[], pos: number): number {
  let idx = 0;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.start <= pos) idx = i;
  return idx;
}

const isWordChar = (ch: string | undefined) => ch !== undefined && !/\s/.test(ch);

function wordLeft(chars: readonly string[], pos: number): number {
  let p = pos;
  while (p > 0 && !isWordChar(chars[p - 1])) p--;
  while (p > 0 && isWordChar(chars[p - 1])) p--;
  return p;
}

function wordRight(chars: readonly string[], pos: number): number {
  let p = pos;
  while (p < chars.length && !isWordChar(chars[p])) p++;
  while (p < chars.length && isWordChar(chars[p])) p++;
  return p;
}

/** Chip under the cursor, or just before it (Ctrl+O target). */
export function chipAtCursor(
  chars: readonly string[],
  pos: number,
  reg: ChipRegistry,
): Chip | undefined {
  for (const i of [pos, pos - 1]) {
    const ch = chars[i];
    if (ch === undefined) continue;
    const id = chipIdOf(ch);
    if (id !== undefined) return reg.get(id);
  }
  return undefined;
}

/** Text of one visual line with chip labels drawn in the accent colour and the cursor inverted. */
function LineText({
  chars,
  start,
  end,
  cursor,
  reg,
  accent,
}: {
  chars: readonly string[];
  start: number;
  end: number;
  /** Code-point offset of the cursor, or -1 when this line has no cursor. */
  cursor: number;
  reg: ChipRegistry;
  accent: string | undefined;
}) {
  const nodes: React.ReactNode[] = [];
  let run = '';
  const flush = (key: string) => {
    if (run !== '') nodes.push(<Text key={key}>{run}</Text>);
    run = '';
  };
  for (let i = start; i < end; i++) {
    const ch = chars[i]!;
    const id = chipIdOf(ch);
    const chip = id === undefined ? undefined : reg.get(id);
    if (chip) {
      flush(`t${i}`);
      nodes.push(
        <Text key={`c${i}`} color={accent} inverse={i === cursor} bold>
          {chipLabel(chip)}
        </Text>,
      );
      continue;
    }
    if (i === cursor) {
      flush(`t${i}`);
      nodes.push(
        <Text key={`k${i}`} inverse>
          {ch}
        </Text>,
      );
      continue;
    }
    run += id === undefined ? ch : '�';
  }
  flush('tail');
  if (cursor >= end) {
    nodes.push(
      <Text key="cursor" color={accent}>
        ▌
      </Text>,
    );
  }
  return <Text>{nodes}</Text>;
}

export function InputPrompt({
  active,
  placeholder,
  historyItems,
  onSubmit,
  columns,
  color,
  commands = [],
  chips,
  limits = DEFAULT_PASTE_LIMITS,
  cwd,
  imagesOk = false,
  providerId,
  env,
  onNotice,
}: InputPromptProps) {
  const [value, setValueState] = useState('');
  const [cursor, setCursorState] = useState(0);
  const [selected, setSelectedState] = useState(0);
  /** Chip whose content is shown under the prompt (Ctrl+O). */
  const [expandedChip, setExpandedChip] = useState<number | undefined>(undefined);
  // Refs mirror the state so that several keys delivered in one tick (key repeat, paste)
  // each see the result of the previous one instead of a stale closure.
  const valueRef = useRef('');
  const cursorPosRef = useRef(0); // code-point offset of the edit cursor
  const selectedRef = useRef(0); // highlighted suggestion
  const cursorRef = useRef<HistoryCursor>(EDITING);
  const ownChips = useRef<ChipRegistry | null>(null);
  const reg = chips ?? (ownChips.current ??= new ChipRegistry());

  const setCursor = (p: number) => {
    cursorPosRef.current = p;
    setCursorState(p);
  };
  const setSelected = (i: number) => {
    selectedRef.current = i;
    setSelectedState(i);
  };
  /** Replaces the text; the cursor goes to `pos` (default: end) and the suggestion resets. */
  const setValue = (v: string, pos?: number) => {
    valueRef.current = v;
    setValueState(v);
    setCursor(pos ?? Array.from(v).length);
    setSelected(0);
  };
  const leaveHistory = () => {
    cursorRef.current = EDITING; // editing leaves the history; the edited text is the new draft
  };
  const edit = (chars: string[], pos: number) => {
    setValue(chars.join(''), pos);
    leaveHistory();
  };
  const insert = (text: string) => {
    const chars = Array.from(valueRef.current);
    const pos = Math.min(cursorPosRef.current, chars.length);
    const ins = Array.from(text);
    chars.splice(pos, 0, ...ins);
    edit(chars, pos + ins.length);
  };

  /** Pasted text: file paths → chips/warnings; long text → one chip; otherwise literal. */
  const handlePaste = (raw: string) => {
    const text = sanitizePaste(raw);
    if (text === '') return;
    const lines = countLines(text);
    if (cwd) {
      const tokens = splitPastedPaths(text);
      const resolved = tokens.map((t) => ({ t, abs: resolvePastedPath(t, cwd, env) }));
      const paths = resolved.filter((r) => r.abs).length;
      // Paths are detected in short pastes, or when every token is a path (a dropped file list);
      // a long paste with an incidental file name stays a text paste.
      if (paths > 0 && (lines <= limits.pasteCollapseLines || paths === tokens.length)) {
        const pieces: string[] = [];
        for (const r of resolved) {
          if (!r.abs) {
            pieces.push(r.t);
            continue;
          }
          const c = classifyPath(r.abs, cwd, limits, imagesOk);
          if (c.kind === 'rejected') {
            onNotice?.(rejectionMessage(c, limits, providerId), 'warn');
            pieces.push(r.t);
            continue;
          }
          const chip =
            c.kind === 'text'
              ? reg.add({
                  kind: 'file',
                  path: c.abs,
                  rel: c.rel,
                  name: c.name,
                  bytes: c.bytes,
                  lines: c.lines,
                })
              : reg.add({
                  kind: 'image',
                  path: c.abs,
                  rel: c.rel,
                  name: c.name,
                  bytes: c.bytes,
                  mediaType: c.mediaType,
                });
          pieces.push(chipChar(chip.id));
        }
        insert(pieces.join(' '));
        return;
      }
    }
    if (lines > limits.pasteCollapseLines) {
      const chip = reg.add({ kind: 'paste', text, lines });
      insert(chipChar(chip.id));
      return;
    }
    insert(text.replace(/\t/g, '  '));
  };
  usePaste(handlePaste, { isActive: active });

  /** Expands the markers, reads attachments and hands the message over (contracts/paste-chips.md § 3). */
  const submitText = (text: string) => {
    const warnings: string[] = [];
    const parts: PromptSubmission['parts'] = [];
    const sent: NonNullable<PromptSubmission['sent']> = [];
    let total = 0;
    const expanded = expandChips(text, reg, (chip) => {
      if (chip.kind === 'paste') {
        total += Buffer.byteLength(chip.text, 'utf8');
        sent.push({ kind: 'paste', lines: chip.lines });
        return { text: chip.text, lines: chip.lines };
      }
      if (chip.kind === 'file') {
        const c = readAttachment(chip.path);
        if (!c) {
          warnings.push(`${chip.rel} não existe mais; enviado como ausente.`);
          return undefined;
        }
        total += Buffer.byteLength(c.text, 'utf8');
        sent.push({ kind: 'file', lines: c.lines, bytes: Buffer.byteLength(c.text, 'utf8') });
        return c;
      }
      const data = readImageBase64(chip.path);
      if (!data) warnings.push(`${chip.rel} não existe mais; a imagem não foi enviada.`);
      else {
        parts.push({ type: 'image', mediaType: chip.mediaType, data, name: chip.name });
        total += chip.bytes;
        sent.push({ kind: 'image', bytes: chip.bytes });
      }
      return undefined;
    });
    if (total > limits.attachMaxTotalBytes) {
      onNotice?.(
        `Conteúdo anexado (${formatBytes(total)}) acima do limite (${formatBytes(limits.attachMaxTotalBytes)}); remova um marcador ou aumente ui.attachMaxTotalBytes`,
        'warn',
      );
      return false;
    }
    onSubmit({ display: labelChips(text, reg), text: expanded, parts, warnings, sent });
    return true;
  };

  useInput(
    (input, key) => {
      if (isScrollKey(key) || isMouseSequence(input)) return;
      const chars = Array.from(valueRef.current);
      const pos = Math.min(cursorPosRef.current, chars.length);
      const suggestions = suggestionsFor(valueRef.current, commands);
      const browsingHistory = cursorRef.current !== EDITING;
      const current = suggestions[Math.min(selectedRef.current, suggestions.length - 1)];
      const ctrlO = key.ctrl && input === 'o';
      if (!ctrlO && expandedChip !== undefined) setExpandedChip(undefined); // any other key closes the panel

      if (key.return) {
        if (current && !browsingHistory) {
          const completion = completionFor(current);
          const typedInFull = valueRef.current === `/${current.name}`;
          if (completion.endsWith(' ') && !typedInFull) {
            // takes arguments: complete and keep editing
            edit(Array.from(completion), Array.from(completion).length);
            return;
          }
          setValue('');
          leaveHistory();
          onSubmit(plainSubmission(completion.trimEnd())); // never submit the trailing argument space
          return;
        }
        const text = valueRef.current;
        if (text.trim() === '') {
          setValue('');
          leaveHistory();
          return;
        }
        if (submitText(text)) {
          setValue('');
          leaveHistory();
        }
        return;
      }
      if (key.backspace) {
        if (pos === 0) return;
        const from = key.ctrl || key.meta ? wordLeft(chars, pos) : pos - 1;
        chars.splice(from, pos - from);
        edit(chars, from);
        return;
      }
      if (key.delete) {
        if (pos >= chars.length) return;
        chars.splice(pos, 1);
        edit(chars, pos);
        return;
      }
      if (key.leftArrow) {
        setCursor(key.ctrl || key.meta ? wordLeft(chars, pos) : Math.max(0, pos - 1));
        return;
      }
      if (key.rightArrow) {
        if (pos >= chars.length) {
          // → at the end of `/word` accepts the highlighted suggestion
          if (current) {
            const completion = Array.from(completionFor(current));
            edit(completion, completion.length);
          }
          return;
        }
        setCursor(key.ctrl || key.meta ? wordRight(chars, pos) : pos + 1);
        return;
      }
      if (key.upArrow || key.downArrow) {
        if (suggestions.length > 0 && !browsingHistory) {
          const n = suggestions.length;
          setSelected((selectedRef.current + (key.upArrow ? n - 1 : 1)) % n);
          return;
        }
        const r = historyNavigate(
          cursorRef.current,
          key.upArrow ? 'up' : 'down',
          historyItems,
          valueRef.current,
        );
        cursorRef.current = r.cursor;
        // labels of this session's markers become markers again (contracts/paste-chips.md § 4)
        if (r.value !== valueRef.current) setValue(relinkChips(r.value, reg));
        return;
      }
      if (ctrlO) {
        const chip = chipAtCursor(chars, pos, reg);
        setExpandedChip(chip && expandedChip !== chip.id ? chip.id : undefined);
        return;
      }
      if (key.ctrl) {
        // readline-style shortcuts (Home/End are reserved for transcript scrolling)
        if (input === 'a') setCursor(0);
        else if (input === 'e') setCursor(chars.length);
        else if (input === 'u') edit(chars.slice(pos), 0);
        else if (input === 'k') edit(chars.slice(0, pos), pos);
        else if (input === 'w' && pos > 0) {
          const from = wordLeft(chars, pos);
          chars.splice(from, pos - from);
          edit(chars, from);
        }
        return;
      }
      if (key.tab) {
        // Tab accepts the highlighted suggestion (Shift+Tab is the approval-mode cycle, in useKeyboard)
        if (!key.shift && current && !browsingHistory) {
          const completion = Array.from(completionFor(current));
          edit(completion, completion.length);
        }
        return;
      }
      if (key.meta || key.escape) return;
      // typed text never contains chip code points (sanitized like a paste)
      const text = Array.from(sanitizePaste(input.replace(/\t/g, '')));
      if (text.length > 0) {
        chars.splice(pos, 0, ...text);
        edit(chars, pos + text.length);
      }
    },
    { isActive: active },
  );

  // Border (2) + padding (2) + prompt marker "› " (2) + cursor (1)
  const textWidth = Math.max(8, columns - 7);
  const chars = Array.from(value);
  const pos = Math.min(cursor, chars.length);
  const widthOf = (ch: string) => {
    const id = chipIdOf(ch);
    const chip = id === undefined ? undefined : reg.get(id);
    return chip ? visualWidth(chipLabel(chip)) : visualWidth(ch);
  };
  const lines = layoutInput(chars, textWidth, widthOf);
  const curLine = cursorLine(lines, pos);
  let first = Math.max(0, lines.length - MAX_INPUT_LINES);
  if (curLine < first) first = curLine;
  const visible = lines.slice(first, first + MAX_INPUT_LINES);
  const borderColor = color ? (active ? 'cyan' : 'gray') : undefined;
  const showPlaceholder = value === '';
  const suggestions = active ? suggestionsFor(value, commands) : [];
  const sel = Math.min(selected, suggestions.length - 1);
  const accent = color ? 'cyan' : undefined;
  const panelChip = active && expandedChip !== undefined ? reg.get(expandedChip) : undefined;

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      flexDirection="column"
      flexShrink={0}
      width={columns}
    >
      {visible.map((line, i) => {
        const lineIdx = first + i;
        const hasCursor = active && lineIdx === curLine;
        return (
          <Box key={lineIdx}>
            <Text color={accent} bold>
              {i === 0 ? (first > 0 ? '⋮ ' : '› ') : '  '}
            </Text>
            {showPlaceholder ? (
              <>
                {active && <Text color={accent}>▌</Text>}
                <Text dimColor>
                  {placeholder ?? (active ? 'Type a message or /help' : 'waiting…')}
                </Text>
              </>
            ) : (
              <LineText
                chars={chars}
                start={line.start}
                end={line.end}
                cursor={hasCursor ? pos : -1}
                reg={reg}
                accent={accent}
              />
            )}
          </Box>
        );
      })}
      {suggestions.map((s, i) => {
        const isSel = i === sel;
        return (
          <Box key={s.name} flexShrink={0}>
            <Text color={accent} bold={isSel}>
              {isSel ? '› ' : '  '}
            </Text>
            <Text color={accent} inverse={isSel} bold={isSel}>
              {`/${s.name}`.padEnd(26)}
            </Text>
            <Text dimColor={!isSel}>
              {` ${s.description.slice(0, Math.max(10, textWidth - 28))}`}
            </Text>
          </Box>
        );
      })}
      {panelChip && <ChipPanel chip={panelChip} width={textWidth} color={color} />}
    </Box>
  );
}
