import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '$lib/server/supabase-admin';
import { recordLoopTick, type LoopName } from '$lib/server/loop-ticks';
import { loopServedAt } from '$lib/server/loop-fairness';
import { isPaidPlan } from '$lib/plans';
import { JOB_OWNERS, type TeamAgentId } from '$lib/agent-owners';

/**
 * Il roster: i lavori ricorrenti come una squadra visibile, con un interruttore per brand invece
 * del solo `autopilot_enabled` tutto-o-niente.
 *
 * Due regole, entrambe pagate da bug in questo repo:
 *   1. **Assenza = acceso.** Si salva solo il rifiuto esplicito, così un lavoro nuovo non ha
 *      bisogno di backfill e una migration non ancora applicata non spegne niente — e le migration
 *      NON girano al deploy, quindi è la condizione normale per qualche ora a ogni rilascio.
 *   2. **"Spento dall'utente" non è "non è girato".** Il gate scrive comunque un `loop_ticks` con
 *      `reason: 'user_off'`, o brand-doctor e i log non sanno distinguere la scelta da un guasto.
 *
 * Entrano solo i lavori che il cliente riconoscerebbe come "un agente che lavora per me". I
 * drenatori di coda, la pubblicazione dei post e i controlli di salute NO: un interruttore su "la
 * cosa che pubblica i tuoi post" produce un utente che lo spegne e poi segnala il prodotto rotto.
 */

/** La chiave di un lavoro del roster. È anche il `loop` con cui scrive in `loop_ticks`. */
export type JobKey = Extract<
  LoopName,
  | 'autopilot'
  | 'analytics_review'
  | 'weekly_recap'
  | 'seo'
  | 'geo'
  | 'radar_recap'
  | 'market_refs'
  | 'strategy_review'
  | 'library'
>;

/** Ogni quanto gira. Solo etichette: la cadenza vera sta in `vercel.json`. */
export type JobCadence = 'daily' | 'weekly' | 'monthly';

export type RosterJob = { key: JobKey; cadence: JobCadence };

/**
 * Volutamente parziale: solo i lavori di cui si conosce con certezza cadenza e punto di gate.
 * Aggiungerne uno è una riga qui + `jobPausedForBrand` nel suo tick + le stringhe nei quattro
 * locali. Nessuna migration, nessun backfill.
 */
export const ROSTER_JOBS: RosterJob[] = [
  // La chiave resta 'autopilot' perché è il loop con cui il tick scrive in loop_ticks da sempre:
  // cambiarla azzererebbe la storia visibile sul roster.
  { key: 'autopilot', cadence: 'weekly' },
  { key: 'analytics_review', cadence: 'weekly' },
  { key: 'weekly_recap', cadence: 'weekly' },
  { key: 'seo', cadence: 'weekly' },
  { key: 'geo', cadence: 'weekly' },
  { key: 'radar_recap', cadence: 'daily' },
  { key: 'market_refs', cadence: 'weekly' },
  // UNA voce per due lavori (ripasso GTM settimanale + rinnovo del piano ogni 4 settimane): è lo
  // stesso mestiere a due granularità, e due card lascerebbero un cliente con metà stratega.
  { key: 'strategy_review', cadence: 'weekly' },
  { key: 'library', cadence: 'monthly' }
];

export const ROSTER_JOB_KEYS: readonly string[] = ROSTER_JOBS.map((j) => j.key);

/**
 * Ogni lavoro è la ROUTINE di un agente vero della chat, mai un agente a sé. La mappa vive
 * client-safe in $lib/agent-owners perché /agents non può importare questo modulo; l'assegnazione
 * qui è il controllo di totalità — un JobKey senza owner non compila.
 */
const OWNER_BY_JOB: Record<JobKey, TeamAgentId> = JOB_OWNERS;

/** L'agente della chat che possiede questo lavoro (il suo thread, la sua card su /agents). */
export function jobOwner(key: JobKey): TeamAgentId {
  return OWNER_BY_JOB[key];
}

/**
 * Senza piano a pagamento gli agenti ricorrenti non partono. Una definizione sola, importata anche
 * dal brief di onboarding: prompt e gate non possono divergere perché sono la stessa riga.
 *
 * Copre SOLO il lavoro schedulato — chat, generazioni manuali e setup dell'onboarding restano su
 * free/trial dentro i gate crediti, o il trial non può dimostrare il prodotto che vende.
 */
