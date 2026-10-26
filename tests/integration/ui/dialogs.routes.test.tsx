import { afterEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp, twoProviders } from '../../helpers/appHarness.js';
import { DEFAULT_COMMANDS } from '../../../src/session/commands.js';
import type { SlashCommand } from '../../../src/session/commands.js';
import { applyPatch } from '../../../src/config/writer.js';
import type { SettingsPatchEntry } from '../../../src/config/writer.js';
import { settingsSchema } from '../../../src/config/schema.js';
import { MaestroError } from '../../../src/utils/errors.js';

afterEach(() => cleanupSized());

const planCmd: SlashCommand = {
  name: 'speckit.plan',
  kind: 'prompt',
  description: 'Plano',
  origin: 'Spec Kit',
  run: () => ({ display: '/speckit.plan', prompt: 'PLAN' }),
};

/** In-memory settings file: the writer patches it and the loader re-parses it. */
function memorySettings(initial: Record<string, unknown>) {
  let raw: Record<string, unknown> = structuredClone(initial);
  const patches: SettingsPatchEntry[][] = [];
  let fail = false;
  return {
    patches,
    setFail: (v: boolean) => (fail = v),
    writer: (patch: SettingsPatchEntry[]) => {
      if (fail) throw new MaestroError({ category: 'invalid_config', message: 'disco cheio' });
      patches.push(patch);
      raw = applyPatch(raw, patch);
      return { path: '(memory)', overriddenByProject: [] as string[] };
    },
    loader: () => ({
      settings: settingsSchema.parse(raw),
      credentialSources: {
        claude: 'env' as const,
        qwen: 'config' as const,
        'claude-code': 'none' as const,
        codex: 'none' as const,
      },
    }),
  };
}

const base = { providers: { qwen: { enabled: true, apiKey: 'sk-qwen-test-0000' } } };

function mount(initial: Record<string, unknown> = {}) {
  const mem = memorySettings({ ...base, ...initial });
  const ui = mountApp({
    columns: 110,
    rows: 34,
    providers: twoProviders(),
    settings: { ...base, ...initial },
    credentials: { credentials: { claude: 'env', qwen: 'config' } },
    controller: {
      commands: [...DEFAULT_COMMANDS, planCmd],
      settingsWriter: mem.writer,
      settingsLoader: mem.loader,
    },
  });
  return { ...ui, mem };
}

async function open(ui: ReturnType<typeof mount>) {
  await waitForFrame(ui, 'Type a message');
  ui.stdin.write('/routes');
  await tick();
  ui.stdin.write(KEYS.enter);
  await waitForFrame(ui, 'Rotas por modelo');
}
async function press(ui: ReturnType<typeof mount>, ...keys: string[]) {
  for (const k of keys) {
    ui.stdin.write(k);
    await tick();
  }
}

