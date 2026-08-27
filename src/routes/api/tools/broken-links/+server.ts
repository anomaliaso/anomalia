import type { RequestHandler } from './$types';
import { runUrlTool, safeFetchUrl } from '$lib/server/tool-guard';
import { extractLinks, type Issue } from '$lib/server/seo-tools';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

// How many links from the page we actually probe. This is the tool's real cost knob: it's our
// own egress and wall-clock, not a paid API, but an unbounded crawl of a page with 800 links
// would blow the function's duration and hammer the target site. One page, capped fan-out.
const MAX_LINKS = 40;
const CONCURRENCY = 8;

type LinkCheck = { url: string; status: number; ok: boolean; external: boolean; error?: string };

async function checkOne(url: string, origin: string): Promise<LinkCheck> {
  const external = (() => { try { return new URL(url).origin !== origin; } catch { return true; } })();
  try {
    // GET rather than HEAD: too many servers answer HEAD with 405 while the page is perfectly
    // fine, which would report healthy links as broken. safeFetchUrl caps the body anyway.
    const res = await safeFetchUrl(url, { maxBytes: 40_000, timeoutMs: 8000 });
    return { url, status: res.status, ok: res.status < 400, external };
  } catch (e) {
    return { url, status: 0, ok: false, external, error: e instanceof Error ? e.message : 'unreachable' };
  }
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const { url } = await request.json().catch(() => ({ url: '' }));
  return runUrlTool('broken-links', getClientAddress(), url, async (input) => {
    const page = await safeFetchUrl(input, { maxBytes: 2_000_000 });
    const origin = new URL(page.url).origin;
    const links = extractLinks(page.body, page.url);
    const scanned = links.slice(0, MAX_LINKS);

    const results: LinkCheck[] = [];
    for (let i = 0; i < scanned.length; i += CONCURRENCY) {
      results.push(...(await Promise.all(scanned.slice(i, i + CONCURRENCY).map((l) => checkOne(l, origin)))));
    }

    const broken = results.filter((r) => !r.ok);
    const issues: Issue[] = [];
    if (broken.length) {
      issues.push({
        severity: broken.some((b) => !b.external) ? 'high' : 'medium',
        title: `${broken.length} broken link${broken.length > 1 ? 's' : ''}`,
        detail: 'Broken internal links waste crawl budget and strand visitors; broken external ones read as an unmaintained page.'
      });
    }
    if (links.length > MAX_LINKS) {
      issues.push({ severity: 'low', title: 'Partial scan', detail: `The page has ${links.length} links; the free scan checks the first ${MAX_LINKS}.` });
    }

    return {
      url: page.url,
      totalLinks: links.length,
      checked: results.length,
      brokenCount: broken.length,
      links: results.sort((a, b) => Number(a.ok) - Number(b.ok)),
      issues
    };
  });
};
