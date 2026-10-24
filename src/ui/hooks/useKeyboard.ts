import { useRef, useState } from 'react';
import { useInput } from 'ink';
import type { Key } from 'ink';
import type { SessionState } from '../../session/session.js';
import type { ViewportActions } from './useViewport.js';

export interface KeyboardHandlers {
  state: SessionState;
  onCancel: () => void;
  onExit: () => void;
  onConfirm: (approved: boolean) => void;
  viewport?: ViewportActions;
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
 * PageUp/PageDown/Home/End/Shift+↑↓ scroll the transcript.
 */
export function useKeyboard({
  state,
  onCancel,
  onExit,
  onConfirm,
  viewport,
  armWindowMs = 2000,
}: KeyboardHandlers) {
  const [exitArmed, setExitArmed] = useState(false);
  const armedAt = useRef<number | null>(null);
  const timer = useRef<NodeJS.Timeout | null>(null);

  useInput((input, key) => {
    const ctrlC = key.ctrl && input === 'c';

    if (viewport && isScrollKey(key)) {
      if (key.pageUp) viewport.pageUp();
      else if (key.pageDown) viewport.pageDown();
      else if (key.home) viewport.home();
      else if (key.end) viewport.end();
      else if (key.upArrow) viewport.scrollBy(-1);
      else if (key.downArrow) viewport.scrollBy(1);
      return;
    }

    if (state === 'generating' && (key.escape || ctrlC)) {
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
    if (ctrlC) {
      const now = Date.now();
      if (armedAt.current !== null && now - armedAt.current <= armWindowMs) {
        onExit();
        return;
      }
      armedAt.current = now;
      setExitArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        armedAt.current = null;
        setExitArmed(false);
      }, armWindowMs);
    }
  });

  return { exitArmed };
}
