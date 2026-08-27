import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { guardTool, safeFetchUrl } from '$lib/server/tool-guard';

// SSRF-guarded: the URL comes from an anonymous caller, so private hosts and oversized bodies
// are rejected inside safeFetchUrl rather than here.
async function safeFetch(url: string): Promise<string> {
  try {
    const res = await safeFetchUrl(url, { timeoutMs: 15000 });
    return res.ok ? res.body : '';
  } catch {
    return '';
  }
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

function extractDescription(html: string): string {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  return m ? m[1].trim() : '';
}

function extractOgDescription(html: string): string {
  const m = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  return m ? m[1].trim() : '';
}

function extractH1(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
}

function extractSitemapUrls(xml: string, origin: string): string[] {
  const urls: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    let u = m[1].trim();
    // Handle relative URLs
    if (u.startsWith('/')) u = origin + u;
    // Handle same-origin URLs (with or without www)
    const uHost = (() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const oHost = origin.replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (uHost === oHost || u.startsWith(origin)) {
      urls.push(u);
    }
  }
  return urls;
}

async function fetchAllSitemapUrls(origin: string): Promise<string[]> {
  const sitemapXml = await safeFetch(`${origin}/sitemap.xml`);
  if (!sitemapXml) return [];

  const urls = extractSitemapUrls(sitemapXml, origin);

  // Check if this is a sitemap index (contains other sitemaps)
  const sitemapRefs = sitemapXml.match(/<sitemap>[\s\S]*?<\/sitemap>/gi) ?? [];
  if (sitemapRefs.length > 0) {
    const childUrls: string[] = [];
    for (const ref of sitemapRefs) {
      const locMatch = ref.match(/<loc>([^<]+)<\/loc>/i);
      if (locMatch) {
        let childUrl = locMatch[1].trim();
        if (childUrl.startsWith('/')) childUrl = origin + childUrl;
        const childXml = await safeFetch(childUrl);
        if (childXml) {
          childUrls.push(...extractSitemapUrls(childXml, origin));
        }
      }
    }
    urls.push(...childUrls);
  }

  return [...new Set(urls)]; // deduplicate
}

function pathToLabel(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' '))
    .join(' > ');
}

function pathToShortLabel(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || 'Home';
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
}

interface PageInfo {
  url: string;
  title: string;
  description: string;
  path: string;
}

async function fetchPageInfo(url: string): Promise<PageInfo> {
  const html = await safeFetch(url);
  const path = new URL(url).pathname;
  const title = extractTitle(html) || extractH1(html) || pathToShortLabel(path);
  const description = extractDescription(html) || extractOgDescription(html) || '';
  return { url, title, description, path };
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const guard = await guardTool('llms-txt-generator', getClientAddress());
  if (!guard.ok) return guard.response;
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return json({ error: 'URL is required' }, { status: 400 });
    }

    let origin: string;
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      origin = parsed.origin;
    } catch {
      return json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Fetch homepage + sitemap
    const [homepage, allUrls] = await Promise.all([
      safeFetch(origin),
      fetchAllSitemapUrls(origin)
    ]);

    const siteName = extractTitle(homepage).split(/[|–—-]/)[0].trim() || new URL(origin).hostname;
    const tagline = extractDescription(homepage) || extractOgDescription(homepage) || '';
    const h1 = extractH1(homepage);

    // Filter out non-public paths
    const publicUrls = allUrls.filter(u => {
      const path = new URL(u).pathname;
      return !path.startsWith('/app/') && !path.startsWith('/api/') && !path.startsWith('/auth/');
    });

    // Fetch info for pages (limit to avoid timeout)
    const pagesToFetch = publicUrls.slice(0, 40);

    const pagesInfo = await Promise.all(
      pagesToFetch.map(u => fetchPageInfo(u).catch(() => ({
        url: u,
        title: pathToShortLabel(new URL(u).pathname),
        description: '',
        path: new URL(u).pathname
      })))
    );

    // Build rich llms.txt
    let llmsTxt = `# ${siteName}`;
    if (h1 && h1 !== siteName) llmsTxt += ` — ${h1}`;
    llmsTxt += `\n\n`;

    llmsTxt += `Website: ${origin}\n`;
    if (tagline) llmsTxt += `Tagline: "${tagline}"\n`;
    llmsTxt += `\n`;

    // About section
    llmsTxt += `## What is ${siteName}\n\n`;
    if (tagline) {
      llmsTxt += `${tagline}\n`;
    }
    llmsTxt += `\n`;

    // Pages from sitemap
    if (pagesInfo.length > 0) {
      llmsTxt += `## Pages\n\n`;
      for (const page of pagesInfo) {
        const label = page.title || pathToShortLabel(page.path);
        const desc = page.description ? ` — ${page.description.slice(0, 120)}` : '';
        llmsTxt += `- [${label}](${page.url})${desc}\n`;
      }
      llmsTxt += `\n`;
    }

    // Static resources — only include if they actually exist
    const staticFiles = ['/llms.txt', '/homepage.md', '/pricing.md', '/usecases.md'];
    const existingStatic: string[] = [];
    for (const file of staticFiles) {
      const check = await safeFetch(`${origin}${file}`);
      if (check && check.length > 10) existingStatic.push(file);
    }
    if (existingStatic.length > 0) {
      llmsTxt += `## Resources\n\n`;
      for (const file of existingStatic) {
        const name = file.replace('/', '').replace('.md', '').replace('.txt', '');
        llmsTxt += `- [${name}](${origin}${file})\n`;
      }
      llmsTxt += `- [Sitemap](${origin}/sitemap.xml)\n`;
      llmsTxt += `\n`;
    }

    // Contact
    llmsTxt += `## Contact\n\n`;
    llmsTxt += `Website: ${origin}\n`;

    return json({
      success: true,
      llmsTxt,
      siteName,
      pagesCount: publicUrls.length
    });
  } catch (err) {
    console.error('[llms-txt-generator]', err);
    return json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};
