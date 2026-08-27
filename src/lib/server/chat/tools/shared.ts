import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRec = Record<string, any>;

export type ChatToolCtx = {
  supabase: SupabaseClient;
  brandId: string;
  tz: string;
  userId: string;
  origin: string;
  locale: string;
  threadId?: string;
  turnRefUrls: string[];
  turnDocuments: Array<{ name: string; markdown: string; title?: string | null }>;
  agentColor: string;
  remainingMs?: () => number;
  memoryAgent: string | null;
};

/**
 * Avvia un tool lungo FUORI dal turno e torna SUBITO.
 *
 * Prima questa funzione eseguiva il lavoro qui, su questa riga, e il turno restava appeso finché
 * non finiva: l'audit SEO & GEO del 22/08 ha tenuto un turno di onboarding bloccato 355 secondi
 * mentre la UI — che disegna l'indicatore leggendo proprio la riga `chat_jobs` inserita qui —
 * diceva "sto lavorando in background, puoi andartene". Le due cose non erano mai state vere
 * insieme: la riga era in background, il turno no. Ora lo sono.
 *
 * La riga nasce `pending`, che nel resto del sistema significa una cosa sola: nessuno la sta
 * eseguendo, qualcuno dovrebbe. Quel qualcuno è `processNextPendingToolJob` (queue.ts), che ha il
 * suo muro da 1800s, il suo heartbeat e la sua cancellazione — cioè tutto quello che al turno
 * mancava. Il kick è solo per non aspettare il cron: se si perde, il cron lo pesca comunque.
 *
 * L'esito rientra in conversazione da solo (tool-job-report.ts), con lo stesso meccanismo dei DM
 * fra agenti. Qui non si aspetta niente e non si sonda niente: il turno dice una riga e si spegne.
 */
export async function startLongToolJob(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  toolName: string,
  params: AnyRec,
  threadId?: string,
  abortSignal?: AbortSignal,
  origin: string = '',
  locale: string = 'it'
): Promise<AnyRec> {
  if (abortSignal?.aborted) {
    return { cancelled: true, error: 'Chat stopped before job could start' };
  }

  const { data: job, error } = await supabase.from('chat_jobs').insert({
    brand_id: brandId,
    user_id: userId,
    tool_name: toolName,
    // `report_*` viaggiano nei params perché è l'unico posto dove portarli senza una migration:
    // chi chiude la riga (worker o reaper) è un altro processo e non ha né l'origin né la lingua.
    input_params: { ...params, report_locale: locale === 'en' ? 'en' : 'it', report_origin: origin },
    status: 'pending',
    thread_id: threadId ?? null
  }).select('id').maybeSingle();

  if (error || !job) return { error: `Failed to create job: ${error?.message ?? 'unknown'}` };

  // Stop premuto tra l'insert e qui: la riga muore prima che il worker la reclami.
  if (abortSignal?.aborted) {
    await supabase
      .from('chat_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', job.id)
      .in('status', ['pending', 'running']);
    return { cancelled: true, job_id: job.id };
  }

  // Import dinamico: queue.ts importa questo modulo (createChatTools), un import statico sarebbe
  // un ciclo. Fire-and-forget per definizione — il worker vive in un'altra invocazione.
  void import('$lib/server/chat/queue')
    .then(({ kickChatQueueWork }) => (origin ? kickChatQueueWork(origin) : undefined))
    .catch(() => {});

  return {
    background: true,
    started: true,
    job_id: job.id,
    tool: toolName,
    message:
      `${toolName} is now running in the background, outside this turn. It is NOT done and there is no result yet. ` +
      'Say in ONE short line what you started and that you will come back with the result as soon as it lands, then END YOUR TURN. ' +
      'Do not wait for it, do not poll it, do not call it again, do not invent its outcome. The result will be delivered to you as a new message.'
  };
}
