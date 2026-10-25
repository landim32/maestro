import { describe, expect, it, vi } from 'vitest';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import type { ConnectionTester } from '../../../src/setup/connectionTest.js';
import type { SettingsPatchEntry } from '../../../src/config/writer.js';
import { MaestroError } from '../../../src/utils/errors.js';
import { makeCtx, makeSettings } from '../../helpers/context.js';
import { fakeAntCli } from '../../helpers/fakeAnt.js';
import { textProvider } from '../../helpers/fakeProvider.js';
import type { ClaudeCodeCli, ClaudeCodeStatus } from '../../../src/setup/claudeCodeCli.js';

/** Claude Code CLI double: never starts a process; records what the driver asked for. */
function fakeClaudeCodeCli(
  location: string | undefined,
  status: ClaudeCodeStatus | { error: string },
): ClaudeCodeCli & { calls: string[]; setLocation(p: string | undefined): void } {
  let loc = location;
  const calls: string[] = [];
  return {
    calls,
    setLocation: (p) => (loc = p),
    locate: () => {
      calls.push('locate');
      return loc;
    },
    readStatus: async () => {
      calls.push('readStatus');
      return status;
    },
  };
}

/** Controller with in-memory settings "disk": writes patch a settings object, loader re-reads it. */
function makeHarness(
  opts: {
    test?: ConnectionTester;
    writeThrows?: boolean;
    env?: NodeJS.ProcessEnv;
    ant?: ReturnType<typeof fakeAntCli>;
    claudeCode?: ClaudeCodeCli;
  } = {},
) {
  let stored = makeSettings({});
  let credentials = {
    claude: 'env' as const,
    qwen: 'none' as const,
    'claude-code': 'none' as const,
  };
  const writes: SettingsPatchEntry[][] = [];
  const session = new Session({ cwd: '/w', activeProviderId: 'claude' });
  const test = opts.test ?? (async () => ({ ok: true as const, latencyMs: 1 }));
  const ctl = new SessionController({
    session,
    ctx: makeCtx({}, { credentials, env: opts.env ?? {} }),
    tools: [],
    system: 's',
    env: opts.env ?? {},
    providerOverride: () => textProvider(['ok']),
    settingsWriter: (patch) => {
      if (opts.writeThrows)
        throw new MaestroError({
          category: 'invalid_config',
          message: 'could not write x: EACCES',
        });
      writes.push(patch);
      // naive apply for the loader
      const raw = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
      for (const p of patch) {
        const segs = p.path.split('.');
        let cur = raw as Record<string, unknown>;
        for (const s of segs.slice(0, -1)) cur = (cur[s] ??= {}) as Record<string, unknown>;
        if (p.value === undefined) delete cur[segs.at(-1)!];
        else cur[segs.at(-1)!] = p.value;
      }
      stored = makeSettings(raw);
      credentials = {
        claude: credentials.claude,
        qwen: stored.providers.qwen.apiKey ? 'config' : 'none',
        'claude-code': stored.providers['claude-code'].enabled ? 'cli' : 'none',
      } as unknown as typeof credentials;
      return { path: '/mem/settings.json', overriddenByProject: [] };
    },
    settingsLoader: () => ({ settings: stored, credentialSources: credentials }),
    setupDeps: {
      testConnection: test,
      ant: opts.ant ?? fakeAntCli(),
      claudeCode: opts.claudeCode ?? fakeClaudeCodeCli(undefined, { loggedIn: false }),
      env: opts.env ?? {},
      platform: 'win32',
    },
  });
  return { ctl, session, writes, stored: () => stored };
}

const flowOf = (ctl: SessionController) =>
  ctl.dialog?.type === 'auth' ? ctl.dialog.flow : undefined;
const tick = () => new Promise((r) => setTimeout(r, 15));

