import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp } from '../../helpers/appHarness.js';
import { textProvider } from '../../helpers/fakeProvider.js';
import { withTempHome } from '../../helpers/tempHome.js';
import type { TempHome } from '../../helpers/tempHome.js';
import { fileHistoryStore, InputHistory } from '../../../src/session/history.js';

let home: TempHome;
beforeEach(() => {
  home = withTempHome();
});
afterEach(() => {
  cleanupSized();
  home.cleanup();
});

function mount() {
  const provider = textProvider(['r1', 'r2', 'r3', 'r4'], { id: 'claude' });
  const history = new InputHistory(fileHistoryStore(home.historyPath));
  const ui = mountApp({
    columns: 100,
    rows: 30,
    provider,
    credentials: { credentials: { claude: 'profile', qwen: 'none' } },
    controller: {
      settingsPaths: { globalPath: home.globalPath, cwd: home.home },
      env: {},
      history,
    },
  });
  return { ...ui, history };
}

async function type(ui: ReturnType<typeof mount>, text: string) {
  ui.stdin.write(text);
  await tick();
}
async function send(ui: ReturnType<typeof mount>, text: string) {
  await type(ui, text);
  ui.stdin.write(KEYS.enter);
  await tick();
}
/** The prompt box sits below the transcript, so its line is the last one with the marker. */
const promptLine = (ui: ReturnType<typeof mount>) =>
  [...ui.frameLines()].reverse().find((l) => l.includes('› ') || l.includes('⋮ ')) ?? '';

describe('input history (US1, contracts/history.md)', () => {
  it('↑ walks messages and commands from newest to oldest; ↓ returns to the empty prompt', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'olá');
    await waitForFrame(ui, 'r1');
    await send(ui, '/model');
    await waitForFrame(ui, 'Selecionar modelo');
    ui.stdin.write(KEYS.esc);
    await waitFor(() => ui.controller.dialog === undefined, 3000, 'closed');
    await send(ui, 'segunda mensagem');
    await waitForFrame(ui, 'r2');

    expect(home.readHistory()).toEqual(['olá', '/model', 'segunda mensagem']);

    ui.stdin.write(KEYS.up);
    await waitFor(() => promptLine(ui).includes('segunda mensagem'), 3000, '↑ 1');
    ui.stdin.write(KEYS.up);
    await waitFor(() => promptLine(ui).includes('/model'), 3000, '↑ 2');
    ui.stdin.write(KEYS.up);
    await waitFor(() => promptLine(ui).includes('olá'), 3000, '↑ 3');
    ui.stdin.write(KEYS.up); // oldest: stays
    await tick();
    expect(promptLine(ui)).toContain('olá');
    ui.stdin.write(KEYS.down);
    await waitFor(() => promptLine(ui).includes('/model'), 3000, '↓ 1');
    ui.stdin.write(KEYS.down);
    ui.stdin.write(KEYS.down);
    await waitFor(() => promptLine(ui).includes('Type a message'), 3000, 'back to empty');
  });

  it('keeps the draft while browsing; an edited entry is sent and becomes the newest', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'one');
    await waitForFrame(ui, 'r1');
    await send(ui, 'two');
    await waitForFrame(ui, 'r2');

    await type(ui, 'rasc');
    ui.stdin.write(KEYS.up);
    await waitFor(() => promptLine(ui).includes('two'), 3000, '↑ shows two');
    ui.stdin.write(KEYS.up);
    await waitFor(() => promptLine(ui).includes('one'), 3000, '↑ shows one');
    ui.stdin.write(KEYS.down);
    ui.stdin.write(KEYS.down);
    await waitFor(() => promptLine(ui).includes('rasc'), 3000, 'draft restored');
    expect(promptLine(ui)).not.toContain('one');

    // edit a recalled entry and send it
    ui.stdin.write(KEYS.up); // 'two' (draft 'rasc' saved again)
    await waitFor(() => promptLine(ui).includes('two'), 3000, 'two again');
    await type(ui, '!');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'r3');
    expect(home.readHistory()).toEqual(['one', 'two', 'two!']);
    expect([...ui.history.entries]).toEqual(['one', 'two', 'two!']);
  });

  it('does not repeat consecutive duplicates and survives /clear', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'same');
    await waitForFrame(ui, 'r1');
    await send(ui, 'same');
    await waitForFrame(ui, 'r2');
    expect(home.readHistory()).toEqual(['same']);
    await send(ui, '/clear');
    await waitFor(() => ui.session.history.length === 0, 3000, 'cleared');
    expect(home.readHistory()).toEqual(['same', '/clear']);
    ui.stdin.write(KEYS.up);
    await waitFor(() => promptLine(ui).includes('/clear'), 3000, 'history kept after /clear');
  });

  it('persists across sessions: a second mount with the same home recovers the entries', async () => {
    const first = mount();
    await waitForFrame(first, 'Type a message');
    await send(first, 'from session 1');
    await waitForFrame(first, 'r1');
    await send(first, '/help');
    await tick();
    cleanupSized();

    const second = mount();
    await waitForFrame(second, 'Type a message');
    expect([...second.history.entries]).toEqual(['from session 1', '/help']);
    second.stdin.write(KEYS.up);
    await waitFor(() => promptLine(second).includes('/help'), 3000, '↑ recovers /help');
    second.stdin.write(KEYS.up);
    await waitFor(() => promptLine(second).includes('from session 1'), 3000, '↑ recovers msg');
  });

  it('Shift+↑ never touches the prompt (scroll key)', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    await send(ui, 'x');
    await waitForFrame(ui, 'r1');
    ui.stdin.write(KEYS.shiftUp);
    await tick();
    expect(promptLine(ui)).toContain('Type a message');
  });
});
