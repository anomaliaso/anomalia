/**
 * IL DIARIO DEGLI OBIETTIVI — perché lo stato finale non risponde alla domanda che conta.
 *
 * `chat_goals` tiene com'è andata a finire. Serve alla card e al prompt del turno dopo, e non basta
 * per la sola domanda che vale la pena farsi su una funzione come questa: **funziona?**
 *
 * Un obiettivo chiuso come raggiunto può esserlo stato al primo colpo o dopo tre riprese. Uno
 * restituito alla persona può essersi fermato perché era impossibile o perché l'agente girava a
 * vuoto. Lo stato finale schiaccia tutto in una parola, e la storia che serviva a capire viene
 * cancellata per sovrascrittura — proprio mentre la funzione è nuova e nessuno sa ancora se la
 * soglia dei quattro giri è generosa o stretta.
 *
 * Quindi due registri, non uno:
 *
 * - **`console.log('[Goal] …')`** — una riga per evento nello stream della funzione. Costa zero,
 *   si legge subito e serve a capire *un* caso mentre è ancora caldo.
 * - **`chat_goal_events`** — una riga per evento nel database, con i contatori come colonne.
 *   Serve alla domanda aggregata: quanti obiettivi si chiudono senza riprese, quanti si fermano
 *   per `no_progress`, quanti criteri vengono buttati invece che chiusi.
 *
 * Tutto fire-and-forget: un diario che fa fallire il turno che sta raccontando è peggio di nessun
 * diario. Ogni scrittura è awaitable ma non lancia mai, e chi la chiama non la aspetta.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { goalProgress, type ChatGoal, type GoalCriterion } from '$lib/server/chat/goal';

export type GoalEventKind =
  /** L'obiettivo nasce — dall'agente o dal comando dell'utente. */
  | 'opened'
  /** Criteri chiusi, buttati o aggiunti. */
  | 'updated'
  /** Fine turno: la decisione su cosa succede adesso. */
  | 'settled'
  /** L'obiettivo si chiude: raggiunto, restituito o abbandonato. */
  | 'closed';

export type GoalEvent = {
  kind: GoalEventKind;
  goalId: string | null;
  brandId: string;
  userId?: string | null;
  threadId?: string | null;
  /** Vocabolario del motore: open_criteria, out_of_time, no_progress, met, handed_back… */
  reason?: string | null;
  actor?: 'agent' | 'user';
  criteria?: GoalCriterion[];
  closedNow?: number;
  laps?: number;
  depth?: number;
  /** Solo per 'settled': la ripresa è stata davvero accodata, o solo decisa? */
  queued?: boolean;
  detail?: Record<string, unknown>;
};

/** La riga nello stream: corta, sempre nello stesso ordine, greppabile per `[Goal]`. */
function logLine(e: GoalEvent, done: number, total: number): string {
  const bits = [
    `[Goal] ${e.kind}`,
    e.reason ? `reason=${e.reason}` : '',
    `progress=${done}/${total}`,
    e.closedNow ? `closed=${e.closedNow}` : '',
    e.laps ? `laps=${e.laps}` : '',
    e.depth ? `depth=${e.depth}` : '',
    e.queued === undefined ? '' : `queued=${e.queued}`,
    `actor=${e.actor ?? 'agent'}`,
    `goal=${e.goalId ?? 'none'}`,
    e.threadId ? `thread=${e.threadId}` : ''
  ];
  return bits.filter(Boolean).join(' ');
}

/**
 * Scrive l'evento nei due registri. Non lancia: qualunque cosa vada storta qui, il turno continua.
 */
export async function logGoalEvent(supabase: SupabaseClient, e: GoalEvent): Promise<void> {
  const { done, total } = goalProgress(e.criteria ?? []);
  console.log(logLine(e, done, total));
  try {
    await supabase.from('chat_goal_events').insert({
      goal_id: e.goalId,
      brand_id: e.brandId,
      user_id: e.userId ?? null,
      thread_id: e.threadId ?? null,
      kind: e.kind,
      reason: e.reason ?? null,
      actor: e.actor ?? 'agent',
      criteria_done: done,
      criteria_total: total,
      criteria_closed_now: e.closedNow ?? 0,
      laps: e.laps ?? 0,
      depth: e.depth ?? 0,
      queued: e.queued ?? null,
      detail: e.detail ?? null
    });
  } catch (err) {
    console.error('[Goal] event log failed:', err instanceof Error ? err.message : err);
  }
}

/** Non aspettarla: il diario non deve mai stare sul percorso critico del turno. */
export function trackGoalEvent(supabase: SupabaseClient, e: GoalEvent): void {
  void logGoalEvent(supabase, e).catch(() => {});
}

export type GoalHistoryEntry = {
  id: string;
  statement: string;
  status: string;
  source: string;
  laps: number;
  criteria: GoalCriterion[];
  created_at: string;
  closed_at: string | null;
  closing_note: string | null;
  events: Array<{
    kind: string;
    reason: string | null;
    actor: string;
    progress: string;
    closed_now: number;
    laps: number;
    queued: boolean | null;
    at: string;
  }>;
};

