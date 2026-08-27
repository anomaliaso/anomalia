import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { CONTENT_SCORER_VERSION } from '$lib/server/content-quality';
import {
  byRelease,
  compareCohorts,
  correlateWithHumanSignal,
  pairedByBrand,
  summarizeSamples
} from '$lib/server/benchmark';
import { loadHumanSignalPairs, loadSamples, releaseTag } from '$lib/server/benchmark-store';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

// Internal read: cron/admin secret only. This is fleet-wide data across every brand, so it must
// never be reachable with a user session.

/**
 * GET /api/v1/benchmark
 *
 *   (no params)                      → current index, per-release breakdown, human-signal check
 *   ?before=ISO&after=ISO            → compare content created before vs after a cutoff
 *   ?before_release=X&after_release=Y→ compare two builds directly
 *   ?paired=1                        → restrict both cohorts to brands present on both sides
 *   ?brand=<uuid>                    → scope everything to one brand
 *
 * The cutoff form is the one to use after shipping a prompt/model change: pass the deploy time.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const admin = createAdminClient();
  const brandId = url.searchParams.get('brand')?.trim() || undefined;
  const paired = url.searchParams.get('paired') === '1';

  const beforeRelease = url.searchParams.get('before_release')?.trim();
  const afterRelease = url.searchParams.get('after_release')?.trim();
  const cutoff = url.searchParams.get('after')?.trim() || url.searchParams.get('cutoff')?.trim();

  try {
    // ── Comparison mode ──────────────────────────────────────────────────────────────────────
    if (beforeRelease && afterRelease) {
      const before = await loadSamples(admin, { release: beforeRelease, brandId });
      const after = await loadSamples(admin, { release: afterRelease, brandId });
      const cohorts = paired ? pairedByBrand(before, after) : { before, after };
      return json({
        ok: true,
        mode: 'release',
        scorerVersion: CONTENT_SCORER_VERSION,
        paired,
        before: beforeRelease,
        after: afterRelease,
        comparison: compareCohorts(cohorts.before, cohorts.after)
      });
    }

    if (cutoff) {
      const at = new Date(cutoff);
      if (Number.isNaN(at.getTime())) {
        return json({ ok: false, error: 'cutoff non è una data ISO valida' }, { status: 400 });
      }
      const iso = at.toISOString();
      const before = await loadSamples(admin, { until: iso, brandId });
      const after = await loadSamples(admin, { since: iso, brandId });
      const cohorts = paired ? pairedByBrand(before, after) : { before, after };
      return json({
        ok: true,
        mode: 'cutoff',
        scorerVersion: CONTENT_SCORER_VERSION,
        paired,
        cutoff: iso,
        comparison: compareCohorts(cohorts.before, cohorts.after)
      });
    }

    // ── Overview mode ────────────────────────────────────────────────────────────────────────
    const samples = await loadSamples(admin, { brandId });
    const releases = [...byRelease(samples).entries()]
      .map(([release, list]) => ({ release, ...summarizeSamples(list) }))
      .sort((a, b) => b.n - a.n);

    const humanSignal = correlateWithHumanSignal(await loadHumanSignalPairs(admin));

    return json({
      ok: true,
      mode: 'overview',
      scorerVersion: CONTENT_SCORER_VERSION,
      currentRelease: releaseTag(),
      overall: summarizeSamples(samples),
      releases,
      // Negative r = higher index means fewer user edits, i.e. the rubric tracks reality.
      humanSignal
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[benchmark]', message);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
