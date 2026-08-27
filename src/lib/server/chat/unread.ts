import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Stato di lettura dei thread, per utente (migration 0207).
 *
 * Tutto sta in due fatti che esistono già: `chat_threads.updated_at`, toccato a ogni messaggio
 * scritto da chiunque (anche dal worker che gira di notte), e `chat_thread_reads.last_read_at`,
 * l'ultima volta che QUELL'utente ha avuto il thread davanti. Non letto = il primo è più recente
 * del secondo. Nessun contatore da mantenere allineato.
 *
 * Ogni funzione qui è best-effort per progetto: le migration non le applica il deploy, quindi in
 * produzione questo codice gira anche dove la tabella non c'è ancora. In quel caso non si alza —
 * si degrada a "tutto letto": nessun badge, che è il modo giusto di sbagliare.
 */

/** Nome della tabella in un posto solo: serve anche ai test per riconoscere la query. */
const TABLE = 'chat_thread_reads';

/**
 * Non letto = qualcosa è stato scritto dopo l'ultima occhiata. Senza riga (thread vecchio, o
 * tabella non ancora applicata) è letto: meglio un badge che manca di una sidebar tutta accesa.
 *
 * Confronto sui millisecondi e non sulle stringhe: postgrest torna `+00:00`, `toISOString()`
 * scrive `Z`, e ordinati come testo quei due formati non sono confrontabili.
 */
export function isUnread(updatedAt: string | null | undefined, lastReadAt: string | null | undefined): boolean {
  if (!updatedAt || !lastReadAt) return false;
  const a = Date.parse(updatedAt);
  const b = Date.parse(lastReadAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a > b;
}

/** `{ threadId: last_read_at }` per i thread chiesti. Query separata, mai dentro una select condivisa. */
export async function loadLastReads(
  supabase: SupabaseClient,
  userId: string,
  threadIds: string[]
): Promise<Record<string, string>> {
  if (!threadIds.length) return {};
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('thread_id, last_read_at')
      .eq('user_id', userId)
      .in('thread_id', threadIds);
    if (error || !data) return {};
    const out: Record<string, string> = {};
    for (const row of data as { thread_id: string; last_read_at: string }[]) {
      out[row.thread_id] = row.last_read_at;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Il degrado si annuncia UNA volta per processo: markThreadRead gira a ogni apertura di thread,
 * e con la tabella mancante (migration non applicata) lo stesso warn inondava i log a ogni mark.
 */
let warnedOnce = false;

/**
 * Sposta il segnalibro a ora. Upsert e non insert: la riga nasce alla creazione del thread e poi
 * viene solo spinta avanti, quindi il caso normale è il conflitto sulla PK.
 */
export async function markThreadRead(
  supabase: SupabaseClient,
  threadId: string,
  userId: string,
  at: string = new Date().toISOString()
): Promise<void> {
  if (!threadId || !userId) return;
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ thread_id: threadId, user_id: userId, last_read_at: at }, { onConflict: 'thread_id,user_id' });
    // Un segnalibro non salvato costa un badge di troppo, non un messaggio perso: si logga e basta.
    if (error && !warnedOnce) {
      warnedOnce = true;
      console.warn(`[unread] mark read failed (further failures muted): ${error.message}`);
    }
  } catch {
    /* tabella non ancora applicata: nessun badge, nessun errore */
  }
}

/**
 * Quanti messaggi sono arrivati dopo l'ultima occhiata, per i thread che risultano non letti.
 *
 * `since` è `{ threadId: last_read_at }` e contiene SOLO i thread già dichiarati non letti da
 * `isUnread`: senza riga di lettura il thread conta come letto — la stessa regola del pallino di
 * prima — quindi qui non arriva mai una soglia nulla e la sidebar non si accende tutta di storico
 * il giorno in cui la 0207 viene applicata.
 *
 * UNA query per tutta la pagina, non una per riga: PostgREST non fa il group by, quindi si chiede
 * quello che è stato scritto dopo la PIÙ VECCHIA delle soglie e si conta qui, thread per thread,
 * con la soglia sua. Due colonne, nessun contenuto: il peso è nel numero di righe, non nei KB.
 *
 * Si contano solo le `assistant` con del testo dentro: i messaggi dell'utente li ha scritti lui e
 * non sono "da leggere", e un turno chiuso su un tool (content '') non è niente da vedere — stessa
 * regola dell'anteprima in `listThreadSnippets`.
 */
export async function loadUnreadCounts(
  supabase: SupabaseClient,
  since: Record<string, string>
): Promise<Record<string, number>> {
  const ids = Object.keys(since);
  if (!ids.length) return {};
  let oldest = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const t = Date.parse(since[id]);
    if (!Number.isNaN(t) && t < oldest) oldest = t;
  }
  if (!Number.isFinite(oldest)) return {};
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('thread_id, created_at')
      .in('thread_id', ids)
      .gt('created_at', new Date(oldest).toISOString())
      .eq('role', 'assistant')
      .neq('content', '')
      // ponytail: tetto di sicurezza. Il badge si ferma a 9+, quindi oltre queste righe non
      // cambierebbe niente a schermo; si alza solo se un giorno il badge imparerà a contare oltre.
      .order('created_at', { ascending: false })
      .limit(500);
    if (error || !data) return {};
    const out: Record<string, number> = {};
    for (const row of data as { thread_id: string; created_at: string }[]) {
      if (Date.parse(row.created_at) > Date.parse(since[row.thread_id])) {
        out[row.thread_id] = (out[row.thread_id] ?? 0) + 1;
      }
    }
    return out;
  } catch {
    return {};
  }
}