export function scheduledWorkAllowed(plan: string | null | undefined): boolean {
  return isPaidPlan(plan);
}

/**
 * Blurb inglesi per i PROMPT: i nomi che l'utente vede stanno in i18n (`app.roster.job.*`). Una
 * chiave senza blurb cade sul suo nome, così un lavoro nuovo entra nel prompt da solo.
 */
const ROSTER_JOB_BLURBS: Partial<Record<string, string>> = {
  autopilot: 'Content producer — plans and produces the recurring weekly batch of posts, then asks for approval.',
  analytics_review: 'Performance review — reads how published posts did and adapts strategy, editorial plan and pending drafts.',
  weekly_recap: 'Weekly recap — the Monday email: what happened, what is coming, what needs the owner.',
  seo: 'SEO agent — weekly site review: grade, issues, and growth initiatives.',
  geo: 'GEO agent — weekly AI-visibility check: where AI assistants cite (or skip) the brand.',
  radar_recap: 'Radar digest — a daily brief of relevant news, conversations and leads found in the field.',
  market_refs: 'Competitor watch — refreshes what competitors are publishing so references stay current.',
  strategy_review: 'Strategy review — rereads strategy and editorial plan against what actually happened and proposes changes.',
  library: 'Library curator — monthly refresh of the indexed site content.'
};

/** Cosa fa un lavoro, in inglese. Chiave senza blurb → il suo nome, cosi' un lavoro nuovo entra
 * da solo sia nel prompt sia nel tool che lo elenca. */
export function jobBlurb(key: string): string {
  return ROSTER_JOB_BLURBS[key] ?? key;
}

/** UNA fonte (ROSTER_JOBS), mai una lista ricopiata dentro un prompt. Il parametro è per i test. */
export function rosterForPrompt(jobs: readonly RosterJob[] = ROSTER_JOBS): string {
  return jobs.map((j) => `- ${j.key} (${j.cadence}): ${jobBlurb(j.key)}`).join('\n');
}

// Map in memoria + TTL corto: un tick scorre decine di brand e chiederebbe "questo lavoro è
// acceso?" per ognuno. Il processo di una function Vercel vive meno del TTL — nel caso peggiore
// la cache dura quanto il tick.

const OPTOUT_CACHE_TTL_MS = 60_000;
const optOutCache = new Map<string, { keys: Set<string>; at: number }>();

// `'unknown'` = lettura fallita, e nel dubbio si lavora (vedi brandPlanForGate).
const planCache = new Map<string, { plan: string | null | 'unknown'; at: number }>();

/** Dopo un toggle dalla UI: la prossima lettura deve vedere la scelta appena fatta. */
export function forgetBrandJobOptOuts(brandId: string): void {
  optOutCache.delete(brandId);
}

/** Solo per i test: azzera tutto. */
export function clearJobRosterCache(): void {
  optOutCache.clear();
  planCache.clear();
}

/**
 * Una lettura fallita risponde `'unknown'` e il gate lascia passare: fermare il lavoro di tutti i
 * brand paganti per un errore di rete è il fallimento peggiore, non quello prudente.
 */
async function brandPlanForGate(brandId: string): Promise<string | null | 'unknown'> {
  const hit = planCache.get(brandId);
  if (hit && Date.now() - hit.at < OPTOUT_CACHE_TTL_MS) return hit.plan;
  let plan: string | null | 'unknown' = 'unknown';
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from('brands').select('plan').eq('id', brandId).maybeSingle();
    if (!error) plan = (data?.plan as string | null) ?? null;
  } catch {
    plan = 'unknown';
  }
  planCache.set(brandId, { plan, at: Date.now() });
  return plan;
}

/**
 * Una query per brand, non una per lavoro. Qualunque errore — tabella assente, rete, permessi —
 * risponde "nessun no", cioè tutto acceso, e il fallback finisce in cache come gli altri: se la
 * tabella non esiste, ripetere la query fallita a ogni tick non la fa apparire.
 */
