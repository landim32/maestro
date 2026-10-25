import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledAssets } from '../../../src/speckit/assets.js';
import {
  discoverCommands,
  preflightFor,
  readIntegration,
  renderBundledCommand,
} from '../../../src/speckit/discovery.js';
import { buildPromptTurn, renderCommandBody } from '../../../src/speckit/prompt.js';
import { SPECKIT_PREAMBLE } from '../../../src/speckit/preamble.js';
import { withTempRepo } from '../../helpers/tempRepo.js';
import type { TempRepo } from '../../helpers/tempRepo.js';

let repo: TempRepo;
afterEach(() => repo?.cleanup());

const assets = bundledAssets();

/** contracts/speckit-commands.md § 1 */
describe('discoverCommands', { timeout: 60_000 }, () => {
  beforeEach(() => {
    repo = withTempRepo({ git: false, specify: '0.4', commandsDir: '.claude/commands' });
  });

  it('prefers .maestro/commands, then the active integration folder, then the bundled files', () => {
    repo.write('.maestro/commands/speckit.plan.md', '---\ndescription: mine\n---\nBODY $ARGUMENTS');
    const { commands, integration, integrationDir } = discoverCommands(repo.root, assets);
    expect(integration).toBe('claude');
    expect(integrationDir).toBe('.claude/commands');
    const byName = new Map(commands.map((c) => [c.name, c]));
    expect(byName.get('speckit.plan')?.origin).toBe('project');
    expect(byName.get('speckit.plan')?.description).toBe('mine');
    expect(byName.get('speckit.specify')?.origin).toBe('claude');
    expect(byName.get('speckit.converge')?.origin).toBe('bundled'); // only in v1.2.3
    expect(byName.get('speckit.tasks')?.origin).toBe('claude');
    expect(commands.filter((c) => c.origin === 'bundled').map((c) => c.name)).toEqual([
      'speckit.converge',
    ]);
  });

  it('skips TOML integrations and uses a generic commands_dir', () => {
    repo.write('.specify/integration.json', JSON.stringify({ integration: 'qwen' }));
    expect(discoverCommands(repo.root, assets).skipped).toEqual(['qwen']);
    repo.write(
      '.specify/integration.json',
      JSON.stringify({
        default_integration: 'generic',
        integration_settings: { generic: { commands_dir: 'tools/cmds', invoke_separator: '.' } },
      }),
    );
    repo.write('tools/cmds/speckit-custom.md', '---\ndescription: custom\n---\nx');
    expect(readIntegration(repo.root)).toEqual({ id: 'generic', commandsDir: 'tools/cmds' });
    const found = discoverCommands(repo.root, assets).commands.find(
      (c) => c.name === 'speckit.custom',
    );
    expect(found).toMatchObject({ origin: 'generic', description: 'custom' });
  });

  it('without .specify and commands only the bundled ten exist', () => {
    const bare = withTempRepo({ git: false, specify: 'none' });
    try {
      const names = discoverCommands(bare.root, assets).commands.map((c) => c.name);
      expect(names).toHaveLength(10);
      expect(names).toContain('speckit.specify');
      expect(names.every((n) => n.startsWith('speckit.'))).toBe(true);
    } finally {
      bare.cleanup();
    }
  });
});

describe('renderBundledCommand / preflightFor', { timeout: 60_000 }, () => {
  beforeEach(() => {
    repo = withTempRepo({ git: false, specify: 'none' });
  });

  it('substitutes {SCRIPT}, {ARGS}, __SPECKIT_COMMAND_X__ and /memory/', () => {
    const text = renderBundledCommand(assets.read('templates/commands/plan.md'));
    expect(text).not.toMatch(/\{SCRIPT\}|\{ARGS\}|__SPECKIT_COMMAND_/);
    expect(text).toContain('Run `.specify/scripts/bash/setup-plan.sh --json`');
    expect(text).toContain('.specify/memory/constitution.md');
    const specify = renderBundledCommand(assets.read('templates/commands/specify.md'));
    expect(specify).toContain('/speckit.plan');
    expect(specify).toContain('$ARGUMENTS');
  });

  it('derives the validation step from the frontmatter or from the command name', () => {
    const cmds = discoverCommands(repo.root, assets).commands;
    const by = (n: string) => cmds.find((c) => c.name === n)!;
    expect(preflightFor(by('speckit.specify'))).toBeUndefined();
    expect(preflightFor(by('speckit.constitution'))).toBeUndefined();
    expect(preflightFor(by('speckit.plan'))).toEqual({
      step: 'check-prerequisites',
      json: true,
      pathsOnly: true,
    });
    expect(preflightFor(by('speckit.tasks'))).toEqual({
      step: 'check-prerequisites',
      json: true,
      requireSpec: true,
    });
    expect(preflightFor(by('speckit.implement'))).toMatchObject({
      step: 'check-prerequisites',
      requireTasks: true,
      includeTasks: true,
    });
    // 0.4.x file without `scripts` frontmatter → table by name
    const legacy = { ...by('speckit.implement'), scripts: undefined };
    expect(preflightFor(legacy)).toEqual({
      step: 'check-prerequisites',
      json: true,
      requireTasks: true,
      includeTasks: true,
    });
    expect(preflightFor({ ...by('speckit.plan'), scripts: undefined })).toEqual({
      step: 'check-prerequisites',
      json: true,
      pathsOnly: true,
    });
  });
});

/** contracts/speckit-commands.md § 2–3 */
describe('prompt turn', { timeout: 60_000 }, () => {
  beforeEach(() => {
    repo = withTempRepo({ git: false, specify: 'none' });
  });

  it('replaces the arguments and prepends the preamble; display is the typed line', () => {
    const file = discoverCommands(repo.root, assets).commands.find(
      (c) => c.name === 'speckit.specify',
    )!;
    // tolerate CRLF checkouts of the assets (the .gitattributes pins LF, but keep the test robust)
    expect(renderCommandBody(file, '  Add login  ').replace(/\r\n/g, '\n')).toContain(
      '```text\nAdd login\n```',
    );
    expect(renderCommandBody(file, '')).not.toContain('$ARGUMENTS');
    const turn = buildPromptTurn(file, 'Add login');
    expect(turn.display).toBe('/speckit.specify Add login');
    expect(turn.prompt.startsWith(SPECKIT_PREAMBLE)).toBe(true);
    expect(turn.prompt).toContain('ask_user');
    expect(turn.prompt).toContain('Add login');
    expect(buildPromptTurn(file, '').display).toBe('/speckit.specify');
  });
});
