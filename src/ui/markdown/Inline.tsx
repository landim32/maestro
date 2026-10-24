import { Fragment } from 'react';
import { Text } from 'ink';
import type { PhrasingContent } from 'mdast';
import { ELEMENT } from './theme.js';
import type { TextStyle } from './theme.js';

export interface InlineProps {
  nodes: PhrasingContent[];
  color: boolean;
  inherit?: TextStyle;
}

function merge(a: TextStyle | undefined, b: TextStyle): TextStyle {
  return { ...(a ?? {}), ...b };
}

/** Plain text of inline nodes (used for tables, headings underline width, link comparison). */
export function plainText(nodes: PhrasingContent[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
      case 'inlineCode':
      case 'html':
        out += n.value;
        break;
      case 'break':
        out += '\n';
        break;
      case 'image':
        out += `[imagem: ${n.alt ?? ''}] (${n.url})`;
        break;
      case 'strong':
      case 'emphasis':
      case 'delete':
      case 'link':
      case 'linkReference':
        out += plainText(n.children as PhrasingContent[]);
        break;
      case 'imageReference':
        out += `[${n.alt ?? ''}]`;
        break;
      default:
        break;
    }
  }
  return out;
}

/** Renders phrasing content as nested <Text> (contracts/markdown-rendering.md § 2). */
export function Inline({ nodes, color, inherit }: InlineProps) {
  return (
    <>
      {nodes.map((n, i) => (
        <Fragment key={i}>{renderNode(n, color, inherit)}</Fragment>
      ))}
    </>
  );
}

function renderNode(n: PhrasingContent, color: boolean, inherit?: TextStyle) {
  switch (n.type) {
    case 'text':
      return <Text {...inherit}>{n.value}</Text>;
    case 'strong':
      return (
        <Text {...merge(inherit, { bold: true })}>
          <Inline nodes={n.children} color={color} inherit={merge(inherit, { bold: true })} />
        </Text>
      );
    case 'emphasis':
      return (
        <Text {...merge(inherit, { italic: true })}>
          <Inline nodes={n.children} color={color} inherit={merge(inherit, { italic: true })} />
        </Text>
      );
    case 'delete':
      return (
        <Text {...merge(inherit, ELEMENT.strike())}>
          <Inline nodes={n.children} color={color} inherit={merge(inherit, ELEMENT.strike())} />
        </Text>
      );
    case 'inlineCode':
      return color ? (
        <Text {...merge(inherit, ELEMENT.inlineCode(color))}>{n.value}</Text>
      ) : (
        <Text {...inherit}>`{n.value}`</Text>
      );
    case 'link': {
      const label = plainText(n.children);
      const showUrl =
        label.trim() !== '' && label !== n.url && label !== n.url.replace(/^mailto:/, '');
      return (
        <Text {...inherit}>
          <Text {...merge(inherit, ELEMENT.link(color))}>
            <Inline
              nodes={n.children}
              color={color}
              inherit={merge(inherit, ELEMENT.link(color))}
            />
          </Text>
          {showUrl && <Text {...merge(inherit, ELEMENT.linkUrl())}> ({n.url})</Text>}
        </Text>
      );
    }
    case 'linkReference':
      return (
        <Text {...inherit}>
          <Inline nodes={n.children} color={color} inherit={inherit} />
        </Text>
      );
    case 'image':
      return (
        <Text {...merge(inherit, ELEMENT.linkUrl())}>
          [imagem: {n.alt ?? ''}] ({n.url})
        </Text>
      );
    case 'imageReference':
      return <Text {...inherit}>[{n.alt ?? ''}]</Text>;
    case 'html':
      return <Text {...merge(inherit, ELEMENT.html())}>{n.value}</Text>;
    case 'break':
      return <Text>{'\n'}</Text>;
    case 'footnoteReference':
      return <Text {...merge(inherit, ELEMENT.linkUrl())}>[^{n.identifier}]</Text>;
    default:
      return null;
  }
}
