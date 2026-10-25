import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNonInteractive } from '../../../src/cli/nonInteractive.js';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { bundledAssets } from '../../../src/speckit/assets.js';
import { systemGit } from '../../../src/speckit/git.js';
import { SpecKitService } from '../../../src/speckit/service.js';
import { allTools } from '../../../src/tools/registry.js';
import type { ProviderEvent } from '../../../src/providers/types.js';
import type { SettingsInput } from '../../../src/config/schema.js';
import { makeCtx } from '../../helpers/context.js';
import { createFakeProvider } from '../../helpers/fakeProvider.js';
import type { FakeProvider } from '../../helpers/fakeProvider.js';
import { withTempRepo } from '../../helpers/tempRepo.js';
import type { TempRepo } from '../../helpers/tempRepo.js';

let repo: TempRepo;
beforeEach(() => {
  repo = withTempRepo({ git: true, specify: '0.4', commandsDir: '.claude/commands' });
});
afterEach(() => repo.cleanup());

const toolCall = (callId: string, name: string, input: unknown): ProviderEvent[] => [
  { type: 'tool_call', callId, name, input },
  { type: 'done', stopReason: 'tool_use' },
];
const answer = (text: string): ProviderEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];
const run = (cmd: string) => ({ command: cmd });

function make(
  provider: FakeProvider,
  settings: SettingsInput = { tools: { approvalMode: 'auto-edit' } },
  interactive = true,
) {
  const session = new Session({ cwd: repo.root, activeProviderId: 'claude' });
  const specKit = new SpecKitService({
    cwd: repo.root,
    env: {},
    git: systemGit,
    assets: bundledAssets(),
    settings: { createBranch: true },
  });
  const controller = new SessionController({
    session,
    ctx: makeCtx(settings),
    tools: allTools(),
    system: 'sys',
    interactive,
    providerOverride: () => provider,
    specKit,
  });
  return { session, controller, specKit };
}

