/**
 * posts.design — the curated wall of social post design, read at runtime by the Motion Video agent.
 *
 * WHY THIS SOURCE AND NOT THE MARKET HARVEST. `market-trends.ts` discovers Instagram Reels and
 * TikToks: UGC, filmed, sound-on. Nothing we generate looks like that — Motion Video makes Remotion
 * kinetic ads, and the corpus for THAT craft is the launch/announcement post: a card, a screen
 * recording of a product, type in motion, six seconds, no face. posts.design is a hand-curated wall
 * of exactly those, from the accounts that set the bar (Cursor, Cerebras, Vercel, Replit, Nothing).
 *
 * WHAT IT REPLACES. Until now the taste of every motion we ship was `MOTION_CRAFT_SPECS` — 34 lines
 * written by hand, frozen. This module makes it possible for the agent to go look at what is
 * actually being published this week and pick a reference, instead of re-deriving one constant.
 *
 * HOW WE READ IT. There is no public API (`/api` is Disallow in robots.txt and `/api/posts` 404s),
 * so this parses the same HTML a browser gets: `sitemap.xml` for the full index (~440 posts, each
 * carrying its media stem, from which platform / handle / original post id fall out) and the post
 * page for the taxonomy, the copy and the clip. Parsing leans on the page's own generated metadata
 * (`og:title`, `meta description`, the `sr-only` figcaptions) rather than on class names, because
 * those are the parts of a Next.js template that change least. Anything unparseable degrades to
 * null — a reference with the wrong brand attached is worse than one field short.
 *
 * THE COMPLIANCE POSTURE, WHICH IS A DESIGN CONSTRAINT AND NOT A DISCLAIMER.
 * posts.design serves `Content-Signal: search=yes,ai-train=no,use=reference` and states it as an
 * express Art. 4 reservation under Directive (EU) 2019/790. And the posts are not theirs: they are
 * third-party brands' work, curated. So:
 *   - nothing here is training data, ever — the clip is watched once and dropped;
 *   - nothing here is stored as media (`market-media.ts` archives clips; this deliberately does not);
 *   - no posts.design URL is handed to the model, so none can end up hot-linked inside a rendered
 *     MP4 the brand publishes (`assertNoReferenceHotlinks` in motion-video/agent.ts enforces it);
 *   - what survives a lookup is a TEXT spec — beats, timing, transition kind, type density — plus
 *     attribution: the brand, the handle, the original post, the reference page, the curator.
 * The thing we take is the structure, which is the thing a director takes from a reference anyway.
 *
 * Requests are identified, capped and cached: one index fetch per TTL, one page fetch per post per
 * process, and a floor between hits so an agent loop cannot turn into a crawl.
 */
import { env } from '$env/dynamic/private';

export const POSTS_DESIGN_ORIGIN = 'https://posts.design';

/**
 * Identified, and honest about what it is: a per-request lookup on behalf of one user, not a
 * crawler and not a training-set collector. An anonymous UA on a site that names AI crawlers in its
 * robots.txt would be the wrong way to arrive.
 */
export const POSTS_DESIGN_UA = `AnomaliaMotionReference/1.0 (+${env.CRAWLER_CONTACT_URL || 'https://anomalia.so'}; on-demand design reference lookup; no training, no storage)`;

/** Index TTL. The wall adds a handful of posts a day — an hour is fresh enough for a creative turn. */
const INDEX_TTL_MS = 60 * 60 * 1000;
/** Post pages never change once curated, so a process-lifetime cache is correct. */
const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;
/** Floor between outbound requests to the origin. Politeness, and a cap on any agent loop. */
export const MIN_REQUEST_INTERVAL_MS = 250;
const FETCH_TIMEOUT_MS = 12_000;
/** Pages are ~150–350KB of SSR markup; anything past this is not a post page. */
const MAX_HTML_BYTES = 3 * 1024 * 1024;

/** One entry of the wall, as the sitemap knows it — no page fetch behind this. */
export type PostsDesignIndexEntry = {
  /** Media stem — stable id, also the gallery's `data-item-id`. */
  id: string;
  /** Path segment of the reference page. */
  slug: string;
  /** Absolute reference page (attribution link). */
  url: string;
  platform: string;
  /** Dash-normalised handle out of the stem: `_` is lost, so never build a profile URL from it. */
  handleSlug: string | null;
  /** Original post id on the source platform. */
  externalId: string | null;
  /** Curation date (sitemap lastmod), YYYY-MM-DD. */
  capturedAt: string | null;
  /** Lowercased words from the slug — the only searchable text the index carries for free. */
  words: string;
};

