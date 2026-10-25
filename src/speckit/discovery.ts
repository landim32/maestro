import fs from 'node:fs';
import path from 'node:path';
import type { AssetsPort } from './assets.js';
import { parseFrontmatter } from './frontmatter.js';
import { isInvocationError, parseInvocation } from './invocation.js';
import type { StepRequest } from './invocation.js';

/** A Spec Kit command file (contracts/speckit-commands.md § 1). */
export interface SpecKitCommandFile {
  /** `speckit.plan`, `speckit.bug.assess`, … */
  name: string;
  /** Absolute path, or `bundled:<rel>` for the embedded commands. */
  path: string;
  /** `project` (.maestro/commands), the integration id (e.g. `claude`) or `bundled`. */
  origin: string;
  description: string;
  scripts?: { sh?: string; ps?: string; py?: string };
  handoffs?: Array<{ label: string; agent: string; prompt?: string; send?: boolean }>;
  tools?: string[];
  body: string;
}

/** Where known Spec Kit integrations keep their command files (markdown ones only). */
export const INTEGRATION_DIRS: Record<string, { dir: string; suffix?: string } | null> = {
  claude: { dir: '.claude/commands' },
  'cursor-agent': { dir: '.cursor/commands' },
  copilot: { dir: '.github/prompts', suffix: '.prompt.md' },
  codex: { dir: '.codex/prompts' },
  windsurf: { dir: '.windsurf/workflows' },
  opencode: { dir: '.opencode/command' },
  codebuddy: { dir: '.codebuddy/commands' },
  amp: { dir: '.agents/commands' },
  gemini: null, // TOML
  qwen: null, // TOML
};

export const MAESTRO_COMMANDS_DIR = '.maestro/commands';

interface IntegrationState {
  id?: string;
  commandsDir?: string;
}

/** Active integration from `.specify/integration.json` (`default_integration`, else `integration`). */
export function readIntegration(root: string): IntegrationState {
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(root, '.specify', 'integration.json'), 'utf8'),
    );
    if (typeof raw !== 'object' || raw === null) return {};
    const r = raw as Record<string, unknown>;
    const id =
      typeof r['default_integration'] === 'string'
        ? r['default_integration']
        : typeof r['integration'] === 'string'
          ? r['integration']
          : undefined;
    if (!id) return {};
    const settings = r['integration_settings'];
    const entry =
      typeof settings === 'object' && settings !== null
        ? (settings as Record<string, unknown>)[id]
        : undefined;
    const commandsDir =
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { commands_dir?: unknown }).commands_dir === 'string'
        ? (entry as { commands_dir: string }).commands_dir
        : undefined;
    return { id, commandsDir };
  } catch {
    return {};
  }
}

function fileToCommand(
  name: string,
  filePath: string,
  origin: string,
  text: string,
): SpecKitCommandFile | undefined {
  let parsed;
  try {
    parsed = parseFrontmatter(text);
  } catch {
    return undefined;
  }
  const d = parsed.data;
  const scripts =
    typeof d['scripts'] === 'object' && d['scripts'] !== null
      ? (d['scripts'] as SpecKitCommandFile['scripts'])
      : undefined;
  return {
    name,
    path: filePath,
    origin,
    description: typeof d['description'] === 'string' ? d['description'] : '',
    scripts,
    handoffs: Array.isArray(d['handoffs'])
      ? (d['handoffs'] as SpecKitCommandFile['handoffs'])
      : undefined,
    tools: Array.isArray(d['tools']) ? (d['tools'] as string[]) : undefined,
    body: parsed.body,
  };
}

function commandName(fileName: string, suffix = '.md'): string | undefined {
  if (!fileName.endsWith(suffix)) return undefined;
  const base = fileName.slice(0, -suffix.length);
  if (!/^speckit[.-]/.test(base)) return undefined;
  // `speckit-specify` (skills style) → `speckit.specify`
  return base.replace(/^speckit-/, 'speckit.');
}

function readDir(root: string, rel: string, origin: string, suffix = '.md'): SpecKitCommandFile[] {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  const out: SpecKitCommandFile[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const name = commandName(f, suffix);
    if (!name) continue;
    const file = path.join(dir, f);
    const cmd = fileToCommand(name, file, origin, fs.readFileSync(file, 'utf8'));
    if (cmd) out.push(cmd);
  }
  return out;
}

