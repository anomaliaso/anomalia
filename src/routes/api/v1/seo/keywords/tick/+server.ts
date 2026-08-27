import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { ensureKeywordStrategy, isFresh, FRESH_DAYS } from '$lib/server/seo-keyword-strategy';
import { withBrandContext } from '$lib/server/ai-log';
import { hasWebHub } from '$lib/server/plans';
import { recordLoopTick, nextRunBudgetMs, type LoopSkipReason } from '$lib/server/loop-ticks';
import { queueForLoop, markServed } from '$lib/server/loop-fairness';

// Bi-weekly keyword research loop: cron hits weekly; we only regenerate when the row is older
// than FRESH_DAYS (14). Same auth gate as geo/autopilot ticks. Supports ?brand=<slug>.
//
// Prima del 2026-08-22: nessun ordine, nessun tetto, nessuna scadenza — la flotta intera dentro una
// finestra da 300s, e un brand la cui `ensureKeywordStrategy` fallisce non scrive `updated_at`,
// quindi non diventa mai fresco e viene ritentato per primo a ogni giro. Adesso l'ordine è una
// decisione (`loop_cursors`, migration 0213), il claim precede i gate, e la finestra decide quanti.

export const config = { maxDuration: 300 };

/**
 * Tetto di brand per tick. Il vincolo vero è il tempo residuo; questo evita solo di leggere cursori
 * per brand irraggiungibili. Una ricerca keyword è una chiamata AI più DataForSEO: ~30-60s.
 */
const MAX_BRANDS_PER_TICK = 8;

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const only = new URL(request.url).searchParams.get('brand');

  const t0 = Date.now();
  let q = admin.from('brands').select('id, name, slug, website, content_prefs, plan').eq('status', 'active');
  if (only) q = q.eq('slug', only);
  const { data: brands } = await q;

  // La coda: chi aspetta da più tempo per primo. `?brand=` è diagnostico e non passa dalla coda.
  const queue = only ? (brands ?? []) : await queueForLoop(admin, 'seo_keywords', brands ?? [], MAX_BRANDS_PER_TICK);

  let refreshed = 0;
  let skipped = 0;
  let deferred = 0;
  const skip = (brandId: string, reason: LoopSkipReason) => {
    skipped++;
    recordLoopTick({ loop: 'seo_keywords', brandId, outcome: 'skipped', reason });
  };

  for (const brand of queue) {
    // La finestra decide quanti, non quali: chi non ci sta non viene claimato ed è primo al giro dopo.
    if (!only && nextRunBudgetMs({ elapsedMs: Date.now() - t0 }) === null) {
      deferred++;
      recordLoopTick({ loop: 'seo_keywords', brandId: brand.id, outcome: 'skipped', reason: 'no_budget' });
      continue;
    }

    // IL CLAIM, prima dei gate e prima del lavoro.
    if (!only) await markServed(admin, 'seo_keywords', brand.id);

    if (!hasWebHub(brand.plan)) {
      skip(brand.id, 'no_plan');
      continue;
    }
    const { data: row } = await admin
      .from('brand_seo_keyword_strategy')
      .select('updated_at')
      .eq('brand_id', brand.id)
      .maybeSingle();
    if (row && isFresh(row.updated_at, FRESH_DAYS)) {
      skip(brand.id, 'fresh');
      continue;
    }
    const startedAt = Date.now();
    const ok = await withBrandContext(brand.id, async () => {
      const strategy = await ensureKeywordStrategy(admin, brand, { force: true });
      return !!strategy;
    }).catch((error) => { swallow('ensure keyword strategy', error); return false; });
    if (ok) {
      refreshed++;
      recordLoopTick({ loop: 'seo_keywords', brandId: brand.id, outcome: 'ok', durationMs: Date.now() - startedAt });
    } else {
      skipped++;
      recordLoopTick({
        loop: 'seo_keywords',
        brandId: brand.id,
        outcome: 'failed',
        reason: 'empty_result',
        durationMs: Date.now() - startedAt
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, refreshed, skipped, deferred, elapsedMs: Date.now() - t0 }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
