import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { isPaidPlan, PAID_PLAN_IDS } from '$lib/plans';
import { recordLoopTick, type LoopSkipReason } from '$lib/server/loop-ticks';
import { analyticsReviewAgentEnabled } from '$lib/server/analytics-review-agent';
import { jobEnabledForBrand } from '$lib/server/job-roster';
import { enqueueAgentJobTurn } from '$lib/server/agent-turns';

// Agente di review analytics. Gira ogni giorno; è il gate di freschezza qui sotto a renderlo
// settimanale per brand.
//
// Il tick non esegue l'agente inline: accoda un TURNO PIENO di chat nel thread persistente
// `job:analytics_review`. Il brief indica il mestiere, il turno sceglie i tool, e il suo stesso
// testo nel thread È il report — nessuna riga deterministica in più, che qui raddoppierebbe. I
// gate (roster, piano, segnale proprio, freschezza) restano nel tick, PRIMA di accodare.
//
// Due invarianti costate care:
//   1. L'eleggibilità sta nella QUERY (piano a pagamento + own_history_at non nullo), non nel
//      corpo del ciclo: con ~79 brand non eleggibili su 84, il round-robin sprecava tutti i suoi
//      slot e un giro completo durava 42 giorni — il gate di freschezza a 6 giorni non poteva
//      nemmeno scattare.
//   2. Quanti brand per tick lo decide il tempo residuo (nextRunBudgetMs), non una costante da
//      indovinare: "2 × 120s sta in 300s, 3 no" era una moltiplicazione tenuta a mente, e il terzo
//      brand veniva ucciso a metà run dopo aver speso i suoi token.
// E ogni `continue` scrive una riga in `loop_ticks`: un brand saltato in silenzio è un brand su
// cui, fra un mese, nessuno saprà rispondere.

export const config = { maxDuration: 300 };

const FRESH_DAYS = 6;
/** Tetto di brand per tick. Il vincolo vero è il tempo residuo; questo evita solo query inutili. */
const MAX_BRANDS_PER_TICK = 8;

function isFresh(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < days * 24 * 60 * 60 * 1000;
}

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  if (!analyticsReviewAgentEnabled()) {
    return new Response(JSON.stringify({ ok: true, skipped: 'ANALYTICS_REVIEW_AGENT_ENABLED=false' }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  const t0 = Date.now();
  const admin = createAdminClient();
  const url = new URL(request.url);
  const only = url.searchParams.get('brand');
  const force = url.searchParams.get('force') === '1';

  let q = admin
    .from('brands')
    .select('id, name, slug, website, content_prefs, plan, timezone, target_platforms, own_history_at')
    .eq('status', 'active')
    // Round-robin: prima chi è stato rivisto meno di recente. Senza cursore il gate di freschezza
    // salterebbe per sempre gli stessi primi slug e nessun altro verrebbe mai rivisto.
    .order('last_review_at', { ascending: true, nullsFirst: true });
  if (only) {
    // Percorso diagnostico (`?brand=slug`): niente pre-filtri, così l'endpoint può DIRE perché un
    // brand non sarebbe stato scelto invece di restituire una lista vuota.
    q = q.eq('slug', only);
  } else {
    q = q.in('plan', [...PAID_PLAN_IDS]).not('own_history_at', 'is', null);
  }
  const { data: brands } = await q.limit(only ? 1 : MAX_BRANDS_PER_TICK);

  let reviewed = 0;
  let skipped = 0;
  let failed = 0;
  const reasons: Record<string, number> = {};

  const skip = (brandId: string, reason: LoopSkipReason) => {
    skipped++;
    reasons[reason] = (reasons[reason] ?? 0) + 1;
    recordLoopTick({ loop: 'analytics_review', brandId, outcome: 'skipped', reason });
  };

  for (const brand of brands ?? []) {
    // Il claim va PRIMA dei gate: se un `continue` salta il bump del cursore, con nullsFirst gli
    // stessi brand non eleggibili si tengono tutti gli slot a ogni giro.
    await admin.from('brands').update({ last_review_at: new Date().toISOString() }).eq('id', brand.id);

    // Il roster PRIMA di ogni altro gate: col lavoro spento non si spende niente, nemmeno una
    // query. Il cursore è già bumpato, quindi un brand spento non si tiene uno slot.
    if (!(await jobEnabledForBrand(brand.id, 'analytics_review'))) {
      skip(brand.id, 'user_off');
      continue;
    }

    if (!isPaidPlan(brand.plan)) {
      skip(brand.id, 'no_plan');
      continue;
    }

    // Serve il segnale di performance PROPRIO: senza, l'agente brucerebbe una chiamata AI su un
    // digest vuoto. Denormalizzato su `brands`, così la selezione sopra è una scansione d'indice.
    if (!brand.own_history_at) {
      skip(brand.id, 'no_own_signal');
      continue;
    }

    if (!force) {
      const { data: last } = await admin
        .from('agent_runs')
        .select('created_at')
        .eq('brand_id', brand.id)
        .eq('agent', 'analytics_review')
        .eq('finished_ok', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last && isFresh(last.created_at, FRESH_DAYS)) {
        skip(brand.id, 'fresh');
        continue;
      }
    }

    const brief = `## SCHEDULED PERFORMANCE REVIEW (server-side brief)
You are this brand's performance analyst on your recurring unattended review, in your own persistent thread. Nobody is present this turn: work autonomously and post ONE short, concrete report here (what the numbers say, what you changed, why).

Read this week's real performance (published posts and their metrics — post/analytics history tools, or run_analytics_review which also applies GTM/editorial proposals and pending-content edits in one pass). Diagnose what worked and what did not, apply what your tools reach, and keep the report tight. Use notify_user only for what the owner must act on. Never invent numbers; if the signal is too thin, say so and stop.`;

    const runStart = Date.now();
    const turn = await enqueueAgentJobTurn(admin, {
      brandId: brand.id,
      jobKey: 'analytics_review',
      brief,
      visible: { it: 'Revisione settimanale delle performance', en: 'Weekly performance review' },
      origin: url.origin,
      // Il turno pieno non scrive per forza in agent_runs: il dedupe guarda i turni schedulati
      // del SUO thread.
      minIntervalMs: force ? 0 : FRESH_DAYS * 24 * 60 * 60 * 1000
    });
    const durationMs = Date.now() - runStart;
    if (turn.ok) {
      reviewed++;
      recordLoopTick({ loop: 'analytics_review', brandId: brand.id, outcome: 'ok', durationMs });
    } else if (turn.reason === 'fresh' || turn.reason === 'thread_busy') {
      skip(brand.id, 'fresh');
    } else {
      failed++;
      reasons[turn.reason] = (reasons[turn.reason] ?? 0) + 1;
      recordLoopTick({
        loop: 'analytics_review',
        brandId: brand.id,
        outcome: 'failed',
        reason: turn.reason,
        durationMs
      });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, reviewed, skipped, failed, reasons, elapsedMs: Date.now() - t0 }),
    { headers: { 'content-type': 'application/json' } }
  );
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
