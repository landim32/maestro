import { memo } from 'react';
import { Box, Text } from 'ink';
import { truncateToWidth, visualWidth } from '../../utils/width.js';
import { highlight, resolveLanguage } from './highlight.js';
import type { Span } from './highlight.js';
import { ELEMENT, styleFor } from './theme.js';

export interface CodeBlockProps {
  code: string;
  lang?: string | null;
  width: number;
  color: boolean;
}

/** Cuts a span list to `max` visual columns, appending `…` when something was removed. */
function truncateSpans(spans: Span[], max: number): Span[] {
  const total = spans.reduce((n, s) => n + visualWidth(s.text), 0);
  if (total <= max) return spans;
  const out: Span[] = [];
  let used = 0;
  const budget = Math.max(0, max - 1);
  for (const s of spans) {
    const w = visualWidth(s.text);
    if (used + w <= budget) {
      out.push(s);
      used += w;
    } else {
      out.push({ text: truncateToWidth(s.text, budget - used, ''), token: s.token });
      break;
    }
  }
  out.push({ text: '…' });
  return out;
}

/** Framed code block with a language label and per-token colors (contracts/markdown-rendering.md § 3). */
export const CodeBlock = memo(function CodeBlock({ code, lang, width, color }: CodeBlockProps) {
  const label = resolveLanguage(lang) ?? (lang?.trim().split(/\s+/)[0] || 'text');
  const inner = Math.max(4, width - 4); // border (2) + padding (2)
  const lines = highlight(code.replace(/\n$/, ''), lang);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color ? ELEMENT.codeBorder : undefined}
      paddingX={1}
      width={width}
      flexShrink={0}
    >
      <Text {...ELEMENT.codeLang()}>{label}</Text>
      {lines.map((line, i) => (
        <Text key={i} wrap="truncate">
          {truncateSpans(line.spans, inner).map((s, j) => (
            <Text key={j} {...styleFor(s.token, color)}>
              {s.text}
            </Text>
          ))}
          {line.spans.length === 0 ? ' ' : ''}
        </Text>
      ))}
    </Box>
  );
});
