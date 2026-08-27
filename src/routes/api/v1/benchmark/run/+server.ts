import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { CONTENT_SCORER_VERSION } from '$lib/server/content-quality';
import { compareCohorts, summarizeSamples } from '$lib/server/benchmark';
import { loadSamples, scoreGoldenRun, type GoldenCandidate } from '$lib/server/benchmark-store';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

const MAX_CANDIDATES = 500;

/**
 * POST /api/v1/benchmark/run — score a batch of generated candidates as one named golden run.
 *
 *   {
 *     "label": "week-planner v3 — dopo lo swap del modello",
 *     "notes": "stessi 40 brief del run baseline-2026-08-17",
 *     "against": "<runId>",                       // optional: compare with an earlier run
 *     "candidates": [
 *       { "caption": "...", "platform": "instagram", "brandId": "<uuid>" }
 *     ]
 *   }
 *
 * Run it once before a change and once after, over the SAME briefs, then read `comparison`.
 */
export const POST: RequestHandler = async ({ request }) => {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'body JSON non valido' }, { status: 400 });
  }

  const label = String(body.label ?? '').trim();
  if (!label) return json({ ok: false, error: 'label obbligatoria' }, { status: 400 });

  const raw = Array.isArray(body.candidates) ? body.candidates : [];
  if (!raw.length) return json({ ok: false, error: 'candidates vuoto' }, { status: 400 });
  if (raw.length > MAX_CANDIDATES) {
    return json({ ok: false, error: `massimo ${MAX_CANDIDATES} candidates per run` }, { status: 400 });
  }

  const candidates: GoldenCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.caption !== 'string') continue;
    candidates.push({
      caption: rec.caption,
      platform: rec.platform ? String(rec.platform) : null,
      brandId: rec.brandId ? String(rec.brandId) : null,
      recentCaptions: Array.isArray(rec.recentCaptions) ? rec.recentCaptions.map((c) => String(c)) : undefined
    });
  }
  if (!candidates.length) return json({ ok: false, error: 'nessun candidate con una caption' }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { runId, scored } = await scoreGoldenRun(admin, {
      label,
      notes: body.notes ? String(body.notes) : null,
      candidates
    });

    const samples = runId ? await loadSamples(admin, { runId }) : [];
    const against = body.against ? String(body.against) : '';
    const comparison = against
      ? compareCohorts(await loadSamples(admin, { runId: against }), samples)
      : null;

    return json({
      ok: true,
      runId,
      scored,
      scorerVersion: CONTENT_SCORER_VERSION,
      summary: summarizeSamples(samples),
      comparison
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[benchmark/run]', message);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
