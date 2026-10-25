import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { Key } from 'ink';
import { isScrollKey, useKeyboard } from '../../src/ui/hooks/useKeyboard.js';
import type { KeyboardHandlers } from '../../src/ui/hooks/useKeyboard.js';
import { Text } from 'ink';

const key = (partial: Partial<Key>): Key =>
  ({
    super: false,
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...partial,
  }) as Key;

function Probe(props: KeyboardHandlers) {
  useKeyboard(props);
  return <Text>probe</Text>;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

function mountKeyboard(partial: Partial<KeyboardHandlers> = {}) {
  const handlers = {
    onCancel: vi.fn(),
    onExit: vi.fn(),
    onConfirm: vi.fn(),
    onCycleMode: vi.fn(),
    onDialogKey: vi.fn(),
  };
  const ui = render(<Probe state="idle" {...handlers} {...partial} />);
  return { ui, ...handlers };
}

afterEach(() => vi.restoreAllMocks());

/** contracts/approval-modes.md § 2 — Tab / Shift+Tab cycle the approval mode. */
describe('contract: Tab cycles the approval mode', () => {
  it('Tab → +1, Shift+Tab → −1 while idle', async () => {
    const { ui, onCycleMode } = mountKeyboard();
    ui.stdin.write('\t');
    await tick();
    ui.stdin.write('\x1b[Z');
    await tick();
    expect(onCycleMode.mock.calls).toEqual([[1], [-1]]);
  });

  it('Tab still cycles while a confirmation is pending and does not answer it', async () => {
    const { ui, onCycleMode, onConfirm } = mountKeyboard({ state: 'awaiting_confirmation' });
    ui.stdin.write('\t');
    await tick();
    expect(onCycleMode).toHaveBeenCalledWith(1);
    expect(onConfirm).not.toHaveBeenCalled();
    ui.stdin.write('y');
    await tick();
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('Tab is ignored while a /auth or /model dialog is open', async () => {
    const { ui, onCycleMode, onDialogKey } = mountKeyboard({ dialogOpen: true });
    ui.stdin.write('\t');
    await tick();
    expect(onCycleMode).not.toHaveBeenCalled();
    expect(onDialogKey).not.toHaveBeenCalled();
  });
});

/** contracts/ask-user.md § 3 — keys while a question is pending. */
describe('contract: ask_user dialog keys', () => {
  it('routes ↑/↓/Enter/Esc/Space/digits to onQuestionKey; letters are left to the TextField', async () => {
    const onQuestionKey = vi.fn();
    const { ui, onConfirm, onCancel } = mountKeyboard({ state: 'awaiting_answer', onQuestionKey });
    for (const k of ['\x1b[A', '\x1b[B', ' ', '3', '\r', 'x', '\x1b']) {
      ui.stdin.write(k);
      await tick();
    }
    expect(onQuestionKey.mock.calls.map((c) => c[0])).toEqual([
      { type: 'up' },
      { type: 'down' },
      { type: 'space' },
      { type: 'digit', n: 3 },
      { type: 'enter' },
      { type: 'cancel' },
    ]);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Ctrl+C declines the question and cancels the response; Tab still cycles the mode', async () => {
    const onQuestionKey = vi.fn();
    const { ui, onCancel, onCycleMode } = mountKeyboard({
      state: 'awaiting_answer',
      onQuestionKey,
    });
    ui.stdin.write('\t');
    await tick();
    expect(onCycleMode).toHaveBeenCalledWith(1);
    expect(onQuestionKey).not.toHaveBeenCalled();
    ui.stdin.write('\x03');
    await tick();
    expect(onQuestionKey).toHaveBeenCalledWith({ type: 'cancel' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

/** contracts/history.md § 3 — plain ↑/↓ belong to the input history, never to scrolling (FR-003). */
describe('contract: prompt keys vs transcript scrolling', () => {
  it('plain ↑/↓ are not scroll keys', () => {
    expect(isScrollKey(key({ upArrow: true }))).toBe(false);
    expect(isScrollKey(key({ downArrow: true }))).toBe(false);
  });
  it('Shift+↑/↓, PageUp/PageDown, Home/End are scroll keys', () => {
    expect(isScrollKey(key({ upArrow: true, shift: true }))).toBe(true);
    expect(isScrollKey(key({ downArrow: true, shift: true }))).toBe(true);
    expect(isScrollKey(key({ pageUp: true }))).toBe(true);
    expect(isScrollKey(key({ pageDown: true }))).toBe(true);
    expect(isScrollKey(key({ home: true }))).toBe(true);
    expect(isScrollKey(key({ end: true }))).toBe(true);
  });
});
