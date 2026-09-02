/**
 * Dove si trovano le conversazioni: RSS, Google News, subreddit in rising, e le ricerche per
 * parola chiave su Reddit, Threads, X Communities e LinkedIn.
 *
 * READ-ONLY per costruzione: da qui non si pubblica e non si commenta niente, si legge soltanto.
 *
 * Il modulo non conosce né il gateway di scraping né le credenziali: entrano da `createSources`.
 * La parte pura — parsing, finestre di freschezza, round-robin — sta fuori dal factory, perché
 * non ha bisogno di niente e si prova da sola.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type FeedItem = { title: string; url: string; snippet: string; sourceName: string; publishedAt: string | null };
export type RedditItem = FeedItem & { createdUtc: number };
export type SourceRef = { kind: string; value: string; lang?: string | null };

const FEED_TIMEOUT_MS = 10_000;
const ITEMS_PER_FEED = 15;

// Un buon commento arriva su un thread che sta SALENDO adesso.
const ENGAGE_MAX_AGE_HOURS = 12;
// Threads / X / LinkedIn hanno un altro orologio. Le loro ricerche ordinano per rilevanza, non per
// recenza (Threads non ha proprio un filtro data), e un post lì resta vivo per giorni invece di
// cadere da una lista rising in ore. Tagliarli a 12h buttava via quasi ogni risultato — la
// scansione registrava "0 item" e sembrava un feed vuoto invece di una finestra troppo stretta.
const CONVERSATION_MAX_AGE_HOURS = 48;

const REDDIT_UA = 'AnomaliaRadar/1.0 (read-only; instant-marketing suggestions)';

/** Una sorgente è brand-AGNOSTICA da scaricare: r/marketing è lo stesso per ogni brand che la guarda. */
export const sourceKey = (s: SourceRef): string => `${s.kind}|${s.value}|${s.lang ?? ''}`;

const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? strip(m[1]) : '';
};

// Il rising RSS di Reddit si scarica da old.reddit.com (meno bloccato dal fingerprint), ma quei
// feed emettono permalink old.reddit.com. Si riscrivono sempre a www, così /leads e le email
// aprono l'interfaccia attuale — mai la skin classica.
export function normalizeRedditUrl(url: string): string {
  const u = (url ?? '').trim();
  if (!u) return u;
  if (u.startsWith('/r/') || u.startsWith('/user/') || u.startsWith('/u/')) return `https://www.reddit.com${u}`;
  return u.replace(/^https?:\/\/(old\.|new\.|www\.)?reddit\.com/i, 'https://www.reddit.com');
}

// Parser RSS 2.0 + Atom tollerante: basta per Google News, RSS standard e i feed Atom di Reddit.
// ponytail: parsing XML a regex — va bene per feed ben formati; si passa a un parser vero se una
// sorgente che serve lo rompe.
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  for (const b of blocks) {
    const title = tag(b, 'title');
    // RSS: <link>url</link>. Atom/Reddit: <link href="url"/>.
    let url = tag(b, 'link');
    if (!url) url = b.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? '';
    if (!title || !url) continue;
    const snippet = (tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 1000);
    const sourceName = tag(b, 'source') || tag(b, 'author') || '';
    const dateRaw = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated');
    const t = dateRaw ? Date.parse(dateRaw) : NaN;
    const cleaned = strip(url);
    out.push({
      title,
      url: /reddit\.com/i.test(cleaned) || cleaned.startsWith('/r/') ? normalizeRedditUrl(cleaned) : cleaned,
      snippet,
      sourceName,
      publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString()
    });
  }
  return out;
}

// Selezione a quote eque: un item per origine a giro, fino a `cap`. Garantisce che ogni sorgente
// con contenuto fresco contribuisca prima che una qualsiasi prenda un secondo posto — così una
// sorgente ad alto volume non affama le altre.
export function roundRobin<T>(byOrigin: Map<string, T[]>, cap: number): T[] {
  const qList = [...byOrigin.values()];
  const out: T[] = [];
  while (out.length < cap && qList.some((q) => q.length)) {
    for (const q of qList) {
      if (!q.length) continue;
      out.push(q.shift()!);
      if (out.length >= cap) break;
    }
  }
  return out;
}

