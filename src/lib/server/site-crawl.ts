// Sitewide SEO crawl — extends library sitemap crawl with per-page technical signals.
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { fetchPage, extractVisibleText } from '$lib/server/brand-analysis';
import { parseSitemapLocs, selectLinkableUrls } from '$lib/server/content-library';
import { pagespeedConfigured, fetchPageSpeed } from '$lib/server/pagespeed';
import { isPaidPlan } from '$lib/plans';

type AnyRec = Record<string, unknown>;

const CAP: Record<string, number> = { go: 80, starter: 200, pro: 500, scale: 500 };
const FETCH_DELAY_MS = 400;

export function seoCrawlCap(plan: string | null | undefined): number {
  if (!plan || plan === 'free') return 40;
  return CAP[plan] ?? (isPaidPlan(plan) ? 200 : 40);
}

const hashUrl = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 16);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function collectSitemapUrls(origin: string): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const roots = await fetchPage(`${origin}/sitemap.xml`).catch(() => '');
  const top = parseSitemapLocs(roots);
  const nested = top.filter((u) => /\.xml(\?|$)/i.test(u)).slice(0, 10);
  const pageUrls = top.filter((u) => !/\.xml(\?|$)/i.test(u));
  for (const sm of nested) {
    const xml = await fetchPage(sm).catch(() => '');
    pageUrls.push(...parseSitemapLocs(xml).filter((u) => !/\.xml(\?|$)/i.test(u)));
  }
  for (const u of pageUrls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

type PageSignals = {
  http_status: number;
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots_meta: string | null;
  h1: string | null;
  word_count: number;
  internal_out_links: number;
  has_schema: boolean;
  hreflang: Array<{ lang: string; href: string }>;
  issues: Array<{ id: string; severity: 'high' | 'medium' | 'low'; message: string }>;
  seo_score: number;
  body_text: string;
};

function analyzeHtml(url: string, html: string, origin: string): Omit<PageSignals, 'http_status'> {
  const title =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ??
    null;
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    null;
  const canonical =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1] ??
    null;
  const robots_meta =
    html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? null;
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  );
  const h1 = h1s[0] || null;
  const body_text = extractVisibleText(html, 8000);
  const word_count = body_text.split(/\s+/).filter(Boolean).length;
  const has_schema = /application\/ld\+json/i.test(html);
  const hreflang = [...html.matchAll(/<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']+)["'][^>]+href=["']([^"']+)["']/gi)].map(
    (m) => ({ lang: m[1], href: m[2] })
  );

  let internal_out_links = 0;
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    try {
      const abs = new URL(m[1], url);
      if (abs.origin === origin) internal_out_links++;
    } catch {
      /* skip */
    }
  }

  const issues: PageSignals['issues'] = [];
  if (robots_meta?.includes('noindex')) {
    issues.push({ id: 'noindex', severity: 'high', message: 'Page is noindex' });
  }
  if (!title || title.trim().length < 10) {
    issues.push({ id: 'missing_title', severity: 'high', message: 'Missing or thin title' });
  }
  if (h1s.length === 0) {
    issues.push({ id: 'missing_h1', severity: 'medium', message: 'No H1' });
  } else if (h1s.length > 1) {
    issues.push({ id: 'multiple_h1', severity: 'low', message: `Multiple H1 (${h1s.length})` });
  }
  if (word_count < 200) {
    issues.push({ id: 'thin_page', severity: 'medium', message: `Thin content (${word_count} words)` });
  }
  if (!canonical) {
    issues.push({ id: 'missing_canonical', severity: 'low', message: 'No canonical link' });
  } else {
    try {
      const c = new URL(canonical, url);
      const u = new URL(url);
      if (c.href.replace(/\/$/, '') !== u.href.replace(/\/$/, '')) {
        issues.push({ id: 'canonical_mismatch', severity: 'medium', message: 'Canonical points elsewhere' });
      }
    } catch {
      issues.push({ id: 'bad_canonical', severity: 'medium', message: 'Invalid canonical URL' });
    }
  }

  let seo_score = 100;
  for (const i of issues) {
    seo_score -= i.severity === 'high' ? 25 : i.severity === 'medium' ? 12 : 5;
  }
  seo_score = Math.max(0, seo_score);

  return {
    title: title?.replace(/\s+/g, ' ').trim().slice(0, 200) ?? null,
    description: description?.replace(/\s+/g, ' ').trim().slice(0, 400) ?? null,
    canonical,
    robots_meta,
    h1,
    word_count,
    internal_out_links,
    has_schema,
    hreflang,
    issues,
    seo_score,
    body_text
  };
}

