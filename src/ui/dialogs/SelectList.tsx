import { Box, Text } from 'ink';

export interface SelectItem {
  label: string;
  description?: string;
  /** Right-hand status column. */
  status?: string;
  disabled?: boolean;
  /** Group heading: never selectable, rendered without marker. */
  header?: boolean;
}

export interface SelectListProps {
  items: SelectItem[];
  selected: number;
  color: boolean;
  labelWidth?: number;
  /** Rows available; when the list is longer, a window around `selected` is shown. */
  maxVisible?: number;
}

/** Visible slice `[start, end)` keeping `selected` inside a window of `max` rows. */
export function visibleWindow(total: number, selected: number, max: number | undefined) {
  if (max === undefined || max <= 0 || total <= max) return { start: 0, end: total };
  const half = Math.floor(max / 2);
  let start = Math.max(0, selected - half);
  if (start + max > total) start = total - max;
  return { start, end: start + max };
}

/** Pure list; navigation happens in the flow reducer (contracts/dialog-flows.md § 2). */
export function SelectList({ items, selected, color, labelWidth, maxVisible }: SelectListProps) {
  const width =
    labelWidth ?? Math.max(...items.filter((i) => !i.header).map((i) => i.label.length), 8);
  const { start, end } = visibleWindow(items.length, selected, maxVisible);
  const slice = items.slice(start, end);
  return (
    <Box flexDirection="column">
      {start > 0 && <Text dimColor>{`  ↑ ${start} acima`}</Text>}
      {slice.map((item, k) => {
        const i = start + k;
        if (item.header) {
          return (
            <Box key={i} flexShrink={0}>
              <Text bold dimColor={!color}>
                {item.label}
              </Text>
            </Box>
          );
        }
        const isSel = i === selected;
        const marker = isSel ? '>' : ' ';
        return (
          <Box key={i} flexShrink={0}>
            <Text
              color={color && isSel && !item.disabled ? 'cyan' : undefined}
              inverse={color && isSel && !item.disabled}
              dimColor={item.disabled}
              bold={isSel && !item.disabled}
            >
              {marker} {item.label.padEnd(width)}
            </Text>
            {item.description !== undefined && (
              <Text dimColor={!isSel || item.disabled}>
                {'  '}
                {item.description}
              </Text>
            )}
            {item.status !== undefined && (
              <Text dimColor>
                {'  ['}
                {item.status}
                {']'}
              </Text>
            )}
          </Box>
        );
      })}
      {end < items.length && <Text dimColor>{`  ↓ ${items.length - end} abaixo`}</Text>}
    </Box>
  );
}
