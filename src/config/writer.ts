import fs from 'node:fs';
import path from 'node:path';
import { MaestroError } from '../utils/errors.js';
import { INITIAL_SETTINGS } from './defaults.js';
import { projectSettingsPath } from './paths.js';
import { formatZodIssues, settingsSchema } from './schema.js';

export interface SettingsPatchEntry {
  /** Dotted path, e.g. `providers.qwen.apiKey`. `value === undefined` removes the key. */
  path: string;
  value: unknown;
}

export interface WriteSettingsOptions {
  globalPath: string;
  /** When given, `./.maestro/settings.json` is inspected for overriding keys. */
  cwd?: string;
}

export interface WriteResult {
  path: string;
  overriddenByProject: string[];
}

type Json = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Current raw file content (keeps `_comment` and anything else), or the first-run template. */
export function readRawSettings(file: string): Json {
  if (!fs.existsSync(file)) return structuredClone(INITIAL_SETTINGS) as unknown as Json;
  const text = fs.readFileSync(file, 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (!isPlainObject(parsed)) {
    throw new MaestroError({
      category: 'invalid_config',
      message: `${file}: must be a JSON object`,
    });
  }
  return parsed;
}

function normalizeValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (key === 'apiKey') {
    const cleaned = value.replace(/\s+/g, '');
    return cleaned === '' ? undefined : cleaned;
  }
  if (key === 'baseUrl') {
    const trimmed = value.trim().replace(/\/+$/, '');
    return trimmed === '' ? undefined : trimmed;
  }
  if (key === 'model') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return value;
}

/** Applies dotted-path patches to a deep clone of `raw`. */
export function applyPatch(raw: Json, patch: SettingsPatchEntry[]): Json {
  const out = structuredClone(raw);
  for (const entry of patch) {
    const segments = entry.path.split('.').filter(Boolean);
    if (segments.length === 0) continue;
    const last = segments[segments.length - 1]!;
    const value = normalizeValue(last, entry.value);
    let cursor: Json = out;
    let missing = false;
    for (const seg of segments.slice(0, -1)) {
      if (!isPlainObject(cursor[seg])) {
        if (value === undefined) {
          missing = true; // nothing to delete; don't create intermediates
          break;
        }
        cursor[seg] = {};
      }
      cursor = cursor[seg] as Json;
    }
    if (missing) continue;
    if (value === undefined) delete cursor[last];
    else cursor[last] = value;
  }
  return out;
}

/** Keys of `paths` that the project-level settings file defines (and therefore overrides). */
export function projectOverrides(paths: string[], cwd: string): string[] {
  const file = projectSettingsPath(cwd);
  if (!fs.existsSync(file)) return [];
  let project: Json;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isPlainObject(parsed)) return [];
    project = parsed;
  } catch {
    return [];
  }
  return paths.filter((p) => {
    let cursor: unknown = project;
    for (const seg of p.split('.')) {
      if (!isPlainObject(cursor) || !(seg in cursor)) return false;
      cursor = cursor[seg];
    }
    return true;
  });
}

/**
 * Validates then atomically writes the patched global settings file
 * (contracts/settings-writer.md). Never writes an invalid file.
 */
export function writeSettings(
  patch: SettingsPatchEntry[],
  opts: WriteSettingsOptions,
): WriteResult {
  const file = opts.globalPath;
  let raw: Json;
  try {
    raw = readRawSettings(file);
  } catch (err) {
    if (err instanceof MaestroError) throw err;
    throw new MaestroError({
      category: 'invalid_config',
      message: `could not read ${file}: ${err instanceof Error ? err.message : String(err)}`,
      cause: err,
    });
  }

  const next = applyPatch(raw, patch);
  const check = settingsSchema.safeParse(next);
  if (!check.success) {
    throw new MaestroError({
      category: 'invalid_config',
      message: formatZodIssues(check.error).join('; '),
      hint: `nothing was written to ${file}`,
    });
  }

  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    const code =
      (err as { code?: string }).code ?? (err instanceof Error ? err.message : String(err));
    throw new MaestroError({
      category: 'invalid_config',
      message: `could not write ${file}: ${code}`,
      hint: 'the configuration applies to this session only',
      cause: err,
    });
  }

  const overriddenByProject = opts.cwd
    ? projectOverrides(
        patch.map((p) => p.path),
        opts.cwd,
      )
    : [];
  return { path: file, overriddenByProject };
}
