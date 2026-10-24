import { Box, Text } from 'ink';
import type { Table as MdTable } from 'mdast';
import { padToWidth, truncateToWidth, visualWidth } from '../../utils/width.js';
import { plainText } from './Inline.js';
import { ELEMENT } from './theme.js';

export interface TableProps {
  node: MdTable;
  width: number;
  color: boolean;
}

const MIN_COL = 3;

/** Shrinks the widest columns proportionally until the table fits `available`. */
export function fitColumns(ideal: number[], available: number): number[] {
  const widths = [...ideal];
  const sep = (widths.length - 1) * 3 + 4; // " │ " between cells + "│ " … " │" outer
  let total = widths.reduce((a, b) => a + b, 0) + sep;
  while (total > available) {
    const maxIdx = widths.indexOf(Math.max(...widths));
    if (widths[maxIdx]! <= MIN_COL) break;
    widths[maxIdx]! -= 1;
    total -= 1;
  }
  return widths;
}

export function Table({ node, width, color }: TableProps) {
  const rows = node.children.map((r) =>
    r.children.map((c) => plainText(c.children).replace(/\n/g, ' ')),
  );
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const aligns = (node.align ?? []).map((a) => a ?? 'left');
  const ideal = Array.from({ length: cols }, (_, c) =>
    Math.max(1, ...rows.map((r) => visualWidth(r[c] ?? ''))),
  );
  const widths = fitColumns(ideal, width);

  const line = (cells: string[], bold = false) => {
    const text = widths
      .map((w, c) =>
        padToWidth(
          truncateToWidth(cells[c] ?? '', w),
          w,
          aligns[c] === 'center' ? 'center' : aligns[c] === 'right' ? 'right' : 'left',
        ),
      )
      .join(' │ ');
    return (
      <Text {...(bold ? ELEMENT.tableHeader() : {})} wrap="truncate">
        │ {text} │
      </Text>
    );
  };
  const rule = (l: string, m: string, r: string) => (
    <Text {...ELEMENT.rule()} wrap="truncate">
      {l}
      {widths.map((w) => '─'.repeat(w + 2)).join(m)}
      {r}
    </Text>
  );

  const [header, ...body] = rows;
  return (
    <Box flexDirection="column" flexShrink={0}>
      {rule('┌', '┬', '┐')}
      {header && line(header, true)}
      {rule('├', '┼', '┤')}
      {body.map((r, i) => (
        <Box key={i}>{line(r)}</Box>
      ))}
      {rule('└', '┴', '┘')}
      {!color && null}
    </Box>
  );
}
