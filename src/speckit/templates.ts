import fs from 'node:fs';
import path from 'node:path';
import type { AssetsPort } from './assets.js';
import { parseYamlSubset } from './frontmatter.js';

/**
 * Template resolution stack of spec-kit 1.x (`resolve_template_content`):
 * overrides → presets (registry priority) → extensions → `.specify/templates/` → bundled.
 */
export type Strategy = 'replace' | 'prepend' | 'append' | 'wrap';

export interface TemplateLayer {
  path: string;
  strategy: Strategy;
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

const VALID_NAME = /^[a-z0-9-]+$/;

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function priorityOf(meta: unknown): number {
  if (typeof meta !== 'object' || meta === null) return 10;
  const p = (meta as { priority?: unknown }).priority;
  if (typeof p === 'boolean') return 10;
  const n = typeof p === 'number' ? p : Number.parseInt(String(p ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? n : 10;
}

function enabled(meta: unknown): boolean {
  if (typeof meta !== 'object' || meta === null) return true;
  return (meta as { enabled?: unknown }).enabled !== false;
}

/** Ids under `<dir>/` ordered by the `.registry` (`key` = presets|extensions), else alphabetically. */
function orderedIds(dir: string, key: 'presets' | 'extensions'): string[] {
  if (!fs.existsSync(dir)) return [];
  const registry = readJson(path.join(dir, '.registry'));
  const entries = registry?.[key];
  const fromDisk = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && VALID_NAME.test(e.name))
    .map((e) => e.name)
    .sort();
  if (typeof entries !== 'object' || entries === null) return fromDisk;
  const ranked = Object.entries(entries as Record<string, unknown>)
    .filter(([id, meta]) => VALID_NAME.test(id) && enabled(meta))
    .sort((a, b) => priorityOf(a[1]) - priorityOf(b[1]) || a[0].localeCompare(b[0]))
    .map(([id]) => id);
  for (const id of fromDisk) if (!(id in (entries as object))) ranked.push(id);
  return ranked;
}

/** Strategy and file a preset manifest declares for `name` (undefined when not declared). */
function presetDeclaration(
  presetDir: string,
  name: string,
): { declared: boolean; strategy: Strategy; file?: string } {
  const manifest = path.join(presetDir, 'preset.yml');
  if (!fs.existsSync(manifest)) return { declared: false, strategy: 'replace' };
  let data: Record<string, unknown>;
  try {
    data = parseYamlSubset(fs.readFileSync(manifest, 'utf8'));
  } catch (err) {
    throw new TemplateError(
      `Error: invalid preset manifest ${manifest}: ${(err as Error).message}`,
    );
  }
  const provides = data['provides'];
  const templates = (provides as { templates?: unknown } | undefined)?.templates;
  if (!Array.isArray(templates))
    throw new TemplateError(`Error: invalid preset manifest ${manifest}`);
  for (const t of templates) {
    if (typeof t !== 'object' || t === null) continue;
    const e = t as { type?: unknown; name?: unknown; file?: unknown; strategy?: unknown };
    if ((e.type ?? 'template') !== 'template' || e.name !== name) continue;
    const strategy = String(e.strategy ?? 'replace').toLowerCase();
    if (!['replace', 'prepend', 'append', 'wrap'].includes(strategy)) {
      throw new TemplateError(`Error: invalid preset manifest ${manifest}`);
    }
    const file =
      typeof e.file === 'string' && !e.file.startsWith('/') && !e.file.includes('../')
        ? e.file
        : undefined;
    return { declared: true, strategy: strategy as Strategy, file };
  }
  return { declared: false, strategy: 'replace' };
}

/** All layers, highest priority first, stopping at the first `replace` base. */
export function templateLayers(name: string, root: string, assets?: AssetsPort): TemplateLayer[] {
  if (!VALID_NAME.test(name)) return [];
  const base = path.join(root, '.specify', 'templates');
  const layers: TemplateLayer[] = [];

  const override = path.join(base, 'overrides', `${name}.md`);
  if (fs.existsSync(override)) return [{ path: override, strategy: 'replace' }];

  const presetsDir = path.join(root, '.specify', 'presets');
  for (const id of orderedIds(presetsDir, 'presets')) {
    const dir = path.join(presetsDir, id);
    const decl = presetDeclaration(dir, name);
    let candidate: string | undefined;
    if (decl.file) {
      const f = path.join(dir, decl.file);
      if (fs.existsSync(f)) candidate = f;
    } else if (!decl.declared) {
      for (const f of [path.join(dir, 'templates', `${name}.md`), path.join(dir, `${name}.md`)]) {
        if (fs.existsSync(f)) {
          candidate = f;
          break;
        }
      }
    }
    if (candidate) {
      layers.push({ path: candidate, strategy: decl.strategy });
      if (decl.strategy === 'replace') return layers;
    }
  }

  const extDir = path.join(root, '.specify', 'extensions');
  for (const id of orderedIds(extDir, 'extensions')) {
    for (const f of [
      path.join(extDir, id, 'templates', `${name}.md`),
      path.join(extDir, id, `${name}.md`),
    ]) {
      if (fs.existsSync(f)) {
        layers.push({ path: f, strategy: 'replace' });
        return layers;
      }
    }
  }

  const core = path.join(base, `${name}.md`);
  if (fs.existsSync(core)) {
    layers.push({ path: core, strategy: 'replace' });
    return layers;
  }
  if (assets?.exists(`templates/${name}.md`)) {
    layers.push({ path: `bundled:templates/${name}.md`, strategy: 'replace' });
  }
  return layers;
}

function readLayer(layer: TemplateLayer, assets?: AssetsPort): string {
  if (layer.path.startsWith('bundled:')) return assets!.read(layer.path.slice('bundled:'.length));
  return fs.readFileSync(layer.path, 'utf8');
}

/** First (effective) template file, or undefined; bundled files are reported as `bundled:<rel>`. */
export function resolveTemplatePath(
  name: string,
  root: string,
  assets?: AssetsPort,
): string | undefined {
  return templateLayers(name, root, assets)[0]?.path;
}

/** Composed template content (prepend/append/wrap on top of the nearest replace base). */
export function resolveTemplateContent(
  name: string,
  root: string,
  assets?: AssetsPort,
): string | undefined {
  const layers = templateLayers(name, root, assets);
  if (layers.length === 0) return undefined;
  const baseIdx = layers.findIndex((l) => l.strategy === 'replace');
  if (baseIdx < 0) {
    throw new TemplateError(`Error: template '${name}' has composing layers but no replace base`);
  }
  let content = readLayer(layers[baseIdx]!, assets);
  for (let i = baseIdx - 1; i >= 0; i--) {
    const layer = layers[i]!;
    const text = readLayer(layer, assets);
    switch (layer.strategy) {
      case 'prepend':
        content = `${text}\n\n${content}`;
        break;
      case 'append':
        content = `${content}\n\n${text}`;
        break;
      case 'wrap':
        if (!text.includes('{CORE_TEMPLATE}')) {
          throw new TemplateError('Error: wrap strategy missing {CORE_TEMPLATE} placeholder');
        }
        content = text.split('{CORE_TEMPLATE}').join(content);
        break;
      default:
        content = text;
    }
  }
  return content;
}
