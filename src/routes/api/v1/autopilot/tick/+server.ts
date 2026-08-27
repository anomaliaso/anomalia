import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { runAutopilotForBrand, REVIEW_GRACE_MS, type AutopilotBrand } from '$lib/server/scheduler';
import { dailyReconciliation } from '$lib/server/reconciliation';
import { recordLoopTick, nextRunBudgetMs } from '$lib/server/loop-ticks';
import { queueForLoop, markServed } from '$lib/server/loop-fairness';
import { reportToAgentThread } from '$lib/server/team-ignition';

// Tick giornaliero dell'autopilot. Due modi di chiamarlo: Vercel Cron (GET con
// `Authorization: Bearer $CRON_SECRET`, iniettato in automatico), o uno scheduler esterno con
// l'header X-Autopilot-Secret.
//
// Client admin (service-role) di proposito: su un cron non c'è sessione utente e serve leggere e
// scrivere su TUTTI i brand, quindi si bypassa RLS. L'unico cancello è il segreto.

// La generazione per brand (Gemini + render) è lenta: serve spazio.
export const config = { maxDuration: 300 };

/**
 * Il vincolo vero è il tempo residuo (nextRunBudgetMs nel ciclo): questo tetto evita solo di
 * leggere cursori per brand che la finestra da 300s non potrebbe mai raggiungere.
 */
const MAX_BRANDS_PER_TICK = 12;

// Oltre questa età un run 'pending' non è "in volo", è un cadavere: la function muore a 300s e
// il run ucciso a metà lascia la riga com'era. Un'ora è larghissima.
const STALE_RUN_MS = 60 * 60 * 1000;

// Le finestre sono di proposito un filo più corte della cadenza letterale: un tick che parte in
// anticipo (deriva d'orologio, jitter del cron) deve far passare il brand, non slittare di un giorno.
const DAY = 24 * 60 * 60 * 1000;
function windowMs(frequency: string | null | undefined): number {
  if (frequency === 'daily') return 1 * DAY;
  if (frequency === '5/week') return 1.4 * DAY;
  if (frequency === '3/week') return 3.5 * DAY;
  return 7 * DAY; // unknown/null → at most once a week
}

// `last_autopilot_run_at` si scrive SOLO sui successi, così un run fallito non blocca il
// tentativo dopo (a quello pensa il contatore di fallimenti). Con un piano editoriale attivo la
// finestra è piatta a ~una settimana: un batch per settimana editoriale, qualunque sia la cadenza.
const PLAN_WINDOW_MS = 6.5 * DAY; // a touch under 7d so cron jitter never slips a week
function isDue(
  brand: { last_autopilot_run_at: string | null; content_prefs: unknown },
  now: number,
  hasActivePlan: boolean,
  // Una bozza in attesa con la grazia scaduta rende il brand "due" IGNORANDO la finestra: la
  // produzione deve seguire la mail del piano di circa un giorno, non di una finestra intera.
  draftCreatedAt: string | null
): boolean {
  if (draftCreatedAt) {
    const draftAge = now - Date.parse(draftCreatedAt);
    if (Number.isFinite(draftAge) && draftAge >= REVIEW_GRACE_MS) return true;
  }
  if (!brand.last_autopilot_run_at) return true;
  const last = Date.parse(brand.last_autopilot_run_at);
  if (Number.isNaN(last)) return true; // illeggibile: meglio girare che restare bloccati
  if (hasActivePlan) return now - last >= PLAN_WINDOW_MS;
  const freq = (brand.content_prefs as { frequency?: string } | null)?.frequency;
  return now - last >= windowMs(freq);
}

