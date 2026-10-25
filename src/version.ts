import { readFileSync } from 'node:fs';

export const APP_NAME = 'maestro';

export interface VersionInfo {
  /** SemVer shown to the user (e.g. `0.1.2` or `0.2.0-alpha.3`). */
  version: string;
  fullVersion?: string;
  branch?: string;
  sha?: string;
  /** `gitversion` (CI outputs), `git` (computed from tags + commit prefixes) or `package`. */
  source: 'gitversion' | 'git' | 'package';
}

function readJson(url: URL): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * The version comes from GitVersion, not from a constant:
 * `scripts/version.mjs --write` stamps `version.json` next to this module
 * (`dist/version.json` on build, `src/version.json` on `npm run dev`).
 * Without a stamp (e.g. tests), `package.json` is the fallback.
 */
function loadVersion(): VersionInfo {
  const stamped = readJson(new URL('./version.json', import.meta.url));
  if (stamped && typeof stamped['version'] === 'string') {
    return {
      version: stamped['version'],
      fullVersion: typeof stamped['fullVersion'] === 'string' ? stamped['fullVersion'] : undefined,
      branch: typeof stamped['branch'] === 'string' ? stamped['branch'] : undefined,
      sha: typeof stamped['sha'] === 'string' ? stamped['sha'] : undefined,
      source: stamped['source'] === 'gitversion' ? 'gitversion' : 'git',
    };
  }
  const pkg = readJson(new URL('../package.json', import.meta.url));
  const version = pkg && typeof pkg['version'] === 'string' ? pkg['version'] : '0.0.0';
  return { version, source: 'package' };
}

export const VERSION_INFO: VersionInfo = loadVersion();
export const VERSION = VERSION_INFO.version;
