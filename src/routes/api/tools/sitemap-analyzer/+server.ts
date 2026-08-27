import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
  hasImages: boolean;
  hasVideos: boolean;
}

interface SitemapAnalysis {
  url: string;
  found: boolean;
  isIndex: boolean;
  childSitemaps: string[];
  totalUrls: number;
  entries: SitemapEntry[];
  stats: {
    withLastmod: number;
    withoutLastmod: number;
    withChangefreq: number;
    withPriority: number;
    withImages: number;
    withVideos: number;
    avgPriority: string;
    changefreqDistribution: Record<string, number>;
    lastmodRange: { oldest: string; newest: string } | null;
  };
  structure: { path: string; count: number }[];
  issues: { severity: 'high' | 'medium' | 'low'; title: string; detail: string }[];
  sizeBytes: number;
  sizeKB: string;
}

import { guardTool, safeFetchUrl } from '$lib/server/tool-guard';

// SSRF-guarded + size-capped. Sitemaps can be huge, hence the larger byte budget; safeFetchUrl
// truncates rather than failing, and a truncated sitemap still parses into useful entries.
async function safeFetch(url: string): Promise<{ text: string; ok: boolean; status: number }> {
  try {
    const res = await safeFetchUrl(url, { timeoutMs: 15000, maxBytes: 5_000_000 });
    return { text: res.ok ? res.body : '', ok: res.ok, status: res.status };
  } catch {
    return { text: '', ok: false, status: 0 };
  }
}

function parseSitemapEntries(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) ?? [];

  for (const block of urlBlocks) {
    const loc = extractTag(block, 'loc');
    if (!loc) continue;

    entries.push({
      loc: loc.trim(),
      lastmod: extractTag(block, 'lastmod')?.trim(),
      changefreq: extractTag(block, 'changefreq')?.trim()?.toLowerCase(),
      priority: extractTag(block, 'priority')?.trim(),
      hasImages: /<image:image|<image:loc/i.test(block),
      hasVideos: /<video:video|<video:loc/i.test(block)
    });
  }

  return entries;
}

function extractTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : undefined;
}

function extractSitemapIndex(xml: string): string[] {
  const refs: string[] = [];
  const blocks = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/gi) ?? [];
  for (const block of blocks) {
    const loc = extractTag(block, 'loc');
    if (loc) refs.push(loc.trim());
  }
  return refs;
}

