import { describe, it, expect } from 'vitest';
import { toCard, truncateCaption, noteFor, TRENDING_MIN_OUTPERFORMANCE } from './wall';

const row = (over: Record<string, unknown> = {}) => ({
  wall_slug: 'figma-launch-abc123',
  platform: 'instagram',
  account_key: 'figma',
  url: 'https://instagram.com/p/abc',
  content: 'A caption',
  published_at: '2026-08-01T10:00:00Z',
  poster_path: 'instagram/abc.webp',
  preview_path: 'instagram/abc-anim.webp',
  design_note: { en: 'The rule under the headline does the work.', it: 'La riga sotto il titolo fa il lavoro.' },
  design_score: 84,
  design_scores: { typography: 9, composition: 8, colour: 7, craft: 9, originality: 6 },
  design_tags: ['minimal', 'not_a_real_tag'],
  outperformance: 3.2,
  views: 12000,
  engagement: 800,
  category: 'saas',
  content_form: 'text_on_screen',
  ...over
});

const SUPA = 'https://proj.supabase.co';

describe('toCard — the whitelist', () => {
  it('builds a card from a full row and signs nothing', () => {
    const card = toCard(row(), 'en', SUPA)!;
    expect(card.slug).toBe('figma-launch-abc123');
    expect(card.posterUrl).toBe(`${SUPA}/storage/v1/object/public/wall/instagram/abc.webp`);
    expect(card.previewUrl).toBe(`${SUPA}/storage/v1/object/public/wall/instagram/abc-anim.webp`);
    // No token, no expiry: a public bucket URL is the whole point (wall-media.ts).
    expect(card.posterUrl).not.toContain('token');
  });

  it('drops tags that are not in the fixed vocabulary', () => {
    expect(toCard(row(), 'en', SUPA)!.tags).toEqual(['minimal']);
  });

  it('refuses a row with no poster, no slug or no link to the original', () => {
    expect(toCard(row({ poster_path: null }), 'en', SUPA)).toBeNull();
    expect(toCard(row({ wall_slug: null }), 'en', SUPA)).toBeNull();
    // The link out IS the attribution — a card without one must never render.
    expect(toCard(row({ url: null }), 'en', SUPA)).toBeNull();
  });

  it('carries no internal column, whatever the row holds', () => {
    const card = toCard(row({ watch_prob: 0.75, query: 'design:instagram/figma', media_path: 'secret' }), 'en', SUPA)!;
    expect(Object.keys(card)).not.toContain('watch_prob');
    expect(Object.keys(card)).not.toContain('query');
    expect(Object.keys(card)).not.toContain('media_path');
  });

  it('leaves preview null when the source was a still', () => {
    expect(toCard(row({ preview_path: null }), 'en', SUPA)!.previewUrl).toBeNull();
  });
});

describe('noteFor', () => {
  it('speaks the visitor’s language when it can', () => {
    expect(noteFor({ en: 'a', it: 'b' }, 'it')).toBe('b');
  });

  it('falls back to English rather than showing an empty slot', () => {
    expect(noteFor({ en: 'a' }, 'fr')).toBe('a');
  });

  it('is null when there is nothing to say', () => {
    expect(noteFor(null, 'en')).toBeNull();
    expect(noteFor({ en: '   ' }, 'en')).toBeNull();
  });
});

describe('truncateCaption', () => {
  it('leaves a short caption alone', () => {
    expect(truncateCaption('short')).toBe('short');
  });

  it('cuts on a word boundary and marks the cut', () => {
    const long = 'word '.repeat(100);
    const out = truncateCaption(long)!;
    expect(out.length).toBeLessThanOrEqual(281);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('  ');
  });

  it('collapses whitespace so a caption cannot break the card', () => {
    expect(truncateCaption('a\n\n\nb')).toBe('a b');
  });

  it('is null for nothing', () => {
    expect(truncateCaption('   ')).toBeNull();
  });
});

describe('the trending bar', () => {
  it('is above 1 — a post matching its own average is not news', () => {
    expect(TRENDING_MIN_OUTPERFORMANCE).toBeGreaterThan(1);
  });
});