async function runTick(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  // `{ brand_id }` restringe il run a UN brand. Il tick per-brand della CLI ci chiama col segreto
  // del server DOPO il suo controllo di proprietà: senza questa restrizione chiunque possa
  // scrivere su un brand farebbe girare (e pagare) l'autopilot di tutti gli altri.
  const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
  const onlyBrandId = typeof body?.brand_id === 'string' ? body.brand_id : null;

  const admin = createAdminClient();
  const now = Date.now();

  // Il "due" si filtra in JS: la finestra dipende da content_prefs.frequency del singolo brand,
  // scomodo da esprimere in SQL. Non si filtra su `autopilot_enabled` (ritirato): il gate —
  // piano a pagamento + opt-out — sta dentro runAutopilotForBrand come per ogni altro agente.
  let query = admin
    .from('brands')
    .select(
      'id, name, slug, plan, timezone, target_platforms, content_prefs, autopilot_failure_count, org_id, last_autopilot_run_at, activated_at, zernio_profile_id, blog_config'
    )
    .eq('status', 'active');
  if (onlyBrandId) query = query.eq('id', onlyBrandId);
  const { data: brands, error } = await query;

  if (error) {
    console.error('[autopilot tick] could not load brands:', error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

  const ids = (brands ?? []).map((b) => b.id);
  const { data: planRows } = ids.length
    ? await admin.from('editorial_plans').select('brand_id').eq('status', 'active').in('brand_id', ids)
    : { data: [] };
  const planned = new Set((planRows ?? []).map((r) => r.brand_id as string));

  // Solo le bozze create DALL'AUTOPILOT: una bozza manuale da /plan non fa mai partire una
  // produzione anticipata, perché lì l'utente ci sta lavorando sopra.
  const { data: draftRowsAll } = ids.length
    ? await admin
        .from('content_plans')
        .select('brand_id, created_at')
        .eq('status', 'draft')
        .eq('source', 'scheduled_cron')
        .in('brand_id', ids)
        .order('created_at', { ascending: false })
    : { data: [] };
  const draftAt = new Map<string, string>();
  for (const r of draftRowsAll ?? []) {
    if (!draftAt.has(r.brand_id as string)) draftAt.set(r.brand_id as string, String(r.created_at));
  }

  const due = (brands ?? []).filter((b) => isDue(b, now, planned.has(b.id), draftAt.get(b.id) ?? null));

  // L'ORDINE è una decisione: chi ha aspettato di più va per primo (`loop_cursors`). È un cursore
  // DIVERSO da `last_autopilot_run_at` e la distinzione conta: quello dice quando il brand ha
  // PRODOTTO (gate di cadenza, si scrive solo sui successi, o ogni fallimento slitterebbe di una
  // settimana); questo dice quando il tick lo ha TENTATO, ed è ciò che serve per non ritentare
  // sempre gli stessi — un brand che fallisce da mesi resta "due" per sempre.
  const queue = onlyBrandId ? due : await queueForLoop(admin, 'autopilot', due, MAX_BRANDS_PER_TICK);

  let processed = 0;
  let skipped = 0;
  let deferred = 0;
  const errors: { brand: string; reason: string }[] = [];
  const t0 = Date.now();

  for (const brand of queue) {
    // La finestra decide quanti, non quali: un run che non ci sta viene ucciso a metà dopo aver
    // speso i suoi token e prima di scrivere. Chi non ci sta non viene claimato, quindi al giro
    // dopo è ancora davanti.
    if (!onlyBrandId && nextRunBudgetMs({ elapsedMs: Date.now() - t0 }) === null) {
      deferred++;
      recordLoopTick({ loop: 'autopilot', brandId: brand.id, outcome: 'skipped', reason: 'no_budget' });
      continue;
    }
    // Il claim va PRIMA della mietitura dei run morti e di ogni gate.
    if (!onlyBrandId) await markServed(admin, 'autopilot', brand.id);

    // Guardia anti-sovrapposizione. Ma un 'pending' non scade da solo: la function che muore a
    // 300s lascia la riga per sempre e la guardia salterebbe quel brand a OGNI giro successivo,
    // senza lasciare traccia. Quindi prima si seppelliscono i cadaveri.
    const staleCutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
    const { data: reaped } = await admin
      .from('scheduler_runs')
      .update({ status: 'failed', error: 'run interrupted — no outcome recorded (function window)' })
      .eq('brand_id', brand.id)
      .eq('status', 'pending')
      .lt('created_at', staleCutoff)
      .select('id');
    if (reaped?.length) {
      // Un run ucciso a metà va contato come fallimento: è `autopilot_failure_count` ad accendere
      // l'avviso nella campanella e, a tre di fila, a far spegnere il lavoro al watchdog. Il primo
      // run riuscito lo riazzera, quindi un timeout isolato non fa rumore.
      await admin
        .from('brands')
        .update({ autopilot_failure_count: (brand.autopilot_failure_count ?? 0) + 1 })
        .eq('id', brand.id);
      console.warn(`[autopilot tick] ${brand.slug}: ${reaped.length} stale pending run(s) reaped as failed.`);
    }

    const { count: inFlight } = await admin
      .from('scheduler_runs')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id)
      .eq('status', 'pending')
      .gte('created_at', staleCutoff);
    if ((inFlight ?? 0) > 0) {
      skipped += 1;
      // «Ogni `continue` scrive una riga» (loop-ticks.ts): un salto muto rende invisibile uno stallo.
      recordLoopTick({ loop: 'autopilot', brandId: brand.id, outcome: 'skipped', reason: 'in_flight' });
      console.warn(`[autopilot tick] ${brand.slug}: pending run in flight — skipping.`);
      continue;
    }

    // Ogni brand lavorato lascia una riga, esito compreso: runAutopilotForBrand ha sette modi
    // diversi di non produrre, e senza questa riga «l'autopilot non fa niente» non ha risposta.
    const startedAt = Date.now();
    try {
      const res = await runAutopilotForBrand(admin, brand as AutopilotBrand);
      if (res.ran) {
        processed += 1;
        console.log(
          `[autopilot tick] ${brand.slug}: ${res.postsCreated} posts awaiting approval, emailed=${res.emailed ?? false}`
        );
        // Resoconto nel thread del producer. Non alza mai, e i giri saltati non scrivono.
        await reportToAgentThread(admin, brand.id, {
          job: 'autopilot',
          postsCreated: res.postsCreated ?? 0,
          emailed: res.emailed ?? false,
          ...(res.planned ? { planned: true } : {})
        });
      } else {
        skipped += 1;
        console.log(`[autopilot tick] ${brand.slug}: skipped (${res.reason}).`);
      }
      recordLoopTick({
        loop: 'autopilot',
        brandId: brand.id,
        outcome: res.ran ? 'ok' : 'skipped',
        reason: res.ran ? null : (res.reason ?? 'unknown'),
        durationMs: Date.now() - startedAt
      });
    } catch (e) {
      // runAutopilotForBrand è fatto per non alzare, ma un brand non deve mai uccidere il ciclo.
      const reason = e instanceof Error ? e.message : 'run threw';
      errors.push({ brand: brand.slug, reason });
      console.error(`[autopilot tick] ${brand.slug} threw:`, reason);
      recordLoopTick({
        loop: 'autopilot',
        brandId: brand.id,
        outcome: 'failed',
        reason,
        durationMs: Date.now() - startedAt
      });
    }
  }

  // Riconciliazione DB↔Zernio. Dopo il ciclo principale, così i post freschi sono già scritti.
  let reconciliation = { checked: 0, brandsWithDivergence: 0, details: [] as Array<{ brand: string; divergent: unknown[]; fixed: number; failed: number }> };
  try {
    // Operazione su tutta la flotta: mai su un tick a brand singolo, che è innescato da un
    // utente — riconciliare gli altri tenant per suo conto è l'escalation che brand_id chiude.
    if (!onlyBrandId) reconciliation = await dailyReconciliation(admin);
    if (reconciliation.brandsWithDivergence > 0) {
      console.warn(`[autopilot tick] reconciliation: ${reconciliation.brandsWithDivergence} brands with divergent schedules`, reconciliation.details);
    }
  } catch (e) {
    console.error('[autopilot tick] reconciliation failed:', e instanceof Error ? e.message : e);
  }

  return new Response(JSON.stringify({ ok: true, considered: due.length, queued: queue.length, processed, skipped, deferred, errors, reconciliation: { checked: reconciliation.checked, divergent: reconciliation.brandsWithDivergence } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => runTick(request);
export const POST: RequestHandler = ({ request }) => runTick(request);
