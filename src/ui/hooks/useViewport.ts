import { useCallback, useEffect, useMemo, useReducer } from 'react';

export interface ViewportState {
  /** First visible content line (0 = top). */
  offset: number;
  contentHeight: number;
  viewportHeight: number;
  /** Stick to the bottom as content grows. */
  follow: boolean;
  /** Content arrived while the user was scrolled up. */
  newBelow: boolean;
}

export type ViewportAction =
  | { type: 'scrollBy'; delta: number }
  | { type: 'pageUp' }
  | { type: 'pageDown' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'reset' }
  | { type: 'measure'; contentHeight: number; viewportHeight: number };

export const WHEEL_LINES = 3;

export function maxOffsetOf(s: Pick<ViewportState, 'contentHeight' | 'viewportHeight'>): number {
  return Math.max(0, s.contentHeight - s.viewportHeight);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const initialViewport: ViewportState = {
  offset: 0,
  contentHeight: 0,
  viewportHeight: 0,
  follow: true,
  newBelow: false,
};

/** Pure transitions (data-model.md § 3). */
export function viewportReducer(state: ViewportState, action: ViewportAction): ViewportState {
  const max = maxOffsetOf(state);
  switch (action.type) {
    case 'scrollBy': {
      const offset = clamp(state.offset + action.delta, 0, max);
      const atBottom = offset >= max;
      return { ...state, offset, follow: atBottom, newBelow: atBottom ? false : state.newBelow };
    }
    case 'pageUp':
      return viewportReducer(state, {
        type: 'scrollBy',
        delta: -Math.max(1, state.viewportHeight - 1),
      });
    case 'pageDown':
      return viewportReducer(state, {
        type: 'scrollBy',
        delta: Math.max(1, state.viewportHeight - 1),
      });
    case 'home':
      return { ...state, offset: 0, follow: max === 0 };
    case 'end':
      return { ...state, offset: max, follow: true, newBelow: false };
    case 'reset':
      return { ...state, offset: 0, follow: true, newBelow: false };
    case 'measure': {
      const next = {
        ...state,
        contentHeight: Math.max(0, action.contentHeight),
        viewportHeight: Math.max(0, action.viewportHeight),
      };
      const nextMax = maxOffsetOf(next);
      if (next.follow) return { ...next, offset: nextMax, newBelow: false };
      const grew = next.contentHeight > state.contentHeight;
      return { ...next, offset: Math.min(next.offset, nextMax), newBelow: state.newBelow || grew };
    }
    default:
      return state;
  }
}

export interface ViewportActions {
  scrollBy: (delta: number) => void;
  pageUp: () => void;
  pageDown: () => void;
  home: () => void;
  end: () => void;
  reset: () => void;
}

export function useViewport(contentHeight: number, viewportHeight: number) {
  const [state, dispatch] = useReducer(viewportReducer, initialViewport);

  useEffect(() => {
    if (contentHeight !== state.contentHeight || viewportHeight !== state.viewportHeight) {
      dispatch({ type: 'measure', contentHeight, viewportHeight });
    }
  }, [contentHeight, viewportHeight, state.contentHeight, state.viewportHeight]);

  const actions = useMemo<ViewportActions>(
    () => ({
      scrollBy: (delta) => dispatch({ type: 'scrollBy', delta }),
      pageUp: () => dispatch({ type: 'pageUp' }),
      pageDown: () => dispatch({ type: 'pageDown' }),
      home: () => dispatch({ type: 'home' }),
      end: () => dispatch({ type: 'end' }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    [],
  );

  const maxOffset = maxOffsetOf(state);
  const scrollable = state.contentHeight > state.viewportHeight;
  const offset = useCallback(() => Math.min(state.offset, maxOffset), [state.offset, maxOffset])();

  return { state: { ...state, offset }, actions, maxOffset, scrollable };
}