/** contracts/speckit-commands.md § 2, § 5; contracts/native-steps.md § 1 */
/** spec US3 — a brand-new project: init → specify → plan → tasks with the bundled (1.x) commands */
describe('Spec Kit flow in a new project (US3)', { timeout: 60_000 }, () => {
  it('/speckit.init installs everything, then the full workflow runs natively; /speckit.status follows along', async () => {
    const fresh = withTempRepo({ git: true, specify: 'none' });
    try {
      const provider = createFakeProvider([
        toolCall(
          'c1',
          'run_command',
          run(
            '.specify/scripts/bash/create-new-feature.sh --json --short-name "hello" "Add a hello command"',
          ),
        ),
        toolCall('w1', 'write_file', {
          path: 'specs/001-hello/spec.md',
          content: '# Feature: hello\n',
        }),
        answer('spec pronta'),
        toolCall('c2', 'run_command', run('.specify/scripts/bash/setup-plan.sh --json')),
        toolCall('w2', 'write_file', {
          path: 'specs/001-hello/plan.md',
          content: '**Language/Version**: TypeScript 5.9\n**Primary Dependencies**: ink\n',
        }),
        toolCall('c3', 'run_command', run('.specify/scripts/bash/update-agent-context.sh')),
        answer('plano pronto'),
        toolCall('c4', 'run_command', run('.specify/scripts/bash/setup-tasks.sh --json')),
        toolCall('w3', 'write_file', {
          path: 'specs/001-hello/tasks.md',
          content: '- [ ] T001 do it\n',
        }),
        answer('tarefas prontas'),
      ]);
      const session = new Session({ cwd: fresh.root, activeProviderId: 'claude' });
      const specKit = new SpecKitService({
        cwd: fresh.root,
        env: {},
        git: systemGit,
        assets: bundledAssets(),
        settings: { createBranch: true },
      });
      const controller = new SessionController({
        session,
        ctx: makeCtx({ tools: { approvalMode: 'auto-edit' } }),
        tools: allTools(),
        system: 'sys',
        providerOverride: () => provider,
        specKit,
      });

      await controller.submit('/speckit.status');
      expect(controller.notices.at(-1)?.text).toContain('não instalado neste projeto');

      await controller.submit('/speckit.init');
      expect(controller.notices.at(-1)?.text).toMatch(/Spec Kit v1\.2\.3 instalado/);
      expect(fresh.exists('.maestro/commands/speckit.specify.md')).toBe(true);
      expect(controller.commands.find((c) => c.name === 'speckit.specify')?.origin).toBe('project');

      expect((await controller.submit('/speckit.specify Add a hello command'))?.stopReason).toBe(
        'end_turn',
      );
      expect(fresh.branch()).toBe('001-hello');
      expect((await controller.submit('/speckit.plan'))?.stopReason).toBe('end_turn');
      expect(fresh.exists('MAESTRO.md')).toBe(true);
      expect((await controller.submit('/speckit.tasks'))?.stopReason).toBe('end_turn');
      expect(fresh.read('specs/001-hello/tasks.md')).toContain('T001');

      await controller.submit('/speckit.status');
      const status = controller.notices.at(-1)?.text ?? '';
      expect(status).toContain('instalado v1.2.3');
      expect(status).toContain('Feature: 001-hello');
      expect(status).toContain('✓ spec.md');
      expect(status).toContain('✓ plan.md');
      expect(status).toContain('✓ tasks.md');
      expect(status).toContain('project: 10');
      // every script went through the native interceptor
      const steps = controller.notices
        .filter((n) => n.text.startsWith('⚙ speckit'))
        .map((n) => n.text.split('  ·')[0]);
      expect(steps).toEqual([
        '⚙ speckit create-feature',
        '⚙ speckit setup-plan',
        '⚙ speckit update-agent-context',
        '⚙ speckit setup-tasks',
      ]);
    } finally {
      fresh.cleanup();
    }
  }, 60_000);
});

