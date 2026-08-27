// Internal linking autopilot: append "See also" links between a brand's own published articles
// (interlinking, a ranking signal Google rewards — related articles reinforce the topic cluster).
// Runs weekly via /api/v1/seo/links/tick and on publish-due (blog-generate.ts). Pure-text appends
// at the END of body_md (never inside the prose), so there is zero risk of breaking the markdown;
// the brand_internal_links table is the dedup ledger. Brands with an external CMS (Shopify/Webflow/
// Wix) pick the updated body up at the next publish-due sync — we never push to the CMS here.
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tokenize, tokenOverlap, suggestAnchor, publicArticleUrl } from './backlink-network';
import { resolveSitePagePublicUrl } from './site-pages';
import { hasWebHub } from '$lib/plans';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export const DEFAULT_MAX_LINKS = 3;

/** The exact block appended to body_md (spec: append in coda, never inside the text). */
export function seeAlsoBlock(anchor: string, url: string): string {
  return `\n\n> See also: [${anchor}](${url})`;
}

/** Pure: anchor from the target title (reuses backlink-network.suggestAnchor), capped ~60 chars. */
export function anchorFor(target: { title?: string }, _keywordStrategy?: unknown): string {
  const anchor = suggestAnchor(String(target.title ?? ''))
    .slice(0, 60)
    .trim();
  return anchor || 'this guide';
}

/** Pure: 0–100 overlap of two topic lists (Jaccard on token sets). */
export function topicOverlapScore(a: string[], b: string[]): number {
  const ta = tokenize(a.join(' '));
  const tb = tokenize(b.join(' '));
  return Math.round(tokenOverlap(ta, tb) * 100);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
}

// Cheap read of the cached keyword strategy (never regenerates — the tick must not spend AI).
async function cachedKeywordTerms(admin: SupabaseClient, brandId: string): Promise<string[]> {
  const { data } = await admin
    .from('brand_seo_keyword_strategy')
    .select('strategy')
    .eq('brand_id', brandId)
    .maybeSingle();
  const keywords = (((data?.strategy as AnyRec | null)?.keywords as AnyRec[] | null) ?? []) as AnyRec[];
  return keywords
    .map((k) => String(k.keyword ?? ''))
    .filter(Boolean)
    .slice(0, 12);
}

// Topics for one article, in order of trust:
// 1. its own tags (brand_article_tags → blog_tags),
// 2. the topics of the brand's indexed pages (brand_pages) on the same host (site/website),
// 3. the brand's cached keyword strategy terms.
async function resolveSourceTopics(admin: SupabaseClient, brandId: string, articleId: string): Promise<string[]> {
  const { data: tags } = await admin
    .from('brand_article_tags')
    .select('blog_tags(name)')
    .eq('article_id', articleId);
  const names = (tags ?? []).map((r) => (r.blog_tags as AnyRec | null)?.name).filter(Boolean) as string[];
  if (names.length) return names;

  const [{ data: brandRow }, { data: pages }, { data: sites }] = await Promise.all([
    admin.from('brands').select('website').eq('id', brandId).maybeSingle(),
    admin.from('brand_pages').select('url, topics').eq('brand_id', brandId).eq('active', true).limit(100),
    admin.from('brand_sites').select('host').eq('brand_id', brandId).eq('verified', true)
  ]);
  const hosts = new Set<string>();
  if (brandRow?.website) hosts.add(hostnameOf(String(brandRow.website)));
  for (const s of sites ?? []) if (s.host) hosts.add(hostnameOf(String(s.host)));

  const topics = new Set<string>();
  for (const p of pages ?? []) {
    if (!Array.isArray(p.topics)) continue;
    if (hosts.size && !hosts.has(hostnameOf(String(p.url ?? '')))) continue;
    for (const t of p.topics as string[]) if (t) topics.add(String(t));
  }
  if (topics.size) return [...topics];

  return cachedKeywordTerms(admin, brandId);
}

export type RelatedArticle = { id: string; title: string; slug: string | null; score: number };

/**
 * Rank other published articles of the brand by topic overlap with the source article.
 * `candidates` is optional: when omitted (or empty) the published siblings are loaded here.
 * Returns only the ones with real overlap, best first, capped at `maxLinks`.
 */
