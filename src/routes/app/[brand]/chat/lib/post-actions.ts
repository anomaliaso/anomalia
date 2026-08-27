import { json } from '@sveltejs/kit';
import type { ModelMessage } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  saveMessages,
  clearHistory,
  clearThreadContext,
  setThreadAgent,
  setThreadCustomAgent
} from '$lib/server/chat/persistence';
import { isClearCommand, clearBusyNotice, clearContextNotice } from '$lib/chat-commands';
import { closeGoal, loadOpenGoal } from '$lib/server/chat/goal';
import { cancelThreadChatJobs } from '$lib/server/chat/job-cancel';
import {
  assistantContentFromPartial,
  persistPartialAssistantReply,
  type ChatPartialSnapshot
} from '$lib/server/chat/partial-persist';
import { threadHasActiveChatResponse } from '$lib/server/chat/queue';
import {
  CHAT_HISTORY_DOC_CAP,
  formatAttachedDocsBlock,
  parseChatDocuments,
  chatDocumentRefs
} from '$lib/chat-documents';
import { hydrateChatDocuments } from '$lib/server/hydrate-chat-documents';
import {
  getChatRateUsage,
  chatRateLimitResponse,
  chatCreditsBlocked
} from '$lib/server/chat/rate-limits';
import { isChatMode, type ChatMode } from '$lib/chat-modes';
import { isChatTier } from '$lib/chat-tiers';
import { resolveAgentForPlan } from '$lib/server/chat/agents';
import {
  jobAbortControllers,
  lastUserText,
  scheduleQueueKick,
  deletePendingChatJobOrReportFailure,
  type Platform
} from './jobs';
import { bilingualNoticeLocale, type Locale } from '$lib/i18n/locale';

/**
 * Le azioni del POST che NON aprono un turno di modello: coda, annullamenti, /clear di contesto e
 * scorciatoie obiettivo. Ogni blocco risponde da sé; per qualsiasi altra azione (redo, o nessuna)
 * restituisce null e il chiamante prosegue col turno — lo stesso ordine di prima, blocco dopo blocco.
 */
