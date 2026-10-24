import { Box, Text } from 'ink';
import type { SessionState } from '../../session/session.js';
import type { TerminalCapabilities } from '../hooks/useTerminalCapabilities.js';
import { MIN_COLUMNS, MIN_ROWS } from '../hooks/useTerminalCapabilities.js';

export interface StatusBarProps {
  state: SessionState;
  exitArmed: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  capabilities: TerminalCapabilities;
  /** Short-lived message (e.g. "alt screen off"). */
  transientNotice?: string;
  scrollable?: boolean;
}

const STATE_TEXT: Record<SessionState, string> = {
  idle: 'ready',
  generating: 'thinking…',
  awaiting_confirmation: 'waiting for confirmation',
};

export function StatusBar({
  state,
  exitArmed,
  usage,
  capabilities,
  transientNotice,
  scrollable,
}: StatusBarProps) {
  const compact = capabilities.compact;
  let hints: string;
  if (state === 'generating') hints = 'Esc cancel';
  else if (state === 'awaiting_confirmation') hints = compact ? 'y / n' : 'y approve · n decline';
  else hints = compact ? '/help · Ctrl+C×2 exit' : 'Enter send · /help · Ctrl+C×2 exit';
  if (scrollable) hints = compact ? `PgUp/PgDn · ${hints}` : `PgUp/PgDn scroll · ${hints}`;
  if (capabilities.tooSmall) hints = '';

  const left = capabilities.tooSmall
    ? `terminal too small (min ${MIN_COLUMNS}x${MIN_ROWS})`
    : `${STATE_TEXT[state]}${exitArmed ? '  ·  press Ctrl+C again to exit' : ''}${transientNotice ? `  ·  ${transientNotice}` : ''}`;

  return (
    <Box height={1} flexShrink={0} paddingX={1} justifyContent="space-between" overflow="hidden">
      <Text
        dimColor={!capabilities.tooSmall}
        color={capabilities.tooSmall && capabilities.color ? 'yellow' : undefined}
      >
        {left}
      </Text>
      <Text dimColor>
        {usage && (usage.inputTokens || usage.outputTokens) && !compact
          ? `${usage.inputTokens}↑ ${usage.outputTokens}↓  ·  `
          : ''}
        {hints}
      </Text>
    </Box>
  );
}
