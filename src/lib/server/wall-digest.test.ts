import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DIGEST_MAX_AGE_DAYS,
  WALL_DIGEST_VERSION,
  buildDesignDigestPrompt,
  buildTrendingDigestPrompt,
  designItemLine,
  finalizeDigest,
  isDigestFresh,
  trendingItemLine,
  wallDigestSection
} from './wall-digest';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-21T12:00:00Z');

const designRow = {
  design_note: { en: 'One oversized numeral anchors the grid.', it: 'Un numero enorme ancora la griglia.' },
  design_tags: ['type_driven', 'monochrome'],
  design_scores: { typography: 9, composition: 8, colour: 7, craft: 9, originality: 8 },
  design_score: 84,
  category: 'saas',
  content_form: 'static'
};

const trendingPost = { id: 'p1', platform: 'tiktok', category: 'food', outperformance: 3.2, views: 120000 };
const analysis = {
  market_post_id: 'p1',
  hook_type: 'question',
  hook_at_s: 0.5,
  hook_line: 'Perché il martedì è vuoto?',
  hook_open_loop: true,
  reveal_at_s: 6,
  cta_at_s: 12,
  dead_seconds: [9],
  duration_s: 14,
  summary: 'Owner walks the empty room, then the packed one.'
};

describe('il distillatore produce un digest datato dagli item', () => {
  it('finalizeDigest stamps kind, version, date and item count', () => {
    const d = finalizeDigest('design', '  patterns…  ', 42, NOW);
    expect(d).toEqual({
      kind: 'design',
      version: WALL_DIGEST_VERSION,
      generatedAt: new Date(NOW).toISOString(),
      itemCount: 42,
      text: 'patterns…'
    });
  });

  it('an empty model answer yields no digest — nothing stale gets overwritten with blank', () => {
    expect(finalizeDigest('trending', '   ', 10, NOW)).toBeNull();
  });

  it('design lines carry the judged evidence: axes, tags, the note', () => {
    const line = designItemLine(designRow);
    expect(line).toContain('[saas/static]');
    expect(line).toContain('typ:9');
    expect(line).toContain('type_driven');
    expect(line).toContain('oversized numeral');
  });

  it('trending lines carry the metric evidence and the watched hook mechanics', () => {
    const line = trendingItemLine(trendingPost, analysis);
    expect(line).toContain('×3.2 vs own median');
    expect(line).toContain('hook=question@0.5s');
    expect(line).toContain('open-loop');
    expect(line).toContain('reveal@6s');
    // A post whose clip was never analysed still contributes its metric, honestly labelled.
    expect(trendingItemLine(trendingPost, null)).toContain('no clip analysis');
  });

  it('the prompts embed the fixture lines and demand observable moves, not taste words', () => {
    const p = buildDesignDigestPrompt([designItemLine(designRow)]);
    expect(p).toContain('oversized numeral');
    expect(p).toMatch(/make it pop/); // named as the forbidden register
    const t = buildTrendingDigestPrompt([trendingItemLine(trendingPost, analysis)]);
    expect(t).toContain('×3.2');
    expect(t).toMatch(/FIRST SECOND/);
  });
});

describe('la sezione prompt degrada, mai blocca', () => {
  const fresh = finalizeDigest('design', 'Ground/ink/one accent.', 30, NOW - 2 * DAY)!;

  it('emits the digest when fresh, framed as the floor', () => {
    const s = wallDigestSection(fresh, NOW);
    expect(s).toContain('AMBIENT DESIGN FLOOR');
    expect(s).toContain('Ground/ink/one accent.');
    expect(s).toContain('always win'); // brand kit / per-brief refs stay the ceiling
  });

  it('emits nothing for a stale digest (> max age) or a missing one', () => {
    const stale = finalizeDigest('trending', 'old crop', 30, NOW - (DIGEST_MAX_AGE_DAYS + 1) * DAY)!;
    expect(wallDigestSection(stale, NOW)).toBe('');
    expect(wallDigestSection(null, NOW)).toBe('');
    expect(isDigestFresh(stale, NOW)).toBe(false);
    expect(isDigestFresh(fresh, NOW)).toBe(true);
  });

  it('the trending flavour names the viral mechanics framing', () => {
    const t = finalizeDigest('trending', 'question hooks land <1s', 30, NOW - DAY)!;
    expect(wallDigestSection(t, NOW)).toContain('CURRENT VIRAL MECHANICS');
  });
});

describe('le cadenze dei cron di raccolta sono quelle decise', () => {
  const crons = (JSON.parse(readFileSync('vercel.json', 'utf8')).crons ?? []) as Array<{
    path: string;
    schedule: string;
  }>;
  const scheduleOf = (path: string) => crons.find((c) => c.path === path)?.schedule;

  it('market/trends dropped from hourly to every 4 hours — the digests carry the knowledge now', () => {
    // Ore 0,4,8,12,16,20 × 6 tag/run coprono comunque tutti i 20 hashtag entro la giornata.
    expect(scheduleOf('/api/v1/market/trends')).toBe('20 */4 * * *');
  });

  // Il muro pubblico non gira piu': `wall.design_judge` costava 4740 chiamate e ~100 dollari al
  // mese con brand_id NULL su tutte — nessun cliente le pagava e nessuno le chiedeva. Gli endpoint
  // sono cancellati, non solo i cron: rimettere una riga qui non riaccenderebbe niente, e questo
  // test lo dice invece di lasciare che qualcuno ci provi.
  it('i due cron del muro non esistono piu\', e nemmeno i loro endpoint', () => {
    expect(scheduleOf('/api/v1/wall/sweep')).toBeUndefined();
    expect(scheduleOf('/api/v1/wall/work')).toBeUndefined();
  });

  it('market/harvest stays daily on purpose: 1 run/day is no multiplier, and slowing it stretches the 12-category rotation to two weeks', () => {
    expect(scheduleOf('/api/v1/market/harvest')).toBe('40 6 * * *');
  });
});
