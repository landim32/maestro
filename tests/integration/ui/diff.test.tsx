/** specs/009 US3 — write diff in the confirmation dialog and in the transcript. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../../../src/session/session.js';
import { allTools } from '../../../src/tools/registry.js';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { answer, KEYS, mountApp, toolCall } from '../../helpers/appHarness.js';

let cwd: string;
const original = Array.from({ length: 200 }, (_, i) => `linha ${i + 1}`).join('\n') + '\n';
const changed = original
  .split('\n')
  .map((l, i) => (i >= 99 && i <= 101 ? `MUDOU ${i + 1}` : l))
  .join('\n');

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-diff-'));
  fs.writeFileSync(path.join(cwd, 'big.txt'), original);
});
afterEach(() => {
  cleanupSized();
  fs.rmSync(cwd, { recursive: true, force: true });
});

function mount() {
  const session = new Session({ cwd, activeProviderId: 'claude' });
  return mountApp({
    columns: 110,
    rows: 50,
    events: [toolCall('w1', 'write_file', { path: 'big.txt', content: changed }), answer('feito')],
    controller: { tools: allTools(), session },
  });
}

async function send(ui: ReturnType<typeof mount>, text: string) {
  ui.stdin.write(text);
  await tick();
  ui.stdin.write(KEYS.enter);
}

describe('write diff (US3)', () => {
  it('the dialog shows path, +3 −3 and line numbers; after approval the transcript keeps the same diff', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'mude');
    await waitForFrame(ui, '[y]');
    const dialog = ui.frameText();
    expect(dialog).toContain('big.txt · +3 −3');
    expect(dialog).toMatch(/100 - linha 100/);
    expect(dialog).toMatch(/100 \+ MUDOU 100/);
    expect(dialog).toMatch(/ 97 {3}linha 97/); // 3 lines of context
    expect(dialog).not.toMatch(/ 96 {3}linha 96/);
    ui.stdin.write('y');
    await waitForFrame(ui, 'feito');
    const t = ui.frameText();
    expect(t).toMatch(/⏺ Write\(big\.txt\)\n\s+⎿ {2}\+3 −3 linhas/);
    expect(t).toMatch(/102 \+ MUDOU 102/);
    expect(fs.readFileSync(path.join(cwd, 'big.txt'), 'utf8')).toBe(changed);
  });

  it('a declined write shows "recusado pelo usuário" without the diff', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'mude');
    await waitForFrame(ui, '[y]');
    ui.stdin.write('n');
    await waitForFrame(ui, 'feito');
    const t = ui.frameText();
    expect(t).toMatch(/⏺ Write\(big\.txt\)\n\s+⎿ {2}recusado pelo usuário/);
    expect(t).not.toContain('MUDOU 100');
    expect(fs.readFileSync(path.join(cwd, 'big.txt'), 'utf8')).toBe(original);
  });

  it('in auto-edit the diff appears without a dialog, with the mode that released it', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Pedir permissão');
    ui.stdin.write(KEYS.shiftTab);
    await waitFor(() => ui.controller.approvalMode === 'auto-edit', 3000, 'auto-edit');
    await send(ui, 'mude');
    await waitForFrame(ui, 'feito');
    const t = ui.frameText();
    expect(t).not.toContain('[y]');
    expect(t).toContain('⎿  +3 −3 linhas · auto (Aceitar edições)');
    expect(t).toMatch(/101 \+ MUDOU 101/);
  });
});
