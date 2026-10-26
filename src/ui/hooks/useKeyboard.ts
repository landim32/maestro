import { useRef, useState } from 'react';
import { useInput } from 'ink';
import type { Key } from 'ink';
import type { SessionState } from '../../session/session.js';
import type { AskUserKey } from '../../setup/askUserFlow.js';
import type { DialogKey } from '../../setup/dialog.js';
import { isMouseSequence } from './useMouseWheel.js';
import type { ViewportActions } from './useViewport.js';

export interface KeyboardHandlers {
  state: SessionState;
  onCancel: () => void;
  /** An autopilot run is active (specs/011): Esc interrupts it even between turns. */
  autopilotActive?: boolean;
  onExit: () => void;
  onConfirm: (approved: boolean) => void;
  viewport?: ViewportActions;
  /** When a modal dialog is open, navigation keys are routed here instead. */
  dialogOpen?: boolean;
  onDialogKey?: (key: DialogKey) => void;
  /** Shift+Tab cycles the approval mode (contracts/approval-modes.md § 2). */
  onCycleMode?: (dir: 1 | -1) => void;
  /** Keys for the ask_user dialog while `state === 'awaiting_answer'` (contracts/ask-user.md § 3). */
  onQuestionKey?: (key: AskUserKey) => void;
  armWindowMs?: number;
}

/** True for keys reserved for transcript scrolling (never typed into the prompt). */
export function isScrollKey(key: Key): boolean {
  return (
    key.pageUp ||
    key.pageDown ||
    key.home ||
    key.end ||
    (key.shift && (key.upArrow || key.downArrow))
  );
}

/**
 * Global shortcuts: Esc / Ctrl+C cancel, Ctrl+C twice exits, y/n answer confirmations,
 * PageUp/PageDown/Home/End/Shift+↑↓ scroll the transcript, Shift+Tab cycles the approval
 * mode (also while a confirmation is pending — the pending action keeps waiting). With a dialog
 * open, ↑/↓/Enter/Esc go to the dialog (contracts/dialog-flows.md § 1) and Shift+Tab is ignored;
 * Ctrl+C twice still exits.
 */
export function useKeyboard({
  state,
  onCancel,
  autopilotActive,
  onExit,
  onConfirm,
  viewport,
  dialogOpen = false,
  onDialogKey,
  onCycleMode,
  onQuestionKey,
  armWindowMs = 2000,
}: KeyboardHandlers) {
  const [exitArmed, setExitArmed] = useState(false);
  const armedAt = useRef<number | null>(null);
  const timer = useRef<NodeJS.Timeout | null>(null);

  const armExit = (): boolean => {
    const now = Date.now();
    if (armedAt.current !== null && now - armedAt.current <= armWindowMs) {
      onExit();
      return true;
    }
    armedAt.current = now;
    setExitArmed(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      armedAt.current = null;
      setExitArmed(false);
    }, armWindowMs);
    return false;
  };

  useInput((input, key) => {
    const ctrlC = key.ctrl && input === 'c';
    if (isMouseSequence(input)) return;

    if (dialogOpen) {
      if (ctrlC) {
        if (!armExit()) onDialogKey?.({ type: 'cancel' });
        return;
      }
      if (key.escape) onDialogKey?.({ type: 'back' });
      else if (key.return) onDialogKey?.({ type: 'enter' });
      else if (key.upArrow && !key.shift) onDialogKey?.({ type: 'up' });
      else if (key.downArrow && !key.shift) onDialogKey?.({ type: 'down' });
      // character input is handled by the dialog's TextField
      return;
    }

    // Shift+Tab cycles the approval mode; plain Tab belongs to the prompt (completes a suggestion).
    if (key.tab) {
      if (key.shift) onCycleMode?.(1);
      return;
    }

    if (viewport && isScrollKey(key)) {
      if (key.pageUp) viewport.pageUp();
      else if (key.pageDown) viewport.pageDown();
      else if (key.home) viewport.home();
      else if (key.end) viewport.end();
      else if (key.upArrow) viewport.scrollBy(-1);
      else if (key.downArrow) viewport.scrollBy(1);
      return;
    }

    if (
      (state === 'generating' || (autopilotActive && state === 'idle')) &&
      (key.escape || ctrlC)
    ) {
      onCancel();
      return;
    }
    if (state === 'awaiting_confirmation') {
      const ch = input.toLowerCase();
      if (ch === 'y') onConfirm(true);
      else if (ch === 'n' || key.escape) onConfirm(false);
      else if (ctrlC) {
        onConfirm(false);
        onCancel();
      }
      return;
    }
    if (state === 'awaiting_answer') {
      // Esc declines the question only; Ctrl+C declines it and cancels the response (twice exits).
      if (ctrlC) {
        if (!armExit()) {
          onQuestionKey?.({ type: 'cancel' });
          onCancel();
        }
        return;
      }
      if (key.escape) onQuestionKey?.({ type: 'cancel' });
      else if (key.return) onQuestionKey?.({ type: 'enter' });
      else if (key.upArrow) onQuestionKey?.({ type: 'up' });
      else if (key.downArrow) onQuestionKey?.({ type: 'down' });
      else if (input === ' ') onQuestionKey?.({ type: 'space' });
      else if (/^[1-9]$/.test(input)) onQuestionKey?.({ type: 'digit', n: Number(input) });
      // other characters belong to the "Outro…" TextField
      return;
    }
    if (ctrlC) armExit();
  });

  return { exitArmed };
}
