import { describe, it, expect } from 'vitest';
import { captionFor, captionViolations, ensureShortNetworkCuts, truncateForPlatform, youtubeTitleFrom } from './platform-limits';

const LONG = 'a'.repeat(1200); // fine on Instagram, way over X (280) and Threads (500)

describe('per-platform captions', () => {
  it('falls back to the main caption when there is no override', () => {
    expect(captionFor('main', null, 'instagram')).toBe('main');
    expect(captionFor('main', { x: '   ' }, 'x')).toBe('main');
  });

  it('uses the override for its platform (twitter === x)', () => {
    expect(captionFor('main', { x: 'short' }, 'x')).toBe('short');
    expect(captionFor('main', { x: 'short' }, 'twitter')).toBe('short');
    expect(captionFor('main', { x: 'short' }, 'threads')).toBe('main');
  });

  it('measures each platform against the caption it will actually publish', () => {
    expect(captionViolations(LONG, ['instagram', 'x', 'threads']).map((v) => v.platform)).toEqual(['x', 'threads']);
    // A valid cut for each short network clears the block; an over-limit cut still fails.
    expect(captionViolations(LONG, ['instagram', 'x', 'threads'], { x: 'short', threads: 'short' })).toEqual([]);
    expect(captionViolations(LONG, ['x'], { x: 'b'.repeat(300) })[0]).toMatchObject({ platform: 'x', length: 300, limit: 280 });
  });
});

describe('ensureShortNetworkCuts', () => {
  it('leaves room when the main caption already fits', () => {
    expect(ensureShortNetworkCuts('short enough', ['instagram', 'x'], null)).toBeNull();
  });

  it('keeps a valid authored cut and fills the missing one', () => {
    const cuts = ensureShortNetworkCuts(LONG, ['instagram', 'x', 'threads'], { x: 'authored x cut' });
    expect(cuts?.x).toBe('authored x cut');
    expect(cuts?.threads?.length).toBeLessThanOrEqual(500);
    expect(cuts?.threads?.length).toBeGreaterThan(0);
  });

  it('replaces an over-limit cut', () => {
    const cuts = ensureShortNetworkCuts(LONG, ['x'], { x: 'b'.repeat(400) });
    expect(cuts?.x?.length).toBeLessThanOrEqual(280);
  });

  it('truncates on a word/sentence boundary when possible', () => {
    const prose = `${'word '.repeat(40)}. More after the period that should be dropped.`;
    const out = truncateForPlatform(prose, 80);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith(' ')).toBe(false);
  });
});

describe('youtubeTitleFrom', () => {
  it('prefers an explicit title and caps at 100 chars', () => {
    expect(youtubeTitleFrom('caption line', 'Explicit')).toBe('Explicit');
    expect(youtubeTitleFrom('a'.repeat(200)).length).toBe(100);
  });

  it('falls back to the first caption line', () => {
    expect(youtubeTitleFrom('Hook line\n\nThe rest of the description.')).toBe('Hook line');
  });
});