describe('SetupDriver — /auth Qwen with fields', () => {
  it('runs test → save → activate and persists everything', async () => {
    const testSpy = vi.fn<ConnectionTester>(async () => ({ ok: true as const, latencyMs: 3 }));
    const h = makeHarness({ test: testSpy });
    const d = h.ctl.setup;
    expect(d.openAuth('qwen')).toBe(true);
    expect(flowOf(h.ctl)).toMatchObject({ step: 'menu', selected: 2 });
    d.dispatch({ type: 'enter' }); // fields: protocol (openai)
    d.dispatch({ type: 'enter' }); // → baseUrl
    d.dispatch({ type: 'enter' }); // default url accepted → apiKey
    d.dispatch({ type: 'input', value: 'sk-new-5555' });
    d.dispatch({ type: 'enter' }); // → model
    d.dispatch({ type: 'enter' }); // → testing
    expect(flowOf(h.ctl)?.step).toBe('testing');
    await tick();
    expect(testSpy).toHaveBeenCalledTimes(1);
    expect(testSpy.mock.calls[0]![1]).toEqual({
      protocol: 'openai',
      baseUrl: 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
      apiKey: 'sk-new-5555',
      model: 'qwen3-coder-plus',
    });
    // test ok → saving (sync) → activate
    expect(flowOf(h.ctl)?.step).toBe('activate');
    expect(h.writes[0]).toEqual([
      { path: 'providers.qwen.enabled', value: true },
      { path: 'providers.qwen.protocol', value: 'openai' },
      {
        path: 'providers.qwen.baseUrl',
        value: 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
      },
      { path: 'providers.qwen.apiKey', value: 'sk-new-5555' },
      { path: 'providers.qwen.model', value: 'qwen3-coder-plus' },
    ]);
    expect(h.ctl.settings.providers.qwen.enabled).toBe(true);
    expect(h.ctl.statuses()[1]?.configured).toBe(true);

    d.dispatch({ type: 'enter' }); // Sim → activating → done
    expect(flowOf(h.ctl)).toMatchObject({ step: 'done', activated: true });
    expect(h.session.activeProviderId).toBe('qwen');
    expect(h.writes.at(-1)).toEqual([{ path: 'activeProvider', value: 'qwen' }]);
    d.dispatch({ type: 'enter' });
    expect(h.ctl.dialog).toBeUndefined();
  });

  it('↓ on the protocol selects Anthropic-compatible; endpoint follows and both are persisted', async () => {
    const testSpy = vi.fn<ConnectionTester>(async () => ({ ok: true as const, latencyMs: 3 }));
    const h = makeHarness({ test: testSpy });
    const d = h.ctl.setup;
    d.openAuth('qwen');
    d.dispatch({ type: 'enter' }); // fields: protocol
    d.dispatch({ type: 'down' }); // anthropic
    d.dispatch({ type: 'enter' }); // → baseUrl (anthropic default)
    d.dispatch({ type: 'enter' }); // → apiKey
    d.dispatch({ type: 'input', value: 'sk-a-1' });
    d.dispatch({ type: 'enter' }); // → model
    d.dispatch({ type: 'enter' }); // → testing
    await tick();
    expect(testSpy.mock.calls[0]![1]).toEqual({
      protocol: 'anthropic',
      baseUrl: 'https://token-plan.maas.qwencloudapi.com/apps/anthropic',
      apiKey: 'sk-a-1',
      model: 'qwen3-coder-plus',
    });
    expect(h.writes[0]).toContainEqual({ path: 'providers.qwen.protocol', value: 'anthropic' });
    expect(h.writes[0]).toContainEqual({
      path: 'providers.qwen.baseUrl',
      value: 'https://token-plan.maas.qwencloudapi.com/apps/anthropic',
    });
    expect(h.ctl.settings.providers.qwen.protocol).toBe('anthropic');
  });

  it('a failed test shows testFailed; "gravar sem testar" marks the provider unverified', async () => {
    const h = makeHarness({
      test: async () => ({
        ok: false as const,
        category: 'auth' as const,
        message: 'chave rejeitada (401)',
        field: 'apiKey' as const,
      }),
    });
    const d = h.ctl.setup;
    d.openAuth('qwen');
    d.dispatch({ type: 'enter' }); // protocol
    d.dispatch({ type: 'enter' }); // baseUrl
    d.dispatch({ type: 'enter' });
    d.dispatch({ type: 'input', value: 'sk-bad' });
    d.dispatch({ type: 'enter' });
    d.dispatch({ type: 'enter' });
    await tick();
    expect(flowOf(h.ctl)).toMatchObject({ step: 'testFailed', result: { category: 'auth' } });
    d.dispatch({ type: 'down' }); // gravar sem testar
    d.dispatch({ type: 'enter' });
    expect(flowOf(h.ctl)?.step).toBe('activate');
    expect(h.ctl.statuses()[1]?.verified).toBe(false);
    expect(h.ctl.describeProviders()).toContain('(not verified)');
  });

  it('cancelling during the test aborts it and returns to the last field', async () => {
    let aborted = false;
    const h = makeHarness({
      test: (_m, _v, o) =>
        new Promise((resolve) => {
          o.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve({ ok: false, category: 'timeout', message: 'x' });
          });
        }),
    });
    const d = h.ctl.setup;
    d.openAuth('qwen');
    d.dispatch({ type: 'enter' }); // protocol
    d.dispatch({ type: 'enter' }); // baseUrl
    d.dispatch({ type: 'enter' });
    d.dispatch({ type: 'input', value: 'sk-x' });
    d.dispatch({ type: 'enter' });
    d.dispatch({ type: 'enter' });
    expect(flowOf(h.ctl)?.step).toBe('testing');
    d.dispatch({ type: 'cancel' });
    await tick();
    expect(aborted).toBe(true);
    expect(flowOf(h.ctl)).toMatchObject({ step: 'fields', index: 3 });
  });

  it('write failures land on saveFailed with the error text', async () => {
    const h = makeHarness({ writeThrows: true });
    const d = h.ctl.setup;
    d.openAuth('qwen');
    d.dispatch({ type: 'enter' }); // protocol
    d.dispatch({ type: 'enter' }); // baseUrl
    d.dispatch({ type: 'enter' });
    d.dispatch({ type: 'input', value: 'sk-x' });
    d.dispatch({ type: 'enter' });
    d.dispatch({ type: 'enter' });
    await tick();
    expect(flowOf(h.ctl)).toMatchObject({ step: 'saveFailed' });
    expect((flowOf(h.ctl) as { error: string }).error).toContain('EACCES');
  });

  it('warns when an environment variable shadows the saved key', async () => {
    const h = makeHarness({ env: { DASHSCOPE_API_KEY: 'env-key' } });
    const d = h.ctl.setup;
    d.openAuth('qwen');
    d.dispatch({ type: 'enter' }); // protocol
    d.dispatch({ type: 'enter' }); // baseUrl
    d.dispatch({ type: 'enter' });
    d.dispatch({ type: 'input', value: 'sk-x' });
    d.dispatch({ type: 'enter' });
    d.dispatch({ type: 'enter' });
    await tick();
    expect((flowOf(h.ctl) as { warnings: string[] }).warnings[0]).toMatch(/DASHSCOPE_API_KEY/);
  });

  it('refuses to open while generating, and /model selection persists activeProvider + model', async () => {
    const h = makeHarness();
    h.session.beginGeneration();
    expect(h.ctl.setup.openAuth()).toBe(false);
    h.session.endGeneration();

    // configure qwen quickly through the writer so it is selectable
    h.ctl.writeSettings([
      { path: 'providers.qwen.enabled', value: true },
      { path: 'providers.qwen.apiKey', value: 'sk-q' },
    ]);
    h.ctl.reloadSettings();
    const d = h.ctl.setup;
    expect(d.openModel()).toBe(true);
    d.dispatch({ type: 'down' }); // claude-sonnet-5-5
    d.dispatch({ type: 'down' }); // claude-haiku-5-5
    d.dispatch({ type: 'down' }); // qwen / qwen3-coder-plus
    d.dispatch({ type: 'enter' });
    expect(h.session.activeProviderId).toBe('qwen');
    expect(h.writes.at(-1)).toEqual([
      { path: 'activeProvider', value: 'qwen' },
      { path: 'providers.qwen.model', value: 'qwen3-coder-plus' },
    ]);
    expect(h.ctl.dialog).toBeUndefined();
  });
});

