import { describe, expect, it } from 'vitest';
import { STICK_TO_BOTTOM_PX, nearBottom } from './chat-scroll';

describe('nearBottom', () => {
  const box = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({
    scrollTop,
    scrollHeight,
    clientHeight
  });

  it('is true when the panel is pinned to the last line', () => {
    expect(nearBottom(box(600))).toBe(true);
  });

  it('tolerates the few pixels smooth scrolling leaves behind', () => {
    expect(nearBottom(box(600 - STICK_TO_BOTTOM_PX + 1))).toBe(true);
  });

  it('is false once the user has scrolled up to read something', () => {
    expect(nearBottom(box(200))).toBe(false);
  });

  it('treats a panel with nothing to scroll as bottom', () => {
    expect(nearBottom(box(0, 300, 400))).toBe(true);
  });

  it('does not block the first render when the element is missing', () => {
    expect(nearBottom(null)).toBe(true);
    expect(nearBottom(undefined)).toBe(true);
  });
});
