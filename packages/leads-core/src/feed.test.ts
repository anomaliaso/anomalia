import { describe, it, expect } from 'vitest';
import {
  parseFeed,
  roundRobin,
  normalizeRedditUrl,
  xCommunityUrl,
  maxAgeHoursFor,
  withinWindow,
  isNoMatch404,
  googleNewsRssUrl,
  createSources
} from './feed';

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

describe('googleNewsRssUrl', () => {
  it("senza lingua non impone un locale: decide Google dalla query", () => {
    expect(googleNewsRssUrl('pizza al taglio')).toBe('https://news.google.com/rss/search?q=pizza%20al%20taglio');
  });

  it('mappa la lingua su hl/gl/ceid, e ripiega su en-US per una sconosciuta', () => {
    expect(googleNewsRssUrl('x', 'it')).toContain('hl=it&gl=IT&ceid=IT:it');
    expect(googleNewsRssUrl('x', 'klingon')).toContain('hl=en-US&gl=US&ceid=US:en');
  });
});

describe('createSources — instradamento delle sorgenti', () => {
  // È QUI che sono nati i due difetti raccontati nei commenti: linkedin_query cadeva su fetchFeed
  // e scaricava le parole chiave come fossero un URL RSS, e X veniva chiamata con `id=` dove
  // l'endpoint vuole `url=`. Entrambi si presentavano come "0 item", non come errori.
  function spy() {
    const paths: string[] = [];
    const sources = createSources({
      scrape: async (path: string) => { paths.push(path); return { posts: [], tweets: [] }; }
    });
    return { sources, paths };
  }

  it('manda ogni kind al suo endpoint, e X con url= non con id=', async () => {
    const { sources, paths } = spy();
    await sources.fetchSourceFeed({ kind: 'threads_query', value: 'seo' });
    await sources.fetchSourceFeed({ kind: 'reddit_query', value: 'seo' });
    await sources.fetchSourceFeed({ kind: 'linkedin_query', value: 'seo' });
    await sources.fetchSourceFeed({ kind: 'x_community', value: '42' });

    expect(paths[0]).toContain('/v1/threads/search?query=seo');
    expect(paths[1]).toContain('/v1/reddit/search?query=seo');
    // linkedin_query DEVE colpire la ricerca LinkedIn: se ricade su fetchFeed torna vuoto per sempre.
    expect(paths[2]).toContain('/v1/linkedin/search/posts?query=seo');
    expect(paths[3]).toContain('/v1/twitter/community/tweets?url=');
    expect(paths[3]).not.toContain('?id=');
  });

  it('una community X senza id non parte in silenzio: lancia', async () => {
    const { sources } = spy();
    await expect(sources.fetchSourceFeed({ kind: 'x_community', value: 'marketing' })).rejects.toThrow('no community id');
  });
});

describe('sorgenti Reddit (solo ScrapeCreators e RSS: niente OAuth ufficiale)', () => {
  it('non resta alcun riferimento al client OAuth Reddit', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./feed.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/oauth\.reddit\.com|REDDIT_CLIENT_(ID|SECRET)|redditAccessToken|redditGet/);
  });
});

describe('createSources — auth del feed Reddit', () => {
  it('aggiunge token e utente quando ci sono, e lascia stare l\'URL quando mancano', () => {
    const withAuth = createSources({ scrape: async () => null, redditAuth: () => ({ token: 't/1', user: 'me' }) });
    expect(withAuth.redditRssAuth('https://www.reddit.com/r/x/.rss')).toBe(
      'https://www.reddit.com/r/x/.rss?feed=t%2F1&user=me'
    );
    expect(withAuth.redditRssAuth('https://www.reddit.com/r/x/.rss?a=1')).toContain('?a=1&feed=');

    const anonymous = createSources({ scrape: async () => null });
    expect(anonymous.redditRssAuth('https://www.reddit.com/r/x/.rss')).toBe('https://www.reddit.com/r/x/.rss');
  });

  it('legge le credenziali a ogni chiamata, non quando si costruisce', () => {
    // Congelarle alla costruzione significherebbe che un cambio d'ambiente non arriva mai.
    let token: string | undefined;
    const sources = createSources({ scrape: async () => null, redditAuth: () => ({ token, user: 'me' }) });
    expect(sources.redditRssAuth('https://r.example/.rss')).toBe('https://r.example/.rss');
    token = 'arrivato';
    expect(sources.redditRssAuth('https://r.example/.rss')).toContain('feed=arrivato');
  });
});