/**
 * The bug this file exists to prevent from coming back.
 *
 * A `wall_slug` means "this row belongs on AT LEAST ONE of the two walls" — and the trending wall's
 * bar is outperformance, not beauty. So the design wall must re-check its own bar at read time. The
 * first version did not, and the page listed a motivational quote over a stock brick wall (judged 38,
 * correctly) directly under the Pentagram covers.
 */
describe('the design wall enforces its own bar', () => {
  function recordingClient() {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    const chain: Record<string, unknown> = {};
    for (const fn of ['select', 'eq', 'neq', 'not', 'gte', 'lte', 'contains', 'order', 'range', 'limit']) {
      chain[fn] = (...args: unknown[]) => {
        calls.push({ fn, args });
        return fn === 'range' ? Promise.resolve({ data: [] }) : chain;
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { client: { from: () => chain } as any, calls };
  }

  it('filters on design_score, not just is_design', async () => {
    const { client, calls } = recordingClient();
    const { listDesignWall } = await import('./wall');
    await listDesignWall(client, { locale: 'en' });
    const gte = calls.filter((c) => c.fn === 'gte').map((c) => c.args[0]);
    expect(gte, 'listDesignWall must gate on design_score').toContain('design_score');
  });

  it('applies the same bar to the sitemap, so an unshowable card is never submitted for indexing', async () => {
    const { client, calls } = recordingClient();
    const { listWallSlugs } = await import('./wall');
    await listWallSlugs(client);
    const gte = calls.filter((c) => c.fn === 'gte').map((c) => c.args[0]);
    expect(gte).toContain('design_score');
  });

  it('leaves the trending wall ranked on outperformance and never on beauty', async () => {
    const { client, calls } = recordingClient();
    const { listTrendingWall } = await import('./wall');
    await listTrendingWall(client, { locale: 'en' });
    const gte = calls.filter((c) => c.fn === 'gte').map((c) => c.args[0]);
    expect(gte).toContain('outperformance');
    expect(gte, 'a plain post that travelled belongs on trending whatever it looks like').not.toContain('design_score');
  });
});

describe('the judge queue and the trending wall agree on what "could appear" means', () => {
  it('keeps the mirrored constants equal', async () => {
    const { TRENDING_MIN_OUTPERFORMANCE_FOR_QUEUE, TRENDING_WINDOW_DAYS_FOR_QUEUE } = await import('./design-judge');
    const { TRENDING_MIN_OUTPERFORMANCE, TRENDING_WINDOW_DAYS } = await import('./wall');
    // design-judge duplicates these to avoid an import cycle; this is the seam that keeps it honest.
    expect(TRENDING_MIN_OUTPERFORMANCE_FOR_QUEUE).toBe(TRENDING_MIN_OUTPERFORMANCE);
    expect(TRENDING_WINDOW_DAYS_FOR_QUEUE).toBe(TRENDING_WINDOW_DAYS);
  });
});

describe('capPerAccount — the wall is a ranking of work, not of accounts', () => {
  const row = (account: string, score: number, platform = 'x') => ({ account_key: account, design_score: score, platform });

  it('keeps at most two cards from one account', async () => {
    const { capPerAccount } = await import('./wall');
    const out = capPerAccount([row('nothing', 70), row('nothing', 69), row('nothing', 68), row('figma', 68)]);
    expect(out.map((r) => r.account_key)).toEqual(['nothing', 'nothing', 'figma']);
  });

  it('preserves the score order it was given', async () => {
    const { capPerAccount } = await import('./wall');
    const out = capPerAccount([row('a', 90), row('b', 80), row('a', 70), row('c', 60)]);
    expect(out.map((r) => r.design_score)).toEqual([90, 80, 70, 60]);
  });

  it('treats the same handle on two platforms as two accounts', async () => {
    const { capPerAccount } = await import('./wall');
    const out = capPerAccount([row('nothing', 70, 'x'), row('nothing', 69, 'x'), row('nothing', 68, 'instagram')]);
    expect(out).toHaveLength(3);
  });

  it('does not let a missing account key bypass the cap', async () => {
    const { capPerAccount } = await import('./wall');
    const out = capPerAccount([row(null as never, 70), row(null as never, 69), row(null as never, 68)]);
    expect(out).toHaveLength(2);
  });
});
