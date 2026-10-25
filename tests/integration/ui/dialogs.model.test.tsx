import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp } from '../../helpers/appHarness.js';
import { textProvider } from '../../helpers/fakeProvider.js';
import { withTempHome } from '../../helpers/tempHome.js';
import type { TempHome } from '../../helpers/tempHome.js';
import type { SettingsInput } from '../../../src/config/schema.js';
import type { ControllerOptions } from '../../../src/session/controller.js';
import { MaestroError } from '../../../src/utils/errors.js';

const QWEN_ON: SettingsInput = { providers: { qwen: { enabled: true, apiKey: 'sk-q-4321' } } };

let home: TempHome;
beforeEach(() => {
  home = withTempHome({ activeProvider: 'claude', ...QWEN_ON });
});
afterEach(() => {
  cleanupSized();
  home.cleanup();
});

function mount(
  opts: {
    qwenConfigured?: boolean;
    settings?: SettingsInput;
    controller?: Partial<ControllerOptions>;
  } = {},
) {
  const qwenConfigured = opts.qwenConfigured ?? true;
  const claude = textProvider(['from claude', 'from claude 2'], { id: 'claude' });
  const qwen = textProvider(['from qwen'], { id: 'qwen' });
  const ui = mountApp({
    columns: 100,
    rows: 30,
    providers: { claude, qwen },
    settings: opts.settings ?? (qwenConfigured ? QWEN_ON : {}),
    credentials: { credentials: { claude: 'profile', qwen: qwenConfigured ? 'config' : 'none' } },
    controller: {
      settingsPaths: { globalPath: home.globalPath, cwd: home.home },
      env: {},
      ...opts.controller,
    },
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
const flowOf = (ui: ReturnType<typeof mount>) =>
  ui.controller.dialog?.type === 'model' ? ui.controller.dialog.flow : undefined;
async function press(ui: ReturnType<typeof mount>, key: string, times = 1) {
  for (let i = 0; i < times; i++) {
    ui.stdin.write(key);
    await tick();
  }
}

describe('/model selector — grouped catalogue (US2)', () => {
  it('lists every model grouped by provider with the active one marked and credential origins', async () => {
    const ui = mount();
    await openModel(ui);
    const frame = ui.lastFrame() ?? '';
    expect(frame).toMatch(/claude · perfil/);
    expect(frame).toMatch(/> ● claude-opus-5-5\s+\[ativo\]/);
    expect(frame).toContain('○ claude-sonnet-5-5');
    expect(frame).toContain('○ claude-haiku-5-5');
    expect(frame).toMatch(/qwen · chave \*\*\*\*4321/);
    expect(frame).toContain('○ qwen3-coder-plus');
    expect(frame).toContain('○ qwen3-max');
    expect(frame).toContain('Digitar outro modelo…');
    expect(frame).not.toContain('sk-q-4321');
  });

  it('↓×3 + Enter switches to Qwen, updates the header, persists and keeps the conversation', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('hello');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'from claude');
    await openModel(ui);
    await press(ui, KEYS.down, 3);
    ui.stdin.write(KEYS.enter);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.session.activeProviderId).toBe('qwen');
    expect(ui.frameLines()[0]).toContain('qwen / qwen3-coder-plus');
    expect(ui.session.history).toHaveLength(2);
    const saved = home.readSettings() as {
      activeProvider: string;
      providers: { qwen: Record<string, unknown> };
    };
    expect(saved.activeProvider).toBe('qwen');
    expect(saved.providers.qwen['models']).toBeUndefined(); // catalogue model: nothing to learn
    ui.stdin.write('again');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'from qwen');
    expect(ui.qwen.requests[0]?.messages).toHaveLength(3);
  });

  it('↓ + Enter picks another model of the same provider and persists providers.claude.model', async () => {
    const ui = mount();
    await openModel(ui);
    await press(ui, KEYS.down);
    ui.stdin.write(KEYS.enter);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.frameLines()[0]).toContain('claude / claude-sonnet-5-5');
    const saved = home.readSettings() as { providers: { claude: { model: string } } };
    expect(saved.providers.claude.model).toBe('claude-sonnet-5-5');
  });

  it('models of unconfigured providers are disabled and skipped by the navigation', async () => {
    const ui = mount({ qwenConfigured: false });
    await openModel(ui);
    expect(ui.lastFrame()).toContain('qwen · não configurado — configure com /auth');
    await press(ui, KEYS.down, 3); // haiku → (qwen and claude-code rows skipped) → custom entry
    expect(flowOf(ui)).toMatchObject({ step: 'list', selected: 9 });
  });

  it('a model added to providers.<id>.models in the file shows up in the list', async () => {
    const withExtra: SettingsInput = {
      providers: {
        claude: { models: ['claude-opus-5-5', 'claude-x'] },
        qwen: { enabled: true, apiKey: 'sk-q-4321' },
        'claude-code': { models: ['claude-opus-5-5'] },
      },
    };
    const ui = mount({ settings: withExtra });
    await openModel(ui);
    expect(ui.lastFrame()).toContain('○ claude-x');
    expect(ui.lastFrame()).not.toContain('claude-sonnet-5-5');
  });

  it('long lists keep the selected row visible in a window', async () => {
    const many: SettingsInput = {
      providers: {
        claude: { models: Array.from({ length: 30 }, (_, i) => `claude-m${i}`) },
        qwen: { enabled: true, apiKey: 'sk-q-4321' },
      },
    };
    const ui = mount({ settings: many });
    await openModel(ui);
    // the active model (outside the 30-entry catalogue) is appended to the claude group → window near the end
    expect(ui.lastFrame()).toContain('acima');
    expect(ui.lastFrame()).toMatch(/> ● claude-opus-5-5\s+\[ativo\]/);
    expect(ui.lastFrame()).not.toContain('claude-m0');
    await press(ui, KEYS.down, 5); // qwen ×3 → custom → wraps to the first model
    await waitForFrame(ui, '> ○ claude-m0');
    expect(ui.lastFrame()).toContain('abaixo');
    expect(ui.lastFrame()).not.toContain('acima');
    expect(ui.lastFrame()).toContain('claude-m1'); // consecutive rows, nothing swallowed
    expect(ui.lastFrame()).toContain('claude-m2');
  });
});

