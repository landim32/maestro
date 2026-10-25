import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledAssets } from '../../../src/speckit/assets.js';
import { discoverCommands } from '../../../src/speckit/discovery.js';
import { nullGit, systemGit } from '../../../src/speckit/git.js';
import {
  INIT_OPTIONS_PATH,
  initReportText,
  initSpecKit,
  installedVersion,
  INTEGRATION_PATH,
  MANIFEST_PATH,
  readManifest,
} from '../../../src/speckit/init.js';
import { statusText } from '../../../src/speckit/status.js';
import { withTempRepo } from '../../helpers/tempRepo.js';
import type { TempRepo } from '../../helpers/tempRepo.js';

let repo: TempRepo;
beforeEach(() => {
  repo = withTempRepo({ git: true, specify: 'none' });
});
afterEach(() => repo.cleanup());

const assets = bundledAssets();

/** contracts/init-and-context.md § 1–2 */
describe('/speckit.init', { timeout: 60_000 }, () => {
  it('creates the full layout in an empty project and records the manifest', () => {
    const report = initSpecKit(repo.root, {}, assets, systemGit);
    expect(report.version).toBe('v1.2.3');
    expect(report.kept).toEqual([]);
    expect(report.created).toContain('.specify/memory/constitution.md');
    expect(report.created).toContain('.specify/templates/spec-template.md');
    expect(report.created).toContain('.specify/templates/agent-file-template.md');
    expect(report.created).toContain('.specify/scripts/bash/check-prerequisites.sh');
    expect(report.created).toContain('.specify/scripts/powershell/setup-plan.ps1');
    expect(report.created).toContain('.specify/scripts/python/common.py');
    expect(report.created).toContain('.maestro/commands/speckit.specify.md');
    expect(report.created).toContain(INIT_OPTIONS_PATH);
    expect(report.created).toContain(INTEGRATION_PATH);
    expect(report.created.filter((f) => f.startsWith('.maestro/commands/'))).toHaveLength(10);
    expect(report.next).toContain('/speckit.constitution');

    const rendered = repo.read('.maestro/commands/speckit.plan.md');
    expect(rendered).not.toMatch(/\{SCRIPT\}|\{ARGS\}|__SPECKIT_COMMAND_/);
    expect(rendered).toContain('.specify/memory/constitution.md');
    expect(JSON.parse(repo.read(INIT_OPTIONS_PATH))).toEqual({
      feature_numbering: 'sequential',
      integration: 'maestro',
      script: 'sh',
      speckit_version: 'v1.2.3',
    });
    expect(JSON.parse(repo.read(INTEGRATION_PATH))).toEqual({
      integration: 'maestro',
      integration_settings: {
        maestro: { invoke_separator: '.', commands_dir: '.maestro/commands' },
      },
    });
    const manifest = readManifest(repo.root)!;
    expect(manifest.version).toBe('v1.2.3');
    expect(Object.keys(manifest.files).length).toBeGreaterThan(30);
    expect(installedVersion(repo.root)).toBe('v1.2.3');

    // discovery now finds the project copies first
    const found = discoverCommands(repo.root, assets);
    expect(found.commands.every((c) => c.origin === 'project')).toBe(true);
    expect(found.commands).toHaveLength(10);
    expect(initReportText(report, false)).toMatch(
      /Spec Kit v1\.2\.3 instalado\.\n {2}criados: \d+ arquivos/,
    );
  });

  it('is idempotent: a second run changes nothing', () => {
    initSpecKit(repo.root, {}, assets, systemGit);
    const before = repo.read('.specify/templates/spec-template.md');
    repo.write('.specify/templates/spec-template.md', `${before}\n<!-- edited -->`);
    const again = initSpecKit(repo.root, {}, assets, systemGit);
    expect(again.created).toEqual([]);
    expect(again.updated).toEqual([INTEGRATION_PATH]);
    expect(again.kept).toEqual([]);
    expect(again.skipped.length).toBeGreaterThan(30);
    expect(repo.read('.specify/templates/spec-template.md')).toContain('<!-- edited -->');
    expect(initReportText(again, false)).toContain('nada a alterar');
  });

  it('--upgrade replaces unmodified files, keeps modified ones and creates missing ones', () => {
    initSpecKit(repo.root, {}, assets, systemGit);
    // simulate an older install: the manifest hash matches the file, but the bundled content changed
    const manifest = readManifest(repo.root)!;
    repo.write('.specify/templates/tasks-template.md', 'OLD CONTENT');
    manifest.files['.specify/templates/tasks-template.md'] = '46ab' + 'a'.repeat(60); // wrong hash → modified
    repo.write('.specify/templates/plan-template.md', 'OLD PLAN');
    manifest.files['.specify/templates/plan-template.md'] = createHash('sha256')
      .update('OLD PLAN')
      .digest('hex');
    fs.writeFileSync(path.join(repo.root, MANIFEST_PATH), JSON.stringify(manifest));
    fs.rmSync(path.join(repo.root, '.maestro', 'commands', 'speckit.tasks.md'));
    repo.write('.specify/memory/constitution.md', '# My constitution');

    const up = initSpecKit(repo.root, { upgrade: true }, assets, systemGit);
    expect(up.updated).toContain('.specify/templates/plan-template.md'); // hash matched → replaced
    expect(up.kept).toEqual(['.specify/templates/tasks-template.md']); // hash differed → kept
    expect(up.created).toEqual(['.maestro/commands/speckit.tasks.md']);
    expect(repo.read('.specify/templates/plan-template.md')).toContain('# Implementation Plan');
    expect(repo.read('.specify/templates/tasks-template.md')).toBe('OLD CONTENT');
    expect(repo.read('.specify/memory/constitution.md')).toBe('# My constitution'); // user-owned, never replaced
    expect(initReportText(up, true)).toContain(
      'mantidos (modificados): .specify/templates/tasks-template.md',
    );
  });

  it('merges integration.json without displacing another agent, and warns without git', () => {
    const other = withTempRepo({ git: false, specify: '0.4' });
    try {
      const report = initSpecKit(other.root, {}, assets, nullGit);
      expect(JSON.parse(other.read(INTEGRATION_PATH))).toMatchObject({
        integration: 'claude',
        integration_settings: { maestro: { invoke_separator: '.' } },
      });
      expect(report.skipped).toContain('.specify/templates/spec-template.md'); // pre-existing 0.4 copy kept
      expect(report.warnings[0]).toMatch(/sem repositório git/);
      expect(JSON.parse(other.read(INIT_OPTIONS_PATH))).toMatchObject({
        branch_numbering: 'sequential',
        speckit_version: 'v1.2.3',
      });
    } finally {
      other.cleanup();
    }
  });
});

