import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { withBrandContext } from '$lib/server/ai-log';
import { hasWebHub } from '$lib/server/plans';
import { seoAgentEnabled, runSeoAgent } from '$lib/server/seo-agent';
import { jobPausedForBrand } from '$lib/server/job-roster';
import { reportToAgentThread } from '$lib/server/team-ignition';
import { recordLoopTick, nextRunBudgetMs, type LoopSkipReason } from '$lib/server/loop-ticks';
import { queueForLoop, markServed } from '$lib/server/loop-fairness';

// Weekly SEO review agent: re-reads audits + DataForSEO, refreshes brand_seo_plans.
// Runs after geo (Mon 07) and keywords (Mon 09). Auth same as other ticks.
// Freshness: skip when a plan was written in the last 6 days (unless ?force=1 / ?brand=).
//
// DUE DIFETTI CHIUSI IL 2026-08-22, e il secondo era il più cattivo.
//  1. Nessun ordinamento: la lista arrivava come la dava il pianificatore, sempre uguale.
//  2. `deadlineMs: 240_000` per OGNI brand, dentro una funzione da 300s. Bastava un brand lento a
//     prendersi l'intera finestra, e siccome era sempre lo stesso primo della lista, i brand dopo
//     di lui non venivano mai raggiunti. Adesso il budget del singolo run è quello che RESTA della
//     finestra (nextRunBudgetMs), e chi non ci sta è il primo del giro dopo.
// In più questo tick dipende da `brand_geo_audits`: finché l'audit GEO serviva sempre gli stessi
// 3 brand, l'agente SEO non poteva partire su nessun altro. I due si sbloccano insieme.

export const config = { maxDuration: 300 };

const FRESH_DAYS = 6;
/**
 * Tetto di brand per tick. Il vincolo vero è il tempo residuo: questo evita solo di leggere cursori
 * per brand che la finestra non potrebbe mai raggiungere. Un run dell'agente può arrivare a ~2
 * minuti, quindi in 280s utili ne passano 2-3; 8 lascia margine ai giri in cui quasi tutti sono
 * freschi e i gate costano una query.
 */
const MAX_BRANDS_PER_TICK = 8;

function isFresh(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < days * 24 * 60 * 60 * 1000;
}

async function run(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  if (!seoAgentEnabled()) {
    return new Response(JSON.stringify({ ok: true, skipped: 'SEO_AGENT_ENABLED=false' }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  const admin = createAdminClient();
  const url = new URL(request.url);
  const only = url.searchParams.get('brand');
  const force = url.searchParams.get('force') === '1';

  const t0 = Date.now();
  let q = admin.from('brands').select('id, name, slug, website, content_prefs, plan').eq('status', 'active');
  if (only) q = q.eq('slug', only);
  const { data: brands } = await q;

  // La coda: chi aspetta da più tempo per primo. `?brand=` è diagnostico e non passa dalla coda.
  const queue = only ? (brands ?? []) : await queueForLoop(admin, 'seo', brands ?? [], MAX_BRANDS_PER_TICK);

  let reviewed = 0;
  let skipped = 0;
  let failed = 0;
  let deferred = 0;
  const skip = (brandId: string, reason: LoopSkipReason) => {
    skipped++;
    recordLoopTick({ loop: 'seo', brandId, outcome: 'skipped', reason });
  };

  for (const brand of queue) {
    // Quanto tempo resta per QUESTO brand. `null` = non ne resta abbastanza per iniziarlo: si esce
    // pulito senza claimare, e al prossimo giro è ancora davanti.
    const budgetMs = only ? 240_000 : nextRunBudgetMs({ elapsedMs: Date.now() - t0 });
    if (budgetMs === null) {
      deferred++;
      recordLoopTick({ loop: 'seo', brandId: brand.id, outcome: 'skipped', reason: 'no_budget' });
      continue;
    }

    // IL CLAIM, prima di ogni gate. Un giro che non produce iniziative non scrive un
    // `brand_seo_plans`, quindi non diventa mai fresco: prima di questa riga si riprendeva lo
    // stesso posto ogni settimana, per sempre.
    if (!only) await markServed(admin, 'seo', brand.id);

    // Roster: dopo il claim, prima del piano e delle query di freschezza.
    if (await jobPausedForBrand('seo', brand.id)) {
      skipped++;
      continue;
    }

    if (!hasWebHub(brand.plan)) {
      skip(brand.id, 'no_plan');
      continue;
    }

    if (!force) {
      const { data: plan } = await admin
        .from('brand_seo_plans')
        .select('created_at')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (plan && isFresh(plan.created_at, FRESH_DAYS)) {
        skip(brand.id, 'fresh');
        continue;
      }
    }

    // Need at least one audit — otherwise the agent has nothing local to review.
    const { data: audit } = await admin
      .from('brand_geo_audits')
      .select('id')
      .eq('brand_id', brand.id)
      .limit(1)
      .maybeSingle();
    if (!audit) {
      skip(brand.id, 'no_own_signal');
      continue;
    }

    // Il numero (non solo il booleano) serve al resoconto in chat: cosa ha prodotto questo giro.
    const startedAt = Date.now();
    const initiatives = await withBrandContext(brand.id, async () => {
      const result = await runSeoAgent({
        supabase: admin,
        brand,
        mode: 'review',
        deadlineMs: budgetMs
      });
      return result?.initiatives?.length ?? 0;
    }).catch((error) => { swallow('runSeoAgent failed', error); return 0; });

    if (initiatives > 0) {
      reviewed++;
      // Il resoconto nel thread dell'agente. Non alza mai; i giri saltati non scrivono.
      // Il tick 'ok' che mancava: /agents legge SOLO loop_ticks, e senza questa riga un
      // lavoro che gira ogni settimana resta "mai girato" per sempre sulla sua card.
      recordLoopTick({ loop: 'seo', brandId: brand.id, outcome: 'ok', durationMs: Date.now() - startedAt });
      await reportToAgentThread(admin, brand.id, { job: 'seo', initiatives });
    } else {
      // Zero iniziative: il giro è avvenuto e non ha prodotto. Era l'unico esito che non lasciava
      // traccia, e quindi il motivo per cui «l'agente SEO non fa niente» non aveva una risposta.
      failed++;
      recordLoopTick({
        loop: 'seo',
        brandId: brand.id,
        outcome: 'skipped',
        reason: 'empty_result',
        durationMs: Date.now() - startedAt
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, reviewed, skipped, failed, deferred, elapsedMs: Date.now() - t0 }), {
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
