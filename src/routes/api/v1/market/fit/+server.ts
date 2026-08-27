import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { marketFit } from '$lib/server/market-harvest';
import { MIN_CORRELATION_PAIRS } from '$lib/server/market-metrics';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

/**
 * GET /api/v1/market/fit — does each rubric check actually track posts that beat their own baseline?
 *
 * Read `overall` for the headline and `byFormat` for the honest version: a check can correlate
 * across the whole pool purely because the accounts that write good hooks also post more video.
 *
 * `discoveredBaselineShare` is the health warning. The closer it is to 1, the more of the fit rests
 * on baselines accumulated from discovery — which are biased high, so the multiples are understated.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  try {
    const fit = await marketFit(createAdminClient(), {
      limit: Number(url.searchParams.get('limit') ?? '') || undefined
    });

    const notes: string[] = [];
    if (!fit.overall.length) {
      notes.push(
        `Nessuna correlazione riportabile: servono almeno ${MIN_CORRELATION_PAIRS} post etichettati per check (etichettati ora: ${fit.pool.labelled}).`
      );
    }
    if (fit.discoveredBaselineShare > 0.5) {
      notes.push(
        `${Math.round(fit.discoveredBaselineShare * 100)}% delle baseline viene dal pool di discovery: sono distorte verso l'alto, quindi le sovraperformance sono sottostimate. Usa il fit per ORDINARE i check, non per leggerne i multipli.`
      );
    }
    if (!fit.overall.some((c) => c.significant)) {
      notes.push('Nessun check supera il rumore: o il pool è ancora piccolo, o il rubric non predice nulla.');
    }

    return json({ ok: true, ...fit, notes });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[market/fit]', message);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