export async function brandJobOptOuts(brandId: string, client?: SupabaseClient): Promise<Set<string>> {
  const hit = optOutCache.get(brandId);
  if (hit && Date.now() - hit.at < OPTOUT_CACHE_TTL_MS) return hit.keys;

  let keys = new Set<string>();
  try {
    const admin = client ?? createAdminClient();
    const { data, error } = await admin
      .from('brand_job_optouts')
      .select('job_key')
      .eq('brand_id', brandId);
    if (error) {
      console.warn('[job-roster] opt-outs unreadable, defaulting to enabled:', error.message.slice(0, 160));
    } else {
      keys = new Set((data ?? []).map((r) => String((r as { job_key: unknown }).job_key)));
    }
  } catch (e) {
    console.warn('[job-roster] opt-outs threw, defaulting to enabled:', e instanceof Error ? e.message.slice(0, 160) : e);
  }

  optOutCache.set(brandId, { keys, at: Date.now() });
  return keys;
}

/** Il gate. `true` = si lavora. Nel dubbio (errore, tabella assente) è sempre `true`. */
export async function jobEnabledForBrand(
  brandId: string,
  jobKey: string,
  client?: SupabaseClient
): Promise<boolean> {
  if (!brandId) return true;
  const off = await brandJobOptOuts(brandId, client);
  return !off.has(jobKey);
}

/**
 * Il PRIMO controllo di ogni tick, prima di spendere qualunque cosa:
 *   if (await jobPausedForBrand('geo', brand.id)) { skipped++; continue; }
 * Registra anche `skipped/user_off`, o roster e brand doctor non distinguono "l'hai spento tu" da
 * "non è girato".
 */
export async function jobPausedForBrand(
  jobKey: JobKey,
  brandId: string,
  /** Il piano, se il tick ce l'ha già in mano (risparmia una query). Omesso = lo legge da sé. */
  plan?: string | null
): Promise<boolean> {
  // "Senza un piano a pagamento, questi non devono partire" — la regola del lavoro schedulato,
  // applicata QUI perché ogni tick del roster passa da questa riga come primo controllo. Il tick
  // `no_plan` è quello che la pagina /agents sa già tradurre: la squadra ferma su un brand free
  // dice il perché, che è parte della vendita, non un errore.
  const p = plan !== undefined ? plan : await brandPlanForGate(brandId);
  if (p !== 'unknown' && !scheduledWorkAllowed(p)) {
    recordLoopTick({ loop: jobKey, brandId, outcome: 'skipped', reason: 'no_plan' });
    return true;
  }
  if (await jobEnabledForBrand(brandId, jobKey)) return false;
  recordLoopTick({ loop: jobKey, brandId, outcome: 'skipped', reason: 'user_off' });
  return true;
}

// ── Lo stato che vede il cliente ────────────────────────────────────────────────────────────────

/**
 * Tre stati, mai confusi tra loro:
 * - `off` — l'hai spento tu. Vince su tutto: se c'è un opt-out, non importa cosa dice l'ultimo tick.
 * - `ok` — ha girato e ha fatto il suo lavoro.
 * - `skipped` — non è girato, e `reason` dice quale gate l'ha fermato (crediti, piano, niente da fare).
 * - `failed` — ci ha provato ed è andato male.
 * - `never` — non risulta nessun giro: nuovo, o mai stato eleggibile.
 */
export type JobState = 'off' | 'ok' | 'skipped' | 'failed' | 'never';

export type JobStatus = {
  key: JobKey;
  cadence: JobCadence;
  enabled: boolean;
  state: JobState;
  /** Codice, MAI un messaggio: alla UI serve una chiave traducibile. `null` quando non c'è. */
  reason: string | null;
  lastRunAt: string | null;
  /**
   * Quando il tick ha PRESO questo brand l'ultima volta (`loop_cursors`) — che non è `lastRunAt`.
   * `lastRunAt` dice cosa è successo QUANDO il lavoro lo ha raggiunto; `servedAt` dice SE lo ha
   * raggiunto. Prima erano indistinguibili: un brand mai raggiunto e un brand raggiunto e scartato
   * lasciavano entrambi zero righe, ed è il motivo per cui «questo brand ha ricevuto il suo
   * controllo SEO questa settimana?» si poteva rispondere solo leggendo i log di Vercel.
   */
  servedAt: string | null;
  /**
   * Il brand è indietro rispetto alla cadenza dichiarata di questo lavoro: il tick non lo raggiunge
   * da più di quanto dovrebbe. `false` anche quando il lavoro è spento — non è un ritardo, è una
   * scelta.
   */
  behind: boolean;
};

/** Quanto può passare fra due giri prima che sia un ritardo. Doppio della cadenza: un giro saltato
 * capita (jitter del cron, finestra piena), due di fila no. */
