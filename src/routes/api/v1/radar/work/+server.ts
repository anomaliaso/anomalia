import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { radarTickForBrand, kickRadarWork } from '$lib/server/radar';

// Radar WORKER: claims batches of pending radar_jobs via an ATOMIC RPC (FOR UPDATE SKIP LOCKED —
// dozens of concurrent workers never double-claim), processes each brand's full radar pass in
// parallel, and keeps going until its time budget (~270s) runs out, then self-chains. Each call is
// one serverless function with its own 300s timeout — the orchestrator fans out N workers so the
// fleet of 1000 brands is drained by ~20 parallel chains, not one serial chain. The */2 cron is the
// backstop: it re-drains any jobs a dropped kick or killed function left behind.

export const config = { maxDuration: 300 };

// Brands processed in parallel per batch within one function invocation. Each brand tick is
// independent (own AI calls, own DB writes) — this controls the concurrency within a single worker.
const BATCH_SIZE = 5;
// Process batches until this much wall-clock has elapsed, then self-chain. Leaves ~30s margin
// under the 300s maxDuration for the final batch + self-chain fetch.
const TIME_BUDGET_MS = 270_000;
// A 'running' job older than this is stalled (function killed mid-process) and may be re-claimed.
const STALL_MS = 6 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClaimedJob = { id: string; brand_id: string; tick_id: string };

async function run(request: Request, platform: Platform): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const origin = new URL(request.url).origin;
  const stallIso = new Date(Date.now() - STALL_MS).toISOString();

  let processed = 0;
  let failed = 0;
  const startedAt = Date.now();

  // Process batch after batch until the time budget is exhausted or the queue is drained. Each
  // iteration: atomic claim → parallel process → persist results. The loop lets a single worker
  // invocation handle as many brands as fit in ~270s (≈9 batches × 5 = ~45 brands), maximising the
  // work per function invocation and minimising self-chain overhead.
  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    // Atomic claim via RPC — race-free with concurrent workers (FOR UPDATE SKIP LOCKED).
    const { data: claimed, error } = await admin.rpc('claim_radar_jobs', {
      p_limit: BATCH_SIZE,
      p_stall_iso: stallIso
    });
    if (error || !claimed?.length) break;

    const jobs = claimed as ClaimedJob[];

    // Load brand data for the claimed jobs (one query for the batch).
    const brandIds = [...new Set(jobs.map((j) => j.brand_id))];
    const { data: brandRows } = await admin
      .from('brands')
      .select('id, name, slug, org_id, timezone, status, plan, target_platforms, content_prefs, blog_config')
      .in('id', brandIds);
    const brandMap = new Map((brandRows ?? []).map((b) => [b.id as string, b]));

    // Process all brands in the batch in parallel — each is independent.
    const results = await Promise.allSettled(
      jobs.map(async (job) => {
        const brand = brandMap.get(job.brand_id);
        if (!brand) throw new Error('brand not found');
        return radarTickForBrand(admin, brand);
      })
    );

    // Persist job outcomes.
    const finishedAt = new Date().toISOString();
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        await admin.from('radar_jobs').update({ status: 'done', result: result.value, finished_at: finishedAt }).eq('id', job.id);
        processed++;
      } else {
        const error = result.reason instanceof Error ? result.reason.message : 'unknown error';
        await admin.from('radar_jobs').update({ status: 'failed', error, finished_at: finishedAt }).eq('id', job.id);
        failed++;
      }
    }
  }

  // Self-chain: kick the next worker if there are still pending jobs. waitUntil so Vercel keeps
  // this function alive just long enough for the fetch to land — the response returns immediately.
  const { count: remaining } = await admin.from('radar_jobs').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  if ((remaining ?? 0) > 0) {
    if (platform?.context?.waitUntil) {
      platform.context.waitUntil(kickRadarWork(origin));
    } else {
      kickRadarWork(origin);
    }
  }

  return new Response(JSON.stringify({ ok: true, processed, failed, remaining: remaining ?? 0 }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
export const POST: RequestHandler = ({ request, platform }) => run(request, platform as Platform);