/** Quanto può essere vecchia una conversazione, per piattaforma. */
export function maxAgeHoursFor(kind: string): number {
  return kind === 'subreddit' || kind === 'reddit_query' ? ENGAGE_MAX_AGE_HOURS : CONVERSATION_MAX_AGE_HOURS;
}

/** Scarta le conversazioni oltre la finestra della loro piattaforma. */
export function withinWindow(kind: string, items: RedditItem[]): RedditItem[] {
  const cutoff = Date.now() / 1000 - maxAgeHoursFor(kind) * 3600;
  return items.filter((i) => i.createdUtc >= cutoff);
}

/**
 * La ricerca di LinkedIn dice "nessun post corrisponde" con un **404 `not_found`** e non addebita
 * credito — un risultato vuoto vestito da errore.
 *
 * Il riconoscimento è volutamente stretto — solo il corpo documentato del no-match — perché ogni
 * altro 404 (path sbagliato, endpoint rimosso) resta un errore vero e deve continuare a urlare.
 */
export function isNoMatch404(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return m.startsWith('scrapecreators 404') && m.includes('"not_found"');
}

// Le impostazioni chiedono l'ID della community X, ma la gente incolla l'URL intero — si accettano
// entrambi e all'endpoint si passa l'URL che documenta davvero.
export function xCommunityUrl(value: string): string {
  const v = String(value ?? '').trim();
  const id = v.match(/communities\/(\d+)/)?.[1] ?? v.replace(/\D/g, '');
  return id ? `https://x.com/i/communities/${id}` : '';
}

const GNEWS_LANG_MAP: Record<string, [string, string, string]> = {
  en: ['en-US', 'US', 'US:en'], it: ['it', 'IT', 'IT:it'], es: ['es', 'ES', 'ES:es'],
  fr: ['fr', 'FR', 'FR:fr'], de: ['de', 'DE', 'DE:de'], pt: ['pt-BR', 'BR', 'BR:pt'],
  nl: ['nl', 'NL', 'NL:nl'], pl: ['pl', 'PL', 'PL:pl'], ro: ['ro', 'RO', 'RO:ro'],
  sv: ['sv', 'SE', 'SE:sv'], no: ['no', 'NO', 'NO:no'], da: ['da', 'DK', 'DK:da'],
  fi: ['fi', 'FI', 'FI:fi'], cs: ['cs', 'CZ', 'CZ:cs'], sk: ['sk', 'SK', 'SK:sk'],
  hu: ['hu', 'HU', 'HU:hu'], hr: ['hr', 'HR', 'HR:hr'], sr: ['sr', 'RS', 'RS:sr'],
  sl: ['sl', 'SI', 'SI:sl'], bg: ['bg', 'BG', 'BG:bg'], uk: ['uk', 'UA', 'UA:uk'],
  ru: ['ru', 'RU', 'RU:ru'], tr: ['tr', 'TR', 'TR:tr'], el: ['el', 'GR', 'GR:el'],
  ar: ['ar', 'SA', 'SA:ar'], he: ['he', 'IL', 'IL:he'], fa: ['fa', 'IR', 'IR:fa'],
  hi: ['hi', 'IN', 'IN:hi'], th: ['th', 'TH', 'TH:th'], vi: ['vi', 'VN', 'VN:vi'],
  id: ['id', 'ID', 'ID:id'], ms: ['ms', 'MY', 'MY:ms'], zh: ['zh-CN', 'CN', 'CN:zh'],
  ja: ['ja', 'JP', 'JP:ja'], ko: ['ko', 'KR', 'KR:ko'],
};

