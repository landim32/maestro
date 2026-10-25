import fs from 'node:fs';
import path from 'node:path';
import type { AssetsPort } from './assets.js';
import type { DiscoveryResult } from './discovery.js';
import { FeatureNotFoundError, findSpecifyRoot, resolveFeaturePaths } from './feature.js';
import type { FeatureContext } from './feature.js';
import { installedVersion } from './init.js';

/** `/speckit.status` (contracts/speckit-commands.md § 6). */
export function statusText(
  ctx: FeatureContext,
  assets: AssetsPort,
  discovery: DiscoveryResult,
): string {
  const root = findSpecifyRoot(ctx.cwd, ctx.git);
  const installed = fs.existsSync(path.join(root, '.specify'));
  const version = installedVersion(root);
  const lines = [
    `Spec Kit — embutido ${assets.version} · ${installed ? `instalado ${version ?? '(versão não registrada)'}` : 'não instalado neste projeto (rode /speckit.init)'}`,
    `Raiz: ${root}`,
  ];
  try {
    const p = resolveFeaturePaths(ctx, { persist: false });
    lines.push(`Feature: ${p.CURRENT_BRANCH} (${sourceLabel(p.source)}) — ${p.FEATURE_DIR}`);
    const mark = (file: string, label: string) => `${fs.existsSync(file) ? '✓' : '✗'} ${label}`;
    const hasFiles = (dir: string) => fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    lines.push(
      `Artefatos: ${[
        mark(p.FEATURE_SPEC, 'spec.md'),
        mark(p.IMPL_PLAN, 'plan.md'),
        mark(p.RESEARCH, 'research.md'),
        mark(p.DATA_MODEL, 'data-model.md'),
        `${hasFiles(p.CONTRACTS_DIR) ? '✓' : '✗'} contracts/`,
        mark(p.QUICKSTART, 'quickstart.md'),
        mark(p.TASKS, 'tasks.md'),
        `${hasFiles(path.join(p.FEATURE_DIR, 'checklists')) ? '✓' : '✗'} checklists/`,
      ].join('  ')}`,
    );
  } catch (err) {
    if (!(err instanceof FeatureNotFoundError)) throw err;
    lines.push('Feature: nenhuma (rode /speckit.specify <descrição> para criar uma)');
  }
  const origins = new Map<string, number>();
  for (const c of discovery.commands) origins.set(c.origin, (origins.get(c.origin) ?? 0) + 1);
  const originText = [...origins.entries()].map(([o, n]) => `${o}: ${n}`).join(', ');
  lines.push(
    `Comandos: ${discovery.commands.length} (${originText})${discovery.integrationDir ? ` · integração ${discovery.integration}: ${discovery.integrationDir}` : ''}`,
  );
  return lines.join('\n');
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'git-branch':
      return 'branch git';
    case 'feature-json':
      return '.specify/feature.json';
    case 'latest-dir':
      return 'pasta mais recente em specs/';
    case 'env-dir':
      return 'SPECIFY_FEATURE_DIRECTORY';
    case 'env-name':
      return 'SPECIFY_FEATURE';
    default:
      return source;
  }
}
