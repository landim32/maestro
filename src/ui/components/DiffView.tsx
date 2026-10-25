import { Box, Text } from 'ink';
import { diffHeader, diffRows, numberWidth } from '../../tools/diff.js';
import type { FileDiff } from '../../tools/diff.js';

export interface DiffViewProps {
  diff: FileDiff;
  color: boolean;
  /** Body rows shown; the rest becomes `… +N linhas` (contracts/diff-view.md § 4). */
  maxLines: number;
  /** `dialog` shows `path · summary` as a header; the transcript already prints the summary. */
  header: 'dialog' | 'transcript';
}

/** Structured diff with line numbers, context and colours (specs/009 US3). */
export function DiffView({ diff, color, maxLines, header }: DiffViewProps) {
  const rows = diffRows(diff);
  const shown = rows.slice(0, Math.max(1, maxLines));
  const hidden = rows.length - shown.length;
  const width = numberWidth(diff);
  const c = (name: string) => (color ? name : undefined);
  return (
    <Box flexDirection="column">
      {header === 'dialog' && (
        <Text bold color={c('yellow')}>
          {diffHeader(diff, 'dialog')}
        </Text>
      )}
      {shown.map((row, i) => {
        if (row.kind === 'gap')
          return (
            <Text key={i} dimColor>
              {`${' '.repeat(width)}  ⋮`}
            </Text>
          );
        const l = row.line;
        const no = String((l.type === '-' ? l.oldNo : l.newNo) ?? '').padStart(width);
        const tone = l.type === '+' ? c('green') : l.type === '-' ? c('red') : undefined;
        return (
          <Box key={i} flexDirection="row">
            <Box width={width + 3} flexShrink={0}>
              <Text dimColor>{`${no} `}</Text>
              <Text color={tone}>{`${l.type} `}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={tone} dimColor={l.type === ' '} wrap="wrap">
                {l.text === '' ? ' ' : l.text}
              </Text>
            </Box>
          </Box>
        );
      })}
      {hidden > 0 && <Text dimColor>{`… +${hidden} linhas`}</Text>}
    </Box>
  );
}