describe('/model selector — "Digitar outro modelo…" (US3)', () => {
  it('asks for the provider, then the name; activates, persists and learns the model', async () => {
    const ui = mount();
    await openModel(ui);
    await press(ui, KEYS.up); // wraps to the custom entry
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Selecionar modelo · provedor');
    expect(ui.lastFrame()).toMatch(/> claude\s+perfil/);
    expect(ui.lastFrame()).toMatch(/qwen\s+chave \*\*\*\*4321/);
    await press(ui, KEYS.down); // qwen
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Modelo para qwen');
    ui.stdin.write(KEYS.ctrlU);
    await tick();
    ui.stdin.write('qwen3-max-preview');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.session.activeProviderId).toBe('qwen');
    expect(ui.controller.activeModel).toBe('qwen3-max-preview');
    expect(ui.frameLines()[0]).toContain('qwen / qwen3-max-preview');
    const saved = home.readSettings() as {
      activeProvider: string;
      providers: { qwen: { model: string; models: string[] } };
    };
    expect(saved.activeProvider).toBe('qwen');
    expect(saved.providers.qwen.model).toBe('qwen3-max-preview');
    expect(saved.providers.qwen.models).toEqual([
      'qwen3-coder-plus',
      'qwen3-coder-flash',
      'qwen3-max',
      'qwen3-max-preview',
    ]);

    // the learned model is now part of the list, marked active
    await openModel(ui);
    expect(ui.lastFrame()).toMatch(/> ● qwen3-max-preview\s+\[ativo\]/);

    // typing it again does not duplicate (the active row is now the last qwen model; ↓ reaches the custom entry)
    await press(ui, KEYS.down);
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Selecionar modelo · provedor');
    expect(flowOf(ui)).toMatchObject({ step: 'customProvider', selected: 1 }); // active provider preselected
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Modelo para qwen');
    ui.stdin.write(KEYS.enter); // pre-filled with the active model
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    const again = home.readSettings() as { providers: { qwen: { models: string[] } } };
    expect(again.providers.qwen.models.filter((m) => m === 'qwen3-max-preview')).toHaveLength(1);
  });

  it('unconfigured providers cannot be chosen; Esc goes back to the provider step and then to the list', async () => {
    const ui = mount({ qwenConfigured: false });
    await openModel(ui);
    await press(ui, KEYS.up);
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Selecionar modelo · provedor');
    expect(ui.lastFrame()).toMatch(/qwen\s+não configurado — configure com \/auth/);
    await press(ui, KEYS.down); // stays on claude (qwen is disabled)
    expect(flowOf(ui)).toMatchObject({ step: 'customProvider', selected: 0 });
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Modelo para claude');
    ui.stdin.write(KEYS.esc);
    await waitForFrame(ui, 'Selecionar modelo · provedor');
    ui.stdin.write(KEYS.esc);
    await waitFor(() => flowOf(ui)?.step === 'list', 3000, 'back to list');
    ui.stdin.write(KEYS.esc);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.session.activeProviderId).toBe('claude');
  });

  it('a failed write keeps the model active for the session and warns', async () => {
    const ui = mount({
      controller: {
        settingsWriter: () => {
          throw new MaestroError({
            category: 'invalid_config',
            message: 'could not write: EACCES',
          });
        },
      },
    });
    await openModel(ui);
    await press(ui, KEYS.down);
    ui.stdin.write(KEYS.enter);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.frameLines()[0]).toContain('claude / claude-sonnet-5-5');
    expect(ui.controller.notices.at(-1)?.text).toMatch(/Não foi possível gravar a configuração/);
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

  it('the textual form persists the choice and learns a new model name', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await ui.controller.submit('/model qwen qwen-max');
    expect(ui.session.activeProviderId).toBe('qwen');
    const saved = home.readSettings() as {
      activeProvider: string;
      providers: { qwen: { model: string; models: string[] } };
    };
    expect(saved.activeProvider).toBe('qwen');
    expect(saved.providers.qwen.model).toBe('qwen-max');
    expect(saved.providers.qwen.models).toEqual([
      'qwen3-coder-plus',
      'qwen3-coder-flash',
      'qwen3-max',
      'qwen-max',
    ]);
    await ui.controller.submit('/model qwen qwen3-max'); // catalogue model: list unchanged
    const again = home.readSettings() as { providers: { qwen: { models: string[] } } };
    expect(again.providers.qwen.models).toHaveLength(4);
    expect(ui.controller.dialog).toBeUndefined();
  });
});
