import type { SupabaseClient } from '@supabase/supabase-js';
import { isPaidPlan } from '$lib/plans';
import { isExportOnlyPlan } from '$lib/server/plans';
import { PENDING_BACKLOG_AGE_MS, PENDING_BACKLOG_CAP } from '$lib/server/autopilot-thresholds';
import { OWN_SOURCE } from '$lib/server/own-post-history';
import { jobEnabledForBrand } from '$lib/server/job-roster';

/**
 * BRAND DOCTOR — «perché questo brand non sta ricevendo niente dall'AI?»
 *
 * È la domanda che il supporto, il founder e l'utente si fanno più spesso, e finora si rispondeva
 * leggendo il codice: ogni ciclo (autopilot, analytics review, …) ha la sua catena di gate, ogni
 * gate ha il suo `continue`, e nessuno di quei `continue` lasciava traccia. L'analytics review
 * agent è rimasto fermo per settimane senza che niente lo dicesse (docs/38-salto-di-qualita.md §1).
 *
 * Il pattern esiste già in un posto solo — `radarDiagnose`, che interroga ogni fonte dal vivo e
 * dice perché una non trova niente. Qui è generalizzato: per ogni ciclo, **il primo gate che questo
 * brand non supera**, cosa serve per superarlo, e quando è girato l'ultima volta.
 *
 * DUE REGOLE CHE TENGONO ONESTO QUESTO MODULO:
 * 1. Si riportano solo gate **verificati nel codice** del ciclo corrispondente. Un gate inventato
 *    qui manda il supporto a caccia di un problema che non esiste.
 * 2. «Non lo so» è una risposta valida e viene detta (`unknown`), invece di essere presentata come
 *    un via libera. Un doctor che dice sempre "tutto ok" non lo apre più nessuno.
 *
 * Read-only: nessuna scrittura, nessuna AI, nessun credito speso.
 */

export type DoctorGate = {
  /** Identificatore stabile: ci si fanno le query, non è prosa. */
  id: string;
  status: 'pass' | 'fail' | 'unknown';
  /** Cosa dice il dato, con i numeri. */
  detail: string;
  /** Cosa deve succedere perché passi. Presente solo su `fail`. */
  fix?: string;
};

export type DoctorLoop = {
  loop: string;
  /** Quando gira, in parole — la fonte è vercel.json, non una supposizione. */
  schedule: string;
  /** `blocked` = un gate lo esclude; `waiting` = passa i gate ma non è ancora il suo turno. */
  status: 'ok' | 'blocked' | 'waiting' | 'failing' | 'unknown';
  /** L'id del PRIMO gate fallito. È la risposta alla domanda per cui esiste questa pagina. */
  blockedBy: string | null;
  gates: DoctorGate[];
  lastRun: { at: string; outcome: string; reason: string | null } | null;
};

export type DoctorFacts = {
  now: number;
  plan: string | null;
  autopilotEnabled: boolean;
  autopilotFailureCount: number;
  lastAutopilotRunAt: string | null;
  hasActiveEditorialPlan: boolean;
  connectedAccounts: number;
  /** Il piano vende zero account per progetto (Go): zero collegati è lo stato normale, non un guasto. */
  exportOnly: boolean;
  ownHistoryAt: string | null;
  pendingPosts: number;
  /** Solo i pending STANTII: è questo il numero su cui lo scheduler frena, non il totale. */
  pendingStalePosts: number;
  publishedLast30: number;
  /** Ultimo run COMPLETATO dell'analytics review (agent_runs.finished_ok). */
  lastAnalyticsRunAt: string | null;
  /** Ultimo esito registrato per ciclo (loop_ticks), incluse le esclusioni. */
  lastTicks: Record<string, { at: string; outcome: string; reason: string | null } | undefined>;
  /** Ultimo errore dell'autopilot, da scheduler_runs. */
  lastSchedulerError: { at: string; error: string } | null;
};

const DAY = 24 * 60 * 60 * 1000;
/** Deve restare allineato a MAX_CONSECUTIVE_FAILURES in scheduler.ts. */
const AUTOPILOT_DISABLE_AFTER = 3;
/** Deve restare allineato a FRESH_DAYS nel tick dell'analytics review. */
const ANALYTICS_FRESH_DAYS = 6;

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / DAY);
}

function ago(iso: string | null | undefined, now: number): string {
  const d = daysSince(iso, now);
  if (d == null) return 'mai';
  if (d === 0) return 'oggi';
  if (d === 1) return 'ieri';
  return `${d} giorni fa`;
}

