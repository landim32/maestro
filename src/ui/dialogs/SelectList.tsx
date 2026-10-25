import { Box, Text } from 'ink';

export interface SelectItem {
  label: string;
  description?: string;
  /** Right-hand status column. */
  status?: string;
  disabled?: boolean;
}

export interface SelectListProps {
  items: SelectItem[];
  selected: number;
  color: boolean;
  labelWidth?: number;
}

/** Pure list; navigation happens in the flow reducer (contracts/dialog-flows.md § 2). */
export function SelectList({ items, selected, color, labelWidth }: SelectListProps) {
  const width = labelWidth ?? Math.max(...items.map((i) => i.label.length), 8);
  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const isSel = i === selected;
        const marker = isSel ? '>' : ' ';
        return (
          <Box key={i}>
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
    </Box>
  );
}