describe('SetupDriver — Claude Auth Login', () => {
  it('missing CLI → hints; retry after install → running → success enables claude and offers activation', async () => {
    const ant = fakeAntCli({
      location: undefined,
      loginOutput: ['Open https://platform.claude.com/oauth/abc in your browser'],
    });
    const h = makeHarness({ ant, env: {} });
    // claude has no credentials in this harness
    const d = h.ctl.setup;
    d.openAuth('claude-login');
    d.dispatch({ type: 'enter' });
    expect(flowOf(h.ctl)).toMatchObject({ step: 'login.missing' });
    expect((flowOf(h.ctl) as { hints: string[] }).hints[0]).toContain('windows_amd64.zip');

    ant.setLocation({ path: 'C:\\ant\\ant.exe', source: 'default-dir' });
    d.dispatch({ type: 'enter' }); // tentar novamente → detect → running
    expect(flowOf(h.ctl)?.step).toBe('login.running');
    await tick();
    expect(flowOf(h.ctl)).toMatchObject({ step: 'activate', warnings: [] });
    expect((flowOf(h.ctl) as { url?: string }).url).toBeUndefined(); // moved past running
    expect(ant.calls.map((c) => c.method)).toEqual(['locate', 'locate', 'runLogin', 'readStatus']);
    expect(h.writes.at(-1)).toEqual([{ path: 'providers.claude.enabled', value: true }]);
  });

  it('shows the URL while running, cancels on Esc and reports failures', async () => {
    const ant = fakeAntCli({
      location: { path: '/bin/ant', source: 'PATH' },
      loginOutput: ['visit https://platform.claude.com/x'],
      manual: true,
    });
    const h = makeHarness({ ant });
    const d = h.ctl.setup;
    d.openAuth('claude-login');
    d.dispatch({ type: 'enter' });
    await tick();
    expect(flowOf(h.ctl)).toMatchObject({
      step: 'login.running',
      url: 'https://platform.claude.com/x',
    });
    d.dispatch({ type: 'back' }); // Esc
    expect(ant.cancelled).toBe(1);
    expect(flowOf(h.ctl)?.step).toBe('menu');
    await tick();
    expect(flowOf(h.ctl)?.step).toBe('menu'); // the cancelled promise does not move the flow

    d.dispatch({ type: 'down' }); // claude-login is item 1
    d.dispatch({ type: 'enter' });
    await tick();
    ant.finishLogin({ ok: false, reason: 'callback timed out' });
    await tick();
    expect(flowOf(h.ctl)).toMatchObject({ step: 'login.failed', reason: 'callback timed out' });
  });

  it('warns when ANTHROPIC_API_KEY shadows the new profile', async () => {
    const ant = fakeAntCli({ location: { path: '/bin/ant', source: 'PATH' } });
    const h = makeHarness({ ant, env: { ANTHROPIC_API_KEY: 'sk-env' } });
    const d = h.ctl.setup;
    d.openAuth('claude-login');
    d.dispatch({ type: 'enter' });
    await tick();
    expect((flowOf(h.ctl) as { warnings: string[] }).warnings[0]).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe('SetupDriver — Claude Code (specs/010 US3, FR-012)', () => {
  it('missing CLI → install hints; found and logged in by subscription → enables the provider, offers activation', async () => {
    const cc = fakeClaudeCodeCli(undefined, {
      loggedIn: true,
      authMethod: 'claude.ai',
      maskedEmail: 'r***@example.com',
    });
    const h = makeHarness({ claudeCode: cc });
    const d = h.ctl.setup;
    d.openAuth('claude-code');
    d.dispatch({ type: 'enter' });
    expect(flowOf(h.ctl)).toMatchObject({ step: 'login.missing' });
    expect((flowOf(h.ctl) as { hints: string[] }).hints.join('\n')).toContain('/login');

    cc.setLocation('/home/u/.local/bin/claude');
    d.dispatch({ type: 'enter' }); // tentar novamente
    await tick();
    expect(flowOf(h.ctl)).toMatchObject({ step: 'activate' });
    const warnings = (flowOf(h.ctl) as { warnings: string[] }).warnings;
    expect(warnings).toEqual(['Claude Code logado como r***@example.com (claude.ai).']);
    expect(h.writes.at(-1)).toEqual([{ path: 'providers.claude-code.enabled', value: true }]);
    expect(cc.calls).toEqual(['locate', 'locate', 'readStatus']);

    d.dispatch({ type: 'enter' }); // ativar
    await tick();
    expect(h.ctl.session.activeProviderId).toBe('claude-code');
  });

  it('never starts a login: not logged in → failure with the Claude Code /login hint', async () => {
    const cc = fakeClaudeCodeCli('/usr/bin/claude', { loggedIn: false });
    const h = makeHarness({ claudeCode: cc });
    const d = h.ctl.setup;
    d.openAuth('claude-code');
    d.dispatch({ type: 'enter' });
    await tick();
    expect(flowOf(h.ctl)).toMatchObject({ step: 'login.failed' });
    expect((flowOf(h.ctl) as { reason: string }).reason).toContain('/login');
    expect(h.writes).toEqual([]);
    expect(cc.calls).toEqual(['locate', 'readStatus']);
  });

  it('a login that is not the subscription is accepted with a credits warning', async () => {
    const cc = fakeClaudeCodeCli('/usr/bin/claude', { loggedIn: true, authMethod: 'api_key' });
    const h = makeHarness({ claudeCode: cc });
    h.ctl.setup.openAuth('claude-code');
    h.ctl.setup.dispatch({ type: 'enter' });
    await tick();
    const warnings = (flowOf(h.ctl) as { warnings: string[] }).warnings;
    expect(warnings[1]).toContain('créditos de API');
  });

  it('status errors are reported', async () => {
    const cc = fakeClaudeCodeCli('/usr/bin/claude', { error: 'sem resposta' });
    const h = makeHarness({ claudeCode: cc });
    h.ctl.setup.openAuth('claude-code');
    h.ctl.setup.dispatch({ type: 'enter' });
    await tick();
    expect(flowOf(h.ctl)).toMatchObject({ step: 'login.failed', reason: 'sem resposta' });
  });
});