describe('Spec Kit flow (US1)', { timeout: 60_000 }, () => {
  it('/speckit.specify → native create-feature (no confirmation), spec written, display kept; /speckit.plan → setup-plan + agent context', async () => {
    const provider = createFakeProvider([
      toolCall(
        'c1',
        'run_command',
        run(
          '.specify/scripts/powershell/create-new-feature.ps1 -Json -ShortName "user-auth" "Add user authentication"',
        ),
      ),
      toolCall('w1', 'write_file', {
        path: 'specs/001-user-auth/spec.md',
        content: '# Feature: user auth\n',
      }),
      answer('spec pronta'),
      toolCall('c2', 'run_command', run('.specify/scripts/powershell/setup-plan.ps1 -Json')),
      toolCall(
        'c3',
        'run_command',
        run('.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude'),
      ),
      answer('plano pronto'),
    ]);
    const { controller, session } = make(provider);
    const confirm = vi.fn(async () => true);

    const r1 = await controller.submit('/speckit.specify Add user authentication', { confirm });
    expect(r1?.stopReason).toBe('end_turn');
    expect(confirm).not.toHaveBeenCalled(); // the script ran natively; the write was auto-edit
    expect(repo.branch()).toBe('001-user-auth');
    expect(repo.read('specs/001-user-auth/spec.md')).toBe('# Feature: user auth\n');
    expect(JSON.parse(repo.read('.specify/feature.json'))).toEqual({
      feature_directory: 'specs/001-user-auth',
    });
    // the model received the script's JSON
    const toolMsg = provider.requests[1]?.messages.at(-1);
    const result = toolMsg?.content[0];
    expect(result?.type === 'tool_result' && result.isError).toBe(false);
    // warnings (dirty tree: the copied .specify/ is untracked) come first; the JSON is the last line
    const jsonLine = result?.type === 'tool_result' ? result.output.trim().split('\n').at(-1)! : '';
    expect(JSON.parse(jsonLine)).toMatchObject({
      BRANCH_NAME: '001-user-auth',
      FEATURE_NUM: '001',
    });
    // transcript: typed line, not the composed prompt
    const user = session.history[0]!;
    expect(user.display).toBe('/speckit.specify Add user authentication');
    expect(user.content[0]?.type === 'text' && user.content[0].text).toContain(
      'Maestro: how this Spec Kit command runs here',
    );
    expect(controller.notices.map((n) => n.text).join('\n')).toMatch(
      /⚙ speckit create-feature {2}· {2}001-user-auth · branch criada/,
    );

    const r2 = await controller.submit('/speckit.plan', { confirm });
    expect(r2?.stopReason).toBe('end_turn');
    expect(repo.read('specs/001-user-auth/plan.md')).toContain('# Implementation Plan');
    expect(repo.exists('CLAUDE.md')).toBe(true);
    expect(repo.exists('MAESTRO.md')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(controller.notices.map((n) => n.text).join('\n')).toMatch(
      /⚙ speckit update-agent-context/,
    );
  });

  it('blocks a command whose prerequisites are missing without calling the model (FR-005)', async () => {
    const provider = createFakeProvider([answer('never')]);
    const { controller } = make(provider);
    const r = await controller.submit('/speckit.tasks');
    expect(r).toBeUndefined();
    expect(provider.requests).toHaveLength(0);
    expect(controller.lastCommandBlocked).toBe(true);
    expect(controller.notices.at(-1)?.level).toBe('warn');
    expect(controller.notices.at(-1)?.text).toMatch(
      /Feature directory not found[\s\S]*Run \/speckit\.specify first/,
    );
  });

  it('an unknown script under .specify/scripts is an ordinary command (approval mode applies)', async () => {
    repo.write('.specify/scripts/bash/outro.sh', 'echo hi');
    const provider = createFakeProvider([
      toolCall('x', 'run_command', run('.specify/scripts/bash/outro.sh --json')),
      answer('done'),
    ]);
    const { controller } = make(provider, { tools: { approvalMode: 'default' } });
    const confirm = vi.fn(async () => false);
    await controller.submit('run it', { confirm });
    expect(confirm).toHaveBeenCalledTimes(1);
    const result = provider.requests[1]?.messages.at(-1)?.content[0];
    expect(result?.type === 'tool_result' && result.output).toBe('user declined');
  });

  it('-p: a blocked Spec Kit command exits with the usage code and the reason on stderr', async () => {
    const provider = createFakeProvider([answer('never')]);
    const { controller } = make(provider, {}, false);
    const out: string[] = [];
    const err: string[] = [];
    const code = await runNonInteractive({
      controller,
      prompt: '/speckit.tasks',
      stdout: { write: (s: string) => out.push(s) },
      stderr: { write: (s: string) => err.push(s) },
      handleSignals: false,
    });
    expect(code).toBe(2);
    expect(err.join('')).toMatch(/Run \/speckit\.specify first/);
    expect(provider.requests).toHaveLength(0);
  });

  it('refuses Spec Kit commands without workspace tools', async () => {
    const provider = createFakeProvider([answer('never')]);
    const session = new Session({ cwd: repo.root, activeProviderId: 'claude' });
    const specKit = new SpecKitService({
      cwd: repo.root,
      env: {},
      git: systemGit,
      assets: bundledAssets(),
    });
    const controller = new SessionController({
      session,
      ctx: makeCtx(),
      tools: [],
      system: 'sys',
      providerOverride: () => provider,
      specKit,
    });
    await controller.submit('/speckit.specify x');
    expect(controller.notices.at(-1)?.text).toMatch(/--no-tools/);
    expect(provider.requests).toHaveLength(0);
    expect(fs.existsSync(path.join(repo.root, 'specs'))).toBe(false);
  });
});