export interface DiscoveryResult {
  commands: SpecKitCommandFile[];
  /** Directory of the active integration that was scanned (undefined when none). */
  integrationDir?: string;
  integration?: string;
  /** Integrations skipped because their format is not markdown. */
  skipped: string[];
}

/**
 * Discovers `/speckit.*` command files: `.maestro/commands/` → the active integration's folder →
 * the bundled commands. The first name found wins (contracts/speckit-commands.md § 1).
 */
export function discoverCommands(root: string, assets?: AssetsPort): DiscoveryResult {
  const seen = new Map<string, SpecKitCommandFile>();
  const add = (list: SpecKitCommandFile[]) => {
    for (const c of list) if (!seen.has(c.name)) seen.set(c.name, c);
  };
  add(readDir(root, MAESTRO_COMMANDS_DIR, 'project'));

  const integration = readIntegration(root);
  const skipped: string[] = [];
  let integrationDir: string | undefined;
  if (integration.id && integration.id !== 'maestro') {
    const known = INTEGRATION_DIRS[integration.id];
    if (known === null) skipped.push(integration.id);
    else {
      const dir = integration.commandsDir ?? known?.dir;
      if (dir) {
        integrationDir = dir;
        add(readDir(root, dir, integration.id, known?.suffix ?? '.md'));
      }
    }
  }

  if (assets) {
    const bundled: SpecKitCommandFile[] = [];
    for (const rel of assets.list()) {
      const m = /^templates\/commands\/([a-z0-9.-]+)\.md$/.exec(rel);
      if (!m) continue;
      const cmd = fileToCommand(
        `speckit.${m[1]}`,
        `bundled:${rel}`,
        'bundled',
        renderBundledCommand(assets.read(rel)),
      );
      if (cmd) bundled.push(cmd);
    }
    add(bundled);
  }
  return { commands: [...seen.values()], integrationDir, integration: integration.id, skipped };
}

/**
 * Renders a bundled command template the way `specify init` does for an integration:
 * `{SCRIPT}` → the sh script line, `{ARGS}` → `$ARGUMENTS`, `__SPECKIT_COMMAND_X__` → `/speckit.x`,
 * `/memory/` → `.specify/memory/`.
 */
export function renderBundledCommand(text: string): string {
  const { data } = parseFrontmatter(text);
  const scripts = data['scripts'] as { sh?: string } | undefined;
  const script = scripts?.sh
    ? `.specify/${scripts.sh}`
    : '.specify/scripts/bash/check-prerequisites.sh --json';
  return text
    .replace(/\{SCRIPT\}/g, script)
    .replace(/\{ARGS\}/g, '$ARGUMENTS')
    .replace(
      /__SPECKIT_COMMAND_([A-Z0-9_]+)__/g,
      (_, id: string) => `/speckit.${id.toLowerCase().replace(/_/g, '.')}`,
    )
    .replace(/(^|[\s`(])\/memory\//g, '$1.specify/memory/');
}

/** Validation step run before the model is called (research R5). */
export function preflightFor(file: SpecKitCommandFile): StepRequest | undefined {
  const fromScripts = file.scripts?.sh ? parseInvocation(file.scripts.sh) : undefined;
  if (fromScripts && !isInvocationError(fromScripts)) {
    switch (fromScripts.step) {
      case 'create-feature':
        return undefined;
      case 'resolve-template':
        return undefined; // e.g. constitution: needs no feature
      case 'setup-plan':
      case 'update-agent-context':
        return { step: 'check-prerequisites', json: true, pathsOnly: true };
      case 'setup-tasks':
        return { step: 'check-prerequisites', json: true, requireSpec: true };
      case 'check-prerequisites':
        return { ...fromScripts, pathsOnly: undefined, template: undefined };
    }
  }
  const short = file.name.replace(/^speckit\./, '');
  switch (short) {
    case 'plan':
    case 'clarify':
      return { step: 'check-prerequisites', json: true, pathsOnly: true };
    case 'tasks':
    case 'checklist':
      return { step: 'check-prerequisites', json: true };
    case 'analyze':
    case 'implement':
    case 'taskstoissues':
      return { step: 'check-prerequisites', json: true, requireTasks: true, includeTasks: true };
    case 'converge':
      return {
        step: 'check-prerequisites',
        json: true,
        requireSpec: true,
        requireTasks: true,
        includeTasks: true,
      };
    default:
      return undefined;
  }
}
