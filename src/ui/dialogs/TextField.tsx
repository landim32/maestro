import { Box, Text, useInput } from 'ink';
import { isMouseSequence } from '../hooks/useMouseWheel.js';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  active: boolean;
  color: boolean;
  /** Mask typed characters with • (API keys). */
  secret?: boolean;
  /** Shown instead of an empty secret value when the stored key can be kept. */
  maskedCurrent?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
}

/**
 * Controlled text input. Enter/Esc/arrows are handled by the dialog keyboard router;
 * this component only edits characters (contracts/dialog-flows.md § 3).
 */
export function TextField({
  label,
  value,
  onChange,
  active,
  color,
  secret = false,
  maskedCurrent,
  placeholder,
  hint,
  error,
}: TextFieldProps) {
  useInput(
    (input, key) => {
      if (key.return || key.escape || key.upArrow || key.downArrow || key.tab) return;
      if (key.pageUp || key.pageDown || key.home || key.end) return;
      if (isMouseSequence(input)) return;
      if (key.ctrl && input === 'u') {
        onChange('');
        return;
      }
      if (key.ctrl || key.meta) return;
      if (key.backspace || key.delete) {
        onChange(Array.from(value).slice(0, -1).join(''));
        return;
      }
      if (input) {
        const cleaned = secret ? input.replace(/\s+/g, '') : input.replace(/\r\n?/g, '\n');
        if (cleaned) onChange(value + cleaned);
      }
    },
    { isActive: active },
  );

  const shown = secret ? '•'.repeat(Array.from(value).length) : value;
  const empty = value === '';

  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      <Box>
        <Text color={color ? 'cyan' : undefined}>› </Text>
        {empty && secret && maskedCurrent ? (
          <Text dimColor>{maskedCurrent} (Enter mantém a atual)</Text>
        ) : empty ? (
          <Text dimColor>{placeholder ?? ''}</Text>
        ) : (
          <Text>{shown}</Text>
        )}
        {active && <Text color={color ? 'cyan' : undefined}>▌</Text>}
      </Box>
      {hint && <Text dimColor>{hint}</Text>}
      {error && <Text color={color ? 'red' : undefined}>✗ {error}</Text>}
    </Box>
  );
}
