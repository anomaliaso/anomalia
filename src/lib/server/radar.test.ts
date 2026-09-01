import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  radarPrefsOf,
  radarPlatformEnabled,
  sourceKindPlatform,
  radarBacklogExceeded,
  RADAR_PENDING_BACKLOG_CAP,
  radarDigestHtml
} from './radar';
import { communityKeyOf, renderCommunityProfile, renderVocabularyDigest } from './community-profile';

describe('radarPrefsOf', () => {
  it('defaults to disabled digest with cap 1', () => {
    expect(radarPrefsOf(null)).toEqual({
      enabled: false,
      mode: 'digest',
      maxPerDay: 1,
      replyTone: 'friendly',
      replyStyle:
        'Sii cinico. Non usare mai il trattino em-dash (—); usa solo punti e virgole. Scrivi in modo diretto, senza fronzoli, senza allungare il testo. Sii conciso. Scrivi come una persona che digita velocemente, non come un\'AI. No emoji.',
      leadInstructions: '',
      emailPerRun: false,
      editPairs: [],
      platforms: {}
    });
  });
  it('clamps maxPerDay to [1,3]', () => {
    expect(radarPrefsOf({ radar: { enabled: true, maxPerDay: 99 } }).maxPerDay).toBe(3);
  });
  it('reads emailPerRun only when explicitly true', () => {
    expect(radarPrefsOf({ radar: { emailPerRun: true } }).emailPerRun).toBe(true);
    expect(radarPrefsOf({ radar: { emailPerRun: 'yes' } }).emailPerRun).toBe(false);
  });
  it('reads platform master toggles (missing = on at scan time)', () => {
    expect(radarPrefsOf({ radar: { platforms: { reddit: false, threads: true } } }).platforms).toEqual({
      reddit: false,
      threads: true
    });
  });

  it('sanitizes editPairs: keeps the last 5 VALID pairs, truncated, and drops junk', () => {
    const pairs = Array.from({ length: 7 }, (_, i) => ({ before: `b${i}`, after: `a${i}` }));
    const out = radarPrefsOf({
      radar: { editPairs: [...pairs, { before: '', after: 'x' }, 'junk', { before: 'solo' }] }
    }).editPairs!;
    expect(out).toHaveLength(5);
    expect(out[4]).toMatchObject({ before: 'b6', after: 'a6' });
    // truncation: a runaway jsonb must never inflate the drafter prompt
    const long = radarPrefsOf({ radar: { editPairs: [{ before: 'x'.repeat(2000), after: 'y', feedback: 'f'.repeat(900) }] } }).editPairs!;
    expect(long[0].before).toHaveLength(600);
    expect(long[0].feedback).toHaveLength(200);
  });
});

describe('radarPlatformEnabled / sourceKindPlatform', () => {
  it('maps source kinds onto platform masters', () => {
    expect(sourceKindPlatform('gnews_query')).toBe('gnews');
    expect(sourceKindPlatform('subreddit')).toBe('reddit');
    expect(sourceKindPlatform('reddit_query')).toBe('reddit');
    expect(sourceKindPlatform('threads_query')).toBe('threads');
    expect(sourceKindPlatform('x_community')).toBe('x');
    expect(sourceKindPlatform('linkedin_query')).toBe('linkedin');
    expect(sourceKindPlatform('rss')).toBeNull();
  });

  it('defaults platforms on, respects explicit off, and blocks Pro-only on Starter', () => {
    const prefs = radarPrefsOf({ radar: { platforms: { reddit: false } } });
    expect(radarPlatformEnabled(prefs, 'reddit', 'starter')).toBe(false);
    expect(radarPlatformEnabled(prefs, 'gnews', 'starter')).toBe(true);
    expect(radarPlatformEnabled(prefs, 'threads', 'starter')).toBe(false);
    expect(radarPlatformEnabled(prefs, 'threads', 'pro')).toBe(true);
    expect(radarPlatformEnabled(radarPrefsOf({ radar: { platforms: { threads: false } } }), 'threads', 'pro')).toBe(
      false
    );
  });
});

