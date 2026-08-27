import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { crawlForSeo } from '$lib/server/site-crawl';
import { hasWebHub } from '$lib/plans';

export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const only = new URL(request.url).searchParams.get('brand');
  // Round-robin across brands (least-recently-crawled first). Cap is 3, but page caps go up to
  // 500 (Pro/Scale) — at 400ms/pause alone that is way past 300s, so each crawl also gets a wall
  // clock budget and persists what it managed to fetch.
  const deadline = Date.now() + 240_000;
  let q = admin
    .from('brands')
    .select('id, name, slug, website, plan, content_prefs')
    .eq('status', 'active')
    .order('last_crawl_at', { ascending: true, nullsFirst: true });
  if (only) q = q.eq('slug', only);
  const { data: brands } = await q.limit(only ? 1 : 3);

  let crawled = 0;
  const now = new Date().toISOString();
  const brandBudgetMs = Math.floor(240_000 / Math.max(1, (brands ?? []).length));
  for (const brand of brands ?? []) {
    if (Date.now() >= deadline) break;
    // Claim the brand BEFORE crawling: a timeout (or any failure) must still rotate the
    // cursor — otherwise the same brand stays first in line and is retried every run
    // while the rest starve. Also de-facto serializes concurrent runs.
    await admin.from('brands').update({ last_crawl_at: now }).eq('id', brand.id);
    // …e PRIMA anche del gate di piano, che stava sopra il claim: un brand senza Web hub non
    // avanzava mai `last_crawl_at`, quindi con `nullsFirst` restava fisso in uno dei tre slot di
    // testa a ogni giro. Stesso difetto del resto della flotta, in una riga fuori posto.
    if (!hasWebHub(brand.plan)) continue;
    try {
      await crawlForSeo(admin, brand, { deadline: Math.min(deadline, Date.now() + brandBudgetMs) });
      crawled++;
    } catch (e) {
      console.error('[seo/crawl/tick]', brand.slug, e instanceof Error ? e.message : e);
    }
  }
  return new Response(JSON.stringify({ ok: true, crawled }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