/** A gallery card: same fields plus the taxonomy and whether the post is motion. */
export type PostsDesignCard = PostsDesignIndexEntry & {
  title: string | null;
  brand: string | null;
  handle: string | null;
  category: string | null;
  styleTags: string[];
  hasVideo: boolean;
};

/** What a post page adds: the copy, the original link, and the clip to watch. */
export type PostsDesignDetail = PostsDesignCard & {
  /** The post's own words, as posts.design transcribed them. */
  text: string | null;
  /** Original post on the source platform — the attribution that must travel with the spec. */
  sourceUrl: string | null;
  /** Absolute clip URL. Fetched once, watched, dropped. Never returned to the model. */
  videoUrl: string | null;
  /** Absolute still URL. Same rule. */
  imageUrl: string | null;
};

/** Off switch. The wall is a third-party site; one env var takes the whole feature out. */
export function isPostsDesignEnabled(): boolean {
  return env.FEATURE_MOTION_REFERENCE_WALL !== 'false';
}

const STEM_RE = /^([a-z0-9]+(?:-[a-z0-9]+)?)-(.+?)-(\d{8,25})-(.+)$/;

/** Split a media stem into platform / handle / post id / words. Null when it is not one. */
export function parseStem(
  stem: string
): { platform: string; handleSlug: string; externalId: string; words: string } | null {
  const m = STEM_RE.exec(stem.trim());
  if (!m) return null;
  return { platform: m[1], handleSlug: m[2], externalId: m[3], words: m[4].replace(/-/g, ' ') };
}

/** Trailing `-YYYY-MM-DD` on a reference slug is the post's publish date. */
export function publishedAtFromSlug(slug: string): string | null {
  const m = /-(\d{4}-\d{2}-\d{2})$/.exec(slug);
  return m ? m[1] : null;
}

