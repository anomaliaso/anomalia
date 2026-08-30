/**
 * The public read layer: the ONLY thing the two public pages are allowed to see.
 *
 * `market_posts` is an internal instrument with fifty columns on it — watch-time probabilities,
 * confounders, baseline provenance, the query that found the row. A page that selected `*` and
 * spread it into its props would publish all of that the day someone adds a column, and nobody would
 * notice. So the pages never touch the table: they call these functions, which select named columns
 * and return a `WallCard` built field by field. Adding a column to `market_posts` cannot leak
 * through here — it has to be added to the projection on purpose.
 *
 * THREE GATES, and every public query passes all three:
 *   1. `wall_state <> 'hidden'`   — the takedown switch, one UPDATE away, beats everything.
 *   2. `design_publishable`        — the automatic safety verdict (see design-judge.ts).
 *   3. a poster exists             — there is something to show.
 * `forced` bypasses only the SCORE, never 1 or 2: a manual pin is a taste override, not a licence.
 *
 * WHAT WE PUBLISH, AND WHAT WE DO NOT. A card carries our own derivative of the media, the author's
 * handle, a truncated caption, a link to the original post, and our own commentary. That is the
 * shape of every curated gallery on the web, and the link out is the point rather than a courtesy —
 * the wall exists to send people to the work. Nothing is re-hosted at full size, nothing is passed
 * off as ours, and `wall_state = 'hidden'` removes a row from every surface immediately.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { DEFAULT_LOCALE, type Locale } from '$lib/i18n/locale';
import { minDesignScore } from '$lib/server/design-judge';
import { DESIGN_TAGS, type DesignAxis, type DesignTag, type WallCard } from '$lib/wall';
import { wallPublicUrl } from '$lib/server/wall-media';

export type { WallCard };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** A post has to beat its own account by this much before it is "trending" in public. */
export const TRENDING_MIN_OUTPERFORMANCE = 1.6;
/**
 * How far back the trending page looks.
 *
 * A gallery of what is working NOW is the entire promise of that page; a two-month-old winner is a
 * case study, and belongs on the design wall if it belongs anywhere.
 */
export const TRENDING_WINDOW_DAYS = 30;

export const PAGE_SIZE = 36;

/**
 * How many cards one account may hold on the design wall.
 *
 * Without this the wall is a ranking of accounts, not of work: the first seven cards it ever showed
 * were four from `nothing` and two from `pentagramdesign`, which reads as a fan page rather than a
 * survey. A prolific account with a consistent house style will out-rank a one-off brilliant piece
 * every time, and a wall that lets it is answering "who posts a lot of good work" when the visitor
 * asked "what is the best work".
 *
 * Two, not one: a studio that made two genuinely different things deserves both, and a cap of one
 * would throw away the second-best piece on the wall to avoid a repeated name.
 */
export const MAX_CARDS_PER_ACCOUNT = 2;

/**
 * How deep the thinning looks before it gives up.
 *
 * The cap is applied in memory, which means the query has to fetch past the rows it will drop. This
 * is the bound on that — generous, because the design wall is hundreds of rows and not millions,
 * and honest, because past it the cap silently stops applying.
 */
export const MAX_WALL_SCAN = 600;
/** Hard ceiling on a page request — the query string is public input. */
export const MAX_PAGE_SIZE = 60;

/** Named columns, once. Every public query selects exactly this. */
const CARD_COLUMNS = [
  'wall_slug',
  'platform',
  'account_key',
  'url',
  'content',
  'published_at',
  'poster_path',
  'preview_path',
  'design_note',
  'design_score',
  'design_scores',
  'design_tags',
  'outperformance',
  'views',
  'engagement',
  'category',
  'content_form'
].join(', ');

/** Captions run long and a card shows two lines of one. Full text is a click away, on the original. */
const CAPTION_MAX = 280;

export function truncateCaption(raw: string | null | undefined, max = CAPTION_MAX): string | null {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length <= max) return s;
  // Cut on a word boundary when one is close enough that the sentence still reads.
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

/**
 * Pick the note for the visitor's language, falling back to English.
 *
 * Silent fallback is right here: a row judged under an older rubric may only carry `en`, and an
 * English sentence is better than an empty slot on the card.
 */
export function noteFor(raw: unknown, locale: Locale): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  const value = n[locale] ?? n[DEFAULT_LOCALE];
  const s = String(value ?? '').trim();
  return s || null;
}