function analyzeStructure(entries: SitemapEntry[], origin: string): { path: string; count: number }[] {
  const pathCounts = new Map<string, number>();

  for (const entry of entries) {
    try {
      const url = new URL(entry.loc);
      const segments = url.pathname.split('/').filter(Boolean);
      const firstSegment = segments.length > 0 ? `/${segments[0]}` : '/';
      pathCounts.set(firstSegment, (pathCounts.get(firstSegment) || 0) + 1);
    } catch {
      // skip invalid URLs
    }
  }

  return [...pathCounts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

function findIssues(
  sitemapUrl: string,
  found: boolean,
  entries: SitemapEntry[],
  sizeBytes: number,
  isIndex: boolean
): { severity: 'high' | 'medium' | 'low'; title: string; detail: string }[] {
  const issues: { severity: 'high' | 'medium' | 'low'; title: string; detail: string }[] = [];

  if (!found) {
    issues.push({
      severity: 'high',
      title: 'Sitemap not found',
      detail: `Could not fetch ${sitemapUrl}. Make sure your sitemap is accessible and returns a 200 status.`
    });
    return issues;
  }

  if (entries.length === 0 && !isIndex) {
    issues.push({
      severity: 'high',
      title: 'Empty sitemap',
      detail: 'The sitemap was found but contains no URLs. Add your pages to the sitemap.'
    });
  }

  // Size check (50MB uncompressed limit)
  if (sizeBytes > 50 * 1024 * 1024) {
    issues.push({
      severity: 'high',
      title: 'Sitemap too large',
      detail: `Sitemap is ${(sizeBytes / 1024 / 1024).toFixed(1)}MB (max 50MB). Split it into multiple sitemaps with a sitemap index.`
    });
  }

  // URL count check (50,000 limit)
  if (entries.length > 50000) {
    issues.push({
      severity: 'high',
      title: 'Too many URLs',
      detail: `Sitemap contains ${entries.length.toLocaleString()} URLs (max 50,000). Split into child sitemaps.`
    });
  }

  // Missing lastmod
  const withoutLastmod = entries.filter(e => !e.lastmod).length;
  if (withoutLastmod > 0 && entries.length > 0) {
    const pct = Math.round((withoutLastmod / entries.length) * 100);
    if (pct > 50) {
      issues.push({
        severity: 'medium',
        title: 'Most URLs missing lastmod',
        detail: `${pct}% of URLs (${withoutLastmod.toLocaleString()}) have no <lastmod> tag. Adding lastmod helps search engines prioritize fresh content.`
      });
    }
  }

  // Invalid lastmod dates
  const invalidDates = entries.filter(e => e.lastmod && isNaN(Date.parse(e.lastmod))).length;
  if (invalidDates > 0) {
    issues.push({
      severity: 'medium',
      title: 'Invalid lastmod dates',
      detail: `${invalidDates} URLs have invalid lastmod dates. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS+00:00).`
    });
  }

  // Invalid priority values
  const invalidPriorities = entries.filter(e => {
    if (!e.priority) return false;
    const p = parseFloat(e.priority);
    return isNaN(p) || p < 0 || p > 1;
  }).length;
  if (invalidPriorities > 0) {
    issues.push({
      severity: 'low',
      title: 'Invalid priority values',
      detail: `${invalidPriorities} URLs have priority values outside 0.0–1.0 range.`
    });
  }

  // Invalid changefreq values
  const validFreqs = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];
  const invalidFreqs = entries.filter(e => e.changefreq && !validFreqs.includes(e.changefreq)).length;
  if (invalidFreqs > 0) {
    issues.push({
      severity: 'low',
      title: 'Invalid changefreq values',
      detail: `${invalidFreqs} URLs have invalid changefreq. Valid values: ${validFreqs.join(', ')}.`
    });
  }

  // Duplicate URLs
  const locs = entries.map(e => e.loc);
  const dupes = locs.length - new Set(locs).size;
  if (dupes > 0) {
    issues.push({
      severity: 'medium',
      title: 'Duplicate URLs found',
      detail: `${dupes} duplicate URLs found in the sitemap. Each URL should appear only once.`
    });
  }

  // Non-canonical URLs (http instead of https, www mismatch)
  const httpUrls = entries.filter(e => e.loc.startsWith('http://')).length;
  if (httpUrls > 0) {
    issues.push({
      severity: 'medium',
      title: 'HTTP URLs in sitemap',
      detail: `${httpUrls} URLs use http:// instead of https://. Sitemaps should only contain canonical HTTPS URLs.`
    });
  }

  // Check for non-indexable paths
  const nonIndexable = entries.filter(e => {
    try {
      const path = new URL(e.loc).pathname;
      return path.startsWith('/app/') || path.startsWith('/api/') || path.startsWith('/auth/') || path.includes('/login');
    } catch { return false; }
  }).length;
  if (nonIndexable > 0) {
    issues.push({
      severity: 'medium',
      title: 'Non-indexable URLs in sitemap',
      detail: `${nonIndexable} URLs point to app, API, auth or login pages that shouldn't be in the sitemap.`
    });
  }

  return issues;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const guard = await guardTool('sitemap-analyzer', getClientAddress());
  if (!guard.ok) return guard.response;
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return json({ error: 'URL is required' }, { status: 400 });
    }

    let origin: string;
    let sitemapUrl: string;

    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      origin = parsed.origin;
      // If the user provided a direct sitemap URL, use it
      if (parsed.pathname.includes('sitemap')) {
        sitemapUrl = parsed.href;
      } else {
        sitemapUrl = `${origin}/sitemap.xml`;
      }
    } catch {
      return json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Fetch the sitemap
    const { text: sitemapXml, ok, status } = await safeFetch(sitemapUrl);

    if (!ok || !sitemapXml) {
      // Try sitemap_index.xml or sitemaps.xml as fallbacks
      const fallbacks = [`${origin}/sitemap_index.xml`, `${origin}/sitemaps.xml`];
      let found = false;
      for (const fb of fallbacks) {
        const res = await safeFetch(fb);
        if (res.ok && res.text) {
          sitemapUrl = fb;
          found = true;
          break;
        }
      }
      if (!found) {
        const analysis: SitemapAnalysis = {
          url: sitemapUrl,
          found: false,
          isIndex: false,
          childSitemaps: [],
          totalUrls: 0,
          entries: [],
          stats: {
            withLastmod: 0, withoutLastmod: 0, withChangefreq: 0,
            withPriority: 0, withImages: 0, withVideos: 0,
            avgPriority: '0', changefreqDistribution: {}, lastmodRange: null
          },
          structure: [],
          issues: [{ severity: 'high', title: 'Sitemap not found', detail: `Could not find a sitemap at ${sitemapUrl}. Create a sitemap.xml at your site's root.` }],
          sizeBytes: 0,
          sizeKB: '0'
        };
        return json({ success: true, analysis });
      }
    }

    // Re-fetch if we changed URL
    const finalRes = await safeFetch(sitemapUrl);
    const xml = finalRes.text;
    const sizeBytes = new TextEncoder().encode(xml).length;

    // Check if it's a sitemap index
    const isIndex = /<sitemapindex/i.test(xml);
    const childSitemaps = isIndex ? extractSitemapIndex(xml) : [];

    // Parse entries from main sitemap
    let allEntries = parseSitemapEntries(xml);

    // If it's an index, fetch child sitemaps
    if (isIndex && childSitemaps.length > 0) {
      const childResults = await Promise.all(
        childSitemaps.slice(0, 20).map(async (childUrl) => {
          const res = await safeFetch(childUrl);
          return res.ok ? parseSitemapEntries(res.text) : [];
        })
      );
      for (const childEntries of childResults) {
        allEntries.push(...childEntries);
      }
    }

    // Deduplicate by loc
    const seen = new Set<string>();
    allEntries = allEntries.filter(e => {
      if (seen.has(e.loc)) return false;
      seen.add(e.loc);
      return true;
    });

    // Compute stats
    const withLastmod = allEntries.filter(e => e.lastmod).length;
    const withChangefreq = allEntries.filter(e => e.changefreq).length;
    const withPriority = allEntries.filter(e => e.priority).length;
    const withImages = allEntries.filter(e => e.hasImages).length;
    const withVideos = allEntries.filter(e => e.hasVideos).length;

    const priorities = allEntries
      .map(e => e.priority ? parseFloat(e.priority) : NaN)
      .filter(p => !isNaN(p));
    const avgPriority = priorities.length > 0
      ? (priorities.reduce((a, b) => a + b, 0) / priorities.length).toFixed(2)
      : 'N/A';

    const changefreqDistribution: Record<string, number> = {};
    for (const e of allEntries) {
      if (e.changefreq) {
        changefreqDistribution[e.changefreq] = (changefreqDistribution[e.changefreq] || 0) + 1;
      }
    }

    const validDates = allEntries
      .map(e => e.lastmod)
      .filter((d): d is string => !!d && !isNaN(Date.parse(d)))
      .map(d => new Date(d).getTime());

    let lastmodRange: { oldest: string; newest: string } | null = null;
    if (validDates.length > 0) {
      lastmodRange = {
        oldest: new Date(Math.min(...validDates)).toISOString().split('T')[0],
        newest: new Date(Math.max(...validDates)).toISOString().split('T')[0]
      };
    }

    const structure = analyzeStructure(allEntries, origin);
    const issues = findIssues(sitemapUrl, true, allEntries, sizeBytes, isIndex);

    const analysis: SitemapAnalysis = {
      url: sitemapUrl,
      found: true,
      isIndex,
      childSitemaps,
      totalUrls: allEntries.length,
      entries: allEntries.slice(0, 200), // limit for response size
      stats: {
        withLastmod,
        withoutLastmod: allEntries.length - withLastmod,
        withChangefreq,
        withPriority,
        withImages,
        withVideos,
        avgPriority,
        changefreqDistribution,
        lastmodRange
      },
      structure,
      issues,
      sizeBytes,
      sizeKB: (sizeBytes / 1024).toFixed(1)
    };

    return json({ success: true, analysis });
  } catch (err) {
    console.error('[sitemap-analyzer]', err);
    return json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};