function absolute(path: string): string {
  return path.startsWith('http') ? path : `${POSTS_DESIGN_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!--\s*-->/g, '')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The full wall out of `sitemap.xml`.
 *
 * Only the URL blocks that carry an `<image:image>` are posts — the rest are `/about`, `/trends`
 * and the brand pages. The image loc is where the stem lives, which is why the index knows the
 * handle and the original post id without ever opening a page.
 */
export function parseSitemap(xml: string): PostsDesignIndexEntry[] {
  const out: PostsDesignIndexEntry[] = [];
  const seen = new Set<string>();
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1]?.trim();
    const image = /<image:loc>([^<]+)<\/image:loc>/.exec(block)?.[1]?.trim();
    if (!loc || !image) continue;
    const slug = loc.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '');
    if (!slug || slug.includes('/')) continue;
    const stem = image.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') ?? '';
    if (!stem || seen.has(stem)) continue;
    seen.add(stem);
    const parts = parseStem(stem);
    out.push({
      id: stem,
      slug,
      url: `${POSTS_DESIGN_ORIGIN}/${slug}`,
      platform: parts?.platform ?? 'unknown',
      handleSlug: parts?.handleSlug ?? null,
      externalId: parts?.externalId ?? null,
      capturedAt: /<lastmod>([^<]+)<\/lastmod>/.exec(block)?.[1]?.trim() ?? null,
      words: (parts?.words ?? slug.replace(/-/g, ' ')).toLowerCase()
    });
  }
  return out;
}

/**
 * Gallery cards out of any page that renders the wall.
 *
 * The taxonomy is in the `sr-only` figcaption the site ships for screen readers —
 * `Title · Brand · @handle · Category · Style Tag. Captured YYYY-MM-DD.` — which is both the
 * cleanest and the most stable place to read it from. `data-video-placeholder` is how a motion post
 * announces itself without a page fetch.
 */
export function parseGalleryCards(html: string): PostsDesignCard[] {
  const out: PostsDesignCard[] = [];
  const articles = html.split('data-item-id="').slice(1);
  for (const chunk of articles) {
    const id = chunk.slice(0, chunk.indexOf('"'));
    if (!id) continue;
    // `split` already ends each chunk at the next card, so a caption is never read off a neighbour.
    const body = chunk;
    const href = /href="\/([a-z0-9-]+)"/i.exec(body)?.[1] ?? null;
    const caption = /<figcaption class="sr-only">([\s\S]*?)<\/figcaption>/.exec(body)?.[1] ?? '';
    const parts = decodeEntities(caption)
      .replace(/\.\s*Captured[\s\S]*$/i, '')
      .split('·')
      .map((p) => p.trim())
      .filter(Boolean);
    const captured = /Captured\s*(\d{4}-\d{2}-\d{2})/.exec(decodeEntities(caption))?.[1] ?? null;
    const stem = parseStem(id);
    const handle = parts.find((p) => p.startsWith('@'))?.slice(1) ?? null;
    const tail = parts.filter((p) => !p.startsWith('@')).slice(1);
    out.push({
      id,
      slug: href ?? id,
      url: `${POSTS_DESIGN_ORIGIN}/${href ?? id}`,
      platform: stem?.platform ?? 'unknown',
      handleSlug: stem?.handleSlug ?? null,
      externalId: stem?.externalId ?? null,
      capturedAt: captured,
      words: (stem?.words ?? '').toLowerCase(),
      title: parts[0] ?? null,
      brand: tail[0] ?? null,
      handle,
      category: tail[1]?.toLowerCase() ?? null,
      styleTags: tail
        .slice(2)
        .flatMap((t) => t.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
      hasVideo: /data-video-placeholder="true"/.test(body)
    });
  }
  return out;
}

const DESCRIPTION_RE = /How (.+?) designed its (.+?) post: (.+?)\.\s*([\s\S]*)$/;

/**
 * A post page.
 *
 * `meta description` is generated from the curator's own fields — "How Cerebras designed its
 * product update post: announcement card, minimal. The Fastest AI Just Got Faster." — so one regex
 * yields brand, category, style tags and the post copy. The original link is the first
 * `status/<id>` on the page; the clip is the `-detail.mp4` for THIS stem (the page also renders
 * similar posts, and matching on the stem is what keeps their clips out of this record).
 */
export function parseDetail(html: string, entry: PostsDesignIndexEntry): PostsDesignDetail {
  const meta = (name: string, attr: 'name' | 'property' = 'name') =>
    decodeEntities(
      new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html)?.[1] ?? ''
    ) || null;

  const description = meta('description');
  const d = description ? DESCRIPTION_RE.exec(description) : null;
  const title = (meta('og:title', 'property') ?? '').replace(/\s*-\s*posts\.design\s*$/i, '').trim() || null;

  const source = new RegExp(`https://(?:x|twitter)\\.com/([A-Za-z0-9_]+)/status/${entry.externalId ?? '\\d+'}`).exec(
    html
  );

  const clip = [`/media/posts/${entry.id}-detail.mp4`, `/media/posts/${entry.id}.mp4`].find((p) =>
    html.includes(p)
  );
  const still = [`/images/posts/${entry.id}.webp`, `/images/posts/${entry.id}.png`].find((p) => html.includes(p));

  // The page quotes the post in full; the meta description truncates it. Prefer the quote.
  const quoted = decodeEntities(
    /What the post said<\/figcaption>\s*<blockquote[^>]*>([\s\S]*?)<\/blockquote>/.exec(html)?.[1] ?? ''
  );

  return {
    ...entry,
    title,
    brand: d?.[1]?.trim() ?? null,
    handle: source?.[1] ?? null,
    category: d?.[2]?.trim().toLowerCase() ?? null,
    styleTags: (d?.[3] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    text: quoted || d?.[4]?.trim() || null,
    sourceUrl: source?.[0] ?? null,
    videoUrl: clip ? absolute(clip) : null,
    imageUrl: still ? absolute(still) : null,
    hasVideo: !!clip
  };
}

/** Words a query contributes, minus the noise that matches everything. */
const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'on', 'with', 'di', 'il', 'la', 'un', 'una',
  'per', 'che', 'con', 'video', 'post', 'motion', 'design', 'style', 'like'
]);

export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9@\s]/g, ' ')
        .split(/\s+/)
        .map((t) => t.replace(/^@/, ''))
        .filter((t) => t.length > 2 && !STOP.has(t))
    )
  ].slice(0, 12);
}

/**
 * Rank the index against a brief.
 *
 * Deliberately lexical and deliberately weak: the index only knows a post's own words and who
 * posted it. A brief is a creative sentence, not a search query, so an empty or unmatched query
 * must still return the freshest slice of the wall rather than nothing — the agent's next move is
 * to WATCH candidates, and it can only do that if it is handed some.
 */
/** Everything an entry knows about itself, flattened for a lexical match. */
function haystack(entry: PostsDesignIndexEntry | PostsDesignCard): string {
  const card = entry as Partial<PostsDesignCard>;
  return [
    entry.words,
    entry.handleSlug ?? '',
    card.brand ?? '',
    card.title ?? '',
    card.category ?? '',
    (card.styleTags ?? []).join(' ')
  ]
    .join(' ')
    .toLowerCase();
}

