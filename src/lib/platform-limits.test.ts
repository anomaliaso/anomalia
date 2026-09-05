import { describe, it, expect } from 'vitest';
import {
  captionFor,
  captionViolations,
  ensureShortNetworkCuts,
  splitForPlatform,
  truncateForPlatform,
  youtubeTitleFrom
} from './platform-limits';

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

describe('splitForPlatform', () => {
  const X = 280;
  const marker = / \d+\/\d+$/;
  const unnumbered = (parts: string[]) => parts.map((p) => p.replace(marker, ''));
  const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');

  const startsAndEndsOnAWordBoundary = (parts: string[], original: string) =>
    unnumbered(parts).every((part) => {
      const at = original.indexOf(part);
      if (at < 0) return false;
      const before = original[at - 1];
      const after = original[at + part.length];
      return (!before || /\s/.test(before)) && (!after || /\s/.test(after));
    });

  it('leaves a caption that already fits as a single unnumbered part', () => {
    expect(splitForPlatform('short and sweet', X)).toEqual(['short and sweet']);
    expect(splitForPlatform('a'.repeat(X), X)).toEqual(['a'.repeat(X)]);
  });

  it('counts the numbering inside the limit when the text overflows by one character', () => {
    const text = `${'word '.repeat(56)}x`;
    expect(text.length).toBe(X + 1);

    const parts = splitForPlatform(text, X);

    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(X);
    }
    expect(parts[0].endsWith(' 1/2')).toBe(true);
    expect(parts[1].endsWith(' 2/2')).toBe(true);
  });

  it('keeps every part of a long thread inside the limit', () => {
    for (const limit of [280, 300, 500]) {
      const parts = splitForPlatform(words(900), limit);
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('never cuts inside a word, a URL, a mention or a hashtag', () => {
    const url = 'https://example.com/a/very/long/path?with=query&and=more';
    const text = `${words(30)} ${url} @a_long_mention_handle #a_long_hashtag_too ${words(30)}`;

    const parts = splitForPlatform(text, X);

    expect(startsAndEndsOnAWordBoundary(parts, text)).toBe(true);
    expect(unnumbered(parts).filter((p) => p.includes(url))).toHaveLength(1);
    expect(unnumbered(parts).filter((p) => p.includes('@a_long_mention_handle'))).toHaveLength(1);
    expect(unnumbered(parts).filter((p) => p.includes('#a_long_hashtag_too'))).toHaveLength(1);
  });

  it('prefers the end of a sentence, then of a clause, over a bare word break', () => {
    const sentence = `${words(25)}. ${words(40)}`;
    expect(unnumbered(splitForPlatform(sentence, X))[0].endsWith('.')).toBe(true);

    const clause = `${words(25)}, ${words(40)}`;
    expect(unnumbered(splitForPlatform(clause, X))[0].endsWith(',')).toBe(true);
  });

  it('loses nothing: the parts recompose the whole original text', () => {
    const text = `${words(40)}. ${words(40)}, ${words(40)}\n${words(40)}`;
    const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();

    expect(normalise(unnumbered(splitForPlatform(text, X)).join(' '))).toBe(normalise(text));
  });

  it('hard-cuts only when a single token is longer than the budget', () => {
    const parts = splitForPlatform('z'.repeat(X * 2), X);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(X);
    }
    expect(parts.length).toBeGreaterThan(1);
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