describe('radarBacklogExceeded (pending-user queue cap)', () => {
  /** Chainable builder that answers the pending count query and captures the incidents upsert. */
  function backlogClient(count: number) {
    const eqCalls: Array<{ col: string; val: unknown }> = [];
    const ltCalls: Array<{ col: string; val: unknown }> = [];
    const upserts: Array<{ payload: Record<string, unknown>; options: unknown }> = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        eqCalls.push({ col, val });
        return builder;
      },
      lt: (col: string, val: unknown) => {
        ltCalls.push({ col, val });
        return builder;
      },
      then: (resolve: (v: { count: number; error: null }) => void) => resolve({ count, error: null })
    };
    const client = {
      from: (table: string) =>
        table === 'posts'
          ? builder
          : {
              upsert: (payload: Record<string, unknown>, options: unknown) => {
                upserts.push({ payload, options });
                return Promise.resolve({ error: null });
              }
            }
    } as unknown as SupabaseClient;
    return { client, eqCalls, ltCalls, upserts };
  }

  it('trips only when more than the cap are pending and older than 7 days', async () => {
    const { client } = backlogClient(RADAR_PENDING_BACKLOG_CAP + 1);
    expect(await radarBacklogExceeded(client, 'brand-1')).toBe(true);

    const under = backlogClient(RADAR_PENDING_BACKLOG_CAP);
    expect(await radarBacklogExceeded(under.client, 'brand-1')).toBe(false);

    const empty = backlogClient(0);
    expect(await radarBacklogExceeded(empty.client, 'brand-1')).toBe(false);
  });

  it('counts only this brand\'s pending_user posts with created_at older than 7 days', async () => {
    const { client, eqCalls, ltCalls } = backlogClient(16);
    await radarBacklogExceeded(client, 'brand-9');
    expect(eqCalls).toContainEqual({ col: 'brand_id', val: 'brand-9' });
    expect(eqCalls).toContainEqual({ col: 'status', val: 'pending_user' });
    expect(ltCalls).toHaveLength(1);
    expect(ltCalls[0].col).toBe('created_at');
    expect(new Date(String(ltCalls[0].val)).getTime()).toBeLessThan(Date.now());
  });

  // Detected_on is GENERATED ALWAYS (migration 0084): sending it fails the upsert with 428C9 and
  // the swallowed error means no incident at all — same rule as the scheduler's pending_backlog.
  it('writes one radar_backlog incident with dedup conflict and NO detected_on in the payload', async () => {
    const { client, upserts } = backlogClient(16);
    expect(await radarBacklogExceeded(client, 'brand-1')).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload).not.toHaveProperty('detected_on');
    expect(upserts[0].payload.brand_id).toBe('brand-1');
    expect(upserts[0].payload.kind).toBe('radar_backlog');
    expect(upserts[0].payload.severity).toBe('warning');
    expect(upserts[0].payload.details).toEqual({ pending: 16, olderThanDays: 7 });
    expect(upserts[0].options).toEqual({ onConflict: 'brand_id,kind,detected_on' });
  });

  it('writes no incident below or at the cap', async () => {
    const at = backlogClient(RADAR_PENDING_BACKLOG_CAP);
    await radarBacklogExceeded(at.client, 'brand-1');
    expect(at.upserts).toHaveLength(0);
  });
});

describe('communityKeyOf', () => {
  it('keys Reddit per subreddit — two subs on one topic are two different rooms', () => {
    expect(communityKeyOf('r/smallbusiness', 'https://www.reddit.com/r/smallbusiness/comments/x/y/')).toEqual({
      platform: 'reddit', community: 'r/smallbusiness'
    });
    // Source name missing → recover the sub from the URL.
    expect(communityKeyOf('', 'https://www.reddit.com/r/saas/comments/x/y/')).toEqual({
      platform: 'reddit', community: 'r/saas'
    });
  });

  it('keys the keyword-search platforms per platform (no stable community behind them)', () => {
    expect(communityKeyOf('threads · @someone', 'https://www.threads.net/@someone/post/abc')?.community).toBe('threads');
    expect(communityKeyOf('linkedin · Someone', 'https://www.linkedin.com/posts/abc')?.community).toBe('linkedin');
    expect(communityKeyOf('x community', 'https://x.com/i/status/1')?.community).toBe('x');
  });

  it('returns null for feed items — a news article has no community', () => {
    expect(communityKeyOf('Il Sole 24 Ore', 'https://ilsole24ore.com/art/abc')).toBeNull();
  });
});

