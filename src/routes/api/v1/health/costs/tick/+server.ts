import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';

// Cost-health tick: alerts when AI spend accumulates on ai_calls rows with NO brand
// attribution (brand_id null). Those calls are never billed to a brand and never hit a
// credit quota, so they only show up here. Runs daily (04:00 UTC, vercel.json).
// Auth same as the other ticks (CRON_SECRET / X-Autopilot-Secret, dev bypass).

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

const WINDOW_HOURS = 24;
const ALERT_THRESHOLD_USD = 1.0;
const INCIDENT_KIND = 'unattributed_ai_cost';

/**
 * The incidents table requires a brand_id (NOT NULL FK → brands, migration 0084), so a
 * platform-level alert can't be stored with a null brand. It is attached to the platform's
 * own brand (slug 'anomalia') when one exists; otherwise the alert is logged only.
 */
async function sentinelBrandId(admin: Awaited<ReturnType<typeof createAdminClient>>): Promise<string | null> {
  const { data: active } = await admin
    .from('brands')
    .select('id')
    .eq('slug', 'anomalia')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (active?.id) return active.id;
  const { data: anyRow } = await admin
    .from('brands')
    .select('id')
    .eq('slug', 'anomalia')
    .limit(1)
    .maybeSingle();
  return anyRow?.id ?? null;
}

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();

  const { data: rows, error } = await admin
    .from('ai_calls')
    .select('cost_usd')
    .is('brand_id', null)
    .gte('created_at', since);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

  let total = 0;
  for (const r of rows ?? []) {
    const c = Number(r.cost_usd);
    if (Number.isFinite(c) && c > 0) total += c;
  }
  const calls24h = rows?.length ?? 0;
  let alerted = false;

  if (total > ALERT_THRESHOLD_USD) {
    console.error(
      `[cost-alert] ${total.toFixed(2)} USD of unattributed AI cost from ${calls24h} calls (brand_id null) in the last ${WINDOW_HOURS}h — credits are not being billed to any brand.`
    );

    try {
      const sentinel = await sentinelBrandId(admin);
      if (sentinel) {
        // Dedup: one incident per kind+brand+day. incidents.brand_id is NOT NULL so the
        // alert is scoped to the sentinel brand (unique(brand_id, kind, detected_on)).
        const today = new Date().toISOString().slice(0, 10);
        const { data: existing } = await admin
          .from('incidents')
          .select('id')
          .eq('brand_id', sentinel)
          .eq('kind', INCIDENT_KIND)
          .eq('detected_on', today)
          .maybeSingle();

        if (existing) {
          console.error(`[cost-alert] incident for ${today} already open — skipping duplicate.`);
        } else {
          const { error: insertErr } = await admin.from('incidents').insert({
            brand_id: sentinel,
            kind: INCIDENT_KIND,
            severity: 'critical',
            details: {
              message: `${total.toFixed(2)} USD unattributed AI cost from ${calls24h} calls in ${WINDOW_HOURS}h (brand_id null)`,
              totalUsd: Math.round(total * 1e6) / 1e6,
              calls24h,
              windowHours: WINDOW_HOURS
            },
            detected_at: new Date().toISOString()
          });
          if (insertErr) {
            console.error('[cost-alert] incident insert failed:', insertErr.message);
          } else {
            alerted = true;
          }
        }
      } else {
        console.error('[cost-alert] no sentinel brand (slug=anomalia) found — alert logged without incident row.');
      }
    } catch (e) {
      console.error('[cost-alert] incident handling failed:', e instanceof Error ? e.message : e);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      cost24h: Math.round(total * 1e6) / 1e6,
      calls24h,
      alerted
    }),
    { headers: { 'content-type': 'application/json' } }
  );
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
