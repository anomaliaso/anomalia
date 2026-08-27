import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { runPrepublishTick } from '$lib/server/prepublish-check';

// Last-mile ship gate: scheduled posts whose slot is in the next ~18 minutes are judged by
// Gemini Flash (plus empty/placeholder/missing-media checks). A reject cancels Zernio and
// returns the post to pending_user. Same auth as the other ticks.

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const brandId = new URL(request.url).searchParams.get('brand')?.trim() || undefined;
  try {
    const result = await runPrepublishTick(createAdminClient(), { brandId });
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'prepublish tick failed';
    console.error('[prepublish] tick failed:', message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
