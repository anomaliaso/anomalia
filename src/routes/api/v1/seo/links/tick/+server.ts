// Weekly internal-linking tick: appends "See also" links between a brand's published articles
// (see src/lib/server/internal-links.ts). Runs after the SEO crawl/review crons; ?brand= scopes
// to one brand, ?max= overrides the per-run article cap. Auth same as the other ticks.
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { runInternalLinkingTick } from '$lib/server/internal-links';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const url = new URL(request.url);
  const brandSlug = url.searchParams.get('brand') ?? undefined;
  const max = Number(url.searchParams.get('max')) || 20;

  const { articles, links } = await runInternalLinkingTick(admin, { brandSlug, maxArticles: max }).catch((e) => {
    console.error('[seo/links/tick]', e instanceof Error ? e.message : e);
    return { articles: 0, links: 0 };
  });
  return new Response(JSON.stringify({ ok: true, articles, links }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
