import fs from 'node:fs';
import path from 'node:path';

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Longest existing ancestor of `p` (or `p` itself) plus the non-existing remainder. */
function splitExisting(p: string): { existing: string; rest: string[] } {
  const rest: string[] = [];
  let cur = p;
  for (;;) {
    if (fs.existsSync(cur)) return { existing: cur, rest };
    const parent = path.dirname(cur);
    if (parent === cur) return { existing: cur, rest };
    rest.unshift(path.basename(cur));
    cur = parent;
  }
}

/**
 * Resolves `inputPath` relative to `cwd` and guarantees the result stays inside `cwd`,
 * following symlinks of every existing ancestor (FR-022). Throws SandboxError otherwise.
 */
export function resolveInsideCwd(cwd: string, inputPath: string): string {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new SandboxError('path must be a non-empty string');
  }
  if (inputPath.includes('\0')) throw new SandboxError('path contains an invalid character');

  const root = path.resolve(cwd);
  const resolved = path.resolve(root, inputPath);
  if (!isInside(root, resolved)) {
    throw new SandboxError(`path outside workspace: ${inputPath}`);
  }

  // Symlink check: compare real paths of the nearest existing ancestor.
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
  const { existing, rest } = splitExisting(resolved);
  const realExisting = fs.realpathSync(existing);
  const realTarget = path.join(realExisting, ...rest);
  if (!isInside(realRoot, realTarget)) {
    throw new SandboxError(`path outside workspace (via symlink): ${inputPath}`);
  }
  return resolved;
}

/** Caps `text` to `max` characters, appending a marker with the number of omitted characters. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n… [truncated ${omitted} characters]`;
}
