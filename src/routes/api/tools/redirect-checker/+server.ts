import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guardTool, traceRedirects, safeFetchUrl } from '$lib/server/tool-guard';
import type { Issue } from '$lib/server/seo-tools';

// Redirect-chain tracer + canonical check: every hop, its status, and whether the final page
// agrees with itself about which URL is canonical.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const { url } = await request.json().catch(() => ({ url: '' }));
  const input = typeof url === 'string' ? url.trim() : '';
  if (!input) return json({ error: 'A website URL is required' }, { status: 400 });

  const guard = await guardTool('redirect-checker', getClientAddress());
  if (!guard.ok) return guard.response;

  try {
    const hops = await traceRedirects(input);
    const final = hops[hops.length - 1];
    const issues: Issue[] = [];

    const redirects = hops.filter((h) => h.status >= 300 && h.status < 400);
    if (redirects.length > 2) {
      issues.push({ severity: 'medium', title: `${redirects.length} redirects in a row`, detail: 'Every hop costs latency and leaks a little ranking signal. Point the first URL straight at the last one.' });
    }
    if (redirects.some((h) => h.status === 302 || h.status === 307)) {
      issues.push({ severity: 'medium', title: 'Temporary redirect in the chain', detail: 'A 302/307 tells engines the move is temporary, so the old URL keeps the ranking. Use 301 for permanent moves.' });
    }
    if (hops.some((h) => h.location === 'redirect loop')) {
      issues.push({ severity: 'high', title: 'Redirect loop', detail: 'The chain returns to a URL it already visited — browsers and crawlers will give up.' });
    }
    if (final && final.status >= 400) {
      issues.push({ severity: 'high', title: `Chain ends in ${final.status}`, detail: 'The destination is an error page, so every link pointing here is effectively broken.' });
    }

    // Only worth a second fetch when we actually landed somewhere real.
    let canonical = '';
    if (final && final.status < 400) {
      const page = await safeFetchUrl(final.url, { maxBytes: 400_000 }).catch((error) => { swallow('fetch canonical page', error); return null; });
      canonical = page?.body.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ?? '';
      if (canonical) {
        const same = new URL(canonical, final.url).toString().replace(/\/$/, '') === final.url.replace(/\/$/, '');
        if (!same) issues.push({ severity: 'medium', title: 'Canonical points elsewhere', detail: `This URL declares ${canonical} as canonical, so it is asking not to be the indexed version.` });
      }
    }

    return json({ success: true, result: { hops, finalUrl: final?.url ?? input, finalStatus: final?.status ?? 0, canonical, issues } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    const known = /not reachable|timed out|resolve|http\(s\)/i.test(msg);
    if (!known) console.error('[tool:redirect-checker]', e);
    return json({ error: known ? msg : 'Could not trace that URL.' }, { status: known ? 400 : 500 });
  }
};
