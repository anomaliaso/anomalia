import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { isFieldFresh, runFieldWatch } from '$lib/server/market-field';
import { withBrandContext } from '$lib/server/ai-log';
import { isPaidPlan } from '$lib/server/plans';
import { recordLoopTick, nextRunBudgetMs, type LoopSkipReason } from '$lib/server/loop-ticks';
import { queueForLoop, markServed } from '$lib/server/loop-fairness';

// Field watch tick — chi ottiene attenzione NEL CAMPO di ogni brand, smontato e distillato.
//
// Cron GIORNALIERO con un tetto di brand per run, non settimanale con tutti: una passata fa una
// manciata di ricerche più un teardown per ogni post nuovo, e tre di fila stanno comode nel budget
// della funzione. Ogni brand resta comunque su cadenza settimanale — è `isFieldFresh` a decidere
// chi tocca, non il calendario del cron. Sta fuori dal tick delle market references di proposito:
// quello richiede competitor con handle, e il field watch serve soprattutto quando quelli mancano.
//
// IL BLOCCO CHE QUESTO FILE AVEVA, fino al 2026-08-22. Il gate chiedeva `row?.field_playbook`, ma
// `buildFieldPlaybook` torna `null` (non lancia) sotto i tre teardown: un brand piccolo o silenzioso
// non poteva soddisfarlo MAI. Restava in cima a una lista senza ordinamento, si prendeva uno dei tre
// slot ogni singolo giorno — ricerche e teardown veri, pagati — e non lo lasciava più. Misurato: 4
// brand su 13 avevano un field post, gli altri nove zero, per sempre. Adesso il claim
// (`loop_cursors`, migration 0213) precede il lavoro: chi non produce avanza lo stesso.
//
// E ogni giro scrive in `loop_ticks`: prima questo lavoro non ne scriveva NESSUNA, quindi su
// /agents era indistinguibile da uno che non è mai partito.

export const config = { maxDuration: 300 };

/** Brand LAVORATI per run. Con il cron giornaliero fanno ~21 passate a settimana. */
const MAX_PER_TICK = 3;
/**
 * Quanti brand il tick GUARDA. Più alto di MAX_PER_TICK perché i gate (piano, freschezza) costano
 * una query: fermarsi al terzo *guardato* invece che al terzo *lavorato* significherebbe non
 * lavorare più nessuno appena tre brand freschi finiscono in cima alla coda.
 */
const MAX_SCAN_PER_TICK = 50;

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const admin = createAdminClient();
  const only = new URL(request.url).searchParams.get('brand');

  const t0 = Date.now();
  let q = admin.from('brands').select('id, name, slug, plan').eq('status', 'active');
  if (only) q = q.eq('slug', only);
  const { data: brands } = await q;

  // La coda: chi aspetta da più tempo per primo. `?brand=` è diagnostico e non passa dalla coda.
  const queue = only ? (brands ?? []) : await queueForLoop(admin, 'field', brands ?? [], MAX_SCAN_PER_TICK);

  let runs = 0;
  let linked = 0;
  let teardowns = 0;
  let playbooks = 0;
  let skipped = 0;
  const skip = (brandId: string, reason: LoopSkipReason) => {
    skipped++;
    recordLoopTick({ loop: 'field', brandId, outcome: 'skipped', reason });
  };

  for (const brand of queue) {
    if (runs >= MAX_PER_TICK && !only) break;
    // La finestra decide quanti, non quali: chi non ci sta non viene claimato e resta in testa alla
    // coda del giro dopo.
    if (!only && nextRunBudgetMs({ elapsedMs: Date.now() - t0 }) === null) break;

    // IL CLAIM, prima di ogni gate e prima del lavoro. È la riga che chiude il blocco descritto
    // sopra: il brand sotto i tre teardown avanza lo stesso invece di tenersi lo slot per sempre.
    if (!only) await markServed(admin, 'field', brand.id);

    if (!isPaidPlan(brand.plan)) {
      skip(brand.id, 'no_plan');
      continue;
    }

    const { data: row } = await admin
      .from('brand_market_references')
      .select('field_updated_at, field_playbook')
      .eq('brand_id', brand.id)
      .maybeSingle();
    // `field_updated_at` si muove anche quando si scrivono solo i topic, quindi da solo direbbe
    // "fresco" a un brand che il playbook non ce l'ha mai avuto: servono entrambi.
    if (row?.field_playbook && isFieldFresh(row.field_updated_at as string) && !only) {
      skip(brand.id, 'fresh');
      continue;
    }

    const startedAt = Date.now();
    const out = await withBrandContext(brand.id, () =>
      runFieldWatch(admin, { id: brand.id, name: brand.name })
    ).catch((e) => {
      console.warn(`[field-watch] ${brand.slug}:`, e instanceof Error ? e.message : e);
      return null;
    });
    if (!out) {
      skipped++;
      recordLoopTick({
        loop: 'field',
        brandId: brand.id,
        outcome: 'failed',
        reason: 'field_watch_failed',
        durationMs: Date.now() - startedAt
      });
      continue;
    }
    runs++;
    linked += out.harvest.linked;
    teardowns += out.teardowns;
    if (out.playbook) playbooks++;
    // Un giro senza playbook è comunque un giro: senza questa riga il brand piccolo resta "mai
    // girato" su /agents anche dopo essere stato lavorato ogni settimana.
    recordLoopTick({
      loop: 'field',
      brandId: brand.id,
      outcome: out.playbook ? 'ok' : 'skipped',
      reason: out.playbook ? null : 'empty_result',
      durationMs: Date.now() - startedAt
    });
  }

  return new Response(JSON.stringify({ ok: true, runs, linked, teardowns, playbooks, skipped, elapsedMs: Date.now() - t0 }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
