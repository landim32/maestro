import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { wrapToWidth } from '../../utils/width.js';
import { isScrollKey } from '../hooks/useKeyboard.js';
import { isMouseSequence } from '../hooks/useMouseWheel.js';

export const MAX_INPUT_LINES = 10;

export interface InputPromptProps {
  active: boolean;
  placeholder?: string;
  /** Previous user messages for ↑/↓ navigation (oldest first). */
  historyItems: string[];
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
  const [value, setValue] = useState('');
  const [cursorIdx, setCursorIdx] = useState<number | null>(null); // index into historyItems

  useInput(
    (input, key) => {
      if (isScrollKey(key) || isMouseSequence(input)) return;
      if (key.return) {
        const text = value;
        setValue('');
        setCursorIdx(null);
        if (text.trim() !== '') onSubmit(text);
        return;
      }
      if (key.backspace || key.delete) {
        setValue((v) => Array.from(v).slice(0, -1).join(''));
        return;
      }
      if (key.upArrow) {
        if (historyItems.length === 0) return;
        const next = cursorIdx === null ? historyItems.length - 1 : Math.max(0, cursorIdx - 1);
        setCursorIdx(next);
        setValue(historyItems[next] ?? '');
        return;
      }
      if (key.downArrow) {
        if (cursorIdx === null) return;
        const next = cursorIdx + 1;
        if (next >= historyItems.length) {
          setCursorIdx(null);
          setValue('');
        } else {
          setCursorIdx(next);
          setValue(historyItems[next] ?? '');
        }
        return;
      }
      if (key.ctrl || key.meta || key.escape || key.tab) return;
      if (input) setValue((v) => v + input.replace(/\r\n?/g, '\n'));
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
