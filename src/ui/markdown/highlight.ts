import { createLowlight } from 'lowlight';
import type { Element, ElementContent, Root as HastRoot } from 'hast';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import powershell from 'highlight.js/lib/languages/powershell';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import dockerfile from 'highlight.js/lib/languages/dockerfile';

const low = createLowlight({
  typescript,
  javascript,
  json,
  python,
  bash,
  powershell,
  markdown,
  yaml,
  xml,
  css,
  sql,
  go,
  rust,
  java,
  csharp,
  diff,
  ini,
  dockerfile,
});

export const SUPPORTED_LANGUAGES: readonly string[] = [
  'typescript',
  'javascript',
  'json',
  'python',
  'bash',
  'powershell',
  'markdown',
  'yaml',
  'xml',
  'css',
  'sql',
  'go',
  'rust',
  'java',
  'csharp',
  'diff',
  'ini',
  'dockerfile',
];

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  jsonc: 'json',
  json5: 'json',
  py: 'python',
  python3: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  ps1: 'powershell',
  pwsh: 'powershell',
  md: 'markdown',
  yml: 'yaml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  vue: 'xml',
  rs: 'rust',
  cs: 'csharp',
  'c#': 'csharp',
  toml: 'ini',
  docker: 'dockerfile',
  golang: 'go',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  patch: 'diff',
};

/** Maps a fence info string (e.g. "ts", "TypeScript", "python title=x") to a registered language, or undefined. */
export function resolveLanguage(lang?: string | null): string | undefined {
  if (!lang) return undefined;
  const key = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!key) return undefined;
  if (SUPPORTED_LANGUAGES.includes(key)) return key;
  return ALIASES[key];
}

export interface Span {
  text: string;
  token?: string;
}
export interface HighlightedLine {
  spans: Span[];
}

function tokenOf(el: Element, parent?: string): string | undefined {
  const cls = el.properties?.['className'];
  const names = Array.isArray(cls) ? cls.map(String) : typeof cls === 'string' ? [cls] : [];
  const hl = names.find((n) => n.startsWith('hljs-'));
  if (!hl) return parent;
  const token = hl.slice('hljs-'.length);
  // hljs nests e.g. <span class="hljs-title function_">; keep the primary token, add sub-scope when present.
  const sub = names.find((n) => n.endsWith('_') && !n.startsWith('hljs-'));
  return sub ? `${token}.${sub.slice(0, -1)}` : token;
}

function flatten(nodes: ElementContent[], token: string | undefined, out: Span[]): void {
  for (const n of nodes) {
    if (n.type === 'text') out.push({ text: n.value, token });
    else if (n.type === 'element') flatten(n.children, tokenOf(n, token), out);
  }
}

function splitLines(spans: Span[]): HighlightedLine[] {
  const lines: HighlightedLine[] = [{ spans: [] }];
  for (const s of spans) {
    const parts = s.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push({ spans: [] });
      if (part !== '') lines[lines.length - 1]!.spans.push({ text: part, token: s.token });
    });
  }
  // A trailing newline must not produce an extra empty line.
  if (lines.length > 1 && lines[lines.length - 1]!.spans.length === 0) lines.pop();
  return lines;
}

/** Highlights `code`; unknown/unsupported languages yield untokenized spans. Never throws. */
export function highlight(code: string, lang?: string | null): HighlightedLine[] {
  const resolved = resolveLanguage(lang);
  if (!resolved) return splitLines([{ text: code }]);
  try {
    const tree: HastRoot = low.highlight(resolved, code);
    const spans: Span[] = [];
    flatten(tree.children as ElementContent[], undefined, spans);
    return splitLines(spans);
  } catch {
    return splitLines([{ text: code }]);
  }
}