/** Row → card. The whitelist in code form: anything not named here cannot reach a page. */
export function toCard(row: AnyRec, locale: Locale, supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL): WallCard | null {
  const slug = String(row.wall_slug ?? '');
  const poster = String(row.poster_path ?? '');
  const sourceUrl = String(row.url ?? '');
  // No slug, no poster or no link out and the card is not renderable — drop it rather than emit a
  // half-card the page then has to defend against.
  if (!slug || !poster || !sourceUrl) return null;

  const tags = Array.isArray(row.design_tags)
    ? (row.design_tags as unknown[])
        .map(String)
        .filter((t): t is DesignTag => (DESIGN_TAGS as readonly string[]).includes(t))
    : [];

  return {
    slug,
    platform: String(row.platform ?? ''),
    account: row.account_key ? String(row.account_key) : null,
    sourceUrl,
    caption: truncateCaption(row.content),
    publishedAt: row.published_at ? String(row.published_at) : null,
    posterUrl: wallPublicUrl(supabaseUrl, poster),
    previewUrl: row.preview_path ? wallPublicUrl(supabaseUrl, String(row.preview_path)) : null,
    note: noteFor(row.design_note, locale),
    designScore: row.design_score == null ? null : Number(row.design_score),
    designScores: (row.design_scores as Record<DesignAxis, number> | null) ?? null,
    tags,
    outperformance: row.outperformance == null ? null : Number(row.outperformance),
    views: row.views == null ? null : Number(row.views),
    engagement: row.engagement == null ? null : Number(row.engagement),
    category: row.category ? String(row.category) : null,
    contentForm: row.content_form ? String(row.content_form) : null
  };
}

const clampSize = (n: number | undefined): number =>
  Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(n) || PAGE_SIZE)));

export type WallQuery = {
  locale?: Locale;
  platform?: string | null;
  tag?: string | null;
  category?: string | null;
  limit?: number;
  offset?: number;
};

export type WallPage = {
  cards: WallCard[];
  /** True when another page exists — the pages paginate rather than dumping the bank. */
  hasMore: boolean;
};

/**
 * The design wall: everything the judge called design, cleared, and scored past the bar — plus the
 * rows pinned by hand.
 *
 * Ordered by score and then by recency. Score first because this page is a ranking and its top row
 * is a claim; recency second so a tie does not freeze the wall in whatever order Postgres felt like.
 *
 * THE BAR IS ENFORCED HERE, AND THAT IS THE WHOLE POINT. The first version of this query did not
 * mention `design_score` at all, on the assumption that a row only ever gets a `wall_slug` if it
 * cleared the bar. That assumption was false and the page proved it: a slug means "this row belongs
 * on AT LEAST ONE of the two walls", and the trending wall's bar is outperformance, not beauty. So
 * every trending post that happened to be `is_design` — a motivational quote over a stock brick
 * wall, scored 38 by a judge that got it exactly right — was listed on the design wall underneath
 * the Pentagram covers. 18 cards on the page, 7 above the bar, the worst at 38.
 *
 * A slug is an IDENTITY. Membership of a wall is a question each wall answers for itself, at read
 * time, against the threshold in force today — which is also why `minDesignScore()` is read here and
 * not baked into the row: lowering the bar has to fill the wall without a re-publish.
 */
export async function listDesignWall(admin: SupabaseClient, q: WallQuery = {}): Promise<WallPage> {
  const locale = q.locale ?? DEFAULT_LOCALE;
  const limit = clampSize(q.limit);
  const offset = Math.max(0, Math.floor(Number(q.offset) || 0));

  let query = admin
    .from('market_posts')
    .select(CARD_COLUMNS)
    .eq('design_publishable', true)
    .neq('wall_state', 'hidden')
    .not('wall_slug', 'is', null)
    .not('poster_path', 'is', null)
    .eq('is_design', true)
    .gte('design_score', minDesignScore());

  if (q.platform) query = query.eq('platform', q.platform);
  if (q.tag && (DESIGN_TAGS as readonly string[]).includes(q.tag)) query = query.contains('design_tags', [q.tag]);

  // The per-account cap is applied in memory, so the window has to be the whole wall rather than one
  // page: paginating first and thinning second would drop a different set on every page and leave
  // holes. Ordered once, thinned once, then sliced — so page 2 continues exactly where page 1 ended.
  const { data } = await query
    .order('design_score', { ascending: false })
    .order('wall_published_at', { ascending: false })
    .limit(MAX_WALL_SCAN);

  const thinned = capPerAccount((data ?? []) as AnyRec[]);
  const page = thinned.slice(offset, offset + limit);
  const cards = page.map((r) => toCard(r, locale)).filter((c): c is WallCard => !!c);
  return { cards, hasMore: thinned.length > offset + limit };
}

