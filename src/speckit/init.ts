import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AssetsPort } from './assets.js';
import { MAESTRO_COMMANDS_DIR, renderBundledCommand } from './discovery.js';
import type { GitPort } from './git.js';

/** `/speckit.init` (contracts/init-and-context.md § 1). */
export interface InitOptions {
  upgrade?: boolean;
}

export interface InitReport {
  version: string;
  created: string[];
  skipped: string[];
  updated: string[];
  kept: string[];
  warnings: string[];
  next: string;
}

export const MANIFEST_PATH = '.specify/integrations/maestro.manifest.json';
export const INIT_OPTIONS_PATH = '.specify/init-options.json';
export const INTEGRATION_PATH = '.specify/integration.json';

interface Manifest {
  integration: 'maestro';
  version: string;
  installed_at: string;
  files: Record<string, string>;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

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

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Project files `init` manages → how to produce their content from the assets. */
export function managedFiles(
  assets: AssetsPort,
): Array<{ rel: string; content: () => string; userOwned?: boolean }> {
  const out: Array<{ rel: string; content: () => string; userOwned?: boolean }> = [
    {
      rel: '.specify/memory/constitution.md',
      content: () => assets.read('templates/constitution-template.md'),
      userOwned: true,
    },
  ];
  for (const rel of assets.list()) {
    if (/^templates\/[^/]+\.md$/.test(rel)) {
      out.push({ rel: `.specify/${rel}`, content: () => assets.read(rel) });
    } else if (/^scripts\/(bash|powershell|python)\/[^/]+$/.test(rel)) {
      out.push({ rel: `.specify/${rel}`, content: () => assets.read(rel) });
    } else {
      const m = /^templates\/commands\/([a-z0-9.-]+)\.md$/.exec(rel);
      if (m) {
        out.push({
          rel: `${MAESTRO_COMMANDS_DIR}/speckit.${m[1]}.md`,
          content: () => renderBundledCommand(assets.read(rel)),
        });
      }
    }
  }
  return out;
}

export function readManifest(root: string): Manifest | undefined {
  const raw = readJson(path.join(root, MANIFEST_PATH));
  if (!raw || typeof raw['files'] !== 'object' || raw['files'] === null) return undefined;
  return raw as unknown as Manifest;
}

/** Version recorded in the project (init-options.json, else the manifest), if any. */
export function installedVersion(root: string): string | undefined {
  const opts = readJson(path.join(root, INIT_OPTIONS_PATH));
  const fromOptions = opts?.['speckit_version'];
  if (typeof fromOptions === 'string') return fromOptions;
  return readManifest(root)?.version;
}

export function initSpecKit(
  root: string,
  opts: InitOptions,
  assets: AssetsPort,
  git: GitPort,
): InitReport {
  const report: InitReport = {
    version: assets.version,
    created: [],
    skipped: [],
    updated: [],
    kept: [],
    warnings: [],
    next: '',
  };
  const previous = readManifest(root);
  const files: Record<string, string> = { ...(previous?.files ?? {}) };

  for (const entry of managedFiles(assets)) {
    const abs = path.join(root, entry.rel);
    const fresh = entry.content();
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, fresh, 'utf8');
      files[entry.rel] = sha256(fresh);
      report.created.push(entry.rel);
      continue;
    }
    if (!opts.upgrade || entry.userOwned) {
      report.skipped.push(entry.rel);
      if (!(entry.rel in files)) files[entry.rel] = sha256(fs.readFileSync(abs, 'utf8'));
      continue;
    }
    const current = fs.readFileSync(abs, 'utf8');
    const recorded = files[entry.rel];
    if (recorded !== undefined && sha256(current) === recorded) {
      if (current !== fresh) {
        fs.writeFileSync(abs, fresh, 'utf8');
        report.updated.push(entry.rel);
      } else {
        report.skipped.push(entry.rel);
      }
      files[entry.rel] = sha256(fresh);
    } else {
      report.kept.push(entry.rel);
      if (recorded === undefined) files[entry.rel] = sha256(current);
    }
  }

  // init-options.json: create once; record the bundled version on upgrade
  const optionsFile = path.join(root, INIT_OPTIONS_PATH);
  const options = readJson(optionsFile);
  if (!options) {
    writeJson(optionsFile, {
      feature_numbering: 'sequential',
      integration: 'maestro',
      script: 'sh',
      speckit_version: assets.version,
    });
    report.created.push(INIT_OPTIONS_PATH);
  } else if (opts.upgrade || options['speckit_version'] === undefined) {
    writeJson(optionsFile, { ...options, speckit_version: assets.version });
    report.updated.push(INIT_OPTIONS_PATH);
  }

  // integration.json: register maestro without displacing another agent's integration
  const integrationFile = path.join(root, INTEGRATION_PATH);
  const integration = readJson(integrationFile) ?? {};
  const settings =
    typeof integration['integration_settings'] === 'object' &&
    integration['integration_settings'] !== null
      ? { ...(integration['integration_settings'] as Record<string, unknown>) }
      : {};
  settings['maestro'] = { invoke_separator: '.', commands_dir: MAESTRO_COMMANDS_DIR };
  const merged: Record<string, unknown> = { ...integration, integration_settings: settings };
  if (merged['integration'] === undefined && merged['default_integration'] === undefined) {
    merged['integration'] = 'maestro';
  }
  const existed = fs.existsSync(integrationFile);
  writeJson(integrationFile, merged);
  (existed ? report.updated : report.created).push(INTEGRATION_PATH);

  const manifest: Manifest = {
    integration: 'maestro',
    version: assets.version,
    installed_at: new Date().toISOString(),
    files,
  };
  writeJson(path.join(root, MANIFEST_PATH), manifest);

  if (!git.hasGit(root)) {
    report.warnings.push(
      'Aviso: sem repositório git; /speckit.specify criará a pasta da feature, mas não a branch.',
    );
  }
  const constitution = fs.readFileSync(path.join(root, '.specify/memory/constitution.md'), 'utf8');
  report.next = /\[[A-Z_ ]+\]/.test(constitution)
    ? 'Próximo passo: /speckit.constitution para definir os princípios do projeto.'
    : 'Próximo passo: /speckit.specify <descrição> para iniciar uma feature.';
  return report;
}

/** Transcript text of an init run (contracts/init-and-context.md § 1). */
export function initReportText(report: InitReport, upgrade: boolean): string {
  const lines = [`Spec Kit ${report.version} ${upgrade ? 'atualizado' : 'instalado'}.`];
  const group = (label: string, items: string[]) => {
    if (items.length === 0) return;
    const dirs = [...new Set(items.map((f) => f.split('/').slice(0, -1).join('/') || '.'))];
    lines.push(
      `  ${label}: ${items.length} arquivo${items.length === 1 ? '' : 's'} (${dirs.join(', ')})`,
    );
  };
  group('criados', report.created);
  group('atualizados', report.updated);
  if (report.kept.length) lines.push(`  mantidos (modificados): ${report.kept.join(', ')}`);
  if (report.skipped.length && report.created.length === 0 && report.updated.length <= 1) {
    lines.push('  nada a alterar: todos os arquivos já existem');
  } else if (report.skipped.length) {
    lines.push(
      `  mantidos: ${report.skipped.length} arquivo${report.skipped.length === 1 ? '' : 's'} já existentes`,
    );
  }
  lines.push(...report.warnings, report.next);
  return lines.join('\n');
}
