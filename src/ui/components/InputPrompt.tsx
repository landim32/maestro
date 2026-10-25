import { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { EDITING, historyNavigate } from '../../session/history.js';
import type { HistoryCursor } from '../../session/history.js';
import { visualWidth } from '../../utils/width.js';
import { isScrollKey } from '../hooks/useKeyboard.js';
import { isMouseSequence } from '../hooks/useMouseWheel.js';

export const MAX_INPUT_LINES = 10;

type Command = { name: string; usage?: string; description: string };

export interface InputPromptProps {
  active: boolean;
  placeholder?: string;
  /** Persistent input history for ↑/↓ navigation (oldest first) — contracts/history.md § 3. */
  historyItems: readonly string[];
  onSubmit: (text: string) => void;
  /** Available columns for the whole prompt box. */
  columns: number;
  color: boolean;
  /** Slash commands for the suggestion list shown while typing `/…` (↑/↓ select, Enter/Tab/→ accept). */
  commands?: ReadonlyArray<Command>;
}

export const MAX_SUGGESTIONS = 6;

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
 * A separator consumed by the break (space or `\n`) belongs to no line.
 */
export function layoutInput(chars: readonly string[], width: number): InputLine[] {
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
    const cw = visualWidth(ch);
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

export function InputPrompt({
  active,
  placeholder,
  historyItems,
  onSubmit,
  columns,
  color,
  commands = [],
}: InputPromptProps) {
  const [value, setValueState] = useState('');
  const [cursor, setCursorState] = useState(0);
  const [selected, setSelectedState] = useState(0);
  // Refs mirror the state so that several keys delivered in one tick (key repeat, paste)
  // each see the result of the previous one instead of a stale closure.
  const valueRef = useRef('');
  const cursorPosRef = useRef(0); // code-point offset of the edit cursor
  const selectedRef = useRef(0); // highlighted suggestion
  const cursorRef = useRef<HistoryCursor>(EDITING);

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

  useInput(
    (input, key) => {
      if (isScrollKey(key) || isMouseSequence(input)) return;
      const chars = Array.from(valueRef.current);
      const pos = Math.min(cursorPosRef.current, chars.length);
      const suggestions = suggestionsFor(valueRef.current, commands);
      const browsingHistory = cursorRef.current !== EDITING;
      const current = suggestions[Math.min(selectedRef.current, suggestions.length - 1)];

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
          onSubmit(completion.trimEnd()); // never submit the trailing argument space (`/model ` → `/model`)
          return;
        }
        const text = valueRef.current;
        setValue('');
        leaveHistory();
        if (text.trim() !== '') onSubmit(text);
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
        if (r.value !== valueRef.current) setValue(r.value);
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
      const text = Array.from(input.replace(/\t/g, '').replace(/\r\n?/g, '\n'));
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
  const lines = layoutInput(chars, textWidth);
  const curLine = cursorLine(lines, pos);
  let first = Math.max(0, lines.length - MAX_INPUT_LINES);
  if (curLine < first) first = curLine;
  const visible = lines.slice(first, first + MAX_INPUT_LINES);
  const borderColor = color ? (active ? 'cyan' : 'gray') : undefined;
  const showPlaceholder = value === '';
  const suggestions = active ? suggestionsFor(value, commands) : [];
  const sel = Math.min(selected, suggestions.length - 1);
  const accent = color ? 'cyan' : undefined;

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
        const text = chars.slice(line.start, line.end).join('');
        const col = pos - line.start;
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
            ) : hasCursor && col < line.end - line.start ? (
              <Text>
                {chars.slice(line.start, pos).join('')}
                <Text inverse>{chars[pos]}</Text>
                {chars.slice(pos + 1, line.end).join('')}
              </Text>
            ) : (
              <>
                <Text>{text}</Text>
                {hasCursor && <Text color={accent}>▌</Text>}
              </>
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
    </Box>
  );
}
