import { Box, Text } from 'ink';
import { readAttachment } from '../attachments.js';
import { chipLabel, formatBytes } from '../chips.js';
import type { Chip } from '../chips.js';
import { truncateToWidth } from '../../utils/width.js';

export const PANEL_LINES = 20;

export interface ChipPanelProps {
  chip: Chip;
  width: number;
  color: boolean;
}

/** Lines shown for a chip: the first PANEL_LINES of its content, or type · size for images. */
export function panelLines(chip: Chip): { lines: string[]; more: number; meta?: string } {
  if (chip.kind === 'image') {
    return { lines: [], more: 0, meta: `${chip.mediaType} · ${formatBytes(chip.bytes)}` };
  }
  const meta =
    chip.kind === 'file' ? `${chip.rel} · ${formatBytes(chip.bytes)}` : `${chip.lines} linhas`;
  const text = chip.kind === 'paste' ? chip.text : (readAttachment(chip.path)?.text ?? '');
  const all = text.replace(/\n$/, '').split('\n');
  return { lines: all.slice(0, PANEL_LINES), more: Math.max(0, all.length - PANEL_LINES), meta };
}

/** Ctrl+O panel under the prompt (contracts/paste-chips.md § 2); never part of the text. */
export function ChipPanel({ chip, width, color }: ChipPanelProps) {
  const { lines, more, meta } = panelLines(chip);
  const accent = color ? 'cyan' : undefined;
  const inner = Math.max(8, width - 4);
  return (
    <Box flexDirection="column" flexShrink={0} paddingLeft={2}>
      <Text color={accent} bold>
        {truncateToWidth(`${chipLabel(chip)}${meta ? `  ·  ${meta}` : ''}`, inner)}
      </Text>
      {lines.map((l, i) => (
        <Text key={i} dimColor>
          {truncateToWidth(l === '' ? ' ' : l, inner)}
        </Text>
      ))}
      {more > 0 && <Text dimColor>{`… +${more} linhas`}</Text>}
      <Text dimColor>{'Ctrl+O fecha'}</Text>
    </Box>
  );
}