/**
 * Keep at most `MAX_CARDS_PER_ACCOUNT` rows per account, preserving order.
 *
 * Exported for the test, and separate from the query because it is a CURATION rule rather than a
 * filter: it does not decide whether a piece is good enough for the wall, it decides how much of the
 * wall one name is allowed to be.
 */
export function capPerAccount(rows: AnyRec[], max = MAX_CARDS_PER_ACCOUNT): AnyRec[] {
  const seen = new Map<string, number>();
  const out: AnyRec[] = [];
  for (const row of rows) {
    // No account key is not a licence to flood: those rows share one bucket rather than bypassing it.
    const key = `${row.platform ?? ''}:${row.account_key ?? '(unknown)'}`.toLowerCase();
    const n = seen.get(key) ?? 0;
    if (n >= max) continue;
    seen.set(key, n + 1);
    out.push(row);
  }
  return out;
}

/**
 * The trending wall: what beat its own account, recently.
 *
 * The ranking is `outperformance` and not likes, for the reason `market-metrics.ts` opens with — a
 * raw like count says more about an account's size than about the post. A million-follower account
 * doing its usual numbers is not news; a small account doing four times its median is.
 */
export async function listTrendingWall(admin: SupabaseClient, q: WallQuery = {}): Promise<WallPage> {
  const locale = q.locale ?? DEFAULT_LOCALE;
  const limit = clampSize(q.limit);
  const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
  const since = new Date(Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let query = admin
    .from('market_posts')
    .select(CARD_COLUMNS)
    .eq('design_publishable', true)
    .neq('wall_state', 'hidden')
    .not('wall_slug', 'is', null)
    .not('poster_path', 'is', null)
    .gte('outperformance', TRENDING_MIN_OUTPERFORMANCE)
    .gte('published_at', since);

  if (q.platform) query = query.eq('platform', q.platform);
  if (q.category) query = query.eq('category', q.category);

  const { data } = await query
    .order('outperformance', { ascending: false })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit);

  const rows = (data ?? []) as AnyRec[];
  const cards = rows.slice(0, limit).map((r) => toCard(r, locale)).filter((c): c is WallCard => !!c);
  return { cards, hasMore: rows.length > limit };
}

/** One card by its public slug, for the detail page. Same three gates as the lists. */
export async function getWallCard(
  admin: SupabaseClient,
  slug: string,
  locale: Locale = DEFAULT_LOCALE
): Promise<WallCard | null> {
  const clean = String(slug ?? '').trim().toLowerCase();
  if (!clean || !/^[a-z0-9-]{3,120}$/.test(clean)) return null;

  const { data } = await admin
    .from('market_posts')
    .select(CARD_COLUMNS)
    .eq('wall_slug', clean)
    .eq('design_publishable', true)
    .neq('wall_state', 'hidden')
    .maybeSingle();

  return data ? toCard(data as AnyRec, locale) : null;
}

/**
 * Every published design slug, for the sitemap. Slug + timestamp only — no card is built.
 *
 * Same bar as the wall itself, for the same reason and with a sharper consequence: without it the
 * sitemap hands a search engine the pages we would not show a visitor, and an index full of
 * score-38 cards is a slower thing to undo than a bad page.
 */
export async function listWallSlugs(
  admin: SupabaseClient,
  limit = 2000
): Promise<Array<{ slug: string; updatedAt: string | null }>> {
  const { data } = await admin
    .from('market_posts')
    .select('wall_slug, wall_published_at')
    .eq('design_publishable', true)
    .eq('is_design', true)
    .gte('design_score', minDesignScore())
    .neq('wall_state', 'hidden')
    .not('wall_slug', 'is', null)
    .order('wall_published_at', { ascending: false })
    .limit(limit);

  return ((data ?? []) as AnyRec[]).map((r) => ({
    slug: String(r.wall_slug),
    updatedAt: r.wall_published_at ? String(r.wall_published_at) : null
  }));
}

/** The tag counts the filter row renders. One query, grouped in memory — the bank is thousands, not millions. */
export async function designTagCounts(admin: SupabaseClient): Promise<Array<{ tag: DesignTag; count: number }>> {
  const { data } = await admin
    .from('market_posts')
    .select('design_tags')
    .eq('design_publishable', true)
    .eq('is_design', true)
    .gte('design_score', minDesignScore())
    .neq('wall_state', 'hidden')
    .not('wall_slug', 'is', null)
    .limit(5000);

  const counts = new Map<DesignTag, number>();
  for (const row of (data ?? []) as AnyRec[]) {
    for (const raw of Array.isArray(row.design_tags) ? row.design_tags : []) {
      const tag = String(raw);
      if ((DESIGN_TAGS as readonly string[]).includes(tag)) {
        counts.set(tag as DesignTag, (counts.get(tag as DesignTag) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}
