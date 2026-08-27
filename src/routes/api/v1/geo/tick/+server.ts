import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { geoTickForBrand } from '$lib/server/geo';
import { jobPausedForBrand } from '$lib/server/job-roster';
import { reportToAgentThread } from '$lib/server/team-ignition';
import { recordLoopTick, nextRunBudgetMs } from '$lib/server/loop-ticks';
import { queueForLoop, markServed } from '$lib/server/loop-fairness';

// GEO tick: for every active brand, run the technical + citation audit and store one snapshot (the
// history powers the trend line). Weekly cron — GEO moves slowly. Same auth gate as the autopilot.
// Supports ?brand=<slug> to run a single brand (manual/testing).
//
// STORIA DI QUESTO FILE, perché spiega la forma che ha. Fino al 2026-08-22 la selezione era
// `.eq('status','active')` e basta: nessun ordine, nessun tetto, nessuna scadenza. Un audit costa
// ~60s di chiamate esterne (DataForSEO + citation audit su più motori), la finestra è di 300s,
// quindi passavano quattro o cinque brand e la function moriva. Siccome l'ordine senza `order by`
// lo decide il pianificatore e in pratica non cambia mai, erano SEMPRE gli stessi quattro o cinque.
// Misurato su 13 brand attivi: `with-love-from-brooklyn-2`, `dal-nulla` e `altro-agency` auditati
// sei settimane di fila; `kbpropertymanager` e `021` mai; `severoricami`, `desco-menu` e `bttrll-3`
// una volta in 45 giorni. In cascata si fermava anche l'agente SEO, che pretende una riga di audit
// GEO per partire. Niente falliva: si degradava.
//
// Adesso l'ordine è una decisione scritta (chi ha aspettato di più va per primo, `loop_cursors`),
// il claim precede i gate (un brand senza sito avanza lo stesso invece di tenersi il posto), e la
// finestra decide QUANTI brand, non QUALI: chi non ci sta è il primo del giro dopo.

export const config = { maxDuration: 300 };

// Tetto di brand per tick. Il vincolo vero è il tempo residuo (nextRunBudgetMs qui sotto): questo
// evita solo di leggere cursori per brand che la finestra non potrebbe mai raggiungere. Con ~60s
// per audit e 280s utili ne passano 4-5; 8 lascia margine se un giro è veloce.
const MAX_BRANDS_PER_TICK = 8;

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const t0 = Date.now();
  const admin = createAdminClient();
  const only = new URL(request.url).searchParams.get('brand');

  let q = admin
    .from('brands')
    .select('id, name, slug, website, content_prefs')
    .eq('status', 'active');
  if (only) q = q.eq('slug', only);
  const { data: brands } = await q;

  // La coda: chi aspetta da più tempo per primo. `?brand=` resta un percorso diagnostico e non
  // passa dalla coda — chi lo chiama vuole quel brand, non quello che tocca.
  const queue = only ? (brands ?? []) : await queueForLoop(admin, 'geo', brands ?? [], MAX_BRANDS_PER_TICK);

  let audited = 0;
  let paused = 0;
  let empty = 0;
  let deferred = 0;
  for (const brand of queue) {
    // La finestra decide quanti, non quali. Chi non ci sta non viene claimato, quindi al prossimo
    // giro è ancora davanti: il tick riparte da dove era arrivato, non dall'inizio della lista.
    if (!only && nextRunBudgetMs({ elapsedMs: Date.now() - t0 }) === null) {
      deferred++;
      recordLoopTick({ loop: 'geo', brandId: brand.id, outcome: 'skipped', reason: 'no_budget' });
      continue;
    }

    // IL CLAIM, prima di ogni gate e prima del lavoro. Un brand senza sito fa tornare `null` da
    // geoTickForBrand (nessun tech, nessuna citazione, nessuna ricerca) e prima di questa riga
    // restava in cima alla lista per sempre, riprovato ogni settimana senza mai lasciare il posto.
    if (!only) await markServed(admin, 'geo', brand.id);

    // Roster: dopo il claim (un lavoro spento non deve tenersi uno slot), prima dell'audit.
    if (await jobPausedForBrand('geo', brand.id)) {
      paused++;
      continue;
    }

    const startedAt = Date.now();
    const res = await geoTickForBrand(admin, brand);
    if (res) {
      audited++;
      // Il tick 'ok' che mancava: /agents legge SOLO loop_ticks, e senza questa riga un lavoro
      // che gira ogni settimana resta "mai girato" per sempre sulla sua card.
      recordLoopTick({ loop: 'geo', brandId: brand.id, outcome: 'ok', durationMs: Date.now() - startedAt });
      // Il resoconto nel thread dell'agente. Non alza mai; i giri saltati non scrivono.
      await reportToAgentThread(admin, brand.id, {
        job: 'geo',
        citability: res.citabilityScore ?? null,
        techScore: res.techScore ?? null
      });
    } else {
      // Il giro è avvenuto e non ha prodotto niente (quasi sempre: nessun sito da auditare). Prima
      // era un silenzio identico a "non è mai stato il suo turno", che sono due problemi diversi.
      empty++;
      recordLoopTick({
        loop: 'geo',
        brandId: brand.id,
        outcome: 'skipped',
        reason: 'empty_result',
        durationMs: Date.now() - startedAt
      });
    }
  }
  return new Response(JSON.stringify({ ok: true, audited, paused, empty, deferred, elapsedMs: Date.now() - t0 }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
