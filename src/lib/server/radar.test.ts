import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseFeed,
  radarPrefsOf,
  roundRobin,
  normalizeRedditUrl,
  radarPlatformEnabled,
  sourceKindPlatform,
  radarBacklogExceeded,
  RADAR_PENDING_BACKLOG_CAP,
  xCommunityUrl,
  withinWindow,
  maxAgeHoursFor,
  isNoMatch404,
  buildEngagePrompt,
  selectTopComments,
  COMMENT_MIN_RELEVANCE,
  radarDigestHtml
} from './radar';
import { normalizeIntent, INTENT_RANK } from '$lib/leads-intent';
import { communityKeyOf, renderCommunityProfile, renderVocabularyDigest } from './community-profile';

describe('roundRobin (fair share across sources)', () => {
  it('gives every source a slot before any takes a second — no starvation by a high-volume source', () => {
    // news has 100 items but the two subs must still appear in the first passes.
    const byOrigin = new Map<string, string[]>([
      ['news', Array.from({ length: 100 }, (_, i) => `n${i}`)],
      ['r/saas', ['s0', 's1']],
      ['r/founder', ['f0', 'f1']]
    ]);
    const out = roundRobin(byOrigin, 6);
    expect(out).toEqual(['n0', 's0', 'f0', 'n1', 's1', 'f1']);
    // Both subs are represented — the old slice(0,N) in fetch order would have returned only news.
    expect(out).toContain('s0');
    expect(out).toContain('f0');
  });

  it('respects the cap and drains remaining sources when others empty', () => {
    const byOrigin = new Map<string, number[]>([['a', [1, 2, 3]], ['b', [4]]]);
    expect(roundRobin(byOrigin, 10)).toEqual([1, 4, 2, 3]); // b empties, a keeps going
    expect(roundRobin(new Map(), 5)).toEqual([]);
  });
});

