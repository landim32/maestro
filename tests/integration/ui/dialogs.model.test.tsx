import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp } from '../../helpers/appHarness.js';
import { textProvider } from '../../helpers/fakeProvider.js';
import { withTempHome } from '../../helpers/tempHome.js';
import type { TempHome } from '../../helpers/tempHome.js';

let home: TempHome;
beforeEach(() => {
  home = withTempHome({
    activeProvider: 'claude',
    providers: { qwen: { enabled: true, apiKey: 'sk-q-4321' } },
  });
});
afterEach(() => {
  cleanupSized();
  home.cleanup();
});

function mount(qwenConfigured = true) {
  const claude = textProvider(['from claude', 'from claude 2'], { id: 'claude' });
  const qwen = textProvider(['from qwen'], { id: 'qwen' });
  const ui = mountApp({
    columns: 100,
    rows: 30,
    providers: { claude, qwen },
    settings: qwenConfigured ? { providers: { qwen: { enabled: true, apiKey: 'sk-q-4321' } } } : {},
    credentials: { credentials: { claude: 'profile', qwen: qwenConfigured ? 'config' : 'none' } },
    controller: { settingsPaths: { globalPath: home.globalPath, cwd: home.home }, env: {} },
  });
  return { ...ui, claude, qwen };
}

async function openModel(ui: ReturnType<typeof mount>) {
  await waitForFrame(ui, 'Type a message');
  ui.stdin.write('/model');
  await tick();
  ui.stdin.write(KEYS.enter);
  await waitForFrame(ui, 'Selecionar modelo');
}

describe('/model selector (US3)', () => {
  it('lists providers with the active one marked and credential origins', async () => {
    const ui = mount();
    await openModel(ui);
    const frame = ui.lastFrame() ?? '';
    expect(frame).toMatch(/● claude\s+\/ claude-opus-5-5\s+perfil\s+\[ativo\]/);
    expect(frame).toMatch(/○ qwen\s+\/ qwen3-coder-plus\s+chave \*\*\*\*4321/);
    expect(frame).toContain('Digitar outro modelo…');
    expect(frame).not.toContain('sk-q-4321');
  });

  it('↓ + Enter switches to Qwen, updates the header, persists and keeps the conversation', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('hello');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'from claude');
    await openModel(ui);
    ui.stdin.write(KEYS.down);
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.session.activeProviderId).toBe('qwen');
    expect(ui.frameLines()[0]).toContain('qwen / qwen3-coder-plus');
    expect(ui.session.history).toHaveLength(2);
    const saved = home.readSettings() as { activeProvider: string };
    expect(saved.activeProvider).toBe('qwen');
    ui.stdin.write('again');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'from qwen');
    expect(ui.qwen.requests[0]?.messages).toHaveLength(3);
  });

  it('unconfigured providers are disabled and skipped', async () => {
    const ui = mount(false);
    await openModel(ui);
    expect(ui.lastFrame()).toContain('não configurado — configure com /auth');
    ui.stdin.write(KEYS.down); // skips qwen → custom entry
    await tick();
    const flow = ui.controller.dialog?.type === 'model' ? ui.controller.dialog.flow : undefined;
    expect(flow?.step === 'list' && flow.selected).toBe(2);
  });

  it('"Digitar outro modelo…" applies a custom model name for the highlighted provider', async () => {
    const ui = mount();
    await openModel(ui);
    ui.stdin.write(KEYS.up); // wraps to the custom entry
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Modelo para claude');
    ui.stdin.write(KEYS.ctrlU);
    await tick();
    ui.stdin.write('claude-sonnet-5-5');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.controller.activeModel).toBe('claude-sonnet-5-5');
    expect(ui.frameLines()[0]).toContain('claude / claude-sonnet-5-5');
    const saved = home.readSettings() as { providers: { claude: { model: string } } };
    expect(saved.providers.claude.model).toBe('claude-sonnet-5-5');
  });

  it('Esc closes without changes; /model is refused while generating', async () => {
    const ui = mount();
    await openModel(ui);
    ui.stdin.write(KEYS.esc);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.session.activeProviderId).toBe('claude');
    ui.session.beginGeneration();
    await ui.controller.submit('/model');
    expect(ui.controller.dialog).toBeUndefined();
    expect(ui.controller.notices.at(-1)?.text).toMatch(/Aguarde/);
    ui.session.endGeneration();
  });

  it('the textual form still works and now persists the choice', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await ui.controller.submit('/model qwen qwen-max');
    expect(ui.session.activeProviderId).toBe('qwen');
    const saved = home.readSettings() as {
      activeProvider: string;
      providers: { qwen: { model: string } };
    };
    expect(saved.activeProvider).toBe('qwen');
    expect(saved.providers.qwen.model).toBe('qwen-max');
    expect(ui.controller.dialog).toBeUndefined();
  });
});
