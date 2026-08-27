import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { checkAccountHealth, recordAccountIncidents } from '$lib/server/account-health';

// Account-health tick: detects connected social accounts whose publish attempts keep failing
// (>= 3 failures AND >= 70% of attempts in the last 7 days) and records a per-brand
// `account_failing` incident (deduped per brand+kind+day). No email — incidents + console.error.
// Auth same as the other ticks (CRON_SECRET / X-Autopilot-Secret, dev bypass).

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const admin = createAdminClient();
  try {
    const { failing } = await checkAccountHealth(admin);
    if (failing.length > 0) {
      console.error(
        `[account-health] ${failing.length} social account(s) failing:`,
        failing.map((f) => ({
          account: f.social_account_id,
          brand: f.brand_id,
          platform: f.platform,
          failures: f.failures,
          total: f.total,
          lastError: f.lastError
        }))
      );
      await recordAccountIncidents(admin, failing);
    }
    return new Response(JSON.stringify({ ok: true, failing }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'account health check failed';
    console.error('[account-health] tick failed:', message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