describe('parseFeed', () => {
  it('parses RSS 2.0 items (Google News shape)', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title><![CDATA[Il Kansas approva la legge X]]></title><link>https://news.google.com/rss/articles/abc</link>
        <pubDate>Wed, 02 Jul 2026 10:00:00 GMT</pubDate><description>Snippet &amp; testo</description>
        <source url="https://ilpost.it">Il Post</source></item>
      <item><title>Seconda notizia</title><link>https://example.com/2</link></item>
    </channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Il Kansas approva la legge X');
    expect(items[0].url).toContain('news.google.com');
    expect(items[0].sourceName).toBe('Il Post');
    expect(items[0].snippet).toContain('Snippet & testo');
    expect(items[0].publishedAt).toMatch(/^2026-07-02/);
  });

  it('parses Atom entries (Reddit shape)', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Post dal subreddit</title><link href="https://reddit.com/r/x/comments/1"/>
        <updated>2026-07-01T08:00:00Z</updated><content type="html">&lt;p&gt;body&lt;/p&gt;</content></entry>
    </feed>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://www.reddit.com/r/x/comments/1');
    expect(items[0].snippet).toContain('body');
  });

  it('rewrites old.reddit.com permalinks from rising RSS to www', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Rising</title><link href="https://old.reddit.com/r/saas/comments/abc/title/"/>
        <updated>2026-07-01T08:00:00Z</updated></entry>
    </feed>`;
    expect(parseFeed(xml)[0].url).toBe('https://www.reddit.com/r/saas/comments/abc/title/');
  });

  it('skips malformed blocks without throwing', () => {
    expect(parseFeed('<rss><item><title>no link</title></item></rss>')).toHaveLength(0);
    expect(parseFeed('garbage')).toHaveLength(0);
  });
});

describe('normalizeRedditUrl', () => {
  it('maps old/new/bare/relative hosts onto www.reddit.com', () => {
    expect(normalizeRedditUrl('https://old.reddit.com/r/x/comments/1')).toBe('https://www.reddit.com/r/x/comments/1');
    expect(normalizeRedditUrl('https://new.reddit.com/r/x/comments/1')).toBe('https://www.reddit.com/r/x/comments/1');
    expect(normalizeRedditUrl('https://reddit.com/r/x/comments/1')).toBe('https://www.reddit.com/r/x/comments/1');
    expect(normalizeRedditUrl('https://www.reddit.com/r/x/comments/1')).toBe('https://www.reddit.com/r/x/comments/1');
    expect(normalizeRedditUrl('/r/x/comments/1')).toBe('https://www.reddit.com/r/x/comments/1');
  });
});

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

describe('xCommunityUrl', () => {
  // The endpoint takes `url`, not `id`. Passing the bare id errored, the fetcher swallowed it, and
  // every scan logged "0 items" — X looked configured and simply never produced a lead.
  it('builds the community URL from a bare id', () => {
    expect(xCommunityUrl('1926186499399139650')).toBe('https://x.com/i/communities/1926186499399139650');
  });

  it('accepts a pasted community URL', () => {
    expect(xCommunityUrl('https://x.com/i/communities/1926186499399139650')).toBe(
      'https://x.com/i/communities/1926186499399139650'
    );
    expect(xCommunityUrl(' twitter.com/i/communities/42/ ')).toBe('https://x.com/i/communities/42');
  });

  it('returns empty when there is no id to find, so the caller can say why', () => {
    expect(xCommunityUrl('marketing')).toBe('');
    expect(xCommunityUrl('')).toBe('');
  });
});

describe('freshness windows', () => {
  const item = (hoursAgo: number) => ({
    title: 't', url: 'u', snippet: '', sourceName: 's', publishedAt: null,
    createdUtc: Date.now() / 1000 - hoursAgo * 3600
  });

  it('keeps Reddit tight (rising = now) and gives the slower platforms 48h', () => {
    expect(maxAgeHoursFor('subreddit')).toBe(12);
    expect(maxAgeHoursFor('reddit_query')).toBe(12);
    expect(maxAgeHoursFor('threads_query')).toBe(48);
    expect(maxAgeHoursFor('linkedin_query')).toBe(48);
    expect(maxAgeHoursFor('x_community')).toBe(48);
  });

  it('drops what is outside the window and keeps what is inside', () => {
    const items = [item(1), item(24), item(60)];
    expect(withinWindow('subreddit', items)).toHaveLength(1);
    // A Threads search ranks by relevance, not recency: the 12h cut used to leave nothing.
    expect(withinWindow('threads_query', items)).toHaveLength(2);
  });
});

describe('intent', () => {
  it('normalises anything the model returns to a known band', () => {
    expect(normalizeIntent('seeking_now')).toBe('seeking_now');
    expect(normalizeIntent('SEEKING_NOW')).toBe('seeking_now');
    expect(normalizeIntent('ready to buy')).toBe('none');
    expect(normalizeIntent(undefined)).toBe('none');
  });

  it('ranks someone asking now above someone venting', () => {
    expect(INTENT_RANK.seeking_now).toBeGreaterThan(INTENT_RANK.comparing);
    expect(INTENT_RANK.comparing).toBeGreaterThan(INTENT_RANK.researching);
    expect(INTENT_RANK.researching).toBeGreaterThan(INTENT_RANK.venting);
    expect(INTENT_RANK.venting).toBeGreaterThan(INTENT_RANK.none);
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

describe('isNoMatch404 (LinkedIn: nessun risultato vestito da errore)', () => {
  // Verificato in produzione: 404 + not_found + credits_charged 0, mentre lo stesso endpoint
  // riempiva il catalogo globale quella mattina. È un insieme vuoto, non un guasto.
  const noMatch = new Error(
    'scrapecreators 404: {"success":false,"credits_remaining":12651,"credits_charged":0,"error":"not_found","errorStatus":404}'
  );

  it('riconosce il no-match documentato', () => {
    expect(isNoMatch404(noMatch)).toBe(true);
  });

  it('NON inghiotte gli altri errori: un path rotto deve restare rumoroso', () => {
    expect(isNoMatch404(new Error('scrapecreators 404: {"error":"route_not_found"}'))).toBe(false);
    expect(isNoMatch404(new Error('scrapecreators 401: {"error":"not_found"}'))).toBe(false);
    expect(isNoMatch404(new Error('scrapecreators 500: server error'))).toBe(false);
    expect(isNoMatch404(new Error('fetch failed'))).toBe(false);
  });

  it('guarda il corpo del messaggio, non il tipo di quello che è stato lanciato', () => {
    // Il client lancia sempre un Error, ma la verità sta nel corpo: se un giorno arrivasse come
    // stringa la risposta non cambierebbe di significato.
    expect(isNoMatch404('scrapecreators 404: {"error":"not_found"}')).toBe(true);
  });
});

describe('buildEngagePrompt (la lingua è quella del THREAD, non del brand)', () => {
  // Brand italiano, thread inglese: il caso reale che produceva bozze in italiano su Reddit EN.
  const base = {
    brandName: 'Trattoria Bio',
    about: 'Prodotti biologici italiani, spedizione in tutta Europa.',
    siteUrl: 'https://trattoriabio.it',
    aiContext: 'Voce: diretta, concreta, italiana.',
    sourceName: 'r/organicfarming',
    title: 'What should I look for when buying organic olive oil?',
    body: 'I keep seeing conflicting labels at the store. My budget is limited. How do I know the oil is actually organic?',
    topComments: '- Look for the EU organic leaf logo',
    author: 'oliveguy',
    intent: 'researching' as const,
    profileBlock: '',
    toneHint: '\nTONE: Write in a friendly tone.',
    styleHint: '\nSTYLE INSTRUCTIONS (PRIORITY — override any conflicting rules below): Sii cinico. No emoji.'
  };

  it('pins the reply language to the thread and carries the thread text the model detects it from', () => {
    const p = buildEngagePrompt(base);
    expect(p).toContain('REPLY LANGUAGE — ABSOLUTE RULE');
    expect(p).toContain('language of the THREAD');
    // le istruzioni di stile (spesso in italiano) governano lo stile, mai la lingua
    expect(p).toContain('Style instructions shape style, never language');
    // il testo su cui rilevare la lingua è nel prompt: titolo e corpo del thread
    expect(p).toContain(base.title);
    expect(p).toContain('conflicting labels');
  });

  it('guards the known failure modes: filler openers, title-only answers, echoing the thread, unsolicited pitch', () => {
    const p = buildEngagePrompt(base);
    expect(p).toContain('NO FILLER OPENERS');
    expect(p).toContain('ANSWER THE ACTUAL QUESTION');
    expect(p).toContain('ADD VALUE BEYOND THE THREAD');
    expect(p).toContain('NO UNSOLICITED PITCH');
    // i commenti già presenti arrivano al drafter come "già detto", non come suggerimento
    expect(p).toContain('EU organic leaf logo');
    expect(p).toContain('never restate it');
  });

  it("includes the owner's recent before→after edits, and omits the block when there are none", () => {
    const withPairs = buildEngagePrompt({
      ...base,
      editPairs: [{ before: 'Bozza lunga e promozionale', after: 'Corta e utile', feedback: 'meno pitch' }]
    });
    expect(withPairs).toContain('HOW THE OWNER REWRITES YOUR DRAFTS');
    expect(withPairs).toContain('BEFORE: Bozza lunga e promozionale');
    expect(withPairs).toContain('AFTER: Corta e utile');
    expect(withPairs).toContain('meno pitch');
    // senza riscritture il drafter lavora come prima: nessun blocco vuoto nel prompt
    expect(buildEngagePrompt(base)).not.toContain('HOW THE OWNER REWRITES');
  });
});

describe('selectTopComments (il cap è "gli N migliori", non "i primi N")', () => {
  const c = (id: string, relevance: number, intent: 'seeking_now' | 'none') =>
    ({ id, action: 'comment', relevance, intent });

  it('picks by intent then relevance, regardless of arrival order', () => {
    const picked = [c('a', 72, 'none'), c('b', 90, 'none'), c('c', 71, 'seeking_now'), c('d', 99, 'none')];
    // 'c' compra adesso (batte tutti), poi 'd' per rilevanza — 'a' arrivato primo NON entra.
    expect(selectTopComments(picked, 2).map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('drops below-floor comments and non-comment actions, and honours a zero budget', () => {
    const picked = [
      { id: 'p', action: 'post', relevance: 99, intent: 'none' as const },
      c('low', COMMENT_MIN_RELEVANCE - 1, 'seeking_now'),
      c('ok', 80, 'none')
    ];
    expect(selectTopComments(picked, 5).map((x) => x.id)).toEqual(['ok']);
    expect(selectTopComments(picked, 0)).toEqual([]);
  });
});

describe('radarDigestHtml (la mail porta la merce: testo pronto + link diretto)', () => {
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

describe('sorgenti Reddit (solo ScrapeCreators e RSS: niente OAuth ufficiale)', () => {
  it('non resta alcun riferimento al client OAuth Reddit nel radar', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./radar.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/oauth\.reddit\.com|REDDIT_CLIENT_(ID|SECRET)|redditAccessToken|redditGet/);
  });
});
