import { describe, it, expect } from 'vitest';
import { analyzePostHistory, historyInsightsDigest } from './post-history-insights';

describe('analyzePostHistory', () => {
  const posts = [
    { content: '#design #branding great work', mediaType: 'video', publishedAt: '2026-01-06T18:00:00Z', metrics: { likes: 100, comments: 10 } }, // Tue 18:00, w=120
    { content: '#design tips', mediaType: 'image', publishedAt: '2026-01-07T09:00:00Z', metrics: { likes: 10 } }, // Wed 09:00, w=10
    { content: '#branding #design', mediaType: 'reel', publishedAt: '2026-01-06T18:30:00Z', metrics: { likes: 50, comments: 5 } } // Tue 18:00, w=60
  ];

  it('ranks hashtags, formats and best times by engagement', () => {
    const ins = analyzePostHistory(posts);
    expect(ins.postCount).toBe(3);
    expect(ins.topHashtags[0]).toBe('#design');
    expect(ins.topHashtags).toContain('#branding');
    expect(ins.topFormats[0]).toBe('video'); // reel normalises to video
    expect(ins.bestTimes[0]).toBe('Tue 18:00');
    expect(ins.cadence).toMatch(/posts\/(week|month)/);
  });

  it('produces a non-empty digest mentioning the mined signals', () => {
    const d = historyInsightsDigest(analyzePostHistory(posts));
    expect(d).toMatch(/WHAT WORKS HERE/);
    expect(d).toContain('#design');
    expect(d).toContain('Tue 18:00');
  });

  it('degrades gracefully on empty history', () => {
    const ins = analyzePostHistory([]);
    expect(ins.postCount).toBe(0);
    expect(historyInsightsDigest(ins)).toBe('');
  });

  it('works without timestamps (hashtags only, no times/cadence)', () => {
    const ins = analyzePostHistory([{ content: '#news #tips', metrics: { likes: 5 } }]);
    expect(ins.topHashtags).toEqual(['#news', '#tips']);
    expect(ins.bestTimes).toEqual([]);
    expect(ins.cadence).toBe('');
  });
});

describe('hook coverage', () => {
  it('names what the brand has never opened with, not just what worked', () => {
    const ins = analyzePostHistory([
      { content: 'Se gestisci un e-commerce, guarda i numeri', mediaType: 'reel', metrics: { likes: 40 } },
      { content: 'Vuoi capire perché i preventivi muoiono?', mediaType: 'image', metrics: { likes: 10 } }
    ]);
    expect(ins.hooks.used.sort()).toEqual(['callout', 'question']);
    expect(ins.hooks.untested).toContain('trojan_horse');
    expect(ins.hooks.coverage).toBeLessThan(20);
  });

  it('counts an unlabelled opening against coverage instead of inventing a tactic', () => {
    const ins = analyzePostHistory([{ content: 'Il nuovo catalogo è online.', mediaType: 'image', metrics: null }]);
    expect(ins.hooks.unclassified).toBe(1);
    expect(ins.hooks.used).toEqual([]);
  });

  it('withholds the "this one won" flag until there are enough posts to mean it', () => {
    const few = analyzePostHistory([
      { content: 'Se gestisci un e-commerce, guarda i numeri', mediaType: 'reel', metrics: { likes: 400 } },
      { content: 'Vuoi capire perché i preventivi muoiono?', mediaType: 'image', metrics: { likes: 1 } }
    ]);
    // Two posts cannot establish a winner, so no "proven angle, untested format" recommendation.
    expect(few.hooks.gaps.every((g) => !g.format)).toBe(true);
  });

  it('recommends a proven angle in an untested format once the sample supports it', () => {
    const posts = Array.from({ length: 12 }, (_, i) => ({
      content: i === 0 ? 'Se gestisci un e-commerce, guarda i numeri' : 'Il catalogo di questa settimana',
      mediaType: i === 0 ? 'reel' : 'image',
      metrics: { likes: i === 0 ? 500 : 1 }
    }));
    const ins = analyzePostHistory(posts);
    const topFormatGap = ins.hooks.gaps.find((g) => g.format);
    expect(topFormatGap?.tactic).toBe('callout');
    expect(topFormatGap?.format).toBe('image');
  });

  it('puts the coverage map into the digest the planners read', () => {
    const digest = historyInsightsDigest(
      analyzePostHistory([{ content: 'Se gestisci un e-commerce, guarda i numeri', mediaType: 'reel', metrics: { likes: 40 } }])
    );
    expect(digest).toContain('COPERTURA DEGLI HOOK');
  });
});
