/**
 * @license
 * Portions adapted from qwen-code (https://github.com/QwenLM/qwen-code),
 * packages/cli/src/ui/components/approvalModeVisuals.ts
 * @ 1c9cdd234fd9a391cac146e2d4c834d603afd045.
 * Copyright 2025 Qwen Team. Copyright 2025 Google LLC.
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Maestro; see THIRD_PARTY_NOTICES.md.
 */

import { Box, Text } from 'ink';
import type { SessionState } from '../../session/session.js';
import { approvalModeInfo } from '../../tools/approval.js';
import type { ApprovalMode } from '../../tools/approval.js';
import type { TerminalCapabilities } from '../hooks/useTerminalCapabilities.js';
import { MIN_COLUMNS, MIN_ROWS } from '../hooks/useTerminalCapabilities.js';

export interface StatusBarProps {
  state: SessionState;
  exitArmed: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  capabilities: TerminalCapabilities;
  /** Short-lived message (e.g. "alt screen off", "modo: YOLO"). */
  transientNotice?: string;
  scrollable?: boolean;
  /** Live approval mode (contracts/approval-modes.md § 3). */
  approvalMode?: ApprovalMode;
}

const STATE_TEXT: Record<SessionState, string> = {
  idle: 'ready',
  generating: 'thinking…',
  awaiting_confirmation: 'waiting for confirmation',
  awaiting_answer: 'waiting for your answer',
};

/** Colour per mode, after qwen-code's approvalModeVisuals: warning for auto modes, error for YOLO. */
export function approvalModeColor(mode: ApprovalMode): 'yellow' | 'red' | undefined {
  const danger = approvalModeInfo(mode).danger;
  if (danger === 'high') return 'red';
  if (danger === 'warn') return 'yellow';
  return undefined;
}

/** Text shown for the mode: full or short label; `YOLO!` when colours are unavailable. */
export function approvalModeText(mode: ApprovalMode, compact: boolean, color: boolean): string {
  const info = approvalModeInfo(mode);
  const text = compact ? info.short : info.label;
  return mode === 'yolo' && !color ? `${text}!` : text;
}

export function StatusBar({
  state,
  exitArmed,
  usage,
  capabilities,
  transientNotice,
  scrollable,
  approvalMode,
}: StatusBarProps) {
  const compact = capabilities.compact;
  let hints: string;
  if (state === 'generating') hints = 'Esc cancel';
  else if (state === 'awaiting_confirmation') hints = compact ? 'y / n' : 'y approve · n decline';
  else if (state === 'awaiting_answer')
    hints = compact ? '↑↓ Enter Esc' : '↑↓ choose · Enter confirm · Esc decline';
  else hints = compact ? '/help · Ctrl+C×2 exit' : 'Enter send · Tab modo · /help · Ctrl+C×2 exit';
  if (scrollable) hints = compact ? `PgUp/PgDn · ${hints}` : `PgUp/PgDn scroll · ${hints}`;
  if (capabilities.tooSmall) hints = '';

  const tail = `${exitArmed ? '  ·  press Ctrl+C again to exit' : ''}${transientNotice ? `  ·  ${transientNotice}` : ''}`;

  if (capabilities.tooSmall) {
    return (
      <Box height={1} flexShrink={0} paddingX={1} justifyContent="space-between" overflow="hidden">
        <Text color={capabilities.color ? 'yellow' : undefined}>
          {`terminal too small (min ${MIN_COLUMNS}x${MIN_ROWS})`}
        </Text>
      </Box>
    );
  }

  const modeColor =
    approvalMode && capabilities.color ? approvalModeColor(approvalMode) : undefined;

  return (
    <Box height={1} flexShrink={0} paddingX={1} justifyContent="space-between" overflow="hidden">
      <Box>
        <Text dimColor>{STATE_TEXT[state]}</Text>
        {approvalMode && (
          <>
            <Text dimColor>{'  ·  '}</Text>
            <Text
              color={modeColor}
              bold={approvalMode === 'yolo'}
              dimColor={modeColor === undefined}
            >
              {approvalModeText(approvalMode, compact, capabilities.color)}
            </Text>
          </>
        )}
        <Text dimColor>{tail}</Text>
      </Box>
      <Text dimColor>
        {usage && (usage.inputTokens || usage.outputTokens) && !compact
          ? `${usage.inputTokens}↑ ${usage.outputTokens}↓  ·  `
          : ''}
        {hints}
      </Text>
    </Box>
  );
}