/** contracts/speckit-commands.md § 6 */
describe('/speckit.status', { timeout: 60_000 }, () => {
  it('reports installation, feature and artifacts', () => {
    const ctx = { cwd: repo.root, env: {}, git: systemGit };
    const none = statusText(ctx, assets, discoverCommands(repo.root, assets));
    expect(none).toContain('não instalado neste projeto');
    expect(none).toContain('Feature: nenhuma');
    initSpecKit(repo.root, {}, assets, systemGit);
    repo.write('specs/001-x/spec.md', 's');
    repo.write('specs/001-x/plan.md', 'p');
    repo.write('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/001-x' }));
    const text = statusText(ctx, assets, discoverCommands(repo.root, assets));
    expect(text).toContain('instalado v1.2.3');
    expect(text).toContain('Feature: 001-x (.specify/feature.json)');
    expect(text).toContain('✓ spec.md');
    expect(text).toContain('✓ plan.md');
    expect(text).toContain('✗ tasks.md');
    expect(text).toContain('Comandos: 10 (project: 10)');
  });
});

describe('bundled assets', { timeout: 60_000 }, () => {
  it('ship VERSION, NOTICE, 6 templates, 10 commands and the three script dialects', () => {
    expect(assets.version).toBe('v1.2.3');
    expect(assets.commit).toBe('8ac9e8103319d98099cfc274a2517bb2b621626c');
    expect(assets.exists('NOTICE')).toBe(true);
    const list = assets.list();
    expect(list.filter((f) => /^templates\/[^/]+\.md$/.test(f))).toHaveLength(6);
    expect(list.filter((f) => /^templates\/commands\//.test(f))).toHaveLength(10);
    for (const d of ['bash', 'powershell', 'python']) {
      expect(list.filter((f) => f.startsWith(`scripts/${d}/`)).length).toBeGreaterThanOrEqual(6);
    }
  });
});
