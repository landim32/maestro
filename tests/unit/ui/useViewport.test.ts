import { describe, expect, it } from 'vitest';
import { initialViewport, viewportReducer } from '../../../src/ui/hooks/useViewport.js';
import type { ViewportState } from '../../../src/ui/hooks/useViewport.js';

function measured(
  contentHeight: number,
  viewportHeight: number,
  extra: Partial<ViewportState> = {},
) {
  return viewportReducer(
    { ...initialViewport, ...extra },
    { type: 'measure', contentHeight, viewportHeight },
  );
}

describe('viewportReducer (data-model § 3)', () => {
  it('follows the bottom when content grows and follow is on', () => {
    const s = measured(100, 20);
    expect(s.offset).toBe(80);
    expect(s.follow).toBe(true);
    expect(s.newBelow).toBe(false);
  });

  it('scrollBy clamps and toggles follow depending on reaching the bottom', () => {
    let s = measured(100, 20);
    s = viewportReducer(s, { type: 'scrollBy', delta: -30 });
    expect(s.offset).toBe(50);
    expect(s.follow).toBe(false);
    s = viewportReducer(s, { type: 'scrollBy', delta: -500 });
    expect(s.offset).toBe(0);
    s = viewportReducer(s, { type: 'scrollBy', delta: 500 });
    expect(s.offset).toBe(80);
    expect(s.follow).toBe(true);
  });

  it('pageUp/pageDown move one screen minus one line', () => {
    let s = measured(100, 20);
    s = viewportReducer(s, { type: 'pageUp' });
    expect(s.offset).toBe(80 - 19);
    s = viewportReducer(s, { type: 'pageDown' });
    expect(s.offset).toBe(80);
    expect(s.follow).toBe(true);
  });

  it('home goes to the top and end to the bottom (re-enabling follow and clearing newBelow)', () => {
    let s = measured(100, 20);
    s = viewportReducer(s, { type: 'home' });
    expect(s.offset).toBe(0);
    expect(s.follow).toBe(false);
    s = viewportReducer(s, { type: 'measure', contentHeight: 120, viewportHeight: 20 });
    expect(s.newBelow).toBe(true);
    expect(s.offset).toBe(0);
    s = viewportReducer(s, { type: 'end' });
    expect(s.offset).toBe(100);
    expect(s.follow).toBe(true);
    expect(s.newBelow).toBe(false);
  });

  it('keeps the position when scrolled up and content grows, flagging newBelow', () => {
    let s = measured(100, 20);
    s = viewportReducer(s, { type: 'scrollBy', delta: -10 }); // offset 70
    s = viewportReducer(s, { type: 'measure', contentHeight: 130, viewportHeight: 20 });
    expect(s.offset).toBe(70);
    expect(s.newBelow).toBe(true);
    // scrolling but not reaching the bottom keeps the flag
    s = viewportReducer(s, { type: 'scrollBy', delta: 5 });
    expect(s.newBelow).toBe(true);
    // reaching the bottom clears it
    s = viewportReducer(s, { type: 'scrollBy', delta: 1000 });
    expect(s.newBelow).toBe(false);
  });

  it('resize: follow → bottom; no follow → clamped', () => {
    let s = measured(100, 20);
    s = viewportReducer(s, { type: 'measure', contentHeight: 100, viewportHeight: 40 });
    expect(s.offset).toBe(60);
    s = viewportReducer(s, { type: 'scrollBy', delta: -50 }); // offset 10
    s = viewportReducer(s, { type: 'measure', contentHeight: 100, viewportHeight: 95 });
    expect(s.offset).toBe(5);
    expect(s.follow).toBe(false);
  });

  it('no overflow: offset 0, follow stays true, home keeps follow', () => {
    let s = measured(10, 20);
    expect(s.offset).toBe(0);
    s = viewportReducer(s, { type: 'scrollBy', delta: -3 });
    expect(s.offset).toBe(0);
    expect(s.follow).toBe(true);
    s = viewportReducer(s, { type: 'home' });
    expect(s.follow).toBe(true);
  });

  it('reset returns to top with follow on', () => {
    let s = measured(100, 20);
    s = viewportReducer(s, { type: 'scrollBy', delta: -10 });
    s = viewportReducer(s, { type: 'reset' });
    expect(s).toMatchObject({ offset: 0, follow: true, newBelow: false });
  });
});
