import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { sendDailyRadarRecap, radarPrefsOf } from '$lib/server/radar';
import { jobPausedForBrand } from '$lib/server/job-roster';
import { reportToAgentThread } from '$lib/server/team-ignition';
import { recordLoopTick } from '$lib/server/loop-ticks';
import { queueForLoop, markServed } from '$lib/server/loop-fairness';

// Radar DAILY recap: one digest email per brand aggregating the day's radar posts + comment/DM
// suggestions. Decoupled from scanning (the tick runs several times a day but never emails). Cron
// 1×/day. Supports ?brand=<slug> for testing.

export const config = { maxDuration: 300 };

// How many brands to email in parallel. Each recap is DB queries + one email send (~1-2s), so a
// pool of 10 drains 1000 brands in ~2 min.
const POOL = 10;

/**
 * Tetto di brand per giro. Oggi non morde (3 brand con il radar acceso, ~2s l'uno: la flotta intera
 * finisce in sei secondi) ed è scritto per quando morderà: 1000 brand × 2s ÷ 10 worker sono ~200s,
 * cioè già dentro il rumore della finestra da 300s. Con la coda ordinata, superare il tetto non
 * significa più "gli ultimi non ricevono l'email mai": significa "la ricevono al giro dopo".
 */
const MAX_BRANDS_PER_TICK = 600;

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const only = new URL(request.url).searchParams.get('brand');

  let q = admin
    .from('brands')
    .select('id, name, slug, org_id, timezone, status, content_prefs')
    .eq('status', 'active');
  if (only) q = q.eq('slug', only);
  const { data: brands } = await q;

  // Skip emailPerRun brands: they're already emailed at the end of each run, so the daily digest
  // would just double-notify them.
  const eligible = (brands ?? []).filter((b) => {
    const p = radarPrefsOf(b.content_prefs);
    return p.enabled && !p.emailPerRun;
  });

  // La coda: chi aspetta da più tempo per primo. `?brand=` è diagnostico e non passa dalla coda.
  const activeBrands = only
    ? eligible
    : await queueForLoop(admin, 'radar_recap', eligible, MAX_BRANDS_PER_TICK);

  // Concurrency pool: N workers pull from a shared index, each sending one recap at a time. This
  // turns 1000 sequential emails (~20 min) into ~N parallel streams (~2 min at POOL=10).
  let sent = 0;
  let paused = 0;
  let quiet = 0;
  let idx = 0;
  const workers = Array.from({ length: Math.min(POOL, activeBrands.length) }, async () => {
    while (idx < activeBrands.length) {
      const brand = activeBrands[idx++];
      // IL CLAIM, prima di ogni gate: chi è stato valutato ha avuto il suo turno, anche se il
      // digest non parte perché oggi non c'era niente da raccontare.
      if (!only) await markServed(admin, 'radar_recap', brand.id);
      // Roster: dopo il claim, prima di comporre e mandare il digest.
      if (await jobPausedForBrand('radar_recap', brand.id)) {
        paused++;
        continue;
      }
      if (await sendDailyRadarRecap(admin, brand)) {
        sent++;
        // Il resoconto nel thread dell'agente, solo quando il digest è partito davvero (un giorno
        // senza trovati non scrive niente). Non alza mai.
        // Il tick 'ok' che mancava: /agents legge SOLO loop_ticks, e senza questa riga un
        // lavoro che gira ogni settimana resta "mai girato" per sempre sulla sua card.
        recordLoopTick({ loop: 'radar_recap', brandId: brand.id, outcome: 'ok' });
        await reportToAgentThread(admin, brand.id, { job: 'radar_recap', sent: true });
      } else {
        // Giorno senza trovati: il giro è avvenuto e non ha prodotto. Prima era un silenzio
        // identico a «non è mai partito», e su /agents un brand tranquillo sembrava un brand rotto.
        quiet++;
        recordLoopTick({ loop: 'radar_recap', brandId: brand.id, outcome: 'skipped', reason: 'empty_result' });
      }
    }
  });
  await Promise.all(workers);

  return new Response(JSON.stringify({ ok: true, recapsSent: sent, paused, quiet }), { headers: { 'content-type': 'application/json' } });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