export async function handlePostAction(input: {
  supabase: SupabaseClient;
  brand: { id: string; plan: string | null };
  user: { id: string };
  request: Request;
  platform: Platform;
  body: Record<string, unknown>;
  webHubEnabled: boolean;
  threadId: string;
  threadAgent: string | null;
  threadCustomAgentId: string | null;
  locale: Locale;
}): Promise<Response | null> {
  const { supabase, brand, user, request, platform, body, webHubEnabled, threadId, threadAgent, threadCustomAgentId, locale } = input;
  const action = body.action as string | undefined;

  // Handle clear history action
  if (action === 'clear') {
    await clearHistory(supabase, brand.id, user.id, threadId);
    return json({ cleared: true, thread_id: threadId });
  }

  // ── `/clear` — azzera il CONTESTO, non la conversazione ────────────────────────────────
  // Da non confondere con `action: 'clear'` qui sopra, che cancella le righe: questo sposta il
  // confine della compattazione all'ultimo messaggio, quindi l'agente riparte da zero e l'utente
  // conserva tutto lo scrollback. Arriva in due forme perché il comando deve valere ovunque: dal
  // browser come azione (nessun turno di modello da pagare) e da qualsiasi altra superficie come
  // testo normale.
  //
  // TURNO IN CORSO O IN CODA → SI RIFIUTA. Una continuazione già accodata riprende ricaricando la
  // history: azzerarla sotto i piedi la farebbe ripartire su una storia che non c'è più, e il
  // sintomo sarebbe un agente che ricomincia da capo senza spiegazione. Il rifiuto lascia una riga
  // nella trascrizione — costa meno di un turno impazzito, e si vede.
  if (action === 'clear_context' || isClearCommand(lastUserText(body.messages as ModelMessage[] | undefined))) {
    const en = bilingualNoticeLocale(locale) === 'en';
    if (await threadHasActiveChatResponse(supabase, { userId: user.id, threadId })) {
      await saveMessages(
        supabase,
        brand.id,
        user.id,
        [{ role: 'assistant', content: clearBusyNotice(en) }],
        threadId
      );
      return json({ cleared: false, busy: true, thread_id: threadId });
    }
    const cleared = await clearThreadContext(
      supabase,
      brand.id,
      user.id,
      threadId,
      clearContextNotice(en)
    );
    return json({ cleared, thread_id: threadId });
  }

  // ── /goal, le due forme che non meritano un turno di modello ──────────────────────────
  // Chiudere un obiettivo e guardarlo sono operazioni sulla riga, non domande a un'AI: farle
  // passare per il modello costerebbe crediti per riscrivere una cosa che il client ha già in mano.
  // La forma che invece merita un turno — `/goal <testo>` — prosegue sotto, con il resto.
  if (action === 'goal_stop' || action === 'goal_status') {
    const current = await loadOpenGoal(supabase, threadId, { brandId: brand.id, userId: user.id });
    if (action === 'goal_status') return json({ goal: current });
    if (!current) return json({ goal: null, closed: false });
    const closed = await closeGoal(
      supabase,
      current.id,
      'abandoned',
      bilingualNoticeLocale(locale) === 'en'
        ? 'Closed by the user.'
        : "Chiuso dall'utente."
    );
    return json({ goal: closed ?? { ...current, status: 'abandoned' }, closed: true });
  }

  // Handle cancel action — mark DB cancelled + abort same-instance controller.
  // Also cancel sibling async tool jobs from this turn (strategy/scrape/etc.).
  // Whatever already streamed must stay in the transcript (Stop ≠ erase).
  if (action === 'cancel') {
    const cancelJobId = body.job_id as string | undefined;
    let chatJobId = cancelJobId;

    if (!chatJobId) {
      // Cancel the latest running chat_response for this thread
      const { data: running } = await supabase
        .from('chat_jobs')
        .select('id')
        .eq('thread_id', threadId)
        .eq('user_id', user.id)
        .eq('tool_name', 'chat_response')
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      chatJobId = running?.id;
    }

    if (chatJobId) {
      const { data: jobRow } = await supabase
        .from('chat_jobs')
        .select('id, brand_id, thread_id, partial, input_params')
        .eq('id', chatJobId)
        .eq('user_id', user.id)
        .maybeSingle();

      const ctrl = jobAbortControllers.get(chatJobId);
      if (ctrl) {
        ctrl.abort();
        jobAbortControllers.delete(chatJobId);
      }

      await cancelThreadChatJobs(supabase, {
        userId: user.id,
        threadId,
        chatJobId
      });

      // Same-instance: onAbort has the freshest livePartial and will salvage.
      // Cross-instance / dead generator: promote the DB mirror here so Stop never
      // leaves a cancelled job with no assistant row.
      if (!ctrl && jobRow?.thread_id && jobRow.partial) {
        try {
          const content = assistantContentFromPartial(jobRow.partial as ChatPartialSnapshot);
          if (content.length) {
            await persistPartialAssistantReply(supabase, {
              brandId: (jobRow.brand_id as string) ?? brand.id,
              userId: user.id,
              threadId: jobRow.thread_id as string,
              content,
              jobId: chatJobId,
              tier: (jobRow.input_params as { tier?: string } | null)?.tier ?? null,
              finalStatus: 'cancelled',
              error: 'stopped by user'
            });
          }
        } catch (e) {
          console.error('[Chat cancel] partial persist failed:', e);
        }
      }
    }

    // Un turno kit non ha una riga `chat_jobs`, quindi fin qui lo Stop non lo toccava: il
    // client abortiva la propria fetch e il turno continuava a spendere. Lo stato del run è
    // l'unico posto dove il gesto dell'utente arriva all'altra invocazione.
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { cancelKitRun } = await import('$lib/agent/bridge/cancel');
    const kitCancelled = await cancelKitRun(createAdminClient(), supabase, threadId).catch((e) => {
      console.error('[Chat cancel] kit run cancel failed:', e);
      return false;
    });

    // Queued follow-ups should still run after the user stops the current turn.
    scheduleQueueKick(platform as Platform, new URL(request.url).origin);

    return json({ cancelled: true, kit_cancelled: kitCancelled });
  }

  // Queue a follow-up while another reply is already generating. Only a pending
  // chat_response job is created — the user message is written when the turn
  // actually starts (stream or queue worker), so the transcript stays clean and
  // the Queue chip is the source of truth for waiting prompts.
  if (action === 'enqueue') {
    const userMessages = body.messages as ModelMessage[] | undefined;
    const lastUserMsg = userMessages?.filter((m) => m.role === 'user').pop();
    if (!lastUserMsg) return new Response('No messages', { status: 400 });
    const queuedDocs = await hydrateChatDocuments(
      supabase,
      user.id,
      brand.id,
      parseChatDocuments(body.documents)
    );
    const textContent =
      typeof lastUserMsg.content === 'string'
        ? lastUserMsg.content
        : Array.isArray(lastUserMsg.content)
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (lastUserMsg.content as any[]).filter((p) => p.type === 'text').map((p) => p.text ?? '').join('')
          : '';
    const queuedUserMessage = textContent + formatAttachedDocsBlock(queuedDocs, CHAT_HISTORY_DOC_CAP);
    if (!queuedUserMessage.trim()) return new Response('Empty message', { status: 400 });

    const noticeLocale = bilingualNoticeLocale(locale);
    const rate = await getChatRateUsage(supabase, brand.id, brand.plan);
    if (!rate.ok) return chatRateLimitResponse(rate, noticeLocale);
    // Accodare un turno è già spendere: il worker lo eseguirà comunque. Si controlla qui, non solo
    // sul percorso interattivo, o la coda diventa il modo per aggirare la quota mensile.
    if (await chatCreditsBlocked(brand.id)) {
      return json({ error: 'credits_exhausted' }, { status: 402 });
    }

    const mode: ChatMode = isChatMode(body.mode) ? body.mode : 'agent';

    const bodyAgent = resolveAgentForPlan(body.agent, webHubEnabled);
    if (bodyAgent && bodyAgent !== threadAgent) {
      await setThreadAgent(supabase, threadId, brand.id, user.id, bodyAgent);
    }
    const queuedCustomAgent =
      body.customAgentId === null
        ? null
        : typeof body.customAgentId === 'string' && body.customAgentId
          ? body.customAgentId
          : threadCustomAgentId;
    if (queuedCustomAgent !== threadCustomAgentId) {
      await setThreadCustomAgent(supabase, threadId, brand.id, user.id, queuedCustomAgent);
    }

    const { data: qJob } = await supabase
      .from('chat_jobs')
      .insert({
        brand_id: brand.id,
        user_id: user.id,
        tool_name: 'chat_response',
        input_params: {
          user_message: queuedUserMessage,
          mode,
          locale,
          origin: new URL(request.url).origin,
          queued: true,
          // Il messaggio è GIÀ nel thread: il POST interattivo l'ha salvato e solo dopo ha preso
          // un 409 busy (il run kit era già partito). Senza questo flag il drain lo risalva —
          // confronta solo il tail della history, che a quel punto è la risposta dell'altro run.
          ...(body.user_message_saved === true ? { user_message_saved: true } : {}),
          ...(queuedDocs.length ? { documents: chatDocumentRefs(queuedDocs) } : {}),
          ...(isChatTier(body.tier) ? { tier: body.tier } : {}),
          ...(typeof body.reasoning === 'string' ? { reasoning: body.reasoning } : {})
        },
        status: 'pending',
        thread_id: threadId
      })
      .select('id')
      .maybeSingle();

    // If nothing else is actively streaming on this thread, start draining immediately.
    const busy = await threadHasActiveChatResponse(supabase, {
      userId: user.id,
      threadId,
      excludeJobId: qJob?.id
    });
    if (!busy) scheduleQueueKick(platform as Platform, new URL(request.url).origin);

    return json({ queued: true, job_id: qJob?.id ?? null, thread_id: threadId });
  }

  // Edit a waiting prompt (pending queued job only).
  if (action === 'queue_edit') {
    const jobId = body.job_id as string | undefined;
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!jobId || !text) return new Response('Missing job_id or text', { status: 400 });
    const { data: job } = await supabase
      .from('chat_jobs')
      .select('id, input_params, status')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .eq('thread_id', threadId)
      .eq('tool_name', 'chat_response')
      .eq('status', 'pending')
      .maybeSingle();
    if (!job) return json({ error: 'Queue item not found' }, { status: 404 });
    const params = { ...((job.input_params ?? {}) as Record<string, unknown>), user_message: text };
    await supabase.from('chat_jobs').update({ input_params: params }).eq('id', jobId);
    return json({ ok: true, job_id: jobId, text });
  }

  // Drop a waiting prompt from the queue.
  if (action === 'queue_delete') {
    const jobId = body.job_id as string | undefined;
    if (!jobId) return new Response('Missing job_id', { status: 400 });
    const { data: job } = await supabase
      .from('chat_jobs')
      .select('id, input_params')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .eq('thread_id', threadId)
      .eq('tool_name', 'chat_response')
      .eq('status', 'pending')
      .maybeSingle();
    if (!job) return json({ error: 'Queue item not found' }, { status: 404 });
    if (!(await deletePendingChatJobOrReportFailure(supabase, jobId))) {
      return json({ error: 'queue_delete_failed' }, { status: 500 });
    }
    // Legacy enqueues also inserted a user row — remove it when we still know the id.
    const msgId = (job.input_params as { message_id?: string } | null)?.message_id;
    if (msgId) {
      await supabase
        .from('chat_messages')
        .update({ superseded: true })
        .eq('id', msgId)
        .eq('user_id', user.id)
        .eq('thread_id', threadId);
    }
    return json({ ok: true, job_id: jobId });
  }

  // Stop the in-flight turn and run this queued prompt immediately (client starts SSE).
  if (action === 'queue_send_now') {
    const jobId = body.job_id as string | undefined;
    if (!jobId) return new Response('Missing job_id', { status: 400 });
    const { data: job } = await supabase
      .from('chat_jobs')
      .select('id, input_params')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .eq('thread_id', threadId)
      .eq('tool_name', 'chat_response')
      .eq('status', 'pending')
      .maybeSingle();
    if (!job) return json({ error: 'Queue item not found' }, { status: 404 });

    const params = (job.input_params ?? {}) as Record<string, unknown>;
    const text = String(params.user_message ?? '').trim();
    if (!text) return new Response('Empty queued message', { status: 400 });

    if (!(await deletePendingChatJobOrReportFailure(supabase, jobId))) {
      return json({ error: 'queue_send_now_failed' }, { status: 500 });
    }

    // Cancel whatever is generating on this thread right now.
    const { data: running } = await supabase
      .from('chat_jobs')
      .select('id')
      .eq('thread_id', threadId)
      .eq('user_id', user.id)
      .eq('tool_name', 'chat_response')
      .eq('status', 'running')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (running?.id) {
      const ctrl = jobAbortControllers.get(running.id);
      if (ctrl) {
        ctrl.abort();
        jobAbortControllers.delete(running.id);
      }
      await cancelThreadChatJobs(supabase, {
        userId: user.id,
        threadId,
        chatJobId: running.id
      });
    }

    // Legacy message row for this queue item — drop it; the live send will insert a fresh one.
    const msgId = typeof params.message_id === 'string' ? params.message_id : null;
    if (msgId) {
      await supabase
        .from('chat_messages')
        .update({ superseded: true })
        .eq('id', msgId)
        .eq('user_id', user.id)
        .eq('thread_id', threadId);
    }

    return json({
      ok: true,
      send_now: true,
      text,
      mode: typeof params.mode === 'string' ? params.mode : undefined,
      tier: typeof params.tier === 'string' ? params.tier : undefined,
      reasoning: typeof params.reasoning === 'string' ? params.reasoning : undefined
    });
  }

  return null;
}