export type CrawlSummary = {
  pages_crawled: number;
  high_issues: number;
  medium_issues: number;
  orphan_count: number;
  duplicate_titles: number;
  avg_seo_score: number;
  cwv?: Array<{ url: string; score: number | null }>;
};

export async function crawlForSeo(
  admin: SupabaseClient,
  brand: AnyRec,
  opts: { deadline?: number } = {}
): Promise<CrawlSummary> {
  const website = String(brand.website ?? '').trim();
  if (!website) throw new Error('Brand has no website');
  const origin = new URL(website.startsWith('http') ? website : `https://${website}`).origin;
  const cap = seoCrawlCap(brand.plan as string);

  const { data: run } = await admin
    .from('brand_crawl_runs')
    .insert({ brand_id: brand.id, pages_crawled: 0, summary: {} })
    .select('id')
    .single();

  const all = await collectSitemapUrls(origin);
  const urls = selectLinkableUrls(all).slice(0, cap);
  // Always include homepage
  if (!urls.includes(origin + '/') && !urls.includes(origin)) urls.unshift(origin + '/');

  const inLinkCounts = new Map<string, number>();
  const pageRows: Array<AnyRec & { url: string; url_hash: string }> = [];
  const titleMap = new Map<string, string[]>();
  // Persist as we go: a Pro cap of 500 pages × (400ms pause + fetch) cannot fit in the tick's
  // 300s, and upserting only at the end meant a brand that ran out of time persisted NOTHING,
  // every single run. Flushed rows lack the in-link/orphan pass — the final upsert adds it.
  let flushed = 0;
  const flushPages = async () => {
    while (pageRows.length - flushed > 0) {
      const chunk = pageRows.slice(flushed, flushed + 50);
      await admin.from('brand_pages').upsert(chunk, { onConflict: 'brand_id,url_hash' });
      flushed += chunk.length;
    }
  };

  for (const url of urls) {
    // Out of time: keep what we crawled so far (rotation gives the rest of the site the next run).
    if (opts.deadline && Date.now() >= opts.deadline) break;
    await sleep(FETCH_DELAY_MS);
    let html = '';
    let status = 200;
    try {
      html = await fetchPage(url);
      if (!html || html.length < 50) status = 404;
    } catch {
      status = 0;
    }

    const signals =
      status === 200
        ? analyzeHtml(url, html, origin)
        : {
            title: null,
            description: null,
            canonical: null,
            robots_meta: null,
            h1: null,
            word_count: 0,
            internal_out_links: 0,
            has_schema: false,
            hreflang: [],
            issues: [{ id: 'fetch_failed', severity: 'high' as const, message: `Fetch failed (${status})` }],
            seo_score: 0,
            body_text: ''
          };

    // Count outbound internal links for in-link graph (second pass)
    for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
      try {
        const abs = new URL(m[1], url);
        if (abs.origin === origin) {
          const key = abs.href.replace(/\/$/, '');
          inLinkCounts.set(key, (inLinkCounts.get(key) ?? 0) + 1);
        }
      } catch {
        /* skip */
      }
    }

    if (signals.title) {
      const t = signals.title.toLowerCase();
      titleMap.set(t, [...(titleMap.get(t) ?? []), url]);
    }

    pageRows.push({
      brand_id: brand.id,
      url,
      url_hash: hashUrl(url),
      title: signals.title,
      description: signals.description,
      body_text: signals.body_text,
      http_status: status,
      canonical: signals.canonical,
      robots_meta: signals.robots_meta,
      h1: signals.h1,
      word_count: signals.word_count,
      internal_out_links: signals.internal_out_links,
      has_schema: signals.has_schema,
      hreflang: signals.hreflang,
      issues: signals.issues,
      seo_score: signals.seo_score,
      crawled_at: new Date().toISOString(),
      last_scanned_at: new Date().toISOString(),
      active: true
    });

    if (pageRows.length - flushed >= 50) await flushPages();
  }

  // Apply in-link counts + orphan detection
  let orphan_count = 0;
  let high_issues = 0;
  let medium_issues = 0;
  let scoreSum = 0;

  for (const row of pageRows) {
    const key = String(row.url).replace(/\/$/, '');
    const inLinks = inLinkCounts.get(key) ?? 0;
    row.internal_in_links = inLinks;
    const issues = [...((row.issues as PageSignals['issues']) ?? [])];
    const path = (() => {
      try {
        return new URL(String(row.url)).pathname;
      } catch {
        return '/';
      }
    })();
    if (path !== '/' && inLinks === 0) {
      issues.push({ id: 'orphan', severity: 'medium', message: 'No internal in-links found in crawl' });
      orphan_count++;
    }
    const t = String(row.title ?? '').toLowerCase();
    if (t && (titleMap.get(t)?.length ?? 0) > 1) {
      issues.push({ id: 'duplicate_title', severity: 'medium', message: 'Duplicate title across pages' });
    }
    row.issues = issues;
    let score = 100;
    for (const i of issues) {
      if (i.severity === 'high') {
        high_issues++;
        score -= 25;
      } else if (i.severity === 'medium') {
        medium_issues++;
        score -= 12;
      } else score -= 5;
    }
    row.seo_score = Math.max(0, score);
    scoreSum += row.seo_score as number;
  }

  // Re-upsert everything, now that in-links / duplicate titles / final scores are known.
  flushed = 0;
  await flushPages();

  // CWV sample: homepage + top 4 by word count
  const cwv: Array<{ url: string; score: number | null }> = [];
  if (pagespeedConfigured() && !(opts.deadline && Date.now() >= opts.deadline)) {
    const sample = [origin + '/', ...pageRows.map((r) => String(r.url)).filter((u) => u !== origin && u !== origin + '/')]
      .slice(0, 5);
    for (const u of sample) {
      const report = await fetchPageSpeed(u, 'mobile').catch((error) => { swallow('fetchPageSpeed failed', error); return null; });
      if (report) cwv.push({ url: u, score: report.score });
    }
  }

  const duplicate_titles = [...titleMap.values()].filter((v) => v.length > 1).length;
  const summary: CrawlSummary = {
    pages_crawled: pageRows.length,
    high_issues,
    medium_issues,
    orphan_count,
    duplicate_titles,
    avg_seo_score: pageRows.length ? Math.round(scoreSum / pageRows.length) : 0,
    cwv: cwv.length ? cwv : undefined
  };

  if (run?.id) {
    await admin
      .from('brand_crawl_runs')
      .update({
        finished_at: new Date().toISOString(),
        pages_crawled: pageRows.length,
        summary
      })
      .eq('id', run.id);
  }

  return summary;
}

export async function loadLatestCrawl(admin: SupabaseClient, brandId: string) {
  const [{ data: run }, { data: pages }] = await Promise.all([
    admin
      .from('brand_crawl_runs')
      .select('id, started_at, finished_at, pages_crawled, summary')
      .eq('brand_id', brandId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('brand_pages')
      .select('url, title, http_status, seo_score, issues, word_count, canonical, robots_meta, crawled_at')
      .eq('brand_id', brandId)
      .not('crawled_at', 'is', null)
      .order('seo_score', { ascending: true })
      .limit(50)
  ]);
  return { run, pages: pages ?? [] };
}
