import { memo } from 'react';
import { Box, Text } from 'ink';
import type { Blockquote, Heading, List, ListItem, PhrasingContent, RootContent } from 'mdast';
import { visualWidth } from '../../utils/width.js';
import { CodeBlock } from './CodeBlock.js';
import { Inline, plainText } from './Inline.js';
import { parseMarkdown } from './parse.js';
import { Table } from './Table.js';
import { ELEMENT } from './theme.js';
import type { TextStyle } from './theme.js';

export interface MarkdownProps {
  source: string;
  /** Available columns. */
  width: number;
  color: boolean;
  /** The source is still growing (same output; reserved for future optimizations). */
  streaming?: boolean;
}

interface Ctx {
  width: number;
  color: boolean;
  inherit?: TextStyle;
}

const BULLETS = ['•', '◦', '▪'];

function HeadingBlock({ node, ctx }: { node: Heading; ctx: Ctx }) {
  const text = plainText(node.children);
  if (node.depth === 1) {
    const w = Math.min(ctx.width, Math.max(1, visualWidth(text)));
    return (
      <Box flexDirection="column">
        <Text {...ELEMENT.heading1(ctx.color)}>
          <Inline nodes={node.children} color={ctx.color} inherit={ELEMENT.heading1(ctx.color)} />
        </Text>
        <Text {...ELEMENT.heading1(ctx.color)}>{'═'.repeat(w)}</Text>
      </Box>
    );
  }
  if (node.depth === 2) {
    return (
      <Text {...ELEMENT.heading2(ctx.color)}>
        <Inline nodes={node.children} color={ctx.color} inherit={ELEMENT.heading2(ctx.color)} />
      </Text>
    );
  }
  return (
    <Text {...ELEMENT.headingN()}>
      <Text {...ELEMENT.headingPrefix()}>{'#'.repeat(node.depth)} </Text>
      <Inline nodes={node.children} color={ctx.color} inherit={ELEMENT.headingN()} />
    </Text>
  );
}

function ListBlock({ node, ctx, depth }: { node: List; ctx: Ctx; depth: number }) {
  const start = node.start ?? 1;
  const markers = node.children.map((item: ListItem, i) => {
    if (item.checked === true) return ctx.color ? '☑' : '[x]';
    if (item.checked === false) return ctx.color ? '☐' : '[ ]';
    return node.ordered ? `${start + i}.` : (BULLETS[Math.min(depth, BULLETS.length - 1)] ?? '•');
  });
  const markerWidth = Math.max(...markers.map((m) => visualWidth(m))) + 1;
  return (
    <Box flexDirection="column">
      {node.children.map((item, i) => (
        <Box key={i} flexDirection="row">
          <Box width={markerWidth} flexShrink={0}>
            <Text {...ELEMENT.bullet(ctx.color)}>{markers[i]}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {item.children.map((child, j) => (
              <BlockNode
                key={j}
                node={child}
                ctx={{ ...ctx, width: Math.max(8, ctx.width - markerWidth) }}
                depth={depth + 1}
                tight={node.spread !== true}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function BlockquoteBlock({ node, ctx, depth }: { node: Blockquote; ctx: Ctx; depth: number }) {
  const inner: Ctx = {
    ...ctx,
    width: Math.max(8, ctx.width - 2),
    inherit: { ...ctx.inherit, ...ELEMENT.quoteText() },
  };
  // A left border draws the bar on every line of the quote (nested quotes stack bars naturally).
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderColor={ctx.color ? 'gray' : undefined}
      borderDimColor={!ctx.color}
      paddingLeft={1}
    >
      {node.children.map((child, i) => (
        <BlockNode
          key={i}
          node={child}
          ctx={inner}
          depth={depth}
          tight={i === node.children.length - 1}
        />
      ))}
    </Box>
  );
}

function BlockNode({
  node,
  ctx,
  depth,
  tight,
}: {
  node: RootContent;
  ctx: Ctx;
  depth: number;
  tight?: boolean;
}) {
  const gap = tight ? 0 : 1;
  switch (node.type) {
    case 'heading':
      return (
        <Box marginBottom={gap}>
          <HeadingBlock node={node} ctx={ctx} />
        </Box>
      );
    case 'paragraph':
      return (
        <Box marginBottom={gap} width={ctx.width}>
          <Text {...ctx.inherit}>
            <Inline nodes={node.children} color={ctx.color} inherit={ctx.inherit} />
          </Text>
        </Box>
      );
    case 'list':
      return (
        <Box marginBottom={gap}>
          <ListBlock node={node} ctx={ctx} depth={depth} />
        </Box>
      );
    case 'blockquote':
      return (
        <Box marginBottom={gap}>
          <BlockquoteBlock node={node} ctx={ctx} depth={depth} />
        </Box>
      );
    case 'code':
      return (
        <Box marginBottom={gap}>
          <CodeBlock code={node.value} lang={node.lang} width={ctx.width} color={ctx.color} />
        </Box>
      );
    case 'table':
      return (
        <Box marginBottom={gap}>
          <Table node={node} width={ctx.width} color={ctx.color} />
        </Box>
      );
    case 'thematicBreak':
      return (
        <Box marginBottom={gap}>
          <Text {...ELEMENT.rule()}>{'─'.repeat(Math.max(1, ctx.width))}</Text>
        </Box>
      );
    case 'html':
      return (
        <Box marginBottom={gap}>
          <Text {...ELEMENT.html()}>{node.value}</Text>
        </Box>
      );
    case 'listItem':
      return (
        <Box flexDirection="column">
          {node.children.map((c, i) => (
            <BlockNode key={i} node={c} ctx={ctx} depth={depth} tight />
          ))}
        </Box>
      );
    case 'definition':
    case 'footnoteDefinition':
      return null;
    default: {
      // Phrasing content at block level (rare) — render inline.
      const n = node as PhrasingContent;
      return (
        <Text {...ctx.inherit}>
          <Inline nodes={[n]} color={ctx.color} inherit={ctx.inherit} />
        </Text>
      );
    }
  }
}

/** Renders markdown as Ink components (contracts/markdown-rendering.md). Never throws. */
export const Markdown = memo(function Markdown({ source, width, color }: MarkdownProps) {
  const tree = parseMarkdown(source);
  const ctx: Ctx = { width: Math.max(8, width), color };
  const children = tree.children;
  return (
    <Box flexDirection="column" width={ctx.width}>
      {children.map((node, i) => (
        <BlockNode key={i} node={node} ctx={ctx} depth={0} tight={i === children.length - 1} />
      ))}
    </Box>
  );
});
