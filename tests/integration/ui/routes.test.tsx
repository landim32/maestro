import { afterEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp, twoProviders } from '../../helpers/appHarness.js';
import { DEFAULT_COMMANDS } from '../../../src/session/commands.js';
import type { SlashCommand } from '../../../src/session/commands.js';

afterEach(() => cleanupSized());

const planCmd: SlashCommand = {
  name: 'speckit.plan',
  kind: 'prompt',
  description: 'Plano',
  origin: 'Spec Kit',
  run: (_ctl, _args, rest) => ({
    display: `/speckit.plan ${rest ?? ''}`.trim(),
    prompt: `PLAN ${rest ?? ''}`,
  }),
};
const initCmd: SlashCommand = {
  name: 'speckit.init',
  description: 'Instala',
  origin: 'Maestro',
  run: () => {},
};
const qwenOn = { providers: { qwen: { enabled: true, apiKey: 'sk-qwen-test-0000' } } };
const creds = { credentials: { claude: 'env' as const, qwen: 'config' as const } };

function mount(settings: Record<string, unknown> = {}, delayMs?: number) {
  const providers = twoProviders({ delayMs });
  const ui = mountApp({
    columns: 100,
    rows: 30,
    providers,
    settings: { ...qwenOn, ...settings },
    credentials: creds,
    controller: { commands: [...DEFAULT_COMMANDS, planCmd, initCmd] },
  });
  return { ...ui, providers };
}

async function send(ui: { stdin: { write(s: string): void } }, text: string) {
  await tick(); // let the prompt's input hook (re)subscribe after the last render
  ui.stdin.write(text);
  await tick();
  ui.stdin.write(KEYS.enter);
}

describe('routes in the UI (specs/008 quickstart 2, 4, 5, 6)', () => {
  it('a command routed to another provider shows the route in the bar and the transcript; chat sees its reply', async () => {
    const ui = mount(
      { routes: { 'speckit.plan': { provider: 'qwen', model: 'qwen3-coder-plus' } } },
      120,
    );
    await waitForFrame(ui, 'Type a message');
    await send(ui, '/speckit.plan tudo');
    await waitForFrame(ui, 'rota: speckit.plan');
    await waitForFrame(ui, '⇢ speckit.plan · qwen / qwen3-coder-plus');
    expect(ui.frameText()).toContain('from qwen');
    expect(ui.providers.qwen.requests[0]!.model).toBe('qwen3-coder-plus');
    expect(ui.frameText()).toMatch(/claude \/ claude-opus-5-5/); // header: active provider unchanged
    await waitForFrame(ui, 'Type a message'); // prompt active again
    await send(ui, 'resuma');
    await waitForFrame(ui, 'from claude');
    expect(ui.frameText()).not.toContain('rota: ');
    expect(JSON.stringify(ui.providers.claude.requests[0]!.messages)).toContain('from qwen');
    const marks = ui.frameText().split('⇢').length - 1;
    expect(marks).toBe(1); // the chat reply is unmarked
  });

  it('/ask and the purpose shortcuts route a request without changing the active provider', async () => {
    const ui = mount({
      routes: {
        github: { provider: 'qwen', model: 'q1' },
        infra: { provider: 'qwen', model: 'q2' },
      },
    });
    await waitForFrame(ui, 'Type a message');
    await send(ui, '/ask github resuma o PR #6');
    await waitForFrame(ui, '⇢ github · qwen / q1');
    expect(ui.providers.qwen.requests[0]!.system).toContain('# Route: github');
    await send(ui, '/infra como escalar?');
    await waitForFrame(ui, '⇢ infra · qwen / q2');
    expect(ui.providers.qwen.requests[1]!.system).toContain('# Route: infra');
    expect(ui.session.activeProviderId).toBe('claude');
    expect(ui.frameText()).toContain('› /infra como escalar?');
  });

  it('an unavailable route warns and falls back; /routes in the dialog lists only prompt commands', async () => {
    const ui = mount({
      providers: { qwen: { enabled: false } },
      routes: { 'speckit.plan': { provider: 'qwen', model: 'q' } },
    });
    await waitForFrame(ui, 'Type a message');
    await send(ui, '/speckit.plan x');
    await waitForFrame(
      ui,
      'Rota speckit.plan indisponível (provedor qwen desabilitado); usando o provedor ativo.',
    );
    await waitForFrame(ui, 'from claude');
    expect(ui.providers.qwen.requests).toHaveLength(0);
    await send(ui, '/routes');
    await waitForFrame(ui, 'Rotas por modelo');
    const text = ui.frameText();
    expect(text).toContain('speckit.plan');
    expect(text).toContain('indisponível');
    expect(text).not.toContain('speckit.init');
    expect(text).not.toMatch(/[○●] (help|ask|model)\b/);
    ui.stdin.write(KEYS.esc);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
  });

  it('commands added later appear as routes after refreshCommands (no restart)', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    expect(ui.controller.routeEntries().map((e) => e.name)).toEqual([
      'chat',
      'github',
      'infra',
      'speckit.plan',
    ]);
    const revisar: SlashCommand = {
      name: 'revisar',
      kind: 'prompt',
      description: 'r',
      origin: 'projeto',
      run: () => ({ display: '/revisar', prompt: 'R' }),
    };
    (ui.controller as unknown as { baseCommands: SlashCommand[] }).baseCommands.push(revisar);
    ui.controller.refreshCommands();
    expect(ui.controller.routeEntries().map((e) => e.name)).toContain('revisar');
  });
});
