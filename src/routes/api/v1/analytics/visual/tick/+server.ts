import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { runVisualInsightsTick, VISUAL_WINDOW_DAYS } from '$lib/server/visual-insights';

// Weekly visual↔engagement correlation (P2 learning loop), Tuesday 07:00. SQL-only + memory
// writes — zero LLM cost, so one brand stays well under the 120s budget. Auth same as the
// other ticks; ?brand=<slug> runs a single brand (for testing), otherwise active brands with
// ≥ 1 own published post in the window are processed (cap 10 per run, ordered by slug).

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const admin = createAdminClient();
  const url = new URL(request.url);
  const only = url.searchParams.get('brand');
  const since = new Date(Date.now() - VISUAL_WINDOW_DAYS * 86400000).toISOString();

  let brands: { id: string; slug: string }[] = [];
  if (only) {
    const { data } = await admin.from('brands').select('id, slug').eq('slug', only).limit(1);
    brands = (data ?? []) as { id: string; slug: string }[];
  } else {
    const { data: recent } = await admin
      .from('posts')
      .select('brand_id')
      .eq('status', 'published')
      .gte('published_at', since)
      .limit(5000);
    const brandIds = [...new Set((recent ?? []).map((r) => String(r.brand_id)))];
    if (brandIds.length) {
      // Round-robin, least-recently-processed first (same rotation column pattern as
      // seo/crawl/tick): ordered by slug the cap of 10 meant brands past the tenth alphabetical
      // one were never processed at all.
      const { data, error } = await admin
        .from('brands')
        .select('id, slug')
        .eq('status', 'active')
        .in('id', brandIds)
        .order('last_visual_at', { ascending: true, nullsFirst: true })
        .limit(10);
      if (error) console.error('[analytics/visual/tick] brand select failed:', error.message);
      brands = (data ?? []) as { id: string; slug: string }[];
    }
  }

  const results: Array<Record<string, unknown>> = [];
  const now = new Date().toISOString();
  for (const brand of brands) {
    // Claim BEFORE the work: a throw (or a timeout) must still rotate the cursor, otherwise the
    // failing brand stays first in line every run and the rest starve behind it.
    await admin.from('brands').update({ last_visual_at: now }).eq('id', brand.id);
    try {
      const r = await runVisualInsightsTick(admin, brand.id);
      results.push({ brand: brand.slug, ...r });
    } catch (e) {
      results.push({ brand: brand.slug, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, brands: results.length, results }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
