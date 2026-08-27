import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { attemptDelivery, claimDueDeliveries } from '$lib/server/brand-webhooks';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

/** Retries whatever the first attempt could not deliver. Cron drives this. */
async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const due = await claimDueDeliveries(admin);
  let delivered = 0;
  for (const { delivery, webhook } of due) {
    const ok = await attemptDelivery(admin, delivery, webhook).catch((e) => {
      console.error('[webhooks/work]', e);
      return false;
    });
    if (ok) delivered += 1;
  }
  return new Response(JSON.stringify({ ok: true, claimed: due.length, delivered }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
