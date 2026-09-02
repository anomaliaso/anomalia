import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { radarPrefsOf, buildRadarFeedCache, kickRadarWork } from '$lib/server/radar';
import { sweepLeadRetention } from '@anomalia/leads-core/contact';
import { swallow } from '$lib/server/swallow';

// Radar ORCHESTRATOR: fetch every distinct source ONCE → DB cache → create one job per brand →
// fan out N workers (calculated from brand count) so the fleet drains in parallel chains, not one
// serial chain. Returns in seconds (no per-brand work here). Cron 4×/day; same auth gate as the
// autopilot. Supports ?brand=<slug> to run a single brand (testing).

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

// Each worker chain processes ~45 brands (9 batches × 5 per batch within 270s). The fan-out
// calculates how many parallel chains are needed to drain all jobs within one tick cycle. Capped at
// 50 to avoid overwhelming the AI provider with concurrent requests (50 chains × 5 batch = 250 peak
// concurrent brand ticks).
const BRANDS_PER_CHAIN = 45;
const MAX_FANOUT = 50;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

async function run(request: Request, platform: Platform): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const only = new URL(request.url).searchParams.get('brand');
  const origin = new URL(request.url).origin;

  // Cleanup: delete jobs + cache older than 7 days (bounded storage).
  const old = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  await Promise.all([
    admin.from('radar_jobs').delete().lt('created_at', old),
    admin.from('radar_feed_cache').delete().lt('fetched_at', old)
  ]);
  await sweepLeadRetention(admin, swallow);

  let q = admin
    .from('brands')
    .select('id, name, slug, org_id, timezone, status, plan, target_platforms, content_prefs, blog_config')
    .eq('status', 'active');
  if (only) q = q.eq('slug', only);
  const { data: brands } = await q;

  const activeBrands = (brands ?? []).filter((b) => radarPrefsOf(b.content_prefs).enabled);
  if (!activeBrands.length) {
    return new Response(JSON.stringify({ ok: true, jobsCreated: 0 }), { headers: { 'content-type': 'application/json' } });
  }

  // 1. Fetch every distinct source ONCE → DB cache (workers read this instead of refetching).
  const sourcesCached = await buildRadarFeedCache(admin, activeBrands.map((b) => String(b.id)));

  // 2. Create one job per brand (idempotent — unique brand_id+tick_id absorbs double-cron).
  const tickId = new Date().toISOString();
  const jobs = activeBrands.map((b) => ({ brand_id: b.id, tick_id: tickId }));
  await admin.from('radar_jobs').upsert(jobs, { onConflict: 'brand_id,tick_id', ignoreDuplicates: true });

  // 3. Fan out: kick N workers so the fleet drains in parallel. Each worker self-chains until the
  // queue is empty. With 1000 brands → ceil(1000/45) = 23 workers; each processes ~43 brands in
  // ~9 batches → ~270s. All 23 run concurrently → total wall-clock ≈ 5 min instead of 100 min.
  // waitUntil collects all kicks so Vercel keeps this function alive until they've all landed.
  const fanout = Math.min(MAX_FANOUT, Math.max(1, Math.ceil(activeBrands.length / BRANDS_PER_CHAIN)));
  const kicks: Promise<void>[] = [];
  for (let i = 0; i < fanout; i++) kicks.push(kickRadarWork(origin));
  if (platform?.context?.waitUntil) {
    platform.context.waitUntil(Promise.all(kicks));
  } else {
    Promise.all(kicks);
  }

  return new Response(JSON.stringify({ ok: true, jobsCreated: jobs.length, sourcesCached, fanout, tickId }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
export const POST: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
