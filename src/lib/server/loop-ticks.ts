import { createAdminClient } from '$lib/server/supabase-admin';

/**
 * LOOP TICKS — un esito per ogni brand che un cron ha VALUTATO, non solo per quelli su cui ha
 * lavorato.
 *
 * PERCHÉ ESISTE. `agent_runs` registra le sessioni degli agenti: nasce una riga quando un agente
 * arriva in fondo (o fallisce dentro il proprio loop). Un brand escluso da un gate — piano free,
 * nessun dato proprio, già revisionato di recente — non lascia niente; e un crash prima di
 * `persistAgentRun` non lascia niente nemmeno lui. Così "zero righe" ha finito per significare due
 * cose incompatibili: «non è mai stato eleggibile» e «esplode ogni volta». È esattamente la
 * differenza che serviva sapere sull'analytics review agent, che per settimane è sembrato rotto
 * mentre era solo irraggiungibile (docs/38-salto-di-qualita.md §1).
 *
 * La regola che ne segue, e che vale per ogni tick di questo repo: **ogni `continue` scrive una
 * riga**. Un brand saltato in silenzio è un brand su cui, tra un mese, nessuno saprà rispondere.
 *
 * Scrittura fire-and-forget come `persistAgentRun`: la telemetria non deve mai far fallire il
 * lavoro che sta osservando.
 */

/** I cicli ricorrenti del prodotto. Uno per cron "che lavora sui brand". */
export type LoopName =
  | 'analytics_review'
  | 'autopilot'
  | 'weekly_recap'
  | 'seo'
  // La ricerca keyword è un lavoro a sé dal ripasso SEO: cadenze diverse (bisettimanale contro
  // settimanale) e quindi cursori diversi, o l'una si mangerebbe il turno dell'altra.
  | 'seo_keywords'
  | 'geo'
  | 'radar'
  // Il recap giornaliero del radar è un lavoro a sé: la scansione e l'email hanno cadenze diverse
  // e il cliente può volerne una senza l'altra.
  | 'radar_recap'
  | 'market_refs'
  // La revisione della strategia: il ripasso del GTM e il rinnovo del piano editoriale sono lo
  // stesso mestiere a due granularità (rileggere il piano contro quello che è successo davvero),
  // quindi condividono UNA chiave — e quindi un solo interruttore nel roster.
  | 'strategy_review'
  | 'library'
  | 'field'
  | 'blog'
  | 'ads';

export type LoopOutcome = 'ok' | 'skipped' | 'failed';

/**
 * Perché un brand non è stato lavorato. Sono stringhe stabili, non prosa: ci si fanno le query.
 * - `no_plan` — piano free/assente, il loop è a pagamento
 * - `fresh` — già fatto di recente, il gate di freschezza ha tenuto
 * - `no_own_signal` — nessun dato di performance proprio da cui adattare
 * - `no_accounts` — nessun account social collegato: il brand non può pubblicare
 * - `no_budget` — finestra della funzione esaurita, il brand torna al prossimo giro
 * - `empty_result` — il loop è girato senza produrre niente (né azioni né note)
 * - `user_off` — il cliente ha spento questo lavoro nel roster: non è un blocco, è una scelta
 */
export type LoopSkipReason =
  | 'no_plan'
  | 'fresh'
  | 'no_own_signal'
  | 'no_accounts'
  | 'no_budget'
  | 'empty_result'
  | 'user_off';

export type LoopTickInput = {
  loop: LoopName;
  brandId: string;
  outcome: LoopOutcome;
  /** Il gate che ha escluso il brand, o il messaggio d'errore per `failed`. */
  reason?: LoopSkipReason | string | null;
  durationMs?: number;
};

/**
 * Registra l'esito di UN brand dentro un tick. Non lancia mai, non attende mai: un errore di
 * telemetria che rompe il cron è peggio del buco di telemetria che stava riempiendo.
 */
export function recordLoopTick(input: LoopTickInput): void {
  try {
    const admin = createAdminClient();
    void admin
      .from('loop_ticks')
      .insert({
        loop: input.loop,
        brand_id: input.brandId,
        outcome: input.outcome,
        reason: input.reason ? String(input.reason).slice(0, 300) : null,
        duration_ms: Number.isFinite(input.durationMs) ? Math.round(Number(input.durationMs)) : null
      })
      .then(
        ({ error }) => {
          if (error) console.warn('[loop-ticks] insert failed:', error.message.slice(0, 160));
        },
        // La insert è in fire-and-forget: senza questo ramo un errore di rete diventa una
        // unhandled rejection che, su Vercel, può portarsi via la function che stiamo osservando.
        (e: unknown) => console.warn('[loop-ticks] insert rejected:', e instanceof Error ? e.message.slice(0, 160) : e)
      );
  } catch (e) {
    console.warn('[loop-ticks] insert threw:', e instanceof Error ? e.message.slice(0, 160) : e);
  }
}

// ── Budget di finestra ──────────────────────────────────────────────────────────────────────────

/** Finestra di una function Vercel con `config.maxDuration = 300`. */
export const DEFAULT_WALL_MS = 300_000;
/** Tempo lasciato libero in fondo per persistere gli esiti e rispondere. */
export const DEFAULT_RESERVE_MS = 20_000;
/** Nessun singolo brand può prendersi più di così, anche se la finestra è tutta libera. */
export const DEFAULT_MAX_RUN_MS = 120_000;
/** Sotto questa soglia un run non ha il tempo di concludere: meglio non iniziarlo. */
export const DEFAULT_MIN_RUN_MS = 45_000;

export type RunBudgetOpts = {
  /** Millisecondi già consumati dall'inizio della richiesta. */
  elapsedMs: number;
  wallMs?: number;
  reserveMs?: number;
  maxRunMs?: number;
  minRunMs?: number;
};

/**
 * Quanto tempo dare al PROSSIMO brand, o `null` se non ne resta abbastanza per iniziarlo.
 *
 * Sostituisce il conteggio fisso "N brand × M secondi" che è la trappola di ogni tick di questo
 * repo: `2 × 120s` sta dentro i 300s, `3 × 120s` no, e il terzo brand veniva ucciso da Vercel a
 * metà run — dopo aver speso i suoi token e prima di scrivere qualunque cosa. Con un budget
 * derivato dal tempo *residuo* il numero di brand per tick smette di essere una costante da
 * indovinare: si lavora finché c'è finestra, e chi non ci sta torna al prossimo giro (motivo
 * `no_budget`, che è un'informazione, non un buco).
 *
 * Puro: nessun clock, nessuna I/O — `elapsedMs` lo passa il chiamante.
 */
export function nextRunBudgetMs(opts: RunBudgetOpts): number | null {
  const wall = opts.wallMs ?? DEFAULT_WALL_MS;
  const reserve = opts.reserveMs ?? DEFAULT_RESERVE_MS;
  const maxRun = opts.maxRunMs ?? DEFAULT_MAX_RUN_MS;
  const minRun = opts.minRunMs ?? DEFAULT_MIN_RUN_MS;

  const elapsed = Number.isFinite(opts.elapsedMs) ? Math.max(0, opts.elapsedMs) : 0;
  const left = wall - reserve - elapsed;
  if (left < minRun) return null;
  return Math.min(maxRun, left);
}
