import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { VERSION } from '../../version.js';
import { COMPACT_BANNER, LARGE_BANNER } from '../banner.js';
import type { BannerVariant } from '../banner.js';

export interface BannerProps {
  variant: BannerVariant;
  color: boolean;
  providerId: string;
  model: string;
  cwd: string;
}

const GRADIENT = ['#22d3ee', '#a855f7', '#ec4899']; // cyan → violet → pink

/** Block-letter logo (large) or one-line mark (compact) + a dim status line. */
export function Banner({ variant, color, providerId, model, cwd }: BannerProps) {
  if (variant === 'none') return null;
  const status = `v${VERSION} · ${providerId} / ${model} · ${cwd}`;

  if (variant === 'compact') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={color ? 'cyan' : undefined}>
          {COMPACT_BANNER}
        </Text>
        <Text dimColor>{status}</Text>
      </Box>
    );
  }

  const lines = LARGE_BANNER.map((l, i) => <Text key={i}>{l}</Text>);
  return (
    <Box flexDirection="column" marginBottom={1}>
      {color ? (
        <Gradient colors={GRADIENT}>
          <Box flexDirection="column">{lines}</Box>
        </Gradient>
      ) : (
        <Box flexDirection="column">
          {LARGE_BANNER.map((l, i) => (
            <Text key={i} bold>
              {l}
            </Text>
          ))}
        </Box>
      )}
      <Text dimColor>{status}</Text>
    </Box>
  );
}
