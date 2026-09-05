// Content Library — a persistent inventory of the brand's own site pages (blog posts, guides,
// resources), crawled from the sitemap and AI-enriched with topics + a relevance score. Its whole
// job: give the planner and radar REAL URLs to put in Reddit link posts, instead of the model
// guessing a link_url that may not exist. Usage is stamped via last_used_at so the same page isn't
// re-shared in a loop.
//
// Reuses the existing crawl primitives: fetchPage (SSRF-safe) + extractVisibleText from
// brand-analysis, and the same sha1 url_hash dedup as brand_news_items.
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { env as publicEnv } from '$env/dynamic/public';
import { fetchPage, extractVisibleText } from './brand-analysis';
import { aiStructured } from './ai-text';

// ponytail: one pass grabs the first N sitemap pages at ~2 req/s (N×delay must stay under the
// route's 120s maxDuration). A site with more pages than this just needs another scan — add
// last_scanned_at-based skipping to make repeated scans page through the remainder if it matters.
const MAX_PAGES_PER_SCAN = 80;
const FETCH_DELAY_MS = 500;         // polite ~2 req/sec to the brand's site
const BODY_CHARS = 8000;            // enough for enrichment, bounded storage
const PLANNER_PAGE_LIMIT = 12;      // how many pages we surface to the strategist
/** Monthly re-crawl window — cron runs daily but only rescans when stale. */
export const LIBRARY_FRESH_DAYS = 30;

type AnyRec = Record<string, unknown>;

const hashUrl = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 16);

// We DON'T guess each site's content taxonomy with an allowlist (that's how a /wiki/... or
// root-slug site indexes to zero). Instead: index everything from the sitemap EXCEPT the obvious
// non-content routes below, dedup translation copies, and let the AI relevance_score decide what's
// actually linkable — the planner only ever picks high-relevance pages.
const SKIP_PATH_RE = /\/(cart|checkout|account|login|sign-?in|sign-?up|register|password|privacy|terms|termini|cookie|legal|newsletter|contact|contatti|tags?|categor(?:y|ia)|author|autore|feed|rss|wp-|assets?|static|search|cerca|sitemap)(?:\/|$|\.)/i;
// A leading locale segment (/en, /es, /pt-br) — used to fold translation duplicates onto the canonical.
const LOCALE_PREFIX_RE = /^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i;

// Pure: pull <loc> URLs out of a sitemap (or sitemap index) XML body.
export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
}
const isXmlUrl = (u: string) => /\.xml(\?|$)/i.test(u);

// Pure: from all sitemap URLs, keep the linkable content pages — drop homepages/locale roots and
// non-content routes (SKIP_PATH_RE). To avoid a library flooded with the same articles in 4
// languages (many sites translate the slug too, so path-matching can't dedup them), keep only the
// site's DEFAULT locale (root, no locale prefix); fall back to everything only when the site keeps
// its primary content under a locale prefix (so the root set is too small to be the real content).
export function selectLinkableUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const kept: Array<{ url: string; localized: boolean }> = [];
  for (const url of urls) {
    let path: string;
    try { path = new URL(url).pathname.replace(/\/+$/, '') || '/'; } catch { continue; }
    if (path === '/') continue;                                   // homepage
    if (path.replace(LOCALE_PREFIX_RE, '') === '') continue;      // bare locale root (/en, /es)
    if (SKIP_PATH_RE.test(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    kept.push({ url, localized: LOCALE_PREFIX_RE.test(path) });
  }
  const rootOnly = kept.filter((k) => !k.localized);
  return (rootOnly.length >= 3 ? rootOnly : kept).map((k) => k.url);
}

// Extract page URLs from a site's sitemap. One level of nesting: if a <loc> points at another .xml
// sitemap we fetch it too. Bounded by MAX_PAGES_PER_SCAN upstream.
async function collectSitemapUrls(origin: string): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const roots = await fetchPage(`${origin}/sitemap.xml`).catch(() => '');

  const top = parseSitemapLocs(roots);
  const nested = top.filter(isXmlUrl).slice(0, 10);
  const pageUrls = top.filter((u) => !isXmlUrl(u));
  for (const sm of nested) {
    const xml = await fetchPage(sm).catch(() => '');
    pageUrls.push(...parseSitemapLocs(xml).filter((u) => !isXmlUrl(u)));
  }
  for (const u of pageUrls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function metaTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return (og || t || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}
function metaDescription(html: string): string {
  const d =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    '';
  return d.replace(/\s+/g, ' ').trim().slice(0, 400);
}

const ENRICH_SCHEMA = {
  type: 'object' as const,
  properties: {
    pages: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index: { type: 'integer' as const, description: 'The index of the page in the input list.' },
          topics: { type: 'array' as const, items: { type: 'string' as const }, description: '3-5 short topic tags.' },
          relevance: { type: 'integer' as const, description: '0-100: how useful this page is to link from the brand’s social posts, given its audience and strategy. Product/blog/guide pages that answer an audience question score high; legal/generic/thin pages score low.' }
        },
        required: ['index', 'topics', 'relevance']
      }
    }
  },
  required: ['pages']
};

