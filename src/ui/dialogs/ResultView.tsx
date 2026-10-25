import { Box, Text } from 'ink';
import { SelectList } from './SelectList.js';

export interface ResultViewProps {
  kind: 'success' | 'error' | 'question';
  title: string;
  lines?: string[];
  warnings?: string[];
  actions?: string[];
  selected?: number;
  color: boolean;
}

/** Outcome screen with optional actions (contracts/dialog-flows.md § 4–6). */
export function ResultView({
  kind,
  title,
  lines = [],
  warnings = [],
  actions = [],
  selected = 0,
  color,
}: ResultViewProps) {
  const titleColor = kind === 'success' ? 'green' : kind === 'error' ? 'red' : 'yellow';
  const prefix = kind === 'success' ? '✓ ' : kind === 'error' ? '✗ ' : '';
  return (
    <Box flexDirection="column">
      <Text bold color={color ? titleColor : undefined}>
        {prefix}
        {title}
      </Text>
      {lines.map((l, i) => (
        <Text key={`l${i}`}>{l}</Text>
      ))}
      {warnings.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {warnings.map((w, i) => (
            <Text key={`w${i}`} color={color ? 'yellow' : undefined}>
              ⚠ {w}
            </Text>
          ))}
        </Box>
      )}
      {actions.length > 0 && (
        <Box marginTop={1}>
          <SelectList
            items={actions.map((a) => ({ label: a }))}
            selected={selected}
            color={color}
          />
        </Box>
      )}
    </Box>
  );
}
