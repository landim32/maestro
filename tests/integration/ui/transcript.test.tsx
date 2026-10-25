/** specs/009 US2 — transcript in the Claude Code format (contracts/transcript.md). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../../../src/session/session.js';
import { allTools } from '../../../src/tools/registry.js';
import { cleanupSized, tick, waitForFrame } from '../../helpers/renderSized.js';
import { answer, KEYS, mountApp, toolCall } from '../../helpers/appHarness.js';
import type { ProviderEvent } from '../../../src/providers/types.js';

let cwd: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-transcript-'));
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'um\ndois\ntrês\n');
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.writeFileSync(path.join(cwd, 'src', 'a.ts'), 'x');
});
afterEach(() => {
  cleanupSized();
  fs.rmSync(cwd, { recursive: true, force: true });
});

function mount(events: ProviderEvent[][], extra: Parameters<typeof mountApp>[0] = {}) {
  const session = new Session({ cwd, activeProviderId: 'claude' });
  return mountApp({
    columns: 110,
    rows: 40,
    events,
    controller: { tools: allTools(), session },
    ...extra,
  });
}

async function send(ui: ReturnType<typeof mount>, text: string) {
  ui.stdin.write(text);
  await tick();
  ui.stdin.write(KEYS.enter);
}

describe('transcript (US2)', () => {
  it('⏺ before the reply, each call with its result under ⎿, no ⚙/✓ lines', async () => {
    const ui = mount([
      [
        { type: 'text_delta', text: 'Vou olhar. ' },
        ...toolCall('c1', 'read_file', { path: 'notes.txt' }),
      ],
      toolCall('c2', 'list_directory', { path: 'src' }),
      toolCall('c3', 'read_file', { path: 'nao-existe.txt' }),
      answer('Pronto, li tudo.'),
    ]);
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'leia');
    await waitForFrame(ui, 'Pronto, li tudo.');
    const t = ui.frameText();
    expect(t).toMatch(/⏺ Vou olhar\./);
    expect(t).toMatch(/⏺ Read\(notes\.txt\)\n\s+⎿ {2}Leu 3 linhas/);
    expect(t).toMatch(/⏺ List\(src\)\n\s+⎿ {2}1 item/);
    expect(t).toMatch(/⏺ Read\(nao-existe\.txt\)\n\s+⎿ {2}file not found: nao-existe\.txt/);
    expect(t).toMatch(/⏺ Pronto, li tudo\./);
    expect(t).not.toMatch(/^\s*⚙/m);
    expect(t).not.toMatch(/^\s*✓/m);
  });

  it('a route other than chat keeps its ⇢ line above the ⏺', async () => {
    const ui = mount([answer('resposta da rota')], {
      settings: { routes: { github: { provider: 'claude', model: 'claude-haiku-5-5' } } },
    });
    await waitForFrame(ui, 'Type a message');
    await send(ui, '/ask github oi');
    await waitForFrame(ui, 'resposta da rota');
    expect(ui.frameText()).toMatch(/⇢ github · claude \/ claude-haiku-5-5\n\s*⏺ resposta da rota/);
  });
});