describe('renderCommunityProfile', () => {
  it('renders only the sections that carry evidence', () => {
    const out = renderCommunityProfile({
      platform: 'reddit', community: 'r/saas',
      demographics: 'Founders, 25-40 (guess)',
      psychographics: '', vocabulary: ['"churn is killing us"'], tried_and_failed: ['cold email'],
      what_lands: '', rules: 'No self-promo outside the weekly thread', tone: ''
    });
    expect(out).toContain('r/saas');
    expect(out).toContain('churn is killing us');
    expect(out).toContain('cold email');
    expect(out).toContain('No self-promo');
    expect(out).not.toContain('What they want');
  });

  it('is empty when there is nothing to say, so no empty block rides in the prompt', () => {
    expect(renderCommunityProfile(undefined)).toBe('');
    expect(renderCommunityProfile({ platform: 'reddit', community: 'r/x' })).toBe('');
  });
});

describe('renderVocabularyDigest', () => {
  it('lists one line per community that has phrases, and nothing otherwise', () => {
    const map = new Map([
      ['reddit|r/saas', { platform: 'reddit', community: 'r/saas', vocabulary: ['"churn"'] }],
      ['reddit|r/quiet', { platform: 'reddit', community: 'r/quiet', vocabulary: [] }]
    ]);
    const out = renderVocabularyDigest(map);
    expect(out).toContain('r/saas');
    expect(out).not.toContain('r/quiet');
    expect(renderVocabularyDigest(new Map())).toBe('');
  });
});

describe('radarDigestHtml (la mail porta la merce: testo pronto + link diretto)', () => {
  it('con radarUrl porta il link di disiscrizione nel corpo, non solo negli header', () => {
    const html = radarDigestHtml(false, 'https://app.example.com', [], [], [], 'https://app.example.com/app/acme/radar');
    expect(html).toContain('https://app.example.com/app/acme/radar');
    expect(html.toLowerCase()).toContain('unsubscribe');
  });

  it('senza radarUrl nessun footer: il corpo resta come prima', () => {
    const html = radarDigestHtml(false, 'https://app.example.com', [], [], []);
    expect(html).not.toContain('unsubscribe');
  });
  it('carries the ready-to-paste comment, the direct thread link and the DM', () => {
    const html = radarDigestHtml(true, 'https://app.example.com', [], [{
      title: 'Best organic olive oil?',
      url: 'https://www.reddit.com/r/organic/comments/abc/x/',
      sourceName: 'r/organic',
      comment: 'Ecco il commento pronto da incollare.',
      dm: 'Ciao, ho visto il tuo post…',
      dmTarget: 'oliveguy',
      dmProfileUrl: 'https://www.reddit.com/user/oliveguy'
    }], []);
    // leggi mail → copia → apri thread → incolla: servono ENTRAMBI, testo e link
    expect(html).toContain('Ecco il commento pronto da incollare.');
    expect(html).toContain('https://www.reddit.com/r/organic/comments/abc/x/');
    expect(html).toContain('Apri e rispondi');
    expect(html).toContain('Ciao, ho visto il tuo post…');
    expect(html).toContain('https://www.reddit.com/user/oliveguy');
  });

  it('keeps one-click approve/reject links for produced posts', () => {
    const html = radarDigestHtml(false, 'https://app.example.com', [{
      title: 'News', caption: 'Caption', imageUrl: null, sourceUrl: 'https://news.example.com/1',
      approveToken: 'tok-a', rejectToken: 'tok-r'
    }], [], []);
    expect(html).toContain('https://app.example.com/api/radar/approve/tok-a');
    expect(html).toContain('https://app.example.com/api/radar/reject/tok-r');
  });
});