/** Il primo gate fallito decide lo stato del ciclo. Un `unknown` non è un via libera: si dichiara. */
function verdict(gates: DoctorGate[]): Pick<DoctorLoop, 'status' | 'blockedBy'> {
  const failed = gates.find((g) => g.status === 'fail');
  if (failed) return { status: 'blocked', blockedBy: failed.id };
  if (gates.some((g) => g.status === 'unknown')) return { status: 'unknown', blockedBy: null };
  return { status: 'ok', blockedBy: null };
}

/**
 * La diagnosi, come funzione pura sui fatti. Tutta l'I/O sta in `collectDoctorFacts`, così questa
 * si può testare su qualunque combinazione di stato senza un database.
 */
export function assessLoops(f: DoctorFacts): DoctorLoop[] {
  const loops: DoctorLoop[] = [];

  // ── 1. Distribuzione. Non è un cron: è la catena che rende sensato tutto il resto. Sta per
  // prima perché è il gate che, oggi, blocca la grande maggioranza dei brand.
  {
    // I gate qui sotto sono quelli che runAutopilotForBrand applica davvero — stessa soglia,
    // stessa finestra, stessa eccezione. Un doctor che riporta soglie sue manda l'utente a
    // risolvere un problema che il codice non ha.
    const accountsBlock = f.connectedAccounts === 0 && !f.exportOnly;
    const backlogBlock = f.pendingStalePosts > PENDING_BACKLOG_CAP;
    const staleDays = Math.round(PENDING_BACKLOG_AGE_MS / (24 * 60 * 60 * 1000));
    const gates: DoctorGate[] = [
      {
        id: 'social_accounts',
        status: accountsBlock ? 'fail' : 'pass',
        detail: f.connectedAccounts > 0
          ? `${f.connectedAccounts} account social collegati.`
          : f.exportOnly
            ? 'Piano "prepara ed esporta": nessun account collegato per progetto, i post si esportano a mano.'
            : 'Nessun account social collegato: la produzione ricorrente è ferma, i post non avrebbero dove uscire.',
        ...(accountsBlock ? { fix: 'Collega almeno un account in Impostazioni → Piattaforme: la produzione riparte da sola.' } : {})
      },
      {
        id: 'approval_backlog',
        // Il freno guarda solo i pending STANTII: chi ha appena ricevuto la settimana e la
        // approverà domani non è un brand fermo.
        status: backlogBlock ? 'fail' : 'pass',
        detail: backlogBlock
          ? `${f.pendingStalePosts} post in attesa da più di ${staleDays} giorni (soglia: ${PENDING_BACKLOG_CAP}): la produzione è in pausa finché la coda non scende.`
          : `${f.pendingPosts} post in coda di approvazione, di cui ${f.pendingStalePosts} da più di ${staleDays} giorni (soglia: ${PENDING_BACKLOG_CAP}).`,
        ...(backlogBlock
          ? { fix: 'Approva dalla mail (un tap), da /approvals, o con `anomalia approve <slug> --all`. Approvare o eliminare qualunque post fa ripartire la produzione.' }
          : {})
      },
      {
        id: 'recent_publish',
        // Per un piano prepara-ed-esporta la pubblicazione non passa da qui: chiamarlo fallimento
        // sarebbe segnalare come guasto il funzionamento previsto del tier.
        status: f.publishedLast30 > 0 ? 'pass' : f.exportOnly ? 'unknown' : 'fail',
        detail:
          f.publishedLast30 > 0
            ? `${f.publishedLast30} post pubblicati negli ultimi 30 giorni.`
            : f.exportOnly
              ? 'Nessuna pubblicazione dall\'app negli ultimi 30 giorni — atteso su un piano di sola esportazione.'
              : 'Nessun post pubblicato negli ultimi 30 giorni.',
        ...(f.publishedLast30 === 0 && !f.exportOnly
          ? { fix: 'Sblocca i due gate qui sopra: senza pubblicazioni non parte nessun ciclo di apprendimento.' }
          : {})
      }
    ];
    loops.push({
      loop: 'publishing',
      schedule: 'continuo (approvazione → scheduler)',
      ...verdict(gates),
      gates,
      lastRun: null
    });
  }

  // ── 2. Autopilot (produzione ricorrente). Gate verificati in autopilot/tick + scheduler.ts.
  {
    const disabled = !f.autopilotEnabled;
    const nearDisable = f.autopilotFailureCount > 0;
    const gates: DoctorGate[] = [
      {
        id: 'autopilot_enabled',
        status: disabled ? 'fail' : 'pass',
        detail: disabled
          ? f.autopilotFailureCount >= AUTOPILOT_DISABLE_AFTER
            ? `Disattivato automaticamente dopo ${f.autopilotFailureCount} fallimenti consecutivi.`
            : 'Autopilot spento.'
          : 'Autopilot attivo.',
        ...(disabled ? { fix: 'Riaccendilo dal roster su /agents (o in Impostazioni → Autopilot) dopo aver risolto la causa dei fallimenti.' } : {})
      },
      {
        id: 'consecutive_failures',
        status: nearDisable ? 'fail' : 'pass',
        detail: nearDisable
          ? `${f.autopilotFailureCount}/${AUTOPILOT_DISABLE_AFTER} fallimenti consecutivi${f.lastSchedulerError ? ` — ultimo: ${f.lastSchedulerError.error.slice(0, 200)}` : ''}.`
          : 'Nessun fallimento consecutivo.',
        ...(nearDisable ? { fix: "Guarda scheduler_runs.error: al terzo fallimento l'autopilot si spegne da solo." } : {})
      },
      {
        id: 'editorial_plan',
        // Non è bloccante: senza piano l'autopilot usa la cadenza di content_prefs. Ma cambia la
        // finestra (≈settimanale con piano) e vale la pena dirlo.
        status: f.hasActiveEditorialPlan ? 'pass' : 'unknown',
        detail: f.hasActiveEditorialPlan
          ? 'Piano editoriale attivo: una batch per settimana editoriale.'
          : 'Nessun piano editoriale attivo: la cadenza viene da content_prefs.frequency.'
      },
      {
        id: 'last_run',
        status: f.lastAutopilotRunAt ? 'pass' : 'unknown',
        detail: `Ultimo run riuscito: ${ago(f.lastAutopilotRunAt, f.now)}.`
      }
    ];
    const v = verdict(gates);
    loops.push({
      loop: 'autopilot',
      schedule: 'ogni giorno 06:00 UTC',
      ...v,
      status: v.status === 'blocked' && !disabled ? 'failing' : v.status,
      gates,
      lastRun: f.lastTicks.autopilot ?? null
    });
  }

  // ── 3. Analytics review. Gate verificati uno per uno nel tick.
  {
    const paid = isPaidPlan(f.plan);
    const ownDays = daysSince(f.ownHistoryAt, f.now);
    const freshDays = daysSince(f.lastAnalyticsRunAt, f.now);
    const isFresh = freshDays != null && freshDays < ANALYTICS_FRESH_DAYS;
    const gates: DoctorGate[] = [
      {
        id: 'paid_plan',
        status: paid ? 'pass' : 'fail',
        detail: paid ? `Piano "${f.plan}".` : `Piano "${f.plan ?? 'free'}": il ciclo è riservato ai piani a pagamento.`,
        ...(paid ? {} : { fix: 'Attiva un piano a pagamento.' })
      },
      {
        id: 'own_performance_data',
        status: f.ownHistoryAt ? 'pass' : 'fail',
        detail: f.ownHistoryAt
          ? `Dati di performance propri (source='${OWN_SOURCE}'), ultimi ${ownDays ?? '?'} giorni fa.`
          : `Nessun dato di performance proprio: l'agente non avrebbe niente da cui adattare (i dati scrapati dei competitor non contano).`,
        ...(f.ownHistoryAt
          ? {}
          : { fix: 'Pubblica dall\'app: la sincronizzazione delle metriche crea le righe da cui questo ciclo impara.' })
      },
      {
        id: 'freshness',
        // Passare il gate di freschezza significa "già fatto di recente": non è un problema, ma è
        // la ragione più frequente per cui un brand non viene toccato oggi.
        status: isFresh ? 'fail' : 'pass',
        detail: isFresh
          ? `Già revisionato ${ago(f.lastAnalyticsRunAt, f.now)} (finestra: ${ANALYTICS_FRESH_DAYS} giorni).`
          : `Ultima review completata: ${ago(f.lastAnalyticsRunAt, f.now)}.`,
        ...(isFresh ? { fix: `Attendi la finestra, o forza con ?brand=<slug>&force=1.` } : {})
      }
    ];
    const v = verdict(gates);
    loops.push({
      loop: 'analytics_review',
      schedule: 'ogni giorno 08:00 UTC (per brand: al più ogni 6 giorni)',
      ...v,
      // "Già fatto di recente" non è un blocco: è un turno saltato.
      status: v.blockedBy === 'freshness' ? 'waiting' : v.status,
      gates,
      lastRun: f.lastTicks.analytics_review ?? null
    });
  }

  return loops;
}

