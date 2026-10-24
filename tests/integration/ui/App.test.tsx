import { afterEach, describe, expect, it } from 'vitest';
import { createFakeProvider } from '../../helpers/fakeProvider.js';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp } from '../../helpers/appHarness.js';

afterEach(() => cleanupSized());

describe('App (interactive UI)', () => {
  it('renders header with provider/model and the prompt', async () => {
    const ui = mountApp({ columns: 100, rows: 30 });
    await waitForFrame(ui, '/help');
    const frame = ui.lastFrame() ?? '';
    expect(frame).toContain('maestro');
    expect(frame).toContain('claude');
    expect(frame).toContain('claude-opus-5-5');
  });

  it('sends a message and shows the streamed answer; keeps context on the next turn', async () => {
    const ui = mountApp({ columns: 100, rows: 30 });
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('hi there');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Hello from fake');
    ui.stdin.write('again');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Second answer');
    expect(ui.provider.requests[1]?.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
  });

  it('runs /model and shows the providers table; /exit triggers onExit', async () => {
    const ui = mountApp({ columns: 100, rows: 30 });
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('/model');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Active: claude');
    ui.stdin.write('/exit');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitFor(() => ui.exits() === 1, 3000, 'exit');
  });

  it('Esc cancels a response in progress and keeps the partial text', async () => {
    const slow = createFakeProvider(
      [
        [
          { type: 'text_delta', text: 'part' },
          { type: 'text_delta', text: 'ial' },
          { type: 'text_delta', text: ' and more' },
          { type: 'done', stopReason: 'end_turn' },
        ],
      ],
      { delayMs: 400 }, // wide window so Esc lands before ' and more' even under load
    );
    const ui = mountApp({ columns: 100, rows: 30, provider: slow });
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('go');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'partial'); // 'part' + 'ial' streamed, ' and more' still pending
    ui.stdin.write('\u001B'); // Esc
    await waitFor(() => ui.session.state === 'idle', 3000, 'cancelled');
    const text = ui.session.history[1]?.content[0];
    expect(text?.type === 'text' && text.text.startsWith('part')).toBe(true);
    expect(ui.lastFrame()).not.toContain('and more');
  });

  it('Ctrl+C twice exits, once only arms', async () => {
    const ui = mountApp({ columns: 100, rows: 30 });
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('\u0003');
    await waitForFrame(ui, 'press Ctrl+C again');
    expect(ui.exits()).toBe(0);
    ui.stdin.write('\u0003');
    await waitFor(() => ui.exits() === 1, 3000, 'exit');
  });
});