export async function findRelatedArticles(
  admin: SupabaseClient,
  brandId: string,
  article: { id: string; title?: string },
  candidates?: Array<{ id: string; title?: string; slug?: string | null }>,
  opts: { maxLinks?: number } = {}
): Promise<RelatedArticle[]> {
  const maxLinks = Math.max(1, opts.maxLinks ?? DEFAULT_MAX_LINKS);
  const sourceTopics = await resolveSourceTopics(admin, brandId, article.id);

  let cands = candidates ?? [];
  if (!cands.length) {
    const { data } = await admin
      .from('brand_articles')
      .select('id, title, slug')
      .eq('brand_id', brandId)
      .eq('status', 'published')
      .neq('id', article.id)
      .order('published_at', { ascending: false })
      .limit(50);
    cands = data ?? [];
  }
  if (!sourceTopics.length || !cands.length) return [];

  const ids = cands.map((c) => c.id);
  const { data: tagRows } = await admin
    .from('brand_article_tags')
    .select('article_id, blog_tags(name)')
    .in('article_id', ids);
  const topicsByArticle = new Map<string, string[]>();
  for (const r of tagRows ?? []) {
    const name = (r.blog_tags as AnyRec | null)?.name;
    if (!name) continue;
    const list = topicsByArticle.get(r.article_id) ?? [];
    list.push(String(name));
    topicsByArticle.set(r.article_id, list);
  }

  const sourceTokens = tokenize(sourceTopics.join(' '));
  return cands
    .map((c) => {
      const targetTopics = topicsByArticle.get(c.id) ?? [];
      // No tags on the target → fall back to its title as the topic bag.
      const targetTokens = targetTopics.length ? tokenize(targetTopics.join(' ')) : tokenize(String(c.title ?? ''));
      const score = Math.round(tokenOverlap(sourceTokens, targetTokens) * 100);
      return { id: c.id, title: String(c.title ?? ''), slug: c.slug ?? null, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, maxLinks);
}

async function hasCmsIntegration(admin: SupabaseClient, brandId: string): Promise<boolean> {
  const { data } = await admin
    .from('blog_integrations')
    .select('id')
    .eq('brand_id', brandId)
    .in('platform', ['shopify', 'webflow', 'wix'])
    .neq('active', false)
    .limit(1);
  return !!data?.length;
}

type RelatedSitePage = { id: string; slug: string; title: string; score: number };

/**
 * Landing pages (/p/ — landing_page/comparison/glossary/programmatic, published) related to the
 * source article's topics, ranked by token overlap against topics + target_query + title.
 */
export async function findRelatedSitePages(
  admin: SupabaseClient,
  brandId: string,
  articleId: string,
  opts: { maxLinks?: number } = {}
): Promise<RelatedSitePage[]> {
  const maxLinks = Math.max(1, opts.maxLinks ?? 2);
  const sourceTopics = await resolveSourceTopics(admin, brandId, articleId);
  if (!sourceTopics.length) return [];

  const { data: pages } = await admin
    .from('brand_site_pages')
    .select('id, slug, title, kind, target_query, status')
    .eq('brand_id', brandId)
    .eq('status', 'published')
    .in('kind', ['landing_page', 'comparison', 'glossary', 'programmatic'])
    .order('created_at', { ascending: false })
    .limit(50);
  const sourceTokens = tokenize(sourceTopics.join(' '));
  return (pages ?? [])
    .map((p) => {
      const bag = [String(p.title ?? ''), String(p.target_query ?? '')].join(' ');
      const score = Math.round(tokenOverlap(sourceTokens, tokenize(bag)) * 100);
      return { id: p.id, slug: String(p.slug ?? ''), title: String(p.title ?? ''), score };
    })
    .filter((r) => r.score > 0 && r.slug)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, maxLinks);
}

/**
 * Append "See also" links for the top related articles to one article's body_md (in coda, never
 * inside the prose), and record each pair in brand_internal_links (unique per pair = dedup).
 * Returns how many links were added. Best-effort: any failure on a candidate just skips it.
 */
export async function applyInternalLinks(
  admin: SupabaseClient,
  brandId: string,
  articleId: string,
  opts: { maxLinks?: number } = {}
): Promise<number> {
  const { data: article } = await admin
    .from('brand_articles')
    .select('id, title, slug, body_md')
    .eq('id', articleId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!article?.body_md) return 0;

  const { data: linkedRows } = await admin
    .from('brand_internal_links')
    .select('target_article_id')
    .eq('source_article_id', articleId);
  const linked = new Set((linkedRows ?? []).map((r) => r.target_article_id));

  const related = await findRelatedArticles(admin, brandId, article, undefined, opts);
  let body = String(article.body_md);
  let added = 0;
  for (const rel of related) {
    if (linked.has(rel.id)) continue;
    const url = await publicArticleUrl(admin, brandId, rel.slug ?? rel.id);
    if (!url) continue;
    if (body.includes(url)) continue; // the writer already linked this page inline → never double-link
    const anchor = anchorFor({ title: rel.title });
    // Insert FIRST: unique(source,target) is the lock. Appending the body first let two concurrent
    // runs both write the "See also" block and only one lose the insert → duplicated block.
    const { error: insErr } = await admin
      .from('brand_internal_links')
      .insert({
        brand_id: brandId,
        source_article_id: articleId,
        target_article_id: rel.id,
        anchor_text: anchor
      })
      .select('id')
      .maybeSingle();
    if (insErr) continue; // a concurrent run already claimed this pair
    const { error } = await admin
      .from('brand_articles')
      .update({ body_md: body.trimEnd() + seeAlsoBlock(anchor, url), updated_at: new Date().toISOString() })
      .eq('id', articleId);
    if (error) continue;
    body = body.trimEnd() + seeAlsoBlock(anchor, url); // keep the in-memory copy in sync → no double append
    added++;
  }

  // External CMS note: the updated body reaches Shopify/Webflow/Wix at the next publish-due
  // sync (cms-sync). We deliberately do NOT push to the CMS from here.
  if (added && (await hasCmsIntegration(admin, brandId))) {
    console.info(
      `[internal-links] brand=${brandId} article=${articleId} added ${added} links; ` +
        'external CMS will pick the updated body up at the next publish-due sync'
    );
  }

  // Landing pages as targets: at most 2 "See also" links to related /p/ pages. Each source may
  // link at most ONE landing page (partial unique index) — the first match claims the slot.
  const { data: existingPageLink } = await admin
    .from('brand_internal_links')
    .select('id')
    .eq('source_article_id', articleId)
    .not('target_site_page_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (!existingPageLink) {
    const sitePages = await findRelatedSitePages(admin, brandId, articleId, { maxLinks: 2 });
    for (const pg of sitePages) {
      const url = await resolveSitePagePublicUrl(admin, brandId, pg.slug);
      if (!url) continue;
      if (body.includes(url)) continue;
      const anchor = anchorFor({ title: pg.title });
      const { error: insErr } = await admin
        .from('brand_internal_links')
        .insert({
          brand_id: brandId,
          source_article_id: articleId,
          target_site_page_id: pg.id,
          anchor_text: anchor
        })
        .select('id')
        .maybeSingle();
      if (insErr) continue; // another run claimed the landing slot
      const { error } = await admin
        .from('brand_articles')
        .update({ body_md: body.trimEnd() + seeAlsoBlock(anchor, url), updated_at: new Date().toISOString() })
        .eq('id', articleId);
      if (error) continue;
      body = body.trimEnd() + seeAlsoBlock(anchor, url);
      added++;
      break; // one landing per source
    }
  }
  return added;
}

/**
 * Cron entry point: for the least-recently-linked active brands with the web hub, take the most recent published
 * articles that have NO recorded internal links yet and apply the linking pass. `maxArticles`
 * caps how many articles are processed per run (default 20); `brandSlug` scopes to one brand.
 */
export async function runInternalLinkingTick(
  admin: SupabaseClient,
  opts: { maxArticles?: number; brandSlug?: string } = {}
): Promise<{ articles: number; links: number }> {
  const maxArticles = Math.max(1, opts.maxArticles ?? 20);
  let q = admin.from('brands').select('id, slug, plan').eq('status', 'active');
  if (opts.brandSlug) q = q.eq('slug', opts.brandSlug);
  const { data: brands } = await q;

  // Rotation: least-recently-linked brands first. The ledger's added_at IS the cursor (every
  // processed article writes a row, links or not) — no extra column, no migration. Without it the
  // first brand took all `maxArticles` slots every run and the rest were never processed.
  const { data: recentLinks } = await admin
    .from('brand_internal_links')
    .select('brand_id, added_at')
    .order('added_at', { ascending: false })
    .limit(500);
  const lastLinkedAt = new Map<string, string>();
  for (const r of recentLinks ?? []) {
    if (!lastLinkedAt.has(r.brand_id)) lastLinkedAt.set(r.brand_id, String(r.added_at));
  }
  const eligible = (brands ?? [])
    .filter((b) => hasWebHub(b.plan))
    // '' (never processed) sorts first.
    .sort((a, b) => (lastLinkedAt.get(a.id) ?? '').localeCompare(lastLinkedAt.get(b.id) ?? ''))
    .slice(0, maxArticles);
  const perBrand = Math.max(1, Math.floor(maxArticles / Math.max(1, eligible.length)));

  const queue: Array<{ brandId: string; articleId: string }> = [];
  for (const brand of eligible) {
    const { data: arts } = await admin
      .from('brand_articles')
      .select('id')
      .eq('brand_id', brand.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(maxArticles);
    const ids = (arts ?? []).map((a) => a.id);
    if (!ids.length) continue;
    // NOT EXISTS on brand_internal_links: skip articles that already have at least one link.
    const { data: linkedRows } = await admin
      .from('brand_internal_links')
      .select('source_article_id')
      .eq('brand_id', brand.id)
      .in('source_article_id', ids);
    const linked = new Set((linkedRows ?? []).map((r) => r.source_article_id));
    let taken = 0;
    for (const a of arts ?? []) {
      if (linked.has(a.id)) continue;
      queue.push({ brandId: brand.id, articleId: a.id });
      if (++taken >= perBrand) break; // per-brand share, so one brand can't eat the whole run
      if (queue.length >= maxArticles) break;
    }
    if (queue.length >= maxArticles) break;
  }

  let articles = 0;
  let links = 0;
  for (const item of queue.slice(0, maxArticles)) {
    const n = await applyInternalLinks(admin, item.brandId, item.articleId).catch((error) => { swallow('apply internal links', error); return 0; });
    if (!n) {
      // No overlapping sibling to link (yet). Mark the article as processed with a self-row so it
      // stops re-occupying a slot every week; a real link never targets the source itself.
      await admin
        .from('brand_internal_links')
        .insert({
          brand_id: item.brandId,
          source_article_id: item.articleId,
          target_article_id: item.articleId,
          anchor_text: ''
        })
        .select('id')
        .maybeSingle();
    }
    articles++;
    links += n;
  }
  return { articles, links };
}
