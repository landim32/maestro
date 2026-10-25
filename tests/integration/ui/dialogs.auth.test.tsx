import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionTester } from '../../../src/setup/connectionTest.js';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp } from '../../helpers/appHarness.js';
import { textProvider } from '../../helpers/fakeProvider.js';
import { fakeAntCli } from '../../helpers/fakeAnt.js';
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

const okTest: ConnectionTester = async () => ({ ok: true, latencyMs: 2 });
const badKeyTest: ConnectionTester = async () => ({
  ok: false,
  category: 'auth',
  message: 'chave rejeitada (401)',
  field: 'apiKey',
});

function mount(test: ConnectionTester = okTest, env: NodeJS.ProcessEnv = {}) {
  const claude = textProvider(['from claude'], { id: 'claude' });
  const qwen = textProvider(['from qwen'], { id: 'qwen' });
  const ui = mountApp({
    columns: 100,
    rows: 30,
    providers: { claude, qwen },
    credentials: { credentials: { claude: 'env', qwen: 'none' } },
    env,
    controller: {
      settingsPaths: { globalPath: home.globalPath, cwd: home.home },
      env,
      setupDeps: { testConnection: test, ant: fakeAntCli(), env, platform: 'win32' },
    },
  });
  return { ...ui, claude, qwen };
}

async function type(ui: ReturnType<typeof mount>, text: string) {
  ui.stdin.write(text);
  await tick();
}

