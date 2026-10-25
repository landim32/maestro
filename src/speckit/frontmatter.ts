/**
 * Minimal YAML subset parser for Spec Kit files (command frontmatter, preset manifests):
 * scalars, nested maps by indentation, lists of scalars and lists of maps, `#` comments.
 * Anything beyond that (anchors, multi-line scalars, flow collections) raises a clear error.
 */

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

export class YamlSubsetError extends Error {
  constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.name = 'YamlSubsetError';
  }
}

interface Line {
  indent: number;
  text: string;
  no: number;
}

function stripComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(raw[i - 1] ?? ''))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function toLines(src: string): Line[] {
  const out: Line[] = [];
  src.split(/\r?\n/).forEach((raw, i) => {
    const text = stripComment(raw).trimEnd();
    if (text.trim() === '') return;
    out.push({ indent: raw.length - raw.trimStart().length, text: text.trim(), no: i + 1 });
  });
  return out;
}

export function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s
      .slice(1, -1)
      .replace(/\\(["\\nt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((p) => parseScalar(p));
  }
  return s;
}

/** Splits `key: value` at the first unquoted `: `; returns undefined when the line is not a key. */
function splitKey(text: string): { key: string; rest: string } | undefined {
  const m = /^([^\s:'"][^:]*?|'[^']*'|"[^"]*")\s*:(?:\s+(.*))?$/.exec(text);
  if (!m) return undefined;
  const key = String(parseScalar(m[1]!));
  return { key, rest: (m[2] ?? '').trim() };
}

function parseBlock(
  lines: Line[],
  start: number,
  indent: number,
): { value: unknown; next: number } {
  const first = lines[start];
  if (!first) return { value: {}, next: start };
  if (first.text.startsWith('- ') || first.text === '-') return parseList(lines, start, indent);
  return parseMap(lines, start, indent);
}

function parseMap(
  lines: Line[],
  start: number,
  indent: number,
): { value: Record<string, unknown>; next: number } {
  const out: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlSubsetError('unexpected indentation', line.no);
    const kv = splitKey(line.text);
    if (!kv) throw new YamlSubsetError(`expected "key: value", got "${line.text}"`, line.no);
    if (kv.rest !== '') {
      out[kv.key] = parseScalar(kv.rest);
      i += 1;
      continue;
    }
    const next = lines[i + 1];
    if (next && next.indent > indent) {
      const child = parseBlock(lines, i + 1, next.indent);
      out[kv.key] = child.value;
      i = child.next;
    } else if (next && next.indent === indent && next.text.startsWith('- ')) {
      // list items at the same indentation as the key (common YAML style)
      const child = parseList(lines, i + 1, indent);
      out[kv.key] = child.value;
      i = child.next;
    } else {
      out[kv.key] = null;
      i += 1;
    }
  }
  return { value: out, next: i };
}

function parseList(
  lines: Line[],
  start: number,
  indent: number,
): { value: unknown[]; next: number } {
  const out: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent || !(line.text.startsWith('- ') || line.text === '-')) break;
    if (line.indent > indent) throw new YamlSubsetError('unexpected indentation in list', line.no);
    const item = line.text === '-' ? '' : line.text.slice(2).trim();
    const kv = splitKey(item);
    if (kv) {
      // "- key: value" starts an inline map whose further keys are indented by two more columns
      const synthetic: Line[] = [{ indent: indent + 2, text: item, no: line.no }];
      let j = i + 1;
      while (j < lines.length && lines[j]!.indent > indent) {
        synthetic.push(lines[j]!);
        j += 1;
      }
      const child = parseMap(synthetic, 0, indent + 2);
      out.push(child.value);
      i = j;
    } else {
      out.push(parseScalar(item));
      i += 1;
    }
  }
  return { value: out, next: i };
}

export function parseYamlSubset(src: string): Record<string, unknown> {
  const lines = toLines(src);
  if (lines.length === 0) return {};
  const { value, next } = parseMap(lines, 0, lines[0]!.indent);
  if (next < lines.length) throw new YamlSubsetError('unparsed content', lines[next]!.no);
  return value;
}

/** Splits `---` frontmatter from the markdown body; no frontmatter → `data = {}`. */
export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalized);
  if (!m) return { data: {}, body: normalized };
  return { data: parseYamlSubset(m[1]!), body: normalized.slice(m[0].length) };
}
