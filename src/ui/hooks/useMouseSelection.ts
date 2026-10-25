import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useStdin, useStdout } from 'ink';
import { copyToClipboard } from '../../utils/clipboard.js';
import type { CopyResult } from '../../utils/clipboard.js';
import { clampToContent, screenToContent } from '../frameRecorder.js';
import type { ContentLineCache, MouseGeometry } from '../frameRecorder.js';
import { idleSelection, selectionReducer } from '../selection.js';
import type { SelectionEvent, SelectionState } from '../selection.js';
import { parseSgrMouse } from './useMouseWheel.js';

export interface CopyOutcome extends CopyResult {
  lines: number;
}

export interface UseMouseSelectionOptions {
  enabled: boolean;
  /** Current transcript geometry (undefined before the first layout). */
  geometry: () => MouseGeometry | undefined;
  cache: ContentLineCache;
  /** Injected clipboard (tests); defaults to copyToClipboard through stdout for OSC 52. */
  copy?: (text: string) => Promise<CopyResult>;
  onChange: (selection: SelectionState) => void;
  onCopy: (outcome: CopyOutcome) => void;
  now?: () => number;
}

/**
 * Turns SGR press/drag/release reports into a selection over the transcript and copies the
 * selected text on release (specs/007 contracts/mouse-selection.md § 1–4). Wheel reports are
 * handled by useMouseWheel; both hooks read the same stdin chunks.
 */
export function useMouseSelection({
  enabled,
  geometry,
  cache,
  copy,
  onChange,
  onCopy,
  now = Date.now,
}: UseMouseSelectionOptions): { clear: () => void } {
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const stateRef = useRef<SelectionState>(idleSelection);
  // Latest callbacks/deps, refreshed after every render so the stdin listener never goes stale.
  const latest = useRef({ geometry, copy, onChange, onCopy, now, cache, stdout });
  useLayoutEffect(() => {
    latest.current = { geometry, copy, onChange, onCopy, now, cache, stdout };
  });

  const apply = useCallback((ev: SelectionEvent): SelectionState => {
    const { cache: c, onChange: changed } = latest.current;
    const next = selectionReducer(stateRef.current, ev, { lineText: (l) => c.get(l) });
    if (next !== stateRef.current) {
      stateRef.current = next;
      changed(next);
    }
    return next;
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (stateRef.current.phase !== 'idle') apply({ type: 'clear' });
      return;
    }
    const onData = (data: Buffer | string) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      for (const ev of parseSgrMouse(text)) {
        const g = latest.current.geometry();
        if (!g) continue;
        if (ev.kind === 'press') {
          const at = screenToContent(ev, g);
          if (!at) {
            if (stateRef.current.phase !== 'idle') apply({ type: 'clear' });
            continue;
          }
          apply({ type: 'press', at, time: latest.current.now() });
        } else if (ev.kind === 'drag') {
          if (stateRef.current.phase !== 'dragging') continue;
          apply({ type: 'drag', at: clampToContent(ev, g) });
        } else if (ev.kind === 'release') {
          if (stateRef.current.phase !== 'dragging') continue;
          const next = apply({ type: 'release', at: clampToContent(ev, g) });
          if (next.phase !== 'done') continue;
          const { copy: copier, stdout: out, onCopy: copied } = latest.current;
          const run = copier ?? ((t: string) => copyToClipboard(t, { stdout: out }));
          void run(next.text).then(
            (r) => copied({ ...r, lines: next.lines }),
            (err) => copied({ ok: false, error: String(err), lines: next.lines }),
          );
        }
      }
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [enabled, stdin, apply]);

  const clear = useCallback(() => {
    if (stateRef.current.phase !== 'idle') apply({ type: 'clear' });
  }, [apply]);

  return { clear };
}
