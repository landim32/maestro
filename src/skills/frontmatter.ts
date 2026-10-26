/**
 * Minimal reader for the YAML header of a SKILL.md (specs/013 research R1). Only top-level
 * scalars matter (`name`, `description`): plain, single- or double-quoted values, `|`/`>`
 * blocks and plain values continued on indented lines. Nested lists and maps are skipped.
 */

export type Frontmatter = { fields: Record<string, string>; body: string } | { error: string };

const KEY = /^([A-Za-z0-9_-]+)\s*:(?:\s+(.*)|\s*)$/;

export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return { error: 'sem cabeçalho (---) no início do arquivo' };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return { error: 'cabeçalho sem fechamento ---' };

  const header = lines.slice(1, end);
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < header.length) {
    const line = header[i]!;
    const m = /^\S/.test(line) ? KEY.exec(line) : null;
    i += 1;
    if (!m) continue;
    const key = m[1]!;
    const raw = (m[2] ?? '').trim();
    // The indented lines that follow belong to this key (block, continuation or nested data).
    const more: string[] = [];
    while (i < header.length && (header[i]!.trim() === '' || /^\s/.test(header[i]!))) {
      more.push(header[i]!);
      i += 1;
    }
    const value = scalar(raw, more);
    if (value !== undefined) fields[key] = value;
  }

  const rest = lines.slice(end + 1);
  if (rest[0]?.trim() === '') rest.shift();
  return { fields, body: rest.join('\n') };
}

function scalar(raw: string, more: string[]): string | undefined {
  const block = /^([|>])([+-]?)\s*(?:#.*)?$/.exec(raw);
  if (block) return blockScalar(block[1] as '|' | '>', block[2] ?? '', more);
  if (raw.startsWith('"')) return doubleQuoted(raw, more);
  if (raw.startsWith("'")) return singleQuoted(raw, more);
  if (raw === '') return undefined; // a nested map or list
  const cont = more.map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('- '));
  return [stripComment(raw), ...cont].join(' ').trim();
}

function stripComment(v: string): string {
  return v.replace(/\s+#.*$/, '');
}

function blockScalar(style: '|' | '>', chomp: string, more: string[]): string {
  const nonEmpty = more.filter((l) => l.trim() !== '');
  const indent = Math.min(...nonEmpty.map((l) => /^\s*/.exec(l)![0].length));
  const body = more.map((l) => (l.trim() === '' ? '' : l.slice(indent)));
  while (body.length && body[body.length - 1] === '') body.pop();
  let text = '';
  if (style === '|') text = body.join('\n');
  else {
    // Folded: a line break between text lines becomes a space, an empty line a newline.
    for (const l of body) {
      if (l === '') text += '\n';
      else text += text === '' || text.endsWith('\n') ? l : ` ${l}`;
    }
  }
  return chomp === '-' ? text : `${text}\n`;
}

function doubleQuoted(raw: string, more: string[]): string {
  const src = [raw, ...more.map((l) => l.trim())].join(' ');
  let out = '';
  for (let k = 1; k < src.length; k += 1) {
    const c = src[k]!;
    if (c === '"') break;
    if (c !== '\\') {
      out += c;
      continue;
    }
    k += 1;
    const e = src[k];
    out += e === 'n' ? '\n' : e === 't' ? '\t' : (e ?? '');
  }
  return out;
}

function singleQuoted(raw: string, more: string[]): string {
  const src = [raw, ...more.map((l) => l.trim())].join(' ');
  let out = '';
  for (let k = 1; k < src.length; k += 1) {
    const c = src[k]!;
    if (c === "'") {
      if (src[k + 1] === "'") {
        out += "'";
        k += 1;
        continue;
      }
      break;
    }
    out += c;
  }
  return out;
}
