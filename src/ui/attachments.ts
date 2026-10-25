/**
 * Pasted file paths → attachments (specs/007 data-model.md § 2, contracts/attachments.md).
 * Tokenization and classification are pure except for the file-system probes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countLines, formatBytes } from './chips.js';

export interface AttachLimits {
  attachMaxBytes: number;
  attachMaxTotalBytes: number;
  imageMaxBytes: number;
}

export type RejectReason =
  'binary' | 'too-large' | 'outside' | 'image-too-large' | 'images-unsupported';

export type PathClass =
  | { kind: 'text'; abs: string; rel: string; name: string; bytes: number; lines: number }
  | { kind: 'image'; abs: string; rel: string; name: string; bytes: number; mediaType: string }
  | {
      kind: 'rejected';
      abs: string;
      rel: string;
      name: string;
      bytes: number;
      reason: RejectReason;
    };

export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Bytes inspected for a NUL byte (same rule as read_file). */
const BINARY_PROBE_BYTES = 8000;

/**
 * Splits a paste into candidate tokens: by line breaks, by spaces outside quotes, and by
 * single/double quotes (a quoted token may contain spaces).
 */
export function splitPastedPaths(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | undefined;
  const flush = () => {
    if (cur !== '') out.push(cur);
    cur = '';
  };
  for (const ch of text) {
    if (quote) {
      if (ch === quote) {
        quote = undefined;
        flush();
      } else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      flush();
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return out;
}

function homeDir(env: NodeJS.ProcessEnv): string {
  return env['HOME'] ?? env['USERPROFILE'] ?? os.homedir();
}

/**
 * Resolves one token (`file://`, `~`, absolute or relative to `cwd`) to an absolute path
 * when it names an existing FILE; directories and missing paths → undefined.
 */
export function resolvePastedPath(
  token: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  let candidate = token.trim();
  if (candidate === '') return undefined;
  if (candidate.includes('\0')) return undefined;
  try {
    if (/^file:\/\//i.test(candidate)) candidate = fileURLToPath(candidate);
    else if (candidate === '~' || candidate.startsWith('~/') || candidate.startsWith('~\\')) {
      candidate = path.join(homeDir(env), candidate.slice(1));
    }
    const abs = path.resolve(cwd, candidate);
    return fs.statSync(abs).isFile() ? abs : undefined;
  } catch {
    return undefined;
  }
}

/** True when a chunk of the file contains a NUL byte. */
export function looksBinary(abs: string): boolean {
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(BINARY_PROBE_BYTES);
    const n = fs.readSync(fd, buf, 0, BINARY_PROBE_BYTES, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

/** Path relative to `cwd` with `/` separators, or undefined when outside it. */
export function relativeInside(cwd: string, abs: string): string | undefined {
  const rel = path.relative(path.resolve(cwd), abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join('/');
}

/** Classifies an existing file (contracts/attachments.md § 2). */
export function classifyPath(
  abs: string,
  cwd: string,
  limits: AttachLimits,
  imagesOk: boolean,
): PathClass {
  const name = path.basename(abs);
  const bytes = fs.statSync(abs).size;
  const rel = relativeInside(cwd, abs);
  const base = { abs, rel: rel ?? abs, name, bytes };
  if (rel === undefined) return { kind: 'rejected', ...base, reason: 'outside' };
  const mediaType = IMAGE_TYPES[path.extname(abs).toLowerCase()];
  if (mediaType) {
    if (!imagesOk) return { kind: 'rejected', ...base, reason: 'images-unsupported' };
    if (bytes > limits.imageMaxBytes)
      return { kind: 'rejected', ...base, reason: 'image-too-large' };
    return { kind: 'image', ...base, mediaType };
  }
  if (looksBinary(abs)) return { kind: 'rejected', ...base, reason: 'binary' };
  if (bytes > limits.attachMaxBytes) return { kind: 'rejected', ...base, reason: 'too-large' };
  return { kind: 'text', ...base, lines: countLines(fs.readFileSync(abs, 'utf8')) };
}

/** User-facing reason for a refused attachment (contracts/attachments.md § 2). */
export function rejectionMessage(
  c: Extract<PathClass, { kind: 'rejected' }>,
  limits: AttachLimits,
  providerId = 'ativo',
): string {
  switch (c.reason) {
    case 'images-unsupported':
      return `O provedor ${providerId} não aceita imagens; o caminho entrou como texto.`;
    case 'image-too-large':
      return `Imagem ${c.name} (${formatBytes(c.bytes)}) acima do limite (${formatBytes(limits.imageMaxBytes)}).`;
    case 'binary':
      return `${c.name} parece binário; o caminho entrou como texto.`;
    case 'too-large':
      return `${c.name} (${formatBytes(c.bytes)}) acima do limite (${formatBytes(limits.attachMaxBytes)}); use read_file ou aumente ui.attachMaxBytes.`;
    case 'outside':
      return `${c.name} está fora da pasta de trabalho; o caminho entrou como texto.`;
  }
}

/** Reads a text attachment at send time; undefined when the file is gone. */
export function readAttachment(abs: string): { text: string; lines: number } | undefined {
  try {
    const text = fs.readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n');
    return { text, lines: countLines(text) };
  } catch {
    return undefined;
  }
}

/** Reads an image as base64 at send time; undefined when the file is gone. */
export function readImageBase64(abs: string): string | undefined {
  try {
    return fs.readFileSync(abs).toString('base64');
  } catch {
    return undefined;
  }
}