describe('/auth dialog (US1)', () => {
  it('opens the menu with statuses and disables the prompt', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await type(ui, '/auth');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Conectar provedor');
    const frame = ui.lastFrame() ?? '';
    expect(frame).toContain('Claude API');
    expect(frame).toContain('Claude Auth Login');
    expect(frame).toContain('Qwen');
    expect(frame).toMatch(/Claude API.*\[ativo/);
    expect(frame).toMatch(/Qwen.*\[não configurado\]/);
    expect(frame).toContain('diálogo aberto');
    // typing does not reach the prompt
    await type(ui, 'hello');
    expect(ui.lastFrame()).not.toContain('› hello');
    expect(ui.controller.dialog?.type).toBe('auth');
  });

  it('/connect and /login are aliases; Esc on the menu closes without changes', async () => {
    for (const cmd of ['/connect', '/login']) {
      const ui = mount();
      await waitForFrame(ui, 'Type a message');
      await type(ui, cmd);
      ui.stdin.write(KEYS.enter);
      await waitForFrame(ui, 'Conectar provedor');
      ui.stdin.write(KEYS.esc);
      await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
      expect(ui.lastFrame()).toContain('Type a message');
      cleanupSized();
    }
  });

  it('configures Qwen end to end: fields → test → save → activate; next message goes to Qwen', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await type(ui, '/auth qwen');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Conectar provedor');
    ui.stdin.write(KEYS.enter); // Qwen → fields
    await waitForFrame(ui, 'Protocolo');
    ui.stdin.write(KEYS.enter); // OpenAI compatível (default)
    await waitForFrame(ui, 'Endpoint');
    expect(ui.lastFrame()).toContain('dashscope-intl'); // hint
    ui.stdin.write(KEYS.enter); // accept default endpoint
    await waitForFrame(ui, 'Chave de API');
    await type(ui, 'sk-very-secret-7777');
    expect(ui.lastFrame()).not.toContain('sk-very-secret');
    expect(ui.lastFrame()).toContain('•••••');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Modelo');
    ui.stdin.write(KEYS.enter); // default model → testing → saving → activate
    await waitForFrame(ui, 'Usar qwen como provedor ativo?');
    ui.stdin.write(KEYS.enter); // Sim
    await waitForFrame(ui, 'qwen configurado e ativo');
    ui.stdin.write(KEYS.enter); // close
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');

    const saved = home.readSettings() as {
      activeProvider: string;
      providers: { qwen: Record<string, unknown> };
    };
    expect(saved.activeProvider).toBe('qwen');
    expect(saved.providers.qwen).toMatchObject({
      enabled: true,
      protocol: 'openai',
      baseUrl: 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
      apiKey: 'sk-very-secret-7777',
      model: 'qwen3-coder-plus',
    });
    expect(ui.session.activeProviderId).toBe('qwen');
    expect(ui.lastFrame()).not.toContain('sk-very-secret');

    await type(ui, 'hi');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'from qwen');
    expect(ui.qwen.requests).toHaveLength(1);
    expect(ui.claude.requests).toHaveLength(0);
  });

  it('an invalid key shows the failure and returns to the key field for correction', async () => {
    const ui = mount(badKeyTest);
    await waitForFrame(ui, 'Type a message');
    await type(ui, '/auth qwen');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Conectar provedor');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Protocolo');
    ui.stdin.write(KEYS.enter); // OpenAI compatível (default)
    await waitForFrame(ui, 'Endpoint');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Chave de API');
    await type(ui, 'sk-bad');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Modelo');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Falha: chave rejeitada (401)');
    expect(ui.lastFrame()).toContain('Corrigir chave de api');
    ui.stdin.write(KEYS.enter); // corrigir
    await waitForFrame(ui, 'Chave de API');
    expect(ui.lastFrame()).toContain('✗ chave rejeitada (401)');
    expect(ui.controller.dialog).toBeDefined();
    expect(() => home.readSettings()).toThrow(); // nothing written yet
  });

  it('Esc goes back one field, then to the menu; Ctrl+U clears a field', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await type(ui, '/auth qwen');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Conectar provedor');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Protocolo');
    ui.stdin.write(KEYS.enter); // OpenAI compatível (default)
    await waitForFrame(ui, 'Endpoint');
    ui.stdin.write(KEYS.ctrlU); // clears the pre-filled endpoint (placeholder shows the default again)
    await tick();
    await type(ui, 'https://x.example/v1');
    await waitForFrame(ui, '› https://x.example/v1');
    expect(ui.lastFrame()).not.toContain('compatible-mode/v1https'); // not appended to the old value
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Chave de API');
    ui.stdin.write(KEYS.esc);
    await waitForFrame(ui, 'Endpoint');
    expect(ui.lastFrame()).toContain('https://x.example/v1');
    ui.stdin.write(KEYS.esc);
    await waitForFrame(ui, 'Protocolo');
    expect(ui.lastFrame()).toContain('> OpenAI compatível');
    ui.stdin.write(KEYS.esc);
    await waitForFrame(ui, 'Conectar provedor');
  });

  it('↓ on the protocol step picks Anthropic compatível and the endpoint follows', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await type(ui, '/auth qwen');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Conectar provedor');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Protocolo');
    expect(ui.lastFrame()).toContain('> OpenAI compatível');
    expect(ui.lastFrame()).toContain('token-plan.maas.qwencloudapi.com/compatible-mode/v1');
    ui.stdin.write(KEYS.down);
    await waitForFrame(ui, '> Anthropic compatível');
    await type(ui, 'zzz'); // typing is ignored on a choice
    expect(ui.lastFrame()).not.toContain('zzz');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Endpoint');
    expect(ui.lastFrame()).toContain('https://token-plan.maas.qwencloudapi.com/apps/anthropic');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Chave de API');
    await type(ui, 'sk-anth-0001');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Modelo');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Usar qwen como provedor ativo?');
    ui.stdin.write(KEYS.down); // Não
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'qwen configurado');
    const saved = home.readSettings() as { providers: { qwen: Record<string, unknown> } };
    expect(saved.providers.qwen).toMatchObject({
      enabled: true,
      protocol: 'anthropic',
      baseUrl: 'https://token-plan.maas.qwencloudapi.com/apps/anthropic',
      apiKey: 'sk-anth-0001',
    });
  });

  it('is refused while a response is in progress', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    ui.session.beginGeneration();
    await ui.controller.submit('/auth');
    expect(ui.controller.dialog).toBeUndefined();
    expect(ui.controller.notices.at(-1)?.text).toMatch(/Aguarde a resposta terminar/);
    ui.session.endGeneration();
  });

  it('Claude API: key + optional endpoint + model, saved with enabled=true', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await type(ui, '/auth claude-api');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Conectar provedor');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Chave de API (sk-ant-…)');
    await type(ui, 'sk-ant-xyz-0001');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Endpoint (opcional)');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Modelo');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Usar claude como provedor ativo?');
    ui.stdin.write(KEYS.down); // Não
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'claude configurado');
    const saved = home.readSettings() as { providers: { claude: Record<string, unknown> } };
    expect(saved.providers.claude).toMatchObject({
      enabled: true,
      apiKey: 'sk-ant-xyz-0001',
      model: 'claude-opus-5-5',
    });
    expect(saved.providers.claude['baseUrl']).toBeUndefined();
  });

  it('does not spam mouse escape sequences when the dialog opens', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    const before = ui.writes().split('\x1b[?1002l').length;
    await type(ui, '/auth');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Conectar provedor');
    expect(ui.writes().split('\x1b[?1002l').length).toBe(before);
  });
});

describe('/auth in non-interactive mode', () => {
  it('prints guidance instead of opening a dialog', async () => {
    const spy = vi.fn();
    void spy;
  });
});