describe('/routes dialog (contracts/routes-dialog.md)', () => {
  it('lists purpose and command routes with their origin; Esc closes without writing', async () => {
    const ui = mount();
    await open(ui);
    const text = ui.frameText();
    expect(text).toContain('Rotas');
    expect(text).toContain('Comandos');
    expect(text).toMatch(/chat\s+claude \/ claude-opus-5-5\s+\[padrão \(segue o ativo\)\]/);
    expect(text).toMatch(/speckit\.plan\s+claude \/ claude-opus-5-5\s+\[padrão \(segue chat\)\]/);
    expect(text).toContain('Nova rota…');
    await press(ui, KEYS.esc);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.mem.patches).toHaveLength(0);
  });

  it('sets a command route to another provider/model, then resets it to the default', async () => {
    const ui = mount();
    await open(ui);
    await press(ui, KEYS.down, KEYS.down, KEYS.down, KEYS.down); // speckit.plan (after chat, github, infra, autopilot.decide)
    await press(ui, KEYS.enter);
    await waitForFrame(ui, 'Escolher provedor e modelo');
    await press(ui, KEYS.enter);
    await waitForFrame(ui, 'provedor');
    await press(ui, KEYS.down, KEYS.enter); // qwen
    await waitForFrame(ui, 'qwen3-coder-plus');
    await press(ui, KEYS.down, KEYS.enter); // qwen3-coder-flash
    await waitForFrame(ui, 'Rota speckit.plan → qwen / qwen3-coder-flash');
    expect(ui.mem.patches[0]).toEqual([
      {
        path: 'routes.speckit.plan',
        segments: ['routes', 'speckit.plan'],
        value: { provider: 'qwen', model: 'qwen3-coder-flash' },
      },
    ]);
    await press(ui, KEYS.enter);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.controller.settings.routes['speckit.plan']).toEqual({
      provider: 'qwen',
      model: 'qwen3-coder-flash',
    });
    // reopen: the row is now global; "Voltar ao padrão" removes the key
    await open(ui);
    expect(ui.frameText()).toMatch(/speckit\.plan\s+qwen \/ qwen3-coder-flash\s+\[global\]/);
    await press(ui, KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.enter); // speckit.plan
    await waitForFrame(ui, 'Voltar ao padrão');
    await press(ui, KEYS.down, KEYS.enter);
    await waitForFrame(ui, 'Rota speckit.plan voltou ao padrão.');
    expect(ui.mem.patches[1]).toEqual([
      { path: 'routes.speckit.plan', segments: ['routes', 'speckit.plan'], value: undefined },
    ]);
  });

  it('creates a user route with a custom model and offers to remove it; built-ins cannot be removed', async () => {
    const ui = mount();
    await open(ui);
    await press(ui, KEYS.up, KEYS.enter); // Nova rota…
    await waitForFrame(ui, 'Nome da rota');
    await press(ui, 'Review', KEYS.enter);
    await waitForFrame(ui, 'minúsculas');
    await press(ui, KEYS.ctrlU, 'review', KEYS.enter);
    await waitForFrame(ui, 'provedor');
    await press(ui, KEYS.enter); // claude
    await waitForFrame(ui, 'Digitar outro modelo');
    await press(ui, KEYS.up, KEYS.enter); // custom
    await waitForFrame(ui, 'Modelo para claude');
    await press(ui, 'claude-custom-9', KEYS.enter);
    await waitForFrame(ui, 'Rota review criada → claude / claude-custom-9');
    expect(ui.mem.patches[0]![0]).toEqual({
      path: 'routes.review',
      segments: ['routes', 'review'],
      value: { provider: 'claude', model: 'claude-custom-9' },
    });
    await press(ui, KEYS.enter);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    expect(ui.controller.commands.some((c) => c.name === 'review')).toBe(true); // shortcut appeared
    await open(ui);
    expect(ui.frameText()).toMatch(
      /review\s+claude \/ claude-custom-9\s+\[global · atalho \/review\]/,
    );
    await press(ui, KEYS.down, KEYS.down, KEYS.down, KEYS.down, KEYS.enter); // review (after chat, github, infra, autopilot.decide)
    await waitForFrame(ui, 'Remover rota');
    await press(ui, KEYS.down, KEYS.enter);
    await waitForFrame(ui, 'Rota review removida.');
    expect(ui.mem.patches.at(-1)).toEqual([
      { path: 'routes.review', segments: ['routes', 'review'], value: undefined },
    ]);
    await press(ui, KEYS.enter);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    await open(ui);
    await press(ui, KEYS.down, KEYS.enter); // github: built-in without value → no remove
    await waitForFrame(ui, 'Escolher provedor e modelo');
    expect(ui.frameText()).not.toContain('Remover rota');
    expect(ui.frameText()).not.toContain('Voltar ao padrão');
  });

  it('a failed write shows the error', async () => {
    const ui = mount();
    await open(ui);
    ui.mem.setFail(true);
    await press(ui, KEYS.enter, KEYS.enter); // chat → set
    await waitForFrame(ui, 'provedor');
    await press(ui, KEYS.enter, KEYS.enter); // claude → first model
    await waitForFrame(ui, 'Não foi possível gravar a rota');
    expect(ui.frameText()).toContain('disco cheio');
    await press(ui, KEYS.enter);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
  });
});
