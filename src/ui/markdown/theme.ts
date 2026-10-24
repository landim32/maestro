/** Colors per highlight.js token and per markdown element (contracts/markdown-rendering.md § 2–3). */

export interface TextStyle {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  dimColor?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
  backgroundColor?: string;
}

const TOKEN_STYLES: Record<string, TextStyle> = {
  keyword: { color: 'magenta' },
  'selector-tag': { color: 'magenta' },
  string: { color: 'green' },
  regexp: { color: 'green' },
  number: { color: 'yellow' },
  literal: { color: 'yellow' },
  comment: { color: 'gray', italic: true },
  quote: { color: 'gray', italic: true },
  function: { color: 'cyan' },
  title: { color: 'cyan' },
  'title.function': { color: 'cyan' },
  'title.class': { color: 'blue', bold: true },
  type: { color: 'blue' },
  built_in: { color: 'blue' },
  class: { color: 'blue' },
  attr: { color: 'cyanBright' },
  attribute: { color: 'cyanBright' },
  property: { color: 'cyanBright' },
  variable: {},
  params: {},
  operator: { color: 'white' },
  punctuation: { color: 'white' },
  meta: { color: 'gray' },
  symbol: { color: 'yellow' },
  bullet: { color: 'yellow' },
  addition: { color: 'green' },
  deletion: { color: 'red' },
  section: { color: 'cyan', bold: true },
  name: { color: 'magenta' },
  tag: { color: 'gray' },
  emphasis: { italic: true },
  strong: { bold: true },
  link: { color: 'blue', underline: true },
};

/** Style for an hljs token (e.g. "keyword", "title.function"). Empty when colors are off. */
export function styleFor(token: string | undefined, color: boolean): TextStyle {
  if (!color || !token) return {};
  if (TOKEN_STYLES[token]) return TOKEN_STYLES[token]!;
  const base = token.split('.')[0]!;
  return TOKEN_STYLES[base] ?? {};
}

export const ELEMENT = {
  heading1: (color: boolean): TextStyle => (color ? { bold: true, color: 'cyan' } : { bold: true }),
  heading2: (color: boolean): TextStyle => (color ? { bold: true, color: 'cyan' } : { bold: true }),
  headingN: (): TextStyle => ({ bold: true }),
  headingPrefix: (): TextStyle => ({ dimColor: true }),
  inlineCode: (color: boolean): TextStyle =>
    color ? { color: 'yellow', backgroundColor: '#303030' } : {},
  link: (color: boolean): TextStyle =>
    color ? { color: 'blue', underline: true } : { underline: true },
  linkUrl: (): TextStyle => ({ dimColor: true }),
  strike: (): TextStyle => ({ strikethrough: true, dimColor: true }),
  bullet: (color: boolean): TextStyle => (color ? { color: 'cyan' } : {}),
  quoteBar: (): TextStyle => ({ dimColor: true }),
  quoteText: (): TextStyle => ({ italic: true }),
  codeBorder: 'gray',
  codeLang: (): TextStyle => ({ dimColor: true }),
  tableHeader: (): TextStyle => ({ bold: true }),
  rule: (): TextStyle => ({ dimColor: true }),
  html: (): TextStyle => ({ dimColor: true }),
} as const;
