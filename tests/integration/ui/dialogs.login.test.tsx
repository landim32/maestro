import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp } from '../../helpers/appHarness.js';
import { fakeAntCli } from '../../helpers/fakeAnt.js';
import type { FakeAntScript } from '../../helpers/fakeAnt.js';
import { textProvider } from '../../helpers/fakeProvider.js';
import { withTempHome } from '../../helpers/tempHome.js';
import type { TempHome } from '../../helpers/tempHome.js';

let home: TempHome;
beforeEach(() => {
  home = withTempHome();
});
afterEach(() => {
  cleanupSized();
  home.cleanup();
});

function mount(script: FakeAntScript, env: NodeJS.ProcessEnv = {}) {
  const ant = fakeAntCli(script);
  // The fake "login" creates the profile file the loader looks for.
  const antEnv = { ...env, ANTHROPIC_CONFIG_DIR: path.join(home.home, 'anthropic') };
  const realFinish = ant.finishLogin.bind(ant);
  const writeProfile = () => {
    fs.mkdirSync(path.join(antEnv.ANTHROPIC_CONFIG_DIR, 'credentials'), { recursive: true });
    fs.writeFileSync(path.join(antEnv.ANTHROPIC_CONFIG_DIR, 'credentials', 'default.json'), '{}');
  };
  ant.finishLogin = (r) => {
    if (r.ok) writeProfile();
    realFinish(r);
  };
  if (!script.manual && (script.loginResult?.ok ?? true)) writeProfile();
  const ui = mountApp({
    columns: 100,
    rows: 30,
    providers: { claude: textProvider(['from claude'], { id: 'claude' }) },
    credentials: { credentials: { claude: 'none', qwen: 'none' } },
    env: antEnv,
    controller: {
      settingsPaths: { globalPath: home.globalPath, cwd: home.home },
      env: antEnv,
      setupDeps: {
        ant,
        env: antEnv,
        platform: 'win32',
        testConnection: async () => ({ ok: true, latencyMs: 1 }),
      },
    },
  });
  return { ...ui, ant };
}

async function openLogin(ui: ReturnType<typeof mount>) {
  await waitForFrame(ui, 'Type a message');
  ui.stdin.write('/auth claude-login');
  await tick();
  ui.stdin.write(KEYS.enter);
  await waitForFrame(ui, 'Conectar provedor');
  ui.stdin.write(KEYS.enter);
}

describe('Claude Auth Login dialog (US2)', () => {
  it('missing CLI → platform instructions; "Tentar novamente" re-detects', async () => {
    const ui = mount({ location: undefined });
    await openLogin(ui);
    await waitForFrame(ui, "A CLI 'ant' da Anthropic não foi encontrada.");
    expect(ui.lastFrame()).toContain('windows_amd64.zip');
    expect(ui.lastFrame()).toContain('Tentar novamente');
    ui.ant.setLocation({ path: 'C:\\ant\\ant.exe', source: 'default-dir' });
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Usar claude como provedor ativo?');
    expect(ui.ant.calls.filter((c) => c.method === 'locate')).toHaveLength(2);
  });

  it('runs the login, shows the URL, confirms success and activates Claude via profile', async () => {
    const ui = mount({
      location: { path: '/bin/ant', source: 'PATH' },
      loginOutput: [
        'If the browser did not open, visit https://platform.claude.com/oauth/authorize?x=1',
      ],
      manual: true,
    });
    await openLogin(ui);
    await waitForFrame(ui, 'Aguardando autorização no navegador…');
    await waitForFrame(ui, 'https://platform.claude.com/oauth/authorize?x=1');
    ui.ant.finishLogin({ ok: true, summary: 'Logged in to Test Org as tester@example.com' });
    await waitForFrame(ui, 'Usar claude como provedor ativo?');
    ui.stdin.write(KEYS.enter); // Sim
    await waitForFrame(ui, 'claude configurado e ativo');
    expect(ui.controller.statuses()[0]).toMatchObject({
      configured: true,
      credentialSource: 'profile',
    });
    expect(ui.ant.calls.map((c) => c.method)).toEqual(['locate', 'runLogin', 'readStatus']);
    const saved = home.readSettings() as { providers: { claude: { enabled: boolean } } };
    expect(saved.providers.claude.enabled).toBe(true);
  });

  it('Esc while running cancels the process and returns to the menu', async () => {
    const ui = mount({ location: { path: '/bin/ant', source: 'PATH' }, manual: true });
    await openLogin(ui);
    await waitForFrame(ui, 'Aguardando autorização');
    ui.stdin.write(KEYS.esc);
    await waitForFrame(ui, 'Conectar provedor');
    expect(ui.ant.cancelled).toBe(1);
    await tick(30);
    expect(ui.lastFrame()).toContain('Conectar provedor'); // the cancelled promise does not move the dialog
  });

  it('a failed login shows the reason with retry', async () => {
    const ui = mount({
      location: { path: '/bin/ant', source: 'PATH' },
      loginResult: { ok: false, reason: 'callback timed out' },
    });
    await openLogin(ui);
    await waitForFrame(ui, 'Login não concluído: callback timed out');
    expect(ui.lastFrame()).toContain('Tentar novamente');
  });

  it('warns when ANTHROPIC_API_KEY shadows the profile', async () => {
    const ui = mount(
      { location: { path: '/bin/ant', source: 'PATH' } },
      { ANTHROPIC_API_KEY: 'sk-env' },
    );
    await openLogin(ui);
    await waitForFrame(ui, 'Usar claude como provedor ativo?');
    expect(ui.lastFrame()).toContain('ANTHROPIC_API_KEY está definida');
  });

  it('login status is refused when `ant auth status` reports no profile', async () => {
    const ui = mount({ location: { path: '/bin/ant', source: 'PATH' }, manual: true });
    await openLogin(ui);
    await waitForFrame(ui, 'Aguardando autorização');
    ui.ant.setLoggedIn(false);
    // finish "ok" but keep status not logged in
    const orig = ui.ant.finishLogin;
    ui.ant.finishLogin = (r) => {
      orig(r);
      ui.ant.setLoggedIn(false);
    };
    ui.ant.finishLogin({ ok: true, summary: 'done' });
    await waitFor(() => (ui.lastFrame() ?? '').includes('Login não concluído'), 3000, 'failed');
    expect(ui.lastFrame()).toContain('nenhum perfil ativo');
  });
});
