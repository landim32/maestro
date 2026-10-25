import fs from 'node:fs';
import path from 'node:path';
import type { GitPort } from './git.js';

export type NumberingMode = 'sequential' | 'timestamp';

export interface InitOptions {
  numbering: NumberingMode;
  /** True when the deprecated `branch_numbering` key was used. */
  deprecatedKey: boolean;
  raw: Record<string, unknown>;
}

/** Reads `.specify/init-options.json` (`feature_numbering`, falling back to `branch_numbering`). */
export function readInitOptions(root: string): InitOptions {
  const file = path.join(root, '.specify', 'init-options.json');
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) raw = parsed as Record<string, unknown>;
  } catch {
    /* missing or invalid: defaults */
  }
  const feature = raw['feature_numbering'];
  const branch = raw['branch_numbering'];
  const value = feature ?? branch;
  return {
    numbering: value === 'timestamp' ? 'timestamp' : 'sequential',
    deprecatedKey: feature === undefined && branch !== undefined,
    raw,
  };
}

const SEQUENTIAL = /^(\d{3,})-/;
const TIMESTAMP = /^\d{8}-\d{6}-/;

/** Highest sequential prefix among `specs/NNN-*` directories (timestamp dirs ignored). */
export function highestFromSpecs(specsDir: string): number {
  let highest = 0;
  if (!fs.existsSync(specsDir)) return 0;
  for (const entry of fs.readdirSync(specsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (TIMESTAMP.test(entry.name)) continue;
    const m = SEQUENTIAL.exec(entry.name);
    if (m) highest = Math.max(highest, Number.parseInt(m[1]!, 10));
  }
  return highest;
}

/** Highest sequential prefix among branch names (local or remote, prefix already stripped). */
export function highestFromBranches(branches: string[]): number {
  let highest = 0;
  for (const name of branches) {
    const short = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
    if (TIMESTAMP.test(short)) continue;
    const m = SEQUENTIAL.exec(short);
    if (m) highest = Math.max(highest, Number.parseInt(m[1]!, 10));
  }
  return highest;
}

export function formatFeatureNum(n: number): string {
  return String(n).padStart(3, '0');
}

/** Next free number across branches and spec directories (research R4). */
export function nextFeatureNumber(root: string, git: GitPort): number {
  const fromSpecs = highestFromSpecs(path.join(root, 'specs'));
  const fromBranches = git.hasGit(root) ? highestFromBranches(git.branches(root)) : 0;
  return Math.max(fromSpecs, fromBranches) + 1;
}

export function specPrefixExists(specsDir: string, featureNum: string): boolean {
  if (!fs.existsSync(specsDir)) return false;
  return fs
    .readdirSync(specsDir, { withFileTypes: true })
    .some((e) => e.isDirectory() && e.name.startsWith(`${featureNum}-`));
}

/** `YYYYMMDD-HHMMSS` in local time, as `date +%Y%m%d-%H%M%S` prints it. */
export function timestampPrefix(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