/** L'URL RSS di Google News per una query. `auto` = nessun parametro di locale, decide Google. */
export function googleNewsRssUrl(query: string, lang?: string | null): string {
  const code = (lang ?? 'auto').toLowerCase();
  if (code === 'auto') return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}`;
  const [hl, gl, ceid] = GNEWS_LANG_MAP[code] ?? ['en-US', 'US', 'US:en'];
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

/**
 * Quello che il package non può procurarsi da solo.
 *
 * `redditAuth` è una funzione e non un oggetto di proposito: le credenziali vanno lette al momento
 * della chiamata, come faceva il codice originale, non congelate quando si costruisce il factory.
 */
export type SourceDeps = {
  /** Il gateway di scraping. Deve lanciare `scrapecreators <status> <body>` sugli errori. */
  scrape: (path: string) => Promise<AnyRec | null>;
  /** Feed token personale di Reddit (reddit.com/prefs/feeds). Senza, gli RSS restano anonimi. */
  redditAuth?: () => { token?: string; user?: string };
  /** Chrome vero, per i feed che bloccano i client HTTP da server. Senza, si salta il ripiego. */
  fetchViaBrowser?: (url: string) => Promise<string | null>;
};

export function createSources(deps: SourceDeps) {
  // Auth del feed personale: dal 2026 i feed anonimi sono bloccati per fingerprint dai server, ma
  // ogni account ha un token privato — aggiungere ?feed=TOKEN&user=USERNAME rende la richiesta il
  // feed autenticato dell'utente e passa. Più semplice di OAuth e read-only per costruzione.
  const redditRssAuth = (url: string): string => {
    const { token, user } = deps.redditAuth?.() ?? {};
    if (!token || !user) return url;
    return `${url}${url.includes('?') ? '&' : '?'}feed=${encodeURIComponent(token)}&user=${encodeURIComponent(user)}`;
  };

  const feedUrlFor = (source: SourceRef): string => {
    if (source.kind === 'gnews_query') return googleNewsRssUrl(source.value, source.lang);
    if (source.kind === 'subreddit') return redditRssAuth(`https://www.reddit.com/r/${source.value.replace(/^r\//, '')}/.rss`);
    return source.value; // plain RSS url
  };

  const fetchFeed = async (source: SourceRef): Promise<FeedItem[]> => {
    try {
      const res = await fetch(feedUrlFor(source), {
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AnomaliaRadar/1.0)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }
      });
      if (!res.ok) return [];
      return parseFeed(await res.text()).slice(0, ITEMS_PER_FEED);
    } catch {
      return []; // un feed morto non rompe mai la scansione
    }
  };

  // Scarica il corpo grezzo di un URL Reddit schivando il muro del fingerprint TLS: Reddit dà 403
  // ai client HTTP da server (Node/undici) anche con auth valida, mentre i browser veri passano.
  // Catena: fetch normale → browser vero. null quando falliscono entrambi.
  const fetchRedditText = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS), headers: { 'User-Agent': REDDIT_UA } });
      if (res.ok) return await res.text();
    } catch { /* si passa al browser */ }
    if (!deps.fetchViaBrowser) return null;
    try {
      const out = await deps.fetchViaBrowser(url);
      return typeof out === 'string' && out.trim() ? out : null;
    } catch {
      return null;
    }
  };

  const fetchSubredditRising = async (sub: string): Promise<RedditItem[]> => {
    const clean = sub.replace(/^r\//, '').replace(/\/+$/, '');
    try {
      const data = await deps.scrape(`/v1/reddit/subreddit?subreddit=${encodeURIComponent(clean)}&sort=rising&trim=true`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: AnyRec[] = Array.isArray(data?.posts) ? data.posts : Array.isArray(data?.data?.children) ? data.data.children.map((c: any) => c?.data ?? c) : [];
      const mapped = raw
        .map((d) => ({
          title: String(d?.title ?? ''),
          url: d?.permalink ? `https://www.reddit.com${String(d.permalink).startsWith('/') ? d.permalink : `/${d.permalink}`}` : String(d?.url ?? ''),
          snippet: String(d?.selftext ?? '').slice(0, 1000),
          sourceName: `r/${clean}`,
          publishedAt: d?.created_utc ? new Date(Number(d.created_utc) * 1000).toISOString() : null,
          createdUtc: Number(d?.created_utc) || 0
        }))
        .filter((i) => i.title && i.url.includes('/comments/'));
      if (mapped.length) return mapped;
    } catch (e) {
      console.warn(`[radar] scrapecreators reddit r/${clean} failed:`, e instanceof Error ? e.message.slice(0, 120) : e);
    }
    // Ripiego: l'endpoint RSS, che funziona da alcune reti ma è bloccato per fingerprint da molti server.
    const xml = await fetchRedditText(redditRssAuth(`https://old.reddit.com/r/${encodeURIComponent(clean)}/rising/.rss`));
    if (!xml) {
      console.warn(`[radar] reddit r/${clean} unavailable — set the reddit feed token (prefs/feeds)`);
      return [];
    }
    return parseFeed(xml)
      .filter((i) => i.url.includes('/comments/'))
      .map((i) => ({ ...i, sourceName: `r/${clean}`, createdUtc: i.publishedAt ? Date.parse(i.publishedAt) / 1000 : 0 }));
  };

  // Le ricerche di conversazioni PROPAGANO gli errori di proposito. Prima facevano
  // `catch { return [] }`, quindi un parametro sbagliato o una chiave scaduta finivano nel log
  // come "0 item" — indistinguibile da "nessuna conversazione degna oggi". È così che la sorgente
  // X è rimasta morta in silenzio: veniva chiamata con `id=` dove l'endpoint vuole `url=`, e ogni
  // scansione riportava un successo pulito e vuoto.

  const fetchThreadsSearch = async (query: string): Promise<RedditItem[]> => {
    // NB: il filtro start_date dell'endpoint restituisce 0 risultati (verificato dal vivo) —
    // si scarica senza filtro e il taglio di freschezza lo fa il chiamante con createdUtc.
    const data = await deps.scrape(`/v1/threads/search?query=${encodeURIComponent(query)}&trim=true`);
    return ((data?.posts ?? []) as AnyRec[])
      .map((post) => ({
        title: String(post?.caption?.text ?? '').replace(/\s+/g, ' ').slice(0, 200),
        url: post?.code && post?.user?.username ? `https://www.threads.net/@${post.user.username}/post/${post.code}` : '',
        snippet: String(post?.caption?.text ?? '').slice(0, 1000),
        sourceName: `threads${post?.user?.username ? ` · @${post.user.username}` : ''}`,
        publishedAt: post?.taken_at ? new Date(Number(post.taken_at) * 1000).toISOString() : null,
        createdUtc: Number(post?.taken_at) || 0
      }))
      .filter((i) => i.title && i.url);
  };

  const fetchRedditSearch = async (query: string): Promise<RedditItem[]> => {
    const data = await deps.scrape(`/v1/reddit/search?query=${encodeURIComponent(query)}&sort=new&timeframe=day&trim=true`);
    return ((data?.posts ?? []) as AnyRec[])
      .map((post) => ({
        title: String(post?.title ?? ''),
        url: post?.permalink ? `https://www.reddit.com${String(post.permalink).startsWith('/') ? post.permalink : `/${post.permalink}`}` : String(post?.url ?? ''),
        snippet: String(post?.selftext ?? '').slice(0, 1000),
        // Il prefisso `r/` resta: il prompt del verdetto e la UI lo usano per trattare questi item
        // come quelli dei subreddit.
        sourceName: `r/${post?.subreddit ?? ''}`,
        publishedAt: post?.created_utc ? new Date(Number(post.created_utc) * 1000).toISOString() : null,
        createdUtc: Number(post?.created_utc) || 0
      }))
      .filter((i) => i.title && i.url.includes('/comments/'));
  };

  const fetchLinkedInSearch = async (query: string): Promise<RedditItem[]> => {
    let data: AnyRec | null;
    try {
      data = await deps.scrape(`/v1/linkedin/search/posts?query=${encodeURIComponent(query)}&date_posted=last-day`);
    } catch (e) {
      // "Nessun post" non è un guasto: segnarlo rosso sarebbe l'errore opposto a quello appena
      // tolto — gridare al lupo invece di tacere. Resta nei log.
      if (isNoMatch404(e)) {
        console.warn(`[radar] linkedin search: nessun risultato per "${query.slice(0, 60)}"`);
        return [];
      }
      throw e;
    }
    return ((data?.posts ?? []) as AnyRec[])
      .map((post) => {
        const text = String(post?.description ?? '').replace(/\s+/g, ' ').trim();
        const ts = post?.datePublished ? Date.parse(String(post.datePublished)) : NaN;
        return {
          title: text.slice(0, 200),
          url: String(post?.url ?? ''),
          snippet: text.slice(0, 1000),
          sourceName: `linkedin${post?.author?.name ? ` · ${post.author.name}` : ''}`,
          publishedAt: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
          createdUtc: Number.isNaN(ts) ? 0 : ts / 1000
        };
      })
      .filter((i) => i.title && i.url);
  };

  // X vende la ricerca per parola chiave solo con l'API a pagamento — le community di nicchia sono
  // la superficie di engage lì. Value = l'id della community dal suo URL.
  const fetchXCommunityTweets = async (communityId: string): Promise<RedditItem[]> => {
    const url = xCommunityUrl(communityId);
    if (!url) throw new Error(`x_community: "${communityId}" has no community id in it`);
    // L'endpoint vuole `url`, NON `id` — v. docs.scrapecreators.com/v1/twitter/community/tweets.
    const data = await deps.scrape(`/v1/twitter/community/tweets?url=${encodeURIComponent(url)}&trim=true`);
    const raw: AnyRec[] = Array.isArray(data?.tweets) ? data.tweets : Array.isArray(data?.data) ? data.data : [];
    return raw
      .map((t) => {
        const ts = t?.created_at ? Date.parse(String(t.created_at)) : NaN;
        const id = String(t?.id_str ?? t?.rest_id ?? t?.id ?? '');
        return {
          title: String(t?.full_text ?? t?.text ?? '').replace(/\s+/g, ' ').slice(0, 200),
          url: id ? `https://x.com/i/status/${id}` : '',
          snippet: String(t?.full_text ?? t?.text ?? '').slice(0, 1000),
          sourceName: 'x community',
          publishedAt: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
          createdUtc: Number.isNaN(ts) ? 0 : ts / 1000
        };
      })
      .filter((i) => i.title && i.url);
  };

  /** Una sorgente, già filtrata nel tempo dove il tempo conta. L'unità della cache condivisa. */
  const fetchSourceFeed = async (s: SourceRef): Promise<FeedItem[]> => {
    if (s.kind === 'threads_query') return withinWindow(s.kind, await fetchThreadsSearch(s.value));
    if (s.kind === 'x_community') return withinWindow(s.kind, await fetchXCommunityTweets(s.value));
    // linkedin_query mancava qui: la sorgente cadeva su fetchFeed(), che scaricava le PAROLE CHIAVE
    // come se fossero un url RSS. Ogni sorgente LinkedIn restituiva niente, per sempre.
    if (s.kind === 'linkedin_query') return withinWindow(s.kind, await fetchLinkedInSearch(s.value));
    if (s.kind === 'reddit_query') return withinWindow(s.kind, await fetchRedditSearch(s.value));
    if (s.kind !== 'subreddit') return fetchFeed(s);
    // TIMING: solo RISING (momentum adesso), taglio netto — un commento su un thread stantio è
    // fiato sprecato.
    return withinWindow(s.kind, await fetchSubredditRising(s.value));
  };

  return {
    redditRssAuth,
    fetchRedditText,
    fetchSubredditRising,
    fetchThreadsSearch,
    fetchRedditSearch,
    fetchLinkedInSearch,
    fetchXCommunityTweets,
    fetchSourceFeed
  };
}

export type Sources = ReturnType<typeof createSources>;
