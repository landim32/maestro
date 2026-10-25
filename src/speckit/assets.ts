import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read-only access to the bundled Spec Kit files (assets/speckit, shipped in the package). */
export interface AssetsPort {
  /** Upstream tag, e.g. `v1.2.3`. */
  version: string;
  /** Upstream commit the assets were taken from. */
  commit: string;
  exists(rel: string): boolean;
  read(rel: string): string;
  /** All relative paths (forward slashes). */
  list(): string[];
}

function walk(dir: string, prefix: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, out);
    else out.push(rel);
  }
}

/** Assets rooted at a directory (tests point it at fixtures). */
export function assetsAt(root: string): AssetsPort {
  const versionLine = fs.existsSync(path.join(root, 'VERSION'))
    ? fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
    : 'unknown unknown';
  const [version = 'unknown', commit = 'unknown'] = versionLine.split(/\s+/);
  return {
    version,
    commit,
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    list: () => {
      const out: string[] = [];
      walk(root, '', out);
      return out.sort();
    },
  };
}

/** `assets/speckit` next to the package: ../../assets/speckit from both src/speckit and dist/speckit. */
export function bundledAssets(): AssetsPort {
  return assetsAt(fileURLToPath(new URL('../../assets/speckit/', import.meta.url)));
}