/** La riga che si legge per prima: il primo ciclo bloccato, o il via libera. */
export function doctorHeadline(loops: DoctorLoop[]): string {
  const blocked = loops.find((l) => l.status === 'blocked' || l.status === 'failing');
  if (!blocked) return 'Nessun blocco rilevato sui cicli coperti da questa diagnosi.';
  const gate = blocked.gates.find((g) => g.id === blocked.blockedBy);
  return `${blocked.loop}: ${gate?.detail ?? blocked.blockedBy}${gate?.fix ? ` → ${gate.fix}` : ''}`;
}

/** Tutte le letture, in parallelo dove possibile. Nessuna scrittura. */
export async function collectDoctorFacts(
  admin: SupabaseClient,
  brand: { id: string; plan?: string | null; autopilot_failure_count?: number | null; last_autopilot_run_at?: string | null; own_history_at?: string | null },
  now = Date.now()
): Promise<DoctorFacts> {
  const since30 = new Date(now - 30 * DAY).toISOString();

  const staleBefore = new Date(now - PENDING_BACKLOG_AGE_MS).toISOString();

  const [accounts, plan, pending, pendingStale, published, lastAnalytics, ticks, schedErr] = await Promise.all([
    admin.from('social_accounts').select('id', { count: 'exact', head: true }).eq('brand_id', brand.id).eq('status', 'active'),
    admin.from('editorial_plans').select('id').eq('brand_id', brand.id).eq('status', 'active').limit(1).maybeSingle(),
    admin.from('posts').select('id', { count: 'exact', head: true }).eq('brand_id', brand.id).eq('status', 'pending_user'),
    // Lo stesso conteggio su cui frena lo scheduler: pending E più vecchi della finestra.
    admin
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id)
      .eq('status', 'pending_user')
      .lt('created_at', staleBefore),
    admin
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id)
      .eq('status', 'published')
      .gte('published_at', since30),
    admin
      .from('agent_runs')
      .select('created_at')
      .eq('brand_id', brand.id)
      .eq('agent', 'analytics_review')
      .eq('finished_ok', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('loop_ticks')
      .select('loop, outcome, reason, created_at')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: false })
      .limit(50),
    admin
      .from('scheduler_runs')
      .select('created_at, error')
      .eq('brand_id', brand.id)
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  // Ultimo esito per ciclo: le righe arrivano già ordinate dal più recente, quindi la prima vince.
  const lastTicks: DoctorFacts['lastTicks'] = {};
  for (const row of ticks.data ?? []) {
    const loop = String(row.loop);
    if (lastTicks[loop]) continue;
    lastTicks[loop] = { at: String(row.created_at), outcome: String(row.outcome), reason: row.reason ?? null };
  }

  return {
    now,
    plan: brand.plan ?? null,
    // Il producer vive sul roster: acceso = nessun opt-out sulla chiave 'autopilot' (il booleano
    // `brands.autopilot_enabled` è ritirato e non va più letto).
    autopilotEnabled: await jobEnabledForBrand(brand.id, 'autopilot', admin),
    autopilotFailureCount: Number(brand.autopilot_failure_count) || 0,
    lastAutopilotRunAt: brand.last_autopilot_run_at ?? null,
    hasActiveEditorialPlan: Boolean(plan.data?.id),
    connectedAccounts: accounts.count ?? 0,
    exportOnly: isExportOnlyPlan(brand.plan),
    ownHistoryAt: brand.own_history_at ?? null,
    pendingPosts: pending.count ?? 0,
    pendingStalePosts: pendingStale.count ?? 0,
    publishedLast30: published.count ?? 0,
    lastAnalyticsRunAt: lastAnalytics.data?.created_at ? String(lastAnalytics.data.created_at) : null,
    lastTicks,
    lastSchedulerError: schedErr.data?.error
      ? { at: String(schedErr.data.created_at), error: String(schedErr.data.error) }
      : null
  };
}

export async function brandDoctor(
  admin: SupabaseClient,
  brand: { id: string; name?: string | null; slug?: string | null; plan?: string | null; autopilot_failure_count?: number | null; last_autopilot_run_at?: string | null; own_history_at?: string | null }
) {
  const facts = await collectDoctorFacts(admin, brand);
  const loops = assessLoops(facts);
  return {
    brand: { name: brand.name ?? null, slug: brand.slug ?? null, plan: brand.plan ?? null },
    generatedAt: new Date(facts.now).toISOString(),
    headline: doctorHeadline(loops),
    loops,
    // Onestà sul perimetro: questa diagnosi copre tre cicli su nove. Dire quali NON copre evita che
    // un "nessun blocco" venga letto come "tutto il prodotto sta funzionando".
    notCovered: ['seo', 'geo', 'radar', 'field', 'blog', 'ads', 'weekly_recap']
  };
}
