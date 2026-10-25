import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../../../src/session/session.js';
import { allTools } from '../../../src/tools/registry.js';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { answer, KEYS, mountApp, toolCall } from '../../helpers/appHarness.js';
import type { HarnessOptions } from '../../helpers/appHarness.js';
import type { ProviderEvent } from '../../../src/providers/types.js';

let cwd: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-approval-'));
});
afterEach(() => {
  cleanupSized();
  fs.rmSync(cwd, { recursive: true, force: true });
});

/** Mounts the App with real workspace tools in a temp cwd and a scripted provider. */
function mount(events: ProviderEvent[][], extra: Partial<HarnessOptions> = {}) {
  const session = new Session({ cwd, activeProviderId: 'claude' });
  return mountApp({
    columns: 110,
    rows: 32,
    events,
    controller: { tools: allTools(), session },
    ...extra,
  });
}

const statusLine = (ui: ReturnType<typeof mount>) =>
  [...ui.frameLines()].reverse().find((l) => /ready|thinking|waiting/.test(l)) ?? '';

async function send(ui: ReturnType<typeof mount>, text: string) {
  ui.stdin.write(text);
  await tick();
  ui.stdin.write(KEYS.enter);
  await tick();
}

/** contracts/approval-modes.md § 2–4, § 7 */
describe('approval modes (US1)', () => {
  it('Tab cycles the four modes in the status bar and back; Shift+Tab goes back; text survives', async () => {
    const ui = mount([answer('ok')]);
    await waitForFrame(ui, 'Pedir permissão');
    expect(statusLine(ui)).toContain('ready');

    ui.stdin.write('abc');
    await tick();
    ui.stdin.write(KEYS.tab);
    await waitForFrame(ui, 'Aceitar edições');
    expect(ui.controller.approvalMode).toBe('auto-edit');
    expect(ui.lastFrame()).toContain('modo: Aceitar edições');
    expect(ui.lastFrame()).toContain('› abc');

    ui.stdin.write(KEYS.tab);
    await waitForFrame(ui, 'Automático');
    ui.stdin.write(KEYS.tab);
    await waitForFrame(ui, 'YOLO');
    ui.stdin.write(KEYS.tab);
    await waitFor(() => ui.controller.approvalMode === 'default', 3000, 'back to default');
    expect(ui.lastFrame()).toContain('Pedir permissão');

    ui.stdin.write(KEYS.shiftTab);
    await waitFor(() => ui.controller.approvalMode === 'yolo', 3000, 'shift+tab');
    // the prompt text was never touched by Tab
    expect(ui.lastFrame()).toContain('› abc');
    expect(ui.lastFrame()).not.toContain('\t');
  });

  it('auto-edit: write_file runs without a dialog and is announced with its summary', async () => {
    const ui = mount([
      toolCall('c1', 'write_file', { path: 'hello.txt', content: 'olá' }),
      answer('arquivo criado'),
    ]);
    await waitForFrame(ui, 'Pedir permissão');
    ui.stdin.write(KEYS.tab);
    await waitForFrame(ui, 'Aceitar edições');
    await send(ui, 'crie hello.txt');
    await waitForFrame(ui, 'arquivo criado');
    const frame = ui.lastFrame() ?? '';
    expect(frame).not.toContain('[y]');
    expect(frame).toContain('⚙ write_file hello.txt');
    expect(frame).toContain('new file: hello.txt (1 lines)');
    expect(frame).toContain('auto (Aceitar edições)');
    expect(fs.readFileSync(path.join(cwd, 'hello.txt'), 'utf8')).toBe('olá');
    // the tool result went back to the model
    expect(ui.provider.requests[1]?.messages.at(-1)?.role).toBe('tool');
  });

  it('auto-edit still asks for commands; auto asks only for destructive ones, with the reason', async () => {
    const ui = mount([toolCall('c1', 'run_command', { command: 'rm -rf tmp' }), answer('feito')]);
    await waitForFrame(ui, 'Pedir permissão');
    ui.stdin.write(KEYS.tab);
    ui.stdin.write(KEYS.tab);
    await waitForFrame(ui, 'Automático');
    await send(ui, 'apague tmp');
    await waitForFrame(ui, '[y]');
    expect(ui.lastFrame()).toContain('Confirmação exigida: remoção recursiva');
    expect(ui.lastFrame()).toContain('modo: Automático');
    ui.stdin.write('n');
    await waitForFrame(ui, 'feito');
    const toolMsg = ui.provider.requests[1]?.messages.at(-1);
    expect(JSON.stringify(toolMsg?.content)).toContain('user declined');
  });

  it('a pending confirmation survives Tab: the mode changes, the dialog keeps waiting for y/n', async () => {
    const ui = mount([toolCall('c1', 'write_file', { path: 'a.txt', content: 'x' }), answer('ok')]);
    await waitForFrame(ui, 'Pedir permissão');
    await send(ui, 'crie a.txt');
    await waitForFrame(ui, '[y]');
    ui.stdin.write(KEYS.tab);
    await waitForFrame(ui, 'Aceitar edições');
    expect(ui.controller.session.state).toBe('awaiting_confirmation');
    expect(ui.lastFrame()).toContain('[y]');
    ui.stdin.write('n');
    await waitForFrame(ui, 'ok');
    expect(fs.existsSync(path.join(cwd, 'a.txt'))).toBe(false);
    expect(ui.controller.approvalMode).toBe('auto-edit');
  });

  it('/approval-mode shows and changes the mode; unknown values warn; Tab is ignored inside /model', async () => {
    const ui = mount([answer('ok')]);
    await waitForFrame(ui, 'Pedir permissão');
    await send(ui, '/approval-mode');
    await waitForFrame(ui, 'Modo de aprovação: Pedir permissão (default)');
    await send(ui, '/approval-mode yolo');
    await waitFor(() => ui.controller.approvalMode === 'yolo', 3000, 'yolo');
    expect(ui.lastFrame()).toContain('YOLO');
    await send(ui, '/approval-mode foo');
    await waitForFrame(ui, "Modo desconhecido 'foo'");

    await send(ui, '/model');
    await waitForFrame(ui, 'Selecionar modelo');
    ui.stdin.write(KEYS.tab);
    await tick();
    expect(ui.controller.approvalMode).toBe('yolo');
    ui.stdin.write(KEYS.esc);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
  });

  it('starts in the configured mode (settings.tools.approvalMode) and never writes the Tab change', async () => {
    const ui = mount([answer('ok')], { settings: { tools: { approvalMode: 'auto' } } });
    await waitForFrame(ui, 'Automático');
    expect(ui.controller.approvalMode).toBe('auto');
    ui.stdin.write(KEYS.tab);
    await waitForFrame(ui, 'YOLO');
    // the settings object the controller holds is untouched: a restart would start in `auto` again
    expect(ui.controller.settings.tools.approvalMode).toBe('auto');
  });
});
