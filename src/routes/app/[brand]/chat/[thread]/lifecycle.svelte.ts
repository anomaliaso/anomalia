import { readPersistedSession, hydrateSessionFromStorage, beginJobPolling, watchToolJobs, isWatchingToolJobs, getSession } from '$lib/stores/chat-session';
import { refreshThreads } from '$lib/stores/chat';
import { parseToolCalls, redoIdOf, type ChatMessage } from '../components/transcript';

/**
 * Il ciclo di vita del turno visto dalla pagina: riaggancio dopo un refresh, poll dei job di
 * tool, reinvii e feedback. Tocca lo stato della pagina solo attraverso i puntini che riceve,
 * così le decisioni restano dove sono.
 */
export function createLifecycle(io: {
  brandSlug: () => string;
  threadId: () => string;
  pendingSeed: () => Array<{ id: string; status: string }> | null | undefined;
  loading: () => boolean;
  messages: () => ChatMessage[];
  setMessages: (m: ChatMessage[]) => void;
  handled: () => number | null;
  touchHandled: (at: number) => void;
  finalize: (completedAt: number) => Promise<void>;
  /** Avanza il cursore del thread sul registro degli eventi e, se serve, rilegge il transcript. */
  syncCursor: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send: (text?: string, meta?: any, opts?: { resend?: boolean; redoMessageId?: string; truncateFromMessageId?: string }) => Promise<void>;
}) {
  /**
   * Il battito del watcher non porta più la cronologia: la chiede la pagina al proprio cursore
   * sul registro del thread, che risponde con il solo delta e ricarica il transcript unicamente
   * quando un messaggio è davvero atterrato. Prima il tick si tirava dietro tutto — 202 KB e
   * 176 ms per cento messaggi, ogni tre secondi, quasi sempre identici a sé stessi.
   */
  function startToolPolling() {
    watchToolJobs({
      brandSlug: io.brandSlug(),
      threadId: io.threadId(),
      onTick: () => io.syncCursor(),
      onIdle: () => refreshThreads(io.brandSlug())
    });
  }

  function maybeStartToolPolling(seedJobs?: Array<{ id: string; status: string }> | null) {
    const pending = seedJobs ?? io.pendingSeed() ?? [];
    if (pending.length || isWatchingToolJobs(io.threadId())) startToolPolling();
  }

  /**
   * Il thread ha ancora un lavoro che gira FUORI dal turno?
   *
   * Sta qui, e non dentro il ramo felice di `send()`, perché la domanda va rifatta da più punti:
   * la fine di OGNI turno — anche quello rotto o fermato —, un messaggio scritto altrove, il
   * ritorno del focus. Finché la risposta arrivava da un posto solo, uno stream che si spezzava
   * lasciava un render in corso senza nessuno che lo dicesse: il seed del server è la fotografia
   * della load, e nient'altro chiedeva più niente.
   */
  async function checkPendingTools(): Promise<void> {
    if (io.loading()) return;
    try {
      const res = await fetch(`/app/${io.brandSlug()}/chat?thread=${io.threadId()}&pending_tools=1`);
      if (!res.ok) return;
      const { jobs } = await res.json();
      if (jobs?.length) startToolPolling();
    } catch {
      /* best-effort */
    }
  }

  /** Si riaggancia a uno stream vivo, o fa poll del job server dopo un refresh. */
  function resumeActiveGeneration(data: { activeJob?: { id: string; status: string } | null }) {
    const threadId = io.threadId();
    const live = getSession(threadId);

    // SSE ancora vivo in questa scheda: i buffer sono già nello store, niente da riagganciare.
    if (live?.loading) return;

    if (live?.completedAt && live.completedAt !== io.handled()) {
      io.touchHandled(live.completedAt);
      void io.finalize(live.completedAt);
      return;
    }

    const job = data.activeJob;
    const persisted = readPersistedSession(threadId);

    if (job?.id && (job.status === 'pending' || job.status === 'running')) {
      beginJobPolling({
        brandSlug: io.brandSlug(),
        threadId,
        jobId: job.id,
        seed: persisted
          ? {
              streamBuf: persisted.streamBuf,
              streamToolCalls: persisted.streamToolCalls,
              streamReasoning: persisted.streamReasoning,
              pendingUserText: persisted.pendingUserText
            }
          : undefined
      });
      return;
    }

    // Nessun job sul server ma c'è un'istantanea locale (stream finito fra due navigazioni):
    // si idrata perché il parziale sia visibile, poi si finalizza se è già completo.
    if (persisted && (persisted.streamBuf || persisted.streamToolCalls.length || persisted.loading)) {
      const hydrated = hydrateSessionFromStorage({
        brandSlug: io.brandSlug(),
        threadId,
        jobId: persisted.jobId
      });
      if (hydrated?.completedAt && hydrated.completedAt !== io.handled()) {
        io.touchHandled(hydrated.completedAt);
        void io.finalize(hydrated.completedAt);
      }
    }
  }

  function retryLast(sessionPending: string | null | undefined) {
    if (io.loading()) return;
    const pending = sessionPending?.trim();
    const msgs = io.messages();
    const lastUserIdx = [...msgs].map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0).pop();
    const lastUser = lastUserIdx != null ? msgs[lastUserIdx] : undefined;
    const text = pending || lastUser?.content?.trim();
    if (!text) return;
    const nextAsst =
      lastUserIdx != null
        ? msgs.slice(lastUserIdx + 1).find((m) => m.role === 'assistant')
        : undefined;
    const redoId = redoIdOf(nextAsst);
    if (redoId) {
      void io.send(text, undefined, { resend: true, redoMessageId: redoId });
    } else if (lastUser?.id) {
      void io.send(text, undefined, { resend: true, truncateFromMessageId: lastUser.id });
    } else {
      void io.send(text, undefined, { resend: true });
    }
  }

  function resendAt(index: number) {
    if (io.loading()) return;
    const msgs = io.messages();
    const msg = msgs[index];
    if (!msg || msg.role !== 'user') return;
    const nextAsst = msgs.slice(index + 1).find((m) => m.role === 'assistant');
    const redoId = redoIdOf(nextAsst);
    io.setMessages(msgs.slice(0, index + 1));
    if (redoId) {
      void io.send(msg.content, undefined, { resend: true, redoMessageId: redoId });
    } else if (msg.id) {
      void io.send(msg.content, undefined, { resend: true, truncateFromMessageId: msg.id });
    } else {
      void io.send(msg.content, undefined, { resend: true });
    }
  }

  function redoAssistant(index: number) {
    if (io.loading()) return;
    const msgs = io.messages();
    const msg = msgs[index];
    const redoId = redoIdOf(msg);
    if (!msg || msg.role !== 'assistant' || !redoId) return;
    const priorUser = [...msgs.slice(0, index)].reverse().find((m) => m.role === 'user');
    io.setMessages(msgs.slice(0, index));
    void io.send(priorUser?.content ?? '', undefined, { redoMessageId: redoId });
  }

  async function sendFeedback(messageId: string | undefined, value: 1 | -1 | null, note?: string) {
    if (!messageId) return;
    const msgs = io.messages();
    const prev = msgs.find((m) => m.id === messageId)?.feedback ?? null;
    io.setMessages(msgs.map((m) => (m.id === messageId ? { ...m, feedback: value } : m)));
    try {
      const res = await fetch('/api/v1/chat/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, value, ...(note ? { note } : {}) })
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      io.setMessages(io.messages().map((m) => (m.id === messageId ? { ...m, feedback: prev } : m)));
    }
  }

  return { startToolPolling, maybeStartToolPolling, checkPendingTools, resumeActiveGeneration, retryLast, resendAt, redoAssistant, sendFeedback };
}

// VERBATIM: i report dei job sono già deterministici lato server, niente parser da inventare.
export function assistantReportOf(messages: ChatMessage[]): string | null {
  return [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content ?? null;
}

export function assistantWorkOf(messages: ChatMessage[]): { post: string | null; plan: string | null } {
  let post: string | null = null;
  let plan: string | null = null;
  for (const m of messages.filter((x) => x.role === 'assistant').slice(-5).reverse()) {
    for (const tc of parseToolCalls(m.tool_calls)) {
      if (!post && tc.preview?.length) post = tc.preview[0].post_id;
      if (!plan && tc.plan) plan = tc.plan.id;
    }
  }
  return { post, plan };
}
