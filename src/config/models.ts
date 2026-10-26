import { DEFAULTS } from './defaults.js';
import type { ProviderId, Settings } from './schema.js';
import type { SettingsPatchEntry } from './writer.js';

type Json = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function dedupe(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of list) if (!out.includes(m)) out.push(m);
  return out;
}

/**
 * Effective catalogue of a provider: `models` plus the configured `model`
 * (appended when missing), without repeats. Never empty (data-model § 2.2).
 */
export function modelCatalog(settings: Settings, id: ProviderId): string[] {
  const p = settings.providers[id];
  return dedupe([...p.models, p.model]);
}

const DEFAULT_MODELS: Record<ProviderId, readonly string[]> = {
  claude: DEFAULTS.claude.models,
  qwen: DEFAULTS.qwen.models,
  'claude-code': DEFAULTS.claudeCode.models,
  codex: DEFAULTS.codex.models,
};

/** `models` as stored in the raw global file (or the provider default when absent/empty). */
function rawModels(globalRaw: Json, id: ProviderId): string[] {
  const providers = globalRaw['providers'];
  const provider = isPlainObject(providers) ? providers[id] : undefined;
  const models = isPlainObject(provider) ? provider['models'] : undefined;
  if (Array.isArray(models) && models.length > 0) {
    return dedupe(models.filter((m): m is string => typeof m === 'string'));
  }
  return [...DEFAULT_MODELS[id]];
}

/**
 * Patch that appends `model` to `providers.<id>.models` of the **raw global** file,
 * or `[]` when it is already there. Works on the raw file (not the merged Settings)
 * so a project-level list is never copied into the global one (research R6).
 */
export function learnModelPatch(
  globalRaw: Json,
  id: ProviderId,
  model: string,
): SettingsPatchEntry[] {
  const name = model.trim();
  if (name === '') return [];
  const current = rawModels(globalRaw, id);
  if (current.includes(name)) return [];
  return [{ path: `providers.${id}.models`, value: [...current, name] }];
}
