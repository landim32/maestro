import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { activityText } from '../../session/activity.js';
import type { Activity } from '../../session/activity.js';

/** Spinner frames (ping-pong), in the style of Claude Code (contracts/activity-line.md § 2). */
export const SPINNER_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'] as const;
export const FRAME_MS = 200;
const STATIC_SYMBOL = '✻';

export interface ActivityLineProps {
  activity: Activity;
  width: number;
  color: boolean;
  clock?: () => number;
  /** Animation period (ms); without color only the time is refreshed, once per second. */
  frameMs?: number;
}

/**
 * Fixed one-line region between the transcript and the prompt (research R1). The timer is local:
 * a tick re-renders only this line, never the transcript.
 */
export function ActivityLine({
  activity,
  width,
  color,
  clock = Date.now,
  frameMs = FRAME_MS,
}: ActivityLineProps) {
  const [frame, setFrame] = useState(0);
  const period = color ? frameMs : 1000;
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => f + 1), period);
    return () => clearInterval(t);
  }, [period]);

  const symbol = color ? SPINNER_FRAMES[frame % SPINNER_FRAMES.length]! : STATIC_SYMBOL;
  const text = activityText(activity, { now: clock(), symbol, width, measure: stringWidth });
  const rest = text.slice(symbol.length);
  return (
    <Box flexShrink={0} paddingX={1} height={1}>
      <Text wrap="truncate">
        <Text color={color ? 'magenta' : undefined}>{symbol}</Text>
        <Text color={color ? 'magenta' : undefined} dimColor={!color}>
          {rest}
        </Text>
      </Text>
    </Box>
  );
}