const CADENCE_GRACE_MS: Record<JobCadence, number> = {
  daily: 2 * 24 * 60 * 60 * 1000,
  weekly: 14 * 24 * 60 * 60 * 1000,
  monthly: 62 * 24 * 60 * 60 * 1000
};

/**
 * I motivi che la UI sa tradurre. Un `failed` porta con sé il messaggio d'errore grezzo (inglese,
 * spesso di una libreria): non deve arrivare a schermo. Tutto ciò che non è in questo insieme
 * diventa `null` e la UI mostra la frase generica del suo stato.
 */
const KNOWN_REASONS = new Set([
  'no_plan',
  'fresh',
  'no_own_signal',
  'no_accounts',
  'no_budget',
  'empty_result',
  'user_off'
]);

export function translatableReason(reason: string | null | undefined): string | null {
  const r = (reason ?? '').trim();
  return r && KNOWN_REASONS.has(r) ? r : null;
}

/**
 * Lo stato del roster di un brand: una query sugli opt-out, una sugli ultimi tick. Niente join,
 * niente colonne nuove su tabelle condivise — una `select` che nomina una colonna non ancora
 * creata fa fallire l'INTERA query, e azzera ogni lettura di quella tabella (già successo).
 */
export async function brandRoster(admin: SupabaseClient, brandId: string): Promise<JobStatus[]> {
  const [off, ticks, served] = await Promise.all([
    // Niente cache qui: chi apre la pagina vuole vedere lo stato vero, non quello di un minuto fa.
    (async () => {
      forgetBrandJobOptOuts(brandId);
      return brandJobOptOuts(brandId, admin);
    })(),
    admin
      .from('loop_ticks')
      .select('loop, outcome, reason, created_at')
      .eq('brand_id', brandId)
      .in('loop', [...ROSTER_JOB_KEYS])
      .order('created_at', { ascending: false })
      .limit(200)
      .then(
        ({ data }) => data ?? [],
        () => [] as { loop: unknown; outcome: unknown; reason: unknown; created_at: unknown }[]
      ),
    // Tollera la tabella assente: i deploy non applicano le migration, e una pagina che esplode
    // perché il cursore non c'è ancora è peggio di una pagina che non sa dire "in ritardo".
    loopServedAt(admin, ROSTER_JOB_KEYS, brandId)
  ]);

  // Le righe arrivano dalla più recente: il primo tick di ogni loop è l'ultimo esito.
  const last = new Map<string, { outcome: string; reason: string | null; at: string }>();
  for (const row of ticks) {
    const loop = String(row.loop);
    if (last.has(loop)) continue;
    last.set(loop, {
      outcome: String(row.outcome),
      reason: row.reason == null ? null : String(row.reason),
      at: String(row.created_at)
    });
  }

  return ROSTER_JOBS.map((job) => {
    const enabled = !off.has(job.key);
    const tick = last.get(job.key);
    const servedAt = served.get(job.key) ?? null;
    // Un tick `user_off` è il riflesso di uno spegnimento, non un giro: se il lavoro è stato
    // riacceso non deve restare a schermo come ultimo esito.
    const meaningful = tick && tick.reason !== 'user_off' ? tick : undefined;
    const state: JobState = !enabled
      ? 'off'
      : !meaningful
        ? 'never'
        : meaningful.outcome === 'ok'
          ? 'ok'
          : meaningful.outcome === 'failed'
            ? 'failed'
            : 'skipped';
    return {
      key: job.key,
      cadence: job.cadence,
      enabled,
      state,
      reason: state === 'skipped' || state === 'failed' ? translatableReason(meaningful?.reason) : null,
      lastRunAt: meaningful?.at ?? null,
      servedAt,
      // Mai servito conta come indietro: è il caso peggiore, non quello neutro. Era il caso di 2
      // brand su 13 per l'audit GEO, invisibile perché non produceva nessuna riga da nessuna parte.
      behind: enabled && (!servedAt || Date.now() - Date.parse(servedAt) > CADENCE_GRACE_MS[job.cadence])
    };
  });
}

/** Quanto indietro guarda `jobRunCounts`. Un mese copre anche il lavoro mensile, una volta. */
export const RUN_WINDOW_DAYS = 30;

/** Tetto della lettura: nove lavori per trenta giorni non ci arrivano, e un brand impazzito non
 * trascina giù la pagina che lo sta guardando. */
const RUN_ROWS_MAX = 1000;

