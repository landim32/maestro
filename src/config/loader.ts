import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { initialSettingsJson } from './defaults.js';
import { anthropicCredentialDirs, globalSettingsPath, projectSettingsPath } from './paths.js';
import { formatZodIssues, settingsSchema, PROVIDER_IDS } from './schema.js';
import type { ProviderId, Settings } from './schema.js';
import type { ApprovalMode } from '../tools/approval.js';

export type CredentialSource = 'config' | 'env' | 'profile' | 'none';

export interface LoadOverrides {
  provider?: ProviderId;
  model?: string;
  noTools?: boolean;
  /** `--approval-mode` / `--yolo` (contracts/approval-modes.md § 5). */
  approvalMode?: ApprovalMode;
}

export interface LoadOptions {
  configPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  overrides?: LoadOverrides;
}

export interface LoadedSettings {
  settings: Settings;
  created: boolean;
  globalPath: string;
  projectPath?: string;
  credentialSources: Record<ProviderId, CredentialSource>;
}

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(file: string, issues: string[]) {
    super(`${file}:\n  ${issues.join('\n  ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function lineCol(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, position);
  const lines = before.split('\n');
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

function readJsonFile(file: string): Json {
  const text = fs.readFileSync(file, 'utf8');
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) throw new ConfigError(file, ['<root>: must be a JSON object']);
    return parsed;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const m = /position (\d+)/.exec(msg);
    if (m) {
      const { line, column } = lineCol(text, Number(m[1]));
      throw new ConfigError(file, [`invalid JSON at line ${line}, column ${column}`]);
    }
    throw new ConfigError(file, [`invalid JSON: ${msg}`]);
  }
}

/** Shallow merge by top-level key; `providers` merges one level deeper (each provider replaced whole). */
export function mergeSettings(base: Json, override: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key === 'providers' && isPlainObject(value) && isPlainObject(base['providers'])) {
      out['providers'] = { ...(base['providers'] as Json), ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}

function ensureProviders(raw: Json): Json {
  const providers = isPlainObject(raw['providers']) ? { ...raw['providers'] } : {};
  for (const id of PROVIDER_IDS) {
    if (!isPlainObject(providers[id])) providers[id] = {};
    else providers[id] = { ...(providers[id] as Json) };
  }
  return { ...raw, providers };
}

function applyEnv(raw: Json, env: NodeJS.ProcessEnv): Json {
  const out = ensureProviders(raw);
  const providers = out['providers'] as Json;
  const qwen = providers['qwen'] as Json;
  if (env['DASHSCOPE_API_KEY']) qwen['apiKey'] = env['DASHSCOPE_API_KEY'];
  if (env['DASHSCOPE_BASE_URL']) qwen['baseUrl'] = env['DASHSCOPE_BASE_URL'];
  const p = env['MAESTRO_PROVIDER'];
  if (p && (PROVIDER_IDS as readonly string[]).includes(p)) out['activeProvider'] = p;
  return out;
}

function applyOverrides(raw: Json, overrides: LoadOverrides | undefined): Json {
  if (!overrides) return raw;
  const out = ensureProviders(raw);
  if (overrides.provider) out['activeProvider'] = overrides.provider;
  if (overrides.noTools || overrides.approvalMode) {
    const tools = isPlainObject(out['tools']) ? { ...(out['tools'] as Json) } : {};
    if (overrides.noTools) tools['enabled'] = false;
    if (overrides.approvalMode) tools['approvalMode'] = overrides.approvalMode;
    out['tools'] = tools;
  }
  if (overrides.model) {
    const active = String(out['activeProvider'] ?? 'claude');
    const providers = out['providers'] as Json;
    const target = providers[active];
    if (isPlainObject(target)) target['model'] = overrides.model;
  }
  return out;
}

function validate(file: string, raw: Json): Settings {
  const result = settingsSchema.safeParse(raw);
  if (!result.success) throw new ConfigError(file, formatZodIssues(result.error));
  return result.data;
}

function hasAnthropicProfile(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  for (const dir of anthropicCredentialDirs(env, platform)) {
    try {
      if (fs.readdirSync(dir).some((f) => f.endsWith('.json'))) return true;
    } catch {
      /* directory missing */
    }
  }
  return false;
}

export function resolveCredentialSources(
  settings: Settings,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  qwenFromEnv: boolean,
): Record<ProviderId, CredentialSource> {
  let claude: CredentialSource = 'none';
  if (settings.providers.claude.apiKey) claude = 'config';
  else if (env['ANTHROPIC_API_KEY'] || env['ANTHROPIC_AUTH_TOKEN']) claude = 'env';
  else if (hasAnthropicProfile(env, platform)) claude = 'profile';

  let qwen: CredentialSource = 'none';
  if (qwenFromEnv) qwen = 'env';
  else if (settings.providers.qwen.apiKey) qwen = 'config';

  return { claude, qwen };
}

/**
 * Loads settings with precedence: args > env > project file > global file > defaults.
 * Creates the global file on first run.
 */
export function loadSettings(opts: LoadOptions = {}): LoadedSettings {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const cwd = opts.cwd ?? process.cwd();
  const globalPath =
    opts.configPath ??
    (env['MAESTRO_CONFIG'] && env['MAESTRO_CONFIG'] !== ''
      ? env['MAESTRO_CONFIG']
      : globalSettingsPath(env));

  let created = false;
  if (!fs.existsSync(globalPath)) {
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(globalPath, initialSettingsJson(), 'utf8');
    created = true;
  }

  const globalRaw = readJsonFile(globalPath);
  validate(globalPath, globalRaw); // surfaces errors in the global file with its own path

  let merged = globalRaw;
  let projectPath: string | undefined;
  const candidate = projectSettingsPath(cwd);
  if (fs.existsSync(candidate)) {
    projectPath = candidate;
    const projectRaw = readJsonFile(candidate);
    merged = mergeSettings(globalRaw, projectRaw);
    validate(candidate, merged);
  }

  const withEnv = applyEnv(merged, env);
  const withOverrides = applyOverrides(withEnv, opts.overrides);
  const settings = validate(projectPath ?? globalPath, withOverrides);

  const credentialSources = resolveCredentialSources(
    settings,
    env,
    platform,
    Boolean(env['DASHSCOPE_API_KEY']),
  );

  return { settings, created, globalPath, projectPath, credentialSources };
}

export { z };
