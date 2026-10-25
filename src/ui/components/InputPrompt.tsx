import { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { EDITING, historyNavigate } from '../../session/history.js';
import type { HistoryCursor } from '../../session/history.js';
import { wrapToWidth } from '../../utils/width.js';
import { isScrollKey } from '../hooks/useKeyboard.js';
import { isMouseSequence } from '../hooks/useMouseWheel.js';

export const MAX_INPUT_LINES = 10;

export interface InputPromptProps {
  active: boolean;
  placeholder?: string;
  /** Persistent input history for ↑/↓ navigation (oldest first) — contracts/history.md § 3. */
  historyItems: readonly string[];
  onSubmit: (text: string) => void;
  /** Available columns for the whole prompt box. */
  columns: number;
  color: boolean;
}

export function InputPrompt({
  active,
  placeholder,
  historyItems,
  onSubmit,
  columns,
  color,
}: InputPromptProps) {
  const [value, setValueState] = useState('');
  // Refs mirror the state so that several keys delivered in one tick (key repeat, paste)
  // each see the result of the previous one instead of a stale closure.
  const valueRef = useRef('');
  const cursorRef = useRef<HistoryCursor>(EDITING);
  const setValue = (v: string) => {
    valueRef.current = v;
    setValueState(v);
  };
  const leaveHistory = () => {
    cursorRef.current = EDITING; // editing leaves the history; the edited text is the new draft
  };

  useInput(
    (input, key) => {
      if (isScrollKey(key) || isMouseSequence(input)) return;
      if (key.return) {
        const text = valueRef.current;
        setValue('');
        leaveHistory();
        if (text.trim() !== '') onSubmit(text);
        return;
      }
      if (key.backspace || key.delete) {
        setValue(Array.from(valueRef.current).slice(0, -1).join(''));
        leaveHistory();
        return;
      }
      if (key.upArrow || key.downArrow) {
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
      // Tab belongs to the approval-mode cycle (useKeyboard); never insert it.
      if (key.ctrl || key.meta || key.escape || key.tab) return;
      const text = input.replace(/\t/g, '');
      if (text) {
        setValue(valueRef.current + text.replace(/\r\n?/g, '\n'));
        leaveHistory();
      }
    },
    { isActive: active },
  );

  // Border (2) + padding (2) + prompt marker "› " (2) + cursor (1)
  const textWidth = Math.max(8, columns - 7);
  const allLines = value === '' ? [''] : wrapToWidth(value, textWidth);
  const visible = allLines.slice(-MAX_INPUT_LINES);
  const hidden = allLines.length - visible.length;
  const borderColor = color ? (active ? 'cyan' : 'gray') : undefined;
  const showPlaceholder = value === '';

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
        const first = i === 0;
        const last = i === visible.length - 1;
        return (
          <Box key={i}>
            <Text color={color ? 'cyan' : undefined} bold>
              {first ? (hidden > 0 ? '⋮ ' : '› ') : '  '}
            </Text>
            {showPlaceholder ? (
              <Text dimColor>
                {placeholder ?? (active ? 'Type a message or /help' : 'waiting…')}
              </Text>
            ) : (
              <Text>{line}</Text>
            )}
            {active && last && <Text color={color ? 'cyan' : undefined}>▌</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
