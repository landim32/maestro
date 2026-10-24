import { Box, Text } from 'ink';

export interface ScrollIndicatorProps {
  offset: number;
  contentHeight: number;
  viewportHeight: number;
  color: boolean;
}

/** One-column track with a proportional thumb (data-model.md § 3). Renders nothing without overflow. */
export function ScrollIndicator({
  offset,
  contentHeight,
  viewportHeight,
  color,
}: ScrollIndicatorProps) {
  if (viewportHeight <= 0 || contentHeight <= viewportHeight) return null;
  const maxOffset = contentHeight - viewportHeight;
  const thumb = Math.max(1, Math.round((viewportHeight * viewportHeight) / contentHeight));
  const pos = Math.round(((viewportHeight - thumb) * Math.min(offset, maxOffset)) / maxOffset);
  const cells: string[] = [];
  for (let i = 0; i < viewportHeight; i++) cells.push(i >= pos && i < pos + thumb ? '█' : '│');
  return (
    <Box flexDirection="column" width={1} flexShrink={0}>
      {cells.map((c, i) => (
        <Text
          key={i}
          color={color ? (c === '█' ? 'cyan' : 'gray') : undefined}
          dimColor={!color && c === '│'}
        >
          {c}
        </Text>
      ))}
    </Box>
  );
}