export function rankIndex<T extends PostsDesignIndexEntry>(
  entries: T[],
  query: string,
  limit = 8
): T[] {
  const terms = queryTerms(query);
  const recency = (e: T) => (e.capturedAt ? Date.parse(e.capturedAt) || 0 : 0);
  const scored = entries.map((e) => {
    const hay = haystack(e);
    let score = 0;
    for (const t of terms) {
      if (hay.includes(t)) score += hay.includes(` ${t} `) || hay.startsWith(`${t} `) ? 2 : 1;
    }
    return { e, score };
  });
  const ordered = scored
    .sort((a, b) => b.score - a.score || recency(b.e) - recency(a.e))
    .map((s) => s.e);
  const take = Math.max(1, limit);

  // ZERO OVUNQUE NON VUOL DIRE "QUESTI SONO I MIGLIORI", VUOL DIRE "NON LO SO".
  //
  // Il match è lessicale sulle parole inglesi dei post. Un brief scritto in italiano — o
  // semplicemente in parole diverse da quelle del muro — non tocca NIENTE: ogni entry sta a zero,
  // l'unico criterio che resta è la data, e ogni brief riceve la stessa identica cima. È così che
  // l'agente finiva per studiare sempre lo stesso video: non perché fosse il più adatto, ma perché
  // era il più recente e nessun brief riusciva a spostarlo.
  //
  // Quando non sappiamo, si ruota sul brief invece di fingere una classifica: deterministico (lo
  // stesso brief rivede gli stessi riferimenti), ma briefs diversi partono da punti diversi del
  // muro. Il muro è curato per intero, quindi qualunque finestra è una finestra di riferimenti
  // buoni — la freschezza vale meno della varietà quando il punteggio non dice niente.
  if (ordered.length > take && scored.every((s) => s.score === 0)) {
    const offset = fingerprint(query) % ordered.length;
    return [...ordered.slice(offset), ...ordered.slice(0, offset)].slice(0, take);
  }
  return ordered.slice(0, take);
}

/** Numero stabile da una stringa. Serve solo a scegliere un punto di partenza, non è un hash. */
function fingerprint(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

/** Merge the gallery's taxonomy into the sitemap index — same post, richer record. */
export function mergeCards(
  index: PostsDesignIndexEntry[],
  cards: PostsDesignCard[]
): Array<PostsDesignIndexEntry | PostsDesignCard> {
  const byId = new Map<string, PostsDesignCard>(cards.map((c) => [c.id, c]));
  const merged: Array<PostsDesignIndexEntry | PostsDesignCard> = index.map((e) => {
    const card = byId.get(e.id);
    if (!card) return e;
    byId.delete(e.id);
    return { ...e, ...card, capturedAt: card.capturedAt ?? e.capturedAt };
  });
  // A card the sitemap has not caught up with yet is still a valid reference.
  return [...byId.values(), ...merged];
}

// ── network ────────────────────────────────────────────────────────────────────────────────────

let lastRequestAt = 0;
const indexCache: { at: number; entries: Array<PostsDesignIndexEntry | PostsDesignCard> } = {
  at: 0,
  entries: []
};
const detailCache = new Map<string, { at: number; detail: PostsDesignDetail }>();

async function politeGet(path: string): Promise<string | null> {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  try {
    const res = await fetch(absolute(path), {
      headers: { 'user-agent': POSTS_DESIGN_UA, accept: 'text/html,application/xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!res.ok) {
      console.warn(`[posts-design] ${res.status} on ${path}`);
      return null;
    }
    const body = await res.text();
    return body.length > MAX_HTML_BYTES ? body.slice(0, MAX_HTML_BYTES) : body;
  } catch (e) {
    console.warn(`[posts-design] fetch failed ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * The wall: every curated post from the sitemap, with the latest two dozen enriched by the gallery.
 * One TTL-cached pair of requests serves every lookup in the process.
 */
export async function loadPostsDesignIndex(): Promise<Array<PostsDesignIndexEntry | PostsDesignCard>> {
  if (indexCache.entries.length && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.entries;
  const [xml, home] = await Promise.all([politeGet('/sitemap.xml'), politeGet('/')]);
  const index = xml ? parseSitemap(xml) : [];
  const cards = home ? parseGalleryCards(home) : [];
  const entries = index.length || cards.length ? mergeCards(index, cards) : [];
  if (!entries.length) return indexCache.entries;
  indexCache.at = Date.now();
  indexCache.entries = entries;
  return entries;
}

/** One post page, cached for the process. */
export async function loadPostsDesignDetail(
  entry: PostsDesignIndexEntry
): Promise<PostsDesignDetail | null> {
  const hit = detailCache.get(entry.id);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.detail;
  const html = await politeGet(`/${entry.slug}`);
  if (!html) return null;
  const detail = parseDetail(html, entry);
  detailCache.set(entry.id, { at: Date.now(), detail });
  return detail;
}

