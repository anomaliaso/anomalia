import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CHAT_REAP_MIN_AGE_MS,
  chatJobDeathMessage,
  classifyKitRun,
  type KitRunLiveness
} from '$lib/server/chat/turn-limits';
import { ChatTurnDeadError } from '$lib/server/chat/job-cancel';
import { assistantContentFromPartial, type ChatPartialSnapshot } from '$lib/server/chat/partial-persist';
import { createEffectsLedger } from '$lib/server/agent-kit-effects-store';

/**
 * IL RECUPERO DEL LAVORO MORTO, per una riga sola — estratto dal loop del cron perché `sweep.test.ts`
 * lo pinna senza dover montare sandbox/checkpoint/auth. Un run ucciso a metà (funzione terminata
 * dalla piattaforma, crash, deploy) non ha mai eseguito il suo `onFinish`: il testo che il modello
 * aveva già prodotto vive solo in `partial`, e all'utente la chat sembra svuotata dopo il proprio
 * messaggio (23/8, segnalato in produzione). Qui quel testo diventa un messaggio vero, con la riga
 * di verità in coda: nessun lavoro sparisce in silenzio.
 */
export async function recoverDeadPartial(db: SupabaseClient, runId: string): Promise<void> {
  // `select('*')` e non la lista dei nomi: i deploy NON eseguono le migration, quindi una colonna
  // nuova puo' non esistere ancora in produzione. Una select che NOMINA una colonna assente prende
  // un 42703 — supabase-js non lancia, restituisce `data: null` — e questa funzione usciva ai primi
  // guard: il recupero spento in silenzio, senza nemmeno un log. Con `*` si legge cio' che la
  // tabella HA, prima e dopo la migration, e l'errore vero (se c'e') finisce nei log.
  const { data: run, error } = await db.from('agent_kit_runs').select('*').eq('id', runId).maybeSingle();
  if (error) {
    console.error('[sweep] lettura run fallita', runId, error);
    return;
  }
  // IL MARCATORE (0219): se `onFinish` ha fatto in tempo a salvare prima che la piattaforma
  // uccidesse la funzione, la riga porta già l'id del messaggio vero — niente da indovinare.
  if (run?.partial_saved_msg_id) return;
  const partial = (run?.partial ?? null) as ChatPartialSnapshot | null;
  const text = partial?.text?.trim();
  // Tool call e testo, nell'ordine dello stream: una chiamata in volo al momento della morte va
  // ricordata sulla riga (tool_calls), così la storia rigiocata la porta come esito incerto invece
  // di dimenticarla — e il turno dopo non rifà un lavoro a pagamento già (forse) fatto.
  const parts = assistantContentFromPartial(partial).filter(
    (p) => p.type === 'tool-call' || p.type === 'text'
  );
  const hasToolCalls = parts.some((p) => p.type === 'tool-call');
  if (!run?.thread_id || !run.user_id || (!text && !hasToolCalls)) return;
  // PALLIATIVO per le righe senza marcatore (run chiusi prima della 0219, o la corsa stretta fra
  // la scrittura di onFinish e questo reaper): il confronto resta su testo, ma con le wildcard di
  // LIKE (`%`/`_`) escapate — senza, un incipit che le contiene faceva match a caso — e una
  // finestra molto più stretta dei 60' originali, perché qui serve solo coprire "onFinish ha
  // appena salvato, il marcatore non è ancora arrivato", non un'ora di storia.
  if (text) {
    const escaped = text.slice(0, 40).replace(/[\\%_]/g, '\\$&');
    const { data: existing } = await db
      .from('chat_messages')
      .select('id')
      .eq('thread_id', run.thread_id)
      .eq('role', 'assistant')
      // Ancorata alla NASCITA DEL RUN, non a una finestra fissa. I 5 minuti erano codice morto: il
      // reaper agisce per definizione dopo >=10' di silenzio, quindi il messaggio da deduplicare
      // cadeva SEMPRE fuori finestra e il caso che il commento dichiarava di coprire produceva un
      // doppione garantito. Un messaggio nato prima del run non puo' essere il suo.
      .gte('created_at', String(run.created_at ?? new Date(0).toISOString()))
      .ilike('content', `${escaped}%`)
      .limit(1)
      .maybeSingle();
    if (existing) return; // già salvato dal suo onFinish: niente doppioni
  }
  const notice = "_(turno interrotto: questo è quanto era stato prodotto prima dell'interruzione)_";
  await db.from('chat_messages').insert({
    brand_id: run.brand_id,
    user_id: run.user_id,
    thread_id: run.thread_id,
    role: 'assistant',
    content: text ? `${text}\n\n${notice}` : notice,
    ...(hasToolCalls ? { tool_calls: parts } : {})
  });
}

type DeadKitRun = KitRunLiveness & {
  id: string;
  brand_id: string;
  user_id: string | null;
  thread_id: string | null;
  agent_id: string | null;
};

/**
 * I run kit che non hanno più un processo dietro: chiusi, recuperati e RIPORTATI. La soglia è
 * la stessa del motore classico (`classifyKitRun`), e ogni riga chiusa passa da `reportChatError`
 * — prima lo sweep restituiva un conteggio nel JSON del cron e nessuno riceveva niente.
 */
export async function reapDeadKitRuns(
  db: SupabaseClient,
  opts: { limit?: number; emailBudget?: number } = {}
): Promise<number> {
  const { data: candidates, error } = await db
    .from('agent_kit_runs')
    .select('id, brand_id, user_id, thread_id, agent_id, state, heartbeat_at, created_at')
    .eq('state', 'running')
    .lt('created_at', new Date(Date.now() - CHAT_REAP_MIN_AGE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 200);
  if (error) {
    console.error('[sweep] lettura dei run da chiudere fallita', error.message);
    return 0;
  }

  let emailsLeft = opts.emailBudget ?? 3;
  let reaped = 0;

  for (const run of (candidates ?? []) as DeadKitRun[]) {
    const verdict = classifyKitRun(run);
    if (!verdict.dead) continue;

    const { data: claimed } = await db
      .from('agent_kit_runs')
      .update({ state: 'aborted', reason: 'aborted', updated_at: new Date().toISOString() })
      .eq('id', run.id)
      .eq('state', 'running')
      .select('id')
      .maybeSingle();
    if (!claimed) continue;
    reaped += 1;

    // Gli effetti di questo run ancora `intended` (un tool di scrittura avviato, mai risolto)
    // diventano `ambiguous`: il risiko del doppio post/schedulazione. Prima di rieseguire, il gate
    // li legge e congela — mai due volte la stessa scrittura perché il segmento è morto a metà.
    try {
      await createEffectsLedger(db).reconcileRun(run.id);
    } catch (e) {
      console.error('[sweep] reconciliazione effetti fallita', run.id, e);
    }

    try {
      await recoverDeadPartial(db, run.id);
    } catch (e) {
      console.error('[sweep] recupero parziale fallito', run.id, e);
    }

    const { reportChatError } = await import('$lib/server/chat/report-error');
    await reportChatError(
      null,
      new ChatTurnDeadError(chatJobDeathMessage(verdict.reason), verdict.reason),
      {
        brandId: run.brand_id,
        userId: run.user_id,
        threadId: run.thread_id,
        kind: 'kit_turn_died',
        notify: emailsLeft > 0 ? 'all' : 'sentry',
        detail: `agent kit run ${run.id} (${run.agent_id ?? 'agente sconosciuto'})`
      }
    );
    if (emailsLeft > 0) emailsLeft -= 1;
  }

  return reaped;
}