// One batch AI call: classify every crawled page's topics + relevance vs the brand context.
async function enrichPages(
  brandContext: string,
  pages: Array<{ title: string; description: string; body_text: string }>
): Promise<Array<{ topics: string[]; relevance: number }>> {
  if (!pages.length) return [];
  const list = pages
    .map((p, i) => `${i}. ${p.title || '(untitled)'} — ${p.description || p.body_text.slice(0, 160)}`)
    .join('\n');
  const prompt = `Below are pages from a brand's own website. For EACH, extract 3-5 topic tags and score 0-100 how useful the page is to LINK from the brand's social posts (a page that answers the audience's real questions scores high; legal, thin, or generic pages score low).

BRAND CONTEXT:
${brandContext.slice(0, 1500)}

PAGES:
${list}`;
  try {
    const out = await aiStructured<{ pages?: Array<{ index?: number; topics?: string[]; relevance?: number }> }>(prompt, ENRICH_SCHEMA, 'You classify web pages precisely. Never invent pages not in the list.', 'return_page_enrichment'
    );
    const byIdx = new Map((out.pages ?? []).map((p) => [Number(p.index), p]));
    return pages.map((_, i) => {
      const e = byIdx.get(i);
      return {
        topics: Array.isArray(e?.topics) ? e!.topics!.map(String).slice(0, 5) : [],
        relevance: Math.max(0, Math.min(100, Number(e?.relevance) || 0))
      };
    });
  } catch {
    return pages.map(() => ({ topics: [], relevance: 0 }));
  }
}

/**
 * Crawl the brand's site from its sitemap, keep content pages, extract meta+text, AI-enrich, and
 * upsert into brand_pages. Incremental by nature: unchanged pages just get re-scored. Returns the
 * number of pages upserted.
 */
export async function crawlBrandSite(admin: SupabaseClient, brand: AnyRec): Promise<number> {
  const { data: kit } = await admin.from('brand_kit').select('source_url, ai_context, about').eq('brand_id', brand.id).maybeSingle();
  const siteUrl = String(kit?.source_url || (brand as AnyRec).website || '').trim();
  if (!siteUrl) return 0;
  let origin: string;
  try { origin = new URL(siteUrl).origin; } catch { return 0; }

  const all = await collectSitemapUrls(origin);
  const urls = selectLinkableUrls(all).slice(0, MAX_PAGES_PER_SCAN);
  if (!urls.length) return 0;

  const crawled: Array<{ url: string; title: string; description: string; body_text: string }> = [];
  for (const url of urls) {
    const html = await fetchPage(url).catch((error) => { swallow('fetch page', error); return ''; });
    if (!html) continue;
    const body_text = extractVisibleText(html, BODY_CHARS);
    if (body_text.length < 200) continue; // skip thin/empty pages
    crawled.push({ url, title: metaTitle(html), description: metaDescription(html), body_text });
    await new Promise((r) => setTimeout(r, FETCH_DELAY_MS)); // ponytail: fixed 1s delay, polite enough
  }
  if (!crawled.length) return 0;

  const brandContext = String(kit?.ai_context || kit?.about || brand.name || '');
  const enriched = await enrichPages(brandContext, crawled);

  const now = new Date().toISOString();
  const rows = crawled.map((p, i) => ({
    brand_id: brand.id,
    url_hash: hashUrl(p.url),
    url: p.url,
    title: p.title || null,
    description: p.description || null,
    body_text: p.body_text,
    topics: enriched[i]?.topics ?? [],
    relevance_score: enriched[i]?.relevance ?? 0,
    last_scanned_at: now,
    active: true
  }));
  // Upsert keeps last_used_at / created_at (not in the payload) intact for existing rows. A DB error
  // must SURFACE (throw), not masquerade as "0 pages indexed" — the caller reports it to the user.
  const { error } = await admin.from('brand_pages').upsert(rows, { onConflict: 'brand_id,url_hash' });
  if (error) throw new Error(`brand_pages upsert failed: ${error.message}`);
  return rows.length;
}