/**
 * Quante volte ogni lavoro ha DAVVERO girato nella finestra.
 *
 * `skipped` non conta: un gate lo ha fermato prima di spendere, e contarlo direbbe "questo lavoro
 * ti costa" di un lavoro che non ha mai chiamato un modello. `ok` e `failed` invece hanno provato,
 * e un tentativo fallito può aver già speso.
 *
 * Non è il COSTO, ed è tutto ciò che il database sa dire: `ai_calls` non ha nessuna colonna che
 * nomini il loop, e le label sono condivise fra lavori diversi (`director` sta sia in autopilot
 * sia in radar_recap), quindi nessuna somma per lavoro sarebbe vera.
 */
export async function jobRunCounts(
  admin: SupabaseClient,
  brandId: string,
  sinceIso: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const res = await admin
      .from('loop_ticks')
      .select('loop, outcome')
      .eq('brand_id', brandId)
      .in('loop', [...ROSTER_JOB_KEYS])
      .in('outcome', ['ok', 'failed'])
      .gte('created_at', sinceIso)
      .limit(RUN_ROWS_MAX);
    for (const row of (res?.data ?? []) as { loop: unknown }[]) {
      const loop = String(row.loop);
      counts.set(loop, (counts.get(loop) ?? 0) + 1);
    }
  } catch {
    return counts;
  }
  return counts;
}

/**
 * L'opt-out scritto DAL SISTEMA, non da una persona: il watchdog dei fallimenti consecutivi
 * dell'autopilot spegne il lavoro qui — una riga visibile sul roster — invece di flippare il
 * vecchio booleano invisibile `brands.autopilot_enabled` (che restava false per mesi senza che
 * nessuno se ne accorgesse: è il difetto che questo lavoro rimuove).
 *
 * `actor` finisce nella colonna omonima (migration 0208). Se la colonna non è ancora stata
 * applicata l'upsert fallirebbe TUTTO, quindi si ritenta senza: meglio un opt-out anonimo che un
 * watchdog che non riesce a fermare un brand che fallisce ogni notte.
 */
export async function recordSystemJobOptOut(
  admin: SupabaseClient,
  input: { brandId: string; jobKey: JobKey; actor: string }
): Promise<void> {
  const base = {
    brand_id: input.brandId,
    job_key: input.jobKey,
    disabled_at: new Date().toISOString()
  };
  try {
    const res = await admin
      .from('brand_job_optouts')
      .upsert({ ...base, actor: input.actor }, { onConflict: 'brand_id,job_key' });
    if (res.error) {
      // Quasi sempre: colonna `actor` non ancora migrata. Riprova nella forma minima.
      const retry = await admin.from('brand_job_optouts').upsert(base, { onConflict: 'brand_id,job_key' });
      if (retry.error) console.warn('[job-roster] system opt-out failed:', retry.error.message.slice(0, 160));
    }
  } catch (e) {
    console.warn('[job-roster] system opt-out threw:', e instanceof Error ? e.message.slice(0, 160) : e);
  }
  forgetBrandJobOptOuts(input.brandId);
}

/** Spegne o riaccende un lavoro. Riaccendere CANCELLA la riga: l'assenza è il default acceso. */
export async function setJobEnabled(
  admin: SupabaseClient,
  input: { brandId: string; jobKey: string; enabled: boolean; userId?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ROSTER_JOB_KEYS.includes(input.jobKey)) return { ok: false, error: 'unknown_job' };
  try {
    const res = input.enabled
      ? await admin
          .from('brand_job_optouts')
          .delete()
          .eq('brand_id', input.brandId)
          .eq('job_key', input.jobKey)
      : await admin.from('brand_job_optouts').upsert(
          {
            brand_id: input.brandId,
            job_key: input.jobKey,
            disabled_at: new Date().toISOString(),
            disabled_by: input.userId ?? null
          },
          { onConflict: 'brand_id,job_key' }
        );
    if (res.error) {
      // Quasi sempre: la migration non è ancora stata applicata a mano. Dirlo, invece di
      // lasciare l'utente davanti a un interruttore che torna indietro da solo senza spiegazioni.
      console.warn('[job-roster] toggle failed:', res.error.message.slice(0, 160));
      return { ok: false, error: 'db' };
    }
  } catch (e) {
    console.warn('[job-roster] toggle threw:', e instanceof Error ? e.message.slice(0, 160) : e);
    return { ok: false, error: 'db' };
  }
  forgetBrandJobOptOuts(input.brandId);
  return { ok: true };
}
