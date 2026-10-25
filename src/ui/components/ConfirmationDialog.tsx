import { Box, Text } from 'ink';
import { approvalModeInfo } from '../../tools/approval.js';
import type { PendingToolAction } from '../../tools/types.js';

export interface ConfirmationDialogProps {
  action: Omit<PendingToolAction, 'resolve'>;
  /** Maximum preview lines (derived from terminal height by the caller). */
  maxLines?: number;
  color?: boolean;
}

export function ConfirmationDialog({
  action,
  maxLines = 40,
  color = true,
}: ConfirmationDialogProps) {
  const lines = action.previewText.split('\n');
  const shown = lines.slice(0, Math.max(1, maxLines));
  const hidden = lines.length - shown.length;
  const c = (name: string) => (color ? name : undefined);
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={c('yellow')}
      paddingX={1}
      marginX={1}
      flexShrink={0}
    >
      <Text color={c('yellow')} bold>
        The model wants to run {action.tool.name}
      </Text>
      {action.reason && <Text color={c('yellow')}>Confirmação exigida: {action.reason}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {shown.map((l, i) => (
          <Text
            key={i}
            color={l.startsWith('+') ? c('green') : l.startsWith('-') ? c('red') : undefined}
          >
            {l}
          </Text>
        ))}
        {hidden > 0 && <Text dimColor>… {hidden} more lines</Text>}
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text color={c('green')} bold>
            [y]
          </Text>{' '}
          approve{'   '}
          <Text color={c('red')} bold>
            [n]
          </Text>{' '}
          decline
          <Text dimColor>{`   modo: ${approvalModeInfo(action.mode).label}`}</Text>
        </Text>
      </Box>
    </Box>
  );
}