/** True when the brand was crawled within `days` (default 30). */
export function isLibraryScanFresh(
  lastScannedAt: string | null | undefined,
  days = LIBRARY_FRESH_DAYS
): boolean {
  if (!lastScannedAt) return false;
  const ageMs = Date.now() - new Date(lastScannedAt).getTime();
  return ageMs < days * 24 * 60 * 60 * 1000;
}

/** Most recent last_scanned_at across the brand's indexed pages (null if never scanned). */
export async function getLibraryLastScannedAt(
  admin: SupabaseClient,
  brandId: string
): Promise<string | null> {
  const { data } = await admin
    .from('brand_pages')
    .select('last_scanned_at')
    .eq('brand_id', brandId)
    .not('last_scanned_at', 'is', null)
    .order('last_scanned_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.last_scanned_at ?? null;
}

/** Top relevant, active pages — least-recently-used first among equally relevant, so we rotate. */
export async function getBrandPages(
  admin: SupabaseClient, brandId: string, limit = PLANNER_PAGE_LIMIT
): Promise<Array<{ id: string; url: string; title: string | null; topics: string[] | null; relevance_score: number | null; last_used_at: string | null }>> {
  const { data } = await admin
    .from('brand_pages')
    .select('id, url, title, topics, relevance_score, last_used_at')
    .eq('brand_id', brandId).eq('active', true)
    .order('relevance_score', { ascending: false, nullsFirst: false })
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  return data ?? [];
}

// The brand's PUBLISHED blog articles, as linkable pages with their live hosted URLs — so the social
// planner can promote/point to them (blog = the deep evergreen anchor, social drives traffic to it).
// Computed fresh, so unpublishing an article simply drops it; no indexing/cleanup needed.
async function publishedArticlePages(admin: SupabaseClient, brandId: string): Promise<Array<{ url: string; title: string; topics: string[]; relevance_score: number; last_used_at: null }>> {
  const { data: arts } = await admin
    .from('brand_articles').select('slug, title, meta_description')
    .eq('brand_id', brandId).eq('status', 'published').order('published_at', { ascending: false }).limit(15);
  if (!arts?.length) return [];
  // Resolve the public base: a verified custom domain if connected, else the app-domain default.
  const { data: site } = await admin.from('brand_sites').select('host').eq('brand_id', brandId).eq('verified', true).limit(1).maybeSingle();
  let base: string;
  if (site?.host) base = `https://${site.host}`;
  else {
    const { data: b } = await admin.from('brands').select('blog_slug, id').eq('id', brandId).maybeSingle();
    const appUrl = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
    if (!appUrl) return [];
    base = `${appUrl}/blog/${b?.blog_slug || b?.id}`;
  }
  return arts.map((a) => ({ url: `${base}/${a.slug}`, title: a.title, topics: [], relevance_score: 75, last_used_at: null }));
}

/**
 * Attach the brand's linkable pages to a planner profile as `profile.pages`. Called from the same
 * builders that attach people/mood images. Combines crawled SITE pages with the brand's own
 * PUBLISHED blog articles, so social content stays aligned with (and drives traffic to) the blog.
 */
export async function attachBrandPages(profile: AnyRec, admin: SupabaseClient, brandId: string): Promise<void> {
  if (Array.isArray(profile.pages) && profile.pages.length) return;
  const [pages, articles] = await Promise.all([
    getBrandPages(admin, brandId).catch((error) => { swallow('load brand pages', error); return []; }),
    publishedArticlePages(admin, brandId).catch((error) => { swallow('publishedArticlePages failed', error); return []; })
  ]);
  profile.pages = [...pages, ...articles];
}

/** Stamp last_used_at when a post links one of the brand's pages. Silent no-op if the URL isn't ours. */
export async function markPageUsed(admin: SupabaseClient, brandId: string, url: string): Promise<void> {
  if (!url) return;
  await admin.from('brand_pages')
    .update({ last_used_at: new Date().toISOString() })
    .eq('brand_id', brandId).eq('url_hash', hashUrl(url));
}