/**
 * Gli obiettivi di un brand con il loro diario, dal più recente.
 *
 * Due query e non una join: le righe di `chat_goals` sono poche e larghe, quelle degli eventi sono
 * tante e strette — una join le moltiplicherebbe per il numero di eventi e restituirebbe la stessa
 * frase dell'obiettivo dieci volte.
 */
export async function loadGoalHistory(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { limit?: number; threadId?: string }
): Promise<GoalHistoryEntry[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  let q = supabase
    .from('chat_goals')
    .select('id, statement, status, source, laps, criteria, created_at, closed_at, closing_note')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts?.threadId) q = q.eq('thread_id', opts.threadId);

  const { data: goals } = await q;
  if (!goals?.length) return [];

  const { data: events } = await supabase
    .from('chat_goal_events')
    .select('goal_id, kind, reason, actor, criteria_done, criteria_total, criteria_closed_now, laps, queued, created_at')
    .in(
      'goal_id',
      goals.map((g) => g.id as string)
    )
    .order('created_at', { ascending: true })
    .limit(limit * 40);

  const byGoal = new Map<string, GoalHistoryEntry['events']>();
  for (const ev of events ?? []) {
    const id = ev.goal_id as string;
    const list = byGoal.get(id) ?? [];
    list.push({
      kind: ev.kind as string,
      reason: (ev.reason as string | null) ?? null,
      actor: (ev.actor as string) ?? 'agent',
      progress: `${ev.criteria_done ?? 0}/${ev.criteria_total ?? 0}`,
      closed_now: (ev.criteria_closed_now as number) ?? 0,
      laps: (ev.laps as number) ?? 0,
      queued: (ev.queued as boolean | null) ?? null,
      at: ev.created_at as string
    });
    byGoal.set(id, list);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (goals as any[]).map((g) => ({
    id: g.id,
    statement: g.statement,
    status: g.status,
    source: g.source,
    laps: g.laps ?? 0,
    criteria: Array.isArray(g.criteria) ? g.criteria : [],
    created_at: g.created_at,
    closed_at: g.closed_at ?? null,
    closing_note: g.closing_note ?? null,
    events: byGoal.get(g.id) ?? []
  }));
}

export type GoalStats = {
  goals: number;
  open: number;
  met: number;
  handed_back: number;
  abandoned: number;
  /** Obiettivi raggiunti senza nessuna ripresa automatica: il caso che vogliamo diventi la norma. */
  met_first_pass: number;
  /** Riprese automatiche consumate in totale — la voce di spesa della funzione. */
  laps: number;
  /** Perché le catene si sono fermate, per ragione. */
  stopped_by: Record<string, number>;
  criteria_done: number;
  criteria_dropped: number;
  criteria_open: number;
};

/**
 * Il riassunto che risponde a "funziona?".
 *
 * Si calcola in memoria da `loadGoalHistory` invece che con un aggregato SQL: sono decine di righe,
 * non milioni, e tenere il conteggio qui significa che la definizione di "raggiunto al primo colpo"
 * sta accanto a quella di `decideGoalContinuation` invece che dentro una query che nessuno rilegge.
 */
export function summarizeGoals(history: GoalHistoryEntry[]): GoalStats {
  const stats: GoalStats = {
    goals: history.length,
    open: 0,
    met: 0,
    handed_back: 0,
    abandoned: 0,
    met_first_pass: 0,
    laps: 0,
    stopped_by: {},
    criteria_done: 0,
    criteria_dropped: 0,
    criteria_open: 0
  };

  for (const g of history) {
    if (g.status === 'open') stats.open++;
    else if (g.status === 'met') stats.met++;
    else if (g.status === 'handed_back') stats.handed_back++;
    else if (g.status === 'abandoned') stats.abandoned++;
    if (g.status === 'met' && g.laps === 0) stats.met_first_pass++;
    stats.laps += g.laps ?? 0;

    for (const c of g.criteria) {
      if (c.status === 'done') stats.criteria_done++;
      else if (c.status === 'dropped') stats.criteria_dropped++;
      else stats.criteria_open++;
    }

    // La ragione che conta è l'ultima: è quella con cui la catena si è fermata.
    const lastStop = [...g.events].reverse().find((e) => e.kind === 'settled' && e.queued !== true);
    if (lastStop?.reason) {
      stats.stopped_by[lastStop.reason] = (stats.stopped_by[lastStop.reason] ?? 0) + 1;
    }
  }
  return stats;
}

/** Ricava il pezzo di diario da un obiettivo, per chi ha già la riga in mano. */
export function goalEventFromGoal(
  goal: ChatGoal,
  brandId: string,
  extra: Partial<GoalEvent> & { kind: GoalEventKind }
): GoalEvent {
  return {
    goalId: goal.id,
    brandId,
    threadId: goal.thread_id,
    criteria: goal.criteria,
    laps: goal.laps,
    actor: goal.source,
    ...extra
  };
}
