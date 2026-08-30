/**
 * In-flight chat stream sessions that survive SPA navigations.
 *
 * Leaving `/app/[brand]/chat/[thread]` must NOT abort the fetch — the SSE
 * reader keeps running here so returning to the thread resumes the live
 * buffer (and the stop button still works). Progress is also mirrored to
 * sessionStorage so a hard refresh can still show text/tools already written
 * while we poll the server job for completion.
 */
import { writable, get, derived } from 'svelte/store';
import { track } from '$lib/analytics';
import {
  applyChatStreamEvent,
  mergeStreamToolCalls,
  readSseEvents,
  toolsForMirror,
  type ChatStreamState,
  type StreamToolCallState
} from '$lib/chat-stream-events';
import type { ChatReasoning } from '$lib/chat-reasoning';
import type { ChatTier } from '$lib/chat-tiers';
import type { ChatReasoningSegment } from '$lib/chat-parts';

/**
 * One live tool call. Same shape the reducer folds (payloads included), so a chip in a streaming
 * turn opens on the very params and result a replayed one shows.
 */
export type StreamToolCall = StreamToolCallState;

/**
 * Folds raw SSE events into ordered reasoning segments, live.
 *
 * `applyChatStreamEvent` (chat-stream-events.ts, shared with other surfaces) still accumulates
 * `reasoning` as one flat string — that reducer is not this task's to touch, and callers like
 * AgentComputerPanel and the maker workbenches still want that single legacy blob. This is the
 * parallel, chat-only view: a segment CLOSES the moment something else (a text delta or a tool
 * call) arrives after its deltas, and the next reasoning delta opens a fresh one — so a turn that
 * thinks → writes → acts → thinks → writes leaves two thought blocks, in order, instead of one.
 *
 * Position is tracked the same way tool calls already are, but on the tool-call axis instead of
 * the text axis (`toolsBefore` instead of `textLen`): a segment records how many tool calls existed
 * when it opened, which is exactly the slot `streamBlocks` needs to interleave it correctly even
 * when it opened at the same text length as a neighboring tool call.
 */
export function foldReasoningEvent(
  fold: { segments: ChatReasoningSegment[]; open: boolean },
  evt: { type?: string; delta?: string } | null | undefined,
  textLen: number,
  toolsSoFar: number
): { segments: ChatReasoningSegment[]; open: boolean } {
  const type = evt?.type;
  if (type === 'reasoning-start' || type === 'reasoning-delta') {
    const delta = type === 'reasoning-delta' ? String(evt?.delta ?? '') : '';
    if (!fold.open) {
      if (!delta && type === 'reasoning-delta') return fold;
      return {
        segments: [...fold.segments, { text: delta, textLen, toolsBefore: toolsSoFar }],
        open: true
      };
    }
    if (!delta) return fold;
    const last = fold.segments[fold.segments.length - 1];
    return {
      segments: [...fold.segments.slice(0, -1), { ...last, text: last.text + delta }],
      open: true
    };
  }
  // Anything else that actually happened — real text, or a tool call — closes the open segment.
  if (fold.open && ((type === 'text-delta' && evt?.delta) || (typeof type === 'string' && type.startsWith('tool-')))) {
    return { ...fold, open: false };
  }
  return fold;
}

export type ChatSessionSnapshot = {
  brandSlug: string;
  threadId: string;
  jobId: string | null;
  loading: boolean;
  streamBuf: string;
  streamToolCalls: StreamToolCall[];
  streamReasoning: string;
  /** Ordered thought blocks, positioned among the tool calls — see `foldReasoningEvent`. */
  streamReasoningSegments: ChatReasoningSegment[];
  error: string | null;
  /** User hit stop — keep buffers so the UI can fold text/tools already shown. */
  intentionalCancel: boolean;
  /** Stream finished successfully; page should reload authoritative messages. */
  completedAt: number | null;
  /** Optimistic user text while the request is in flight (shown on remount). */
  pendingUserText: string | null;
  /** Wall-clock start of the current generation (for live duration in the UI). */
  startedAt: number | null;
  /**
   * CHAT DI GRUPPO — la chiave del membro che sta scrivendo in QUESTO turno (`chat_messages.name`).
   * È l'unica cosa che cambia fra la prima e la seconda voce di una stanza, e serve alla riga di
   * caricamento per mettersi il volto giusto. Arriva dall'header `X-Chat-Speaker` sul turno
   * interattivo e dal job (`speaker` in input_params) su quello accodato. Null = thread normale.
   */
  speaker?: string | null;
};

type InternalSession = ChatSessionSnapshot & {
  abort: AbortController;
  /** Whether the last reasoning segment is still open (accepting deltas) — live-loop bookkeeping,
   *  not part of the public snapshot. */
  reasoningOpen: boolean;
  /**
   * True finché la sessione è SOLO il placeholder ottimistico di `primeChatSession`: nessun fetch
   * in volo, upgradabile dal proprio `startChatSession`. Una sessione loading NON primed è sempre
   * davvero in volo — anche prima degli header (i turni kit non portano `X-Chat-Job-Id`, quindi
   * jobId/streamBuf non bastano a distinguerla) — e per un secondo invio è 'busy'.
   */
  primed: boolean;
};

const sessions = new Map<string, InternalSession>();

/** Public snapshots keyed by thread id (no AbortController). */
export const chatSessions = writable<Record<string, ChatSessionSnapshot>>({});

export const generatingThreadIds = derived(chatSessions, ($s) =>
  new Set(Object.values($s).filter((x) => x.loading).map((x) => x.threadId))
);

/** Threads with async tool jobs still running (strategy/plan/week/campaign, …). */
export const backgroundToolThreads = writable<Set<string>>(new Set());

export type BackgroundToolJob = {
	id: string;
	tool_name: string;
	status: string;
	created_at: string;
	/**
	 * Cosa sta facendo ADESSO: il testo del turno e le sue tool call, scritti in diretta dal
	 * runner. Senza, la riga poteva dire solo quanti lavori c'erano — e durante un render di
	 * dieci minuti quello era l'unico posto dove guardare.
	 */
	partial?: {
		text?: string;
		tools?: Array<{ toolName?: string; status?: string }>;
	} | null;
};

/**
 * The jobs themselves, not just "is something running".
 *
 * The watcher has always fetched this list every 3s and thrown it away, keeping only whether it
 * was empty — so the UI could show a spinner but never say what was running or how much. Keeping
 * it costs nothing extra over the wire and is what lets the user see three renders in flight
 * instead of one anonymous ellipsis.
 */
export const backgroundToolJobs = writable<Record<string, BackgroundToolJob[]>>({});

export function setThreadToolJobs(threadId: string, jobs: BackgroundToolJob[]) {
	backgroundToolJobs.update((prev) => {
		if (!jobs.length && !prev[threadId]) return prev;
		const next = { ...prev };
		if (jobs.length) next[threadId] = jobs;
		else delete next[threadId];
		return next;
	});
}

export function setThreadToolBackground(threadId: string, active: boolean) {
  backgroundToolThreads.update((prev) => {
    const next = new Set(prev);
    if (active) next.add(threadId);
    else next.delete(threadId);
    return next;
  });
}

/**
 * Threads generating somewhere that is NOT this tab — another tab, another device, or a queue
 * worker with no browser at all. Fed by the brand Realtime channel; without it every tab has its
 * own private idea of what is running and the sidebar lies in all but one of them.
 */
export const remoteBusyThreadIds = writable<Set<string>>(new Set());

export function setThreadRemoteBusy(threadId: string, active: boolean) {
  remoteBusyThreadIds.update((prev) => {
    if (prev.has(threadId) === active) return prev;
    const next = new Set(prev);
    if (active) next.add(threadId);
    else next.delete(threadId);
    return next;
  });
}

/** Dropped wholesale when the channel goes away, so a stale dot cannot outlive the connection. */
export function clearRemoteBusyThreads() {
  remoteBusyThreadIds.update((prev) => (prev.size ? new Set() : prev));
}

/** Union of live SSE + async tool background work + other tabs — drives the sidebar pulse. */
export const busyThreadIds = derived(
  [generatingThreadIds, backgroundToolThreads, remoteBusyThreadIds],
  ([$gen, $tools, $remote]) => new Set([...$gen, ...$tools, ...$remote])
);

function storageKey(threadId: string) {
  return `anomalia:chat-stream:${threadId}`;
}

function persistToStorage(s: ChatSessionSnapshot) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (!s.loading && !s.streamBuf && !s.streamToolCalls.length && !s.streamReasoning) {
      sessionStorage.removeItem(storageKey(s.threadId));
      return;
    }
    sessionStorage.setItem(
      storageKey(s.threadId),
      JSON.stringify({
        brandSlug: s.brandSlug,
        threadId: s.threadId,
        jobId: s.jobId,
        loading: s.loading,
        streamBuf: s.streamBuf,
        // This runs on every SSE chunk, so the mirror stays cheap to serialize: tool params and
        // results are dropped here exactly as they are on the job row. A tab that comes back from a
        // hard refresh shows the same chips, closed, until the saved turn lands with the payloads.
        streamToolCalls: toolsForMirror(s.streamToolCalls),
        streamReasoning: s.streamReasoning,
        streamReasoningSegments: s.streamReasoningSegments,
        pendingUserText: s.pendingUserText,
        completedAt: s.completedAt,
        error: s.error,
        startedAt: s.startedAt,
        speaker: s.speaker ?? null,
        savedAt: Date.now()
      })
    );
  } catch {
    /* quota / private mode */
  }
}

function clearStorage(threadId: string) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(storageKey(threadId));
  } catch {
    /* ignore */
  }
}

/** Read a previously persisted in-flight snapshot (e.g. after hard refresh). */
export function readPersistedSession(threadId: string): ChatSessionSnapshot | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(threadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatSessionSnapshot & { savedAt?: number };
    // Ignore stale snapshots older than 30 minutes
    if (parsed.savedAt && Date.now() - parsed.savedAt > 30 * 60 * 1000) {
      clearStorage(threadId);
      return null;
    }
    return {
      brandSlug: parsed.brandSlug,
      threadId: parsed.threadId,
      jobId: parsed.jobId ?? null,
      loading: !!parsed.loading,
      streamBuf: parsed.streamBuf ?? '',
      streamToolCalls: Array.isArray(parsed.streamToolCalls) ? parsed.streamToolCalls : [],
      streamReasoning: parsed.streamReasoning ?? '',
      streamReasoningSegments: Array.isArray(parsed.streamReasoningSegments)
        ? parsed.streamReasoningSegments
        : [],
      error: parsed.error ?? null,
      intentionalCancel: false,
      completedAt: parsed.completedAt ?? null,
      pendingUserText: parsed.pendingUserText ?? null,
      startedAt: parsed.startedAt ?? null,
      speaker: parsed.speaker ?? null
    };
  } catch {
    return null;
  }
}

function publish() {
  const next: Record<string, ChatSessionSnapshot> = {};
  for (const [id, s] of sessions) {
    const snap: ChatSessionSnapshot = {
      brandSlug: s.brandSlug,
      threadId: s.threadId,
      jobId: s.jobId,
      loading: s.loading,
      streamBuf: s.streamBuf,
      streamToolCalls: s.streamToolCalls,
      streamReasoning: s.streamReasoning,
      streamReasoningSegments: s.streamReasoningSegments,
      error: s.error,
      intentionalCancel: s.intentionalCancel,
      completedAt: s.completedAt,
      pendingUserText: s.pendingUserText,
      startedAt: s.startedAt,
      speaker: s.speaker ?? null
    };
    next[id] = snap;
    if (s.intentionalCancel) clearStorage(id);
    else persistToStorage(snap);
  }
  chatSessions.set(next);
}

function patch(threadId: string, partial: Partial<ChatSessionSnapshot>) {
  const s = sessions.get(threadId);
  if (!s) return;
  Object.assign(s, partial);
  publish();
}

export function getSession(threadId: string): ChatSessionSnapshot | null {
  return get(chatSessions)[threadId] ?? null;
}

export function clearSession(threadId: string) {
  const s = sessions.get(threadId);
  if (!s) return;
  if (s.loading && !s.intentionalCancel) {
    // Don't tear down an active background stream — only clear idle/finished ones.
    if (!s.completedAt && !s.error) return;
  }
  sessions.delete(threadId);
  clearStorage(threadId);
  publish();
}

export function dismissSession(threadId: string) {
  sessions.delete(threadId);
  clearStorage(threadId);
  publish();
}

/** Stop generation: abort client fetch + tell server to cancel the job.
 * Keeps stream buffers so whatever already arrived stays visible and can be folded. */
/**
 * Il gesto dell'utente detto al server. SEMPRE, anche senza jobId: un turno kit non scrive in
 * `chat_jobs`, e la condizione `if (jobId)` rendeva il pulsante Stop un abort della sola fetch
 * del browser — il server continuava a lavorare e la risposta ricompariva.
 */
function postCancel(brandSlug: string, threadId: string, jobId?: string | null): void {
  void fetch(`/app/${brandSlug}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel', thread_id: threadId, ...(jobId ? { job_id: jobId } : {}) })
  }).catch(() => {});
}

/**
 * `brandSlug` serve SOLO quando la sessione locale non c'è: `sessions` vive in memoria, quindi
 * dopo un reload è vuota mentre il turno sul server è vivissimo. La pagina in quel caso si
 * riaggancia al run orfano e mostra Stop — e Stop deve arrivare al server, o resta un gesto che
 * non esce dal browser: crediti che continuano a bruciare, messaggi bloccati in coda, e «Send
 * now» che rimbalza perché passa da qui prima di chiedere l'invio.
 */
export async function cancelChatSession(threadId: string, brandSlug?: string): Promise<void> {
  const s = sessions.get(threadId);
  if (!s) {
    clearStorage(threadId);
    if (brandSlug) postCancel(brandSlug, threadId);
    return;
  }

  s.intentionalCancel = true;
  s.loading = false;
  s.error = null;
  s.completedAt = Date.now();
  // Do NOT clear streamBuf / tools / reasoning — Stop must not erase the turn.
  publish();

  s.abort.abort();
  postCancel(s.brandSlug, threadId, s.jobId);

  // Leave the session snapshot for send()/completion effects to fold, then dismiss.
  publish();
}

function isBenignDisconnect(err: unknown): boolean {
  if (!err) return false;
  const e = err as Error & { name?: string };
  if (e.name === 'AbortError') return true;
  const msg = (e.message ?? String(err)).toLowerCase();
  return (
    msg.includes('abort') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('the user aborted')
  );
}

function markSessionError(threadId: string, brandSlug: string, source: string) {
  track('chat_error', {
    thread_id: threadId,
    brand_slug: brandSlug,
    source
  });
  patch(threadId, {
    loading: false,
    error: 'chat.error',
    completedAt: Date.now()
  });
}

/** Queued before `createThread` so the history $effect can keep the first bubble. */
let optimisticQueue: { brandSlug: string; text: string } | null = null;

/**
 * Call *before* `ensureThread` / `createThread` — those set `threadId` and can
 * flush a history clear before `primeChatSession` runs.
 */
export function prepareOptimisticSend(brandSlug: string, text: string): void {
  optimisticQueue = { brandSlug, text };
}

/**
 * L'invio non è mai partito (creazione del thread fallita): il testo in attesa va buttato, o il
 * prossimo thread che si apre ci trova dentro una bolla utente mai scritta e una sessione in
 * "sto pensando" che nessuno completerà.
 */
export function clearOptimisticSend(): void {
  optimisticQueue = null;
}

/**
 * Bind any prepared optimistic text to a thread (primes the session). Safe to
 * call from the history $effect when `threadId` first appears.
 */
export function takeOptimisticPending(brandSlug: string, threadId: string): string | null {
  if (!optimisticQueue || optimisticQueue.brandSlug !== brandSlug) return null;
  const text = optimisticQueue.text;
  optimisticQueue = null;
  primeChatSession({ brandSlug, threadId, pendingUserText: text });
  return text;
}

/**
 * Seed a loading session with the optimistic user bubble text *before*
 * `startChatSession` fetches — so a threadId-driven history reload cannot
 * wipe the first message while Thinking is shown.
 */
export function primeChatSession(opts: {
  brandSlug: string;
  threadId: string;
  pendingUserText: string;
}): void {
  const existing = sessions.get(opts.threadId);
  // Already streaming a real response — don't clobber.
  if (existing?.loading && (existing.jobId || existing.streamBuf || existing.streamToolCalls.length)) {
    return;
  }
  if (existing?.loading && existing.pendingUserText) {
    // Already primed for this turn.
    return;
  }
  if (existing && !existing.loading) {
    sessions.delete(opts.threadId);
    clearStorage(opts.threadId);
  }

  const abort = new AbortController();
  sessions.set(opts.threadId, {
    brandSlug: opts.brandSlug,
    threadId: opts.threadId,
    jobId: null,
    loading: true,
    streamBuf: '',
    streamToolCalls: [],
    streamReasoning: '',
    streamReasoningSegments: [],
    reasoningOpen: false,
    error: null,
    intentionalCancel: false,
    completedAt: null,
    pendingUserText: opts.pendingUserText,
    startedAt: Date.now(),
    primed: true,
    abort
  });
  publish();
}

/**
 * Start (or no-op if already streaming) a chat response for a thread.
 * The reader runs outside any page lifecycle so navigation does not kill it.
 *
 * When a turn is already in flight, prefer {@link enqueueChatMessage} so the
 * follow-up is persisted server-side and drained in the background.
 */
export async function startChatSession(opts: {
  brandSlug: string;
  threadId: string;
  userText: string;
  /** Display text for the optimistic user bubble (may differ from userText). */
  pendingUserText?: string;
  /** Live workbench UI state so the model knows which tab the user is viewing. */
  workbench?: {
    activeHref: string;
    activeLabel: string;
    tabs: Array<{ href: string; label: string }>;
  };
  mode?: 'agent' | 'plan' | 'ask';
  /** Auto = the app picks, Fast = Gemini 3.7 Flash, Pro = Grok via kie, plus named custom models (DeepSeek Pro, GPT 5.6 Terra/Sol). */
  tier?: ChatTier;
  /** Reasoning effort for this turn; mapped per provider server-side. */
  reasoning?: ChatReasoning;
  /** Specialized agent id (publish/brand/grow/web) — scopes prompt + tools for this turn. */
  agent?: string | null;
  command?: string;
  attachments?: {
    uploads: string[];
    brandImageIds: string[];
    postThumbIds: string[];
    peopleIds: string[];
    talentIds: string[];
  };
  /** Files already converted to markdown for this turn (not auto-ingested). */
  documents?: Array<{ name: string; markdown?: string; title?: string | null; path?: string }>;
  /**
   * Assistant redo: supersede this assistant message (+ later rows) and regenerate
   * from the prior user turn without inserting a new user message.
   */
  redoMessageId?: string;
  /**
   * Resend / edit: supersede this message (+ later rows) before saving the new user turn.
   */
  truncateFromMessageId?: string;
  approval?: { approvalId: string; approved: boolean; reason?: string };
}): Promise<'ok' | 'busy' | 'busy_saved' | 'error' | 'cancelled'> {
  const displayPending = opts.pendingUserText ?? opts.userText;
  const existing = sessions.get(opts.threadId);
  // Una sessione loading non-primed è SEMPRE davvero in volo, anche prima degli header: i turni
  // kit non impostano `X-Chat-Job-Id`, quindi «ha un job o del buffer» lasciava una finestra in
  // cui due invii ravvicinati aprivano due POST concorrenti (e l'abort del gemello orfanava la
  // UI del superstite). L'unico placeholder upgradabile è quello di `primeChatSession`.
  if (existing?.loading && !existing.primed) {
    return 'busy';
  }

  // Drop a finished/error snapshot, or upgrade a primed placeholder.
  if (existing) {
    try {
      existing.abort.abort();
    } catch {
      /* ignore */
    }
    sessions.delete(opts.threadId);
    clearStorage(opts.threadId);
  }

  const abort = new AbortController();
  const session: InternalSession = {
    brandSlug: opts.brandSlug,
    threadId: opts.threadId,
    jobId: null,
    loading: true,
    streamBuf: '',
    streamToolCalls: [],
    streamReasoning: '',
    streamReasoningSegments: [],
    reasoningOpen: false,
    error: null,
    intentionalCancel: false,
    completedAt: null,
    pendingUserText: displayPending,
    startedAt: Date.now(),
    primed: false,
    abort
  };
  sessions.set(opts.threadId, session);
  publish();

  try {
    const res = await fetch(`/app/${opts.brandSlug}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(opts.approval
          ? {
              action: 'approval_response',
              approval_id: opts.approval.approvalId,
              approval_decision: opts.approval.approved ? 'approved' : 'denied',
              ...(opts.approval.reason ? { approval_reason: opts.approval.reason } : {})
            }
          : opts.redoMessageId
          ? { action: 'redo', message_id: opts.redoMessageId }
          : { messages: [{ role: 'user', content: opts.userText }] }),
        thread_id: opts.threadId,
        ...(opts.truncateFromMessageId && !opts.redoMessageId
          ? { truncate_from_message_id: opts.truncateFromMessageId }
          : {}),
        ...(opts.workbench ? { workbench: opts.workbench } : {}),
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.tier ? { tier: opts.tier } : {}),
        ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
        ...(opts.agent ? { agent: opts.agent } : {}),
        ...(opts.command ? { command: opts.command } : {}),
        ...(opts.attachments && !opts.redoMessageId ? { attachments: opts.attachments } : {}),
        ...(opts.documents?.length && !opts.redoMessageId ? { documents: opts.documents } : {})
      }),
      signal: abort.signal
    });

    // Session may have been cancelled while the request was in flight.
    if (!sessions.has(opts.threadId) || sessions.get(opts.threadId)?.intentionalCancel) {
      return 'cancelled';
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // 409 {error:'busy'}: un altro turno è già vivo su questo thread (guardia server-side,
      // chat/+server.ts). Non è un errore da barra rossa: il chiamante su 'busy' accoda già da
      // solo (enqueueChatMessage), e il placeholder qui va tolto o resterebbe un «sto pensando»
      // che nessuno completa.
      if (res.status === 409 && errText.includes('"busy"')) {
        sessions.delete(opts.threadId);
        clearStorage(opts.threadId);
        publish();
        // DUE busy diversi: quello della guardia a monte arriva PRIMA che il messaggio sia
        // salvato (accodarlo è giusto), quello del bridge kit arriva DOPO — la riga è già nel
        // thread e chi accoda deve dirlo al drain, o la salva una seconda volta.
        return errText.includes('"user_message_saved":true') ? 'busy_saved' : 'busy';
      }
      let message = errText || `HTTP ${res.status}`;
      try {
        const j = JSON.parse(errText) as { message?: string; error?: string };
        if (typeof j.message === 'string' && j.message.trim()) message = j.message;
      } catch {
        /* plain text body */
      }
      patch(opts.threadId, {
        loading: false,
        error: message,
        completedAt: Date.now()
      });
      track('chat_error', {
        thread_id: opts.threadId,
        brand_slug: opts.brandSlug,
        source: res.status === 429 ? 'rate_limit' : 'http'
      });
      return 'error';
    }

    const jobId = res.headers.get('X-Chat-Job-Id');
    // Chi parla in questa battuta (stanza). Arriva con gli header, cioè prima del primo token:
    // la riga di caricamento nasce già col volto giusto invece di cambiarlo a metà turno.
    const speaker = res.headers.get('X-Chat-Speaker');
    if (jobId || speaker) patch(opts.threadId, { ...(jobId ? { jobId } : {}), speaker: speaker || null });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';
    let streamFailed = false;

    // WATCHDOG: un socket appeso (proxy che non chiude il TCP) non fa MAI rigettare
    // `reader.read()` — senza un timer la bolla resta congelata finché il TCP non muore da solo.
    // 90s e non meno: un tool lungo può stare decine di secondi senza emettere un byte tra input
    // e output. Il timer si cancella a ogni chunk, mai accumulato.
    const READ_STALL_MS = 90_000;
    while (true) {
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const read = await Promise.race([
        reader.read(),
        new Promise<'stalled'>((resolve) => {
          stallTimer = setTimeout(() => resolve('stalled'), READ_STALL_MS);
        })
      ]).finally(() => clearTimeout(stallTimer));
      if (read === 'stalled') {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        const stalled = sessions.get(opts.threadId);
        if (stalled?.jobId) {
          // Legacy: stesso riaggancio del catch benigno — il poll completa la sessione.
          patch(opts.threadId, { loading: true, error: null });
          void pollUntilDone(opts.threadId, opts.brandSlug, stalled.jobId, stalled.abort.signal);
        } else {
          // Kit (nessun jobId): dismiss secco — il poll kit-run della pagina, gated su !loading,
          // riaggancia il run vivo entro ~1.2s. Un falso positivo degrada con grazia.
          sessions.delete(opts.threadId);
          clearStorage(opts.threadId);
          publish();
        }
        return 'ok';
      }
      const { done, value } = read;
      if (done) break;

      const cur = sessions.get(opts.threadId);
      if (!cur || cur.intentionalCancel) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return 'cancelled';
      }

      sseBuf += decoder.decode(value, { stream: true });
      const { events, rest } = readSseEvents(sseBuf);
      sseBuf = rest;

      // Same reducer the server runs while draining the stream, so a resumed turn rebuilds the
      // exact buffer this loop would have produced.
      const state: ChatStreamState = {
        text: cur.streamBuf,
        tools: cur.streamToolCalls,
        reasoning: cur.streamReasoning,
        failed: false
      };
      let changed = false;
      let reasoningFold = { segments: cur.streamReasoningSegments, open: cur.reasoningOpen };
      for (const evt of events) {
        changed = applyChatStreamEvent(state, evt) || changed;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nextFold = foldReasoningEvent(reasoningFold, evt as any, state.text.length, state.tools.length);
        if (nextFold !== reasoningFold) {
          reasoningFold = nextFold;
          changed = true;
        }
      }
      if (state.failed) streamFailed = true;
      const buf = state.text;
      const tools = state.tools;
      const reasoning = state.reasoning;
      cur.reasoningOpen = reasoningFold.open;

      if (changed) {
        patch(opts.threadId, {
          streamBuf: buf,
          streamToolCalls: tools,
          streamReasoning: reasoning,
          streamReasoningSegments: reasoningFold.segments
        });
      }
    }

    const final = sessions.get(opts.threadId);
    if (!final || final.intentionalCancel) return 'cancelled';

    if (streamFailed) {
      markSessionError(opts.threadId, opts.brandSlug, 'sse_error');
      return 'error';
    }

    patch(opts.threadId, {
      loading: false,
      completedAt: Date.now(),
      error: null
    });
    return 'ok';
  } catch (e) {
    const cur = sessions.get(opts.threadId);
    if (!cur) return 'cancelled';

    if (cur.intentionalCancel) {
      // Keep buffers for the UI to fold — server also salvages the partial reply.
      patch(opts.threadId, {
        loading: false,
        completedAt: cur.completedAt ?? Date.now(),
        error: null
      });
      return 'cancelled';
    }

    // Navigation / tab teardown / transient disconnect: keep buffers + poll the job.
    // AbortError is benign here (same as failed-to-fetch) — deleting the session made the
    // thread page flash empty while generation continued server-side.
    if ((isBenignDisconnect(e) || (e as Error).name === 'AbortError') && cur.jobId) {
      patch(opts.threadId, {
        loading: true,
        error: null
      });
      void pollUntilDone(opts.threadId, opts.brandSlug, cur.jobId, cur.abort.signal);
      return 'ok';
    }

    if ((e as Error).name === 'AbortError') {
      // No job id yet (aborted before headers) — drop the placeholder.
      sessions.delete(opts.threadId);
      clearStorage(opts.threadId);
      publish();
      return 'cancelled';
    }

    // Disconnessione benigna su un turno KIT (nessun jobId: `X-Chat-Job-Id` è solo legacy) con
    // dello stream GIÀ ricevuto: il server sopravvive (waitUntil) e il poll kit-run della pagina
    // riaggancia il run entro ~1.2s. Dismiss secco, senza completedAt: `markSessionError` qui
    // foldava il parziale come bolla assistant E il poll faceva ricrescere lo STESSO testo
    // accanto (doppione), con una barra rossa su un turno vivo. Se invece non è arrivato nemmeno
    // un byte il POST può non essere mai atterrato — lì resta il percorso errore.
    if (
      isBenignDisconnect(e) &&
      (cur.streamBuf || cur.streamToolCalls.length || cur.streamReasoning)
    ) {
      sessions.delete(opts.threadId);
      clearStorage(opts.threadId);
      publish();
      return 'ok';
    }

    markSessionError(opts.threadId, opts.brandSlug, 'fetch');
    return 'error';
  }
}

/**
 * Attach polling for a server-side job when there is no live SSE reader
 * (hard refresh). Restores any persisted streamBuf/tools so the UI still
 * shows what was already written.
 */
export function beginJobPolling(opts: {
  brandSlug: string;
  threadId: string;
  jobId: string;
  /** Chi risponde a questo job (chiave membro di una stanza) — il volto della riga viva. */
  speaker?: string | null;
  /** Optional seed so remount shows text/tools already streamed. */
  seed?: Partial<
    Pick<
      ChatSessionSnapshot,
      'streamBuf' | 'streamToolCalls' | 'streamReasoning' | 'streamReasoningSegments' | 'pendingUserText'
    >
  >;
}): void {
  const existing = sessions.get(opts.threadId);
  if (existing?.loading && existing.jobId === opts.jobId) {
    // Already tracking this job — still merge any richer seed buffers.
    if (opts.seed) {
      const nextBuf = (opts.seed.streamBuf?.length ?? 0) > existing.streamBuf.length ? opts.seed.streamBuf! : existing.streamBuf;
      const nextTools =
        (opts.seed.streamToolCalls?.length ?? 0) > existing.streamToolCalls.length
          ? opts.seed.streamToolCalls!
          : existing.streamToolCalls;
      const nextReasoning =
        (opts.seed.streamReasoning?.length ?? 0) > existing.streamReasoning.length
          ? opts.seed.streamReasoning!
          : existing.streamReasoning;
      const nextReasoningSegments =
        (opts.seed.streamReasoningSegments?.length ?? 0) > existing.streamReasoningSegments.length
          ? opts.seed.streamReasoningSegments!
          : existing.streamReasoningSegments;
      if (
        nextBuf !== existing.streamBuf ||
        nextTools !== existing.streamToolCalls ||
        nextReasoning !== existing.streamReasoning ||
        nextReasoningSegments !== existing.streamReasoningSegments
      ) {
        patch(opts.threadId, {
          streamBuf: nextBuf,
          streamToolCalls: nextTools,
          streamReasoning: nextReasoning,
          streamReasoningSegments: nextReasoningSegments,
          pendingUserText: opts.seed.pendingUserText ?? existing.pendingUserText
        });
      }
    }
    return;
  }

  if (existing?.loading) return;

  const persisted = readPersistedSession(opts.threadId);
  const abort = new AbortController();
  sessions.set(opts.threadId, {
    brandSlug: opts.brandSlug,
    threadId: opts.threadId,
    jobId: opts.jobId,
    loading: true,
    streamBuf: opts.seed?.streamBuf ?? existing?.streamBuf ?? persisted?.streamBuf ?? '',
    streamToolCalls:
      opts.seed?.streamToolCalls ?? existing?.streamToolCalls ?? persisted?.streamToolCalls ?? [],
    streamReasoning:
      opts.seed?.streamReasoning ?? existing?.streamReasoning ?? persisted?.streamReasoning ?? '',
    // ponytail: la coda (`pollUntilDone`) non ricostruisce segmenti posizionati — legge solo la
    // stringa piatta dal `partial` del job. Riappesa qui trascina avanti quelli che il tab aveva
    // già raccolto DAL VIVO prima del distacco; se il ragionamento riprende mentre si è in poll,
    // resta nel fallback a blocco unico finché non torna un reader SSE vero. Upgrade quando la
    // coda porterà segmenti nel partial.
    streamReasoningSegments:
      opts.seed?.streamReasoningSegments ?? existing?.streamReasoningSegments ?? persisted?.streamReasoningSegments ?? [],
    reasoningOpen: false,
    error: null,
    intentionalCancel: false,
    completedAt: null,
    pendingUserText:
      opts.seed?.pendingUserText ?? existing?.pendingUserText ?? persisted?.pendingUserText ?? null,
    startedAt: existing?.startedAt ?? persisted?.startedAt ?? Date.now(),
    // La firma di QUESTO job, non quella rimasta dalla voce precedente: senza il reset, la
    // seconda voce di una stanza si riaggancerebbe col volto di chi ha appena finito.
    speaker: opts.speaker ?? null,
    primed: false,
    abort
  });
  publish();

  void pollUntilDone(opts.threadId, opts.brandSlug, opts.jobId, abort.signal);
}

/**
 * Rehydrate an in-memory session from sessionStorage (hard refresh) without
 * starting a new network request. Caller should then poll / attach as needed.
 */
export function hydrateSessionFromStorage(opts: {
  brandSlug: string;
  threadId: string;
  jobId?: string | null;
}): ChatSessionSnapshot | null {
  const live = sessions.get(opts.threadId);
  if (live) return getSession(opts.threadId);

  const persisted = readPersistedSession(opts.threadId);
  if (!persisted) return null;

  const abort = new AbortController();
  const jobId = opts.jobId ?? persisted.jobId;
  // Mai risuscitare loading:true senza un job che `pollUntilDone` possa davvero completare: i
  // turni kit non hanno jobId (`X-Chat-Job-Id` è solo legacy), e un loading orfano disinnescava
  // sia il poll kit-run della pagina (gated su !loading) sia il reload Realtime — parziale
  // congelato con spinner infinito fino al TTL di 30'. Con loading:false il poll kit-run parte
  // al mount e la bolla orfana rende il `partial` del server (bug del 23/8).
  const willPoll = !!jobId && (persisted.loading || !!opts.jobId);
  sessions.set(opts.threadId, {
    ...persisted,
    brandSlug: opts.brandSlug,
    threadId: opts.threadId,
    jobId,
    loading: willPoll,
    intentionalCancel: false,
    error: null,
    reasoningOpen: false,
    primed: false,
    abort
  });
  publish();

  if (willPoll && jobId) {
    void pollUntilDone(opts.threadId, opts.brandSlug, jobId, abort.signal);
  }

  return getSession(opts.threadId);
}

async function pollUntilDone(
  threadId: string,
  brandSlug: string,
  jobId: string,
  signal: AbortSignal
) {
  // Resumed turns are read at ~350ms while text keeps arriving, which is close enough to the
  // server's own write cadence to read as a live stream. When nothing is advancing (a long tool
  // call producing no output) it backs off, so a slow turn doesn't cost a request every third of
  // a second. Bounded by wall clock, not attempts, so the pace can vary freely.
  const FAST_MS = 350;
  const deadline = Date.now() + 12 * 60 * 1000;
  let quiet = 0;
  while (Date.now() < deadline) {
    if (signal.aborted) return;
    const cur = sessions.get(threadId);
    if (!cur || cur.intentionalCancel) return;

    try {
      const res = await fetch(`/app/${brandSlug}/chat?job_id=${jobId}`, { signal });
      if (res.ok) {
        const { job } = await res.json();
        // La voce del turno accodato: in una stanza la seconda voce è un job diverso con una
        // firma diversa, ed è qui che la riga di caricamento se ne accorge.
        if (typeof job?.speaker === 'string' && job.speaker) {
          const who = sessions.get(threadId);
          if (who && who.speaker !== job.speaker) patch(threadId, { speaker: job.speaker });
        }
        // Replay the server's live snapshot: this is the resumed stream. Only ever moves forward,
        // so a slow poll can never rewind text this tab has already shown.
        const partial = job?.partial as
          | { text?: string; tools?: StreamToolCall[]; reasoning?: string }
          | null;
        const cur2 = sessions.get(threadId);
        if (partial && cur2) {
          const text = String(partial.text ?? '');
          const tools = Array.isArray(partial.tools) ? partial.tools : [];
          const reasoning = String(partial.reasoning ?? '');
          const advanced =
            text.length > cur2.streamBuf.length ||
            tools.length > cur2.streamToolCalls.length ||
            reasoning.length > cur2.streamReasoning.length;
          quiet = advanced ? 0 : quiet + 1;
          if (advanced) {
            patch(threadId, {
              streamBuf: text.length >= cur2.streamBuf.length ? text : cur2.streamBuf,
              // Lo snapshot porta payload TRONCATI (toolsForMirror): merge tiene quelli INTERI
              // che questa scheda ha già visto, così riprendere non chiude le chip aperte.
              streamToolCalls:
                tools.length >= cur2.streamToolCalls.length
                  ? mergeStreamToolCalls(cur2.streamToolCalls, tools)
                  : cur2.streamToolCalls,
              streamReasoning:
                reasoning.length >= cur2.streamReasoning.length ? reasoning : cur2.streamReasoning
            });
          }
        }
        if (job?.status === 'done') {
          patch(threadId, { loading: false, completedAt: Date.now(), error: null });
          return;
        }
        if (job?.status === 'cancelled') {
          // Server salvages the partial into chat_messages — keep buffers and
          // mark complete so the page folds / reloads instead of wiping the turn.
          patch(threadId, {
            loading: false,
            completedAt: Date.now(),
            intentionalCancel: true,
            error: null
          });
          return;
        }
        if (job?.status === 'failed') {
          // Partial reply (if any) was promoted to chat_messages server-side —
          // mark complete so the page reloads the transcript instead of wiping buffers.
          markSessionError(threadId, brandSlug, 'job_poll');
          return;
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      /* ignore transient */
    }

    // 350ms while it streams → 1s after ~1s of silence → 2.5s once it is clearly idle.
    const delay = quiet < 3 ? FAST_MS : quiet < 12 ? 1000 : 2500;
    await new Promise((r) => setTimeout(r, delay));
  }

  patch(threadId, { loading: false, completedAt: Date.now() });
}

/**
 * Persist a follow-up while another reply is already streaming. Creates a pending
 * `chat_response` job only — the user bubble is written when the turn starts, so
 * the Queue chip is the source of truth. A background worker drains the queue when
 * the current turn finishes (no open tab required).
 */
export type QueuedChatItem = {
  id: string;
  text: string;
  created_at: string;
  mode?: string | null;
  tier?: string | null;
};

export async function fetchChatQueue(opts: {
  brandSlug: string;
  threadId: string;
}): Promise<QueuedChatItem[]> {
  try {
    const res = await fetch(
      `/app/${opts.brandSlug}/chat?thread=${opts.threadId}&pending_queue=1`
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: QueuedChatItem[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}

export async function enqueueChatMessage(opts: {
  brandSlug: string;
  threadId: string;
  userText: string;
  mode?: 'agent' | 'plan' | 'ask';
  tier?: ChatTier;
  reasoning?: ChatReasoning;
  agent?: string | null;
  documents?: Array<{ name: string; markdown?: string; title?: string | null; path?: string }>;
  /** Il messaggio è già in `chat_messages` (409 busy arrivato dopo il salvataggio): il drain non lo risalva. */
  userMessageSaved?: boolean;
  /**
   * Attaccare il poll del job appena accodato. `false` quando sullo schermo c'è già un run vivo
   * (kit) di cui stiamo mostrando il parziale: la sessione finta a `loading:true` lo nasconderebbe
   * dietro uno spinner vuoto, e il job comunque non parte finché quel run non finisce.
   */
  attachPolling?: boolean;
}): Promise<{ ok: true; jobId: string | null } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/app/${opts.brandSlug}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'enqueue',
        thread_id: opts.threadId,
        messages: [{ role: 'user', content: opts.userText }],
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.tier ? { tier: opts.tier } : {}),
        ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
        ...(opts.agent ? { agent: opts.agent } : {}),
        ...(opts.documents?.length ? { documents: opts.documents } : {}),
        ...(opts.userMessageSaved ? { user_message_saved: true } : {})
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: errText || `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { job_id?: string };
    const jobId = body.job_id ?? null;
    // If nothing else is live, attach polling immediately (queue worker may already be running).
    const live = sessions.get(opts.threadId);
    if (jobId && !live?.loading && opts.attachPolling !== false) {
      beginJobPolling({ brandSlug: opts.brandSlug, threadId: opts.threadId, jobId });
    }
    return { ok: true, jobId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function editQueuedChatMessage(opts: {
  brandSlug: string;
  threadId: string;
  jobId: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/app/${opts.brandSlug}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'queue_edit',
        thread_id: opts.threadId,
        job_id: opts.jobId,
        text: opts.text
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: errText || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteQueuedChatMessage(opts: {
  brandSlug: string;
  threadId: string;
  jobId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/app/${opts.brandSlug}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'queue_delete',
        thread_id: opts.threadId,
        job_id: opts.jobId
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: errText || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Cancel the in-flight turn and return the queued prompt so the client can
 * start a live SSE send immediately.
 */
export async function sendQueuedChatNow(opts: {
  brandSlug: string;
  threadId: string;
  jobId: string;
}): Promise<
  | { ok: true; text: string; mode?: string; tier?: string; reasoning?: string }
  | { ok: false; error: string }
> {
  try {
    // Abort the local SSE reader first so the UI unlocks immediately.
    await cancelChatSession(opts.threadId, opts.brandSlug);
    const res = await fetch(`/app/${opts.brandSlug}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'queue_send_now',
        thread_id: opts.threadId,
        job_id: opts.jobId
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: errText || `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      text?: string;
      mode?: string;
      tier?: string;
      reasoning?: string;
    };
    const text = String(body.text ?? '').trim();
    if (!text) return { ok: false, error: 'Empty queued message' };
    return {
      ok: true,
      text,
      mode: body.mode,
      tier: body.tier,
      reasoning: body.reasoning
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * After a live turn settles, reattach to any pending/running chat_response left
 * on the thread (queued follow-ups drained by the background worker).
 */
export async function reattachActiveChatJob(opts: {
  brandSlug: string;
  threadId: string;
}): Promise<boolean> {
  try {
    const res = await fetch(
      `/app/${opts.brandSlug}/chat?thread=${opts.threadId}&active_job=1`
    );
    if (!res.ok) return false;
    const { job } = await res.json();
    if (!job?.id || (job.status !== 'pending' && job.status !== 'running')) return false;
    beginJobPolling({
      brandSlug: opts.brandSlug,
      threadId: opts.threadId,
      jobId: job.id,
      speaker: typeof job.speaker === 'string' ? job.speaker : null
    });
    return true;
  } catch {
    return false;
  }
}

// ── Async tool-job watchers (strategy / plan / week / campaign) ──────────────
// Survive SPA navigation so the sidebar pulse clears when the job finishes even
// if the user left the chat page.

type ToolWatch = {
  brandSlug: string;
  threadId: string;
  timer: ReturnType<typeof setInterval>;
  /** Page-mounted callback to fold fresh messages into the UI. */
  onMessages: ((msgs: unknown[]) => void) | null;
  /** Fired once when no pending tool jobs remain (sidebar / list refresh). */
  onIdle: (() => void) | null;
};

const toolWatches = new Map<string, ToolWatch>();

/** Test helper — clear module-level watchers/sessions between unit tests. */
export function __resetChatSessionForTests(): void {
  for (const w of toolWatches.values()) clearInterval(w.timer);
  toolWatches.clear();
  sessions.clear();
  chatSessions.set({});
  backgroundToolThreads.set(new Set());
}

export function isWatchingToolJobs(threadId: string): boolean {
  return toolWatches.has(threadId);
}

/**
 * Watch pending/running async tool jobs for a thread. Safe to call repeatedly —
 * keeps a single interval per thread and updates the message callback.
 */
export function watchToolJobs(opts: {
  brandSlug: string;
  threadId: string;
  onMessages?: (msgs: unknown[]) => void;
  onIdle?: () => void;
}): void {
  const existing = toolWatches.get(opts.threadId);
  if (existing) {
    existing.brandSlug = opts.brandSlug;
    if (opts.onMessages) existing.onMessages = opts.onMessages;
    if (opts.onIdle) existing.onIdle = opts.onIdle;
    setThreadToolBackground(opts.threadId, true);
    return;
  }

  setThreadToolBackground(opts.threadId, true);
  const watch: ToolWatch = {
    brandSlug: opts.brandSlug,
    threadId: opts.threadId,
    onMessages: opts.onMessages ?? null,
    onIdle: opts.onIdle ?? null,
    timer: setInterval(() => {
      void tickToolWatch(opts.threadId);
    }, 3000)
  };
  toolWatches.set(opts.threadId, watch);
  // Immediate first tick so remount isn't stuck waiting 3s
  void tickToolWatch(opts.threadId);
}

/** Detach the page callback without stopping the watcher (user left the chat). */
export function detachToolJobMessages(threadId: string): void {
  const w = toolWatches.get(threadId);
  if (w) {
    w.onMessages = null;
    w.onIdle = null;
  }
}

export function stopWatchingToolJobs(threadId: string): void {
  const w = toolWatches.get(threadId);
  if (!w) {
    setThreadToolBackground(threadId, false);
    setThreadToolJobs(threadId, []);
    return;
  }
  clearInterval(w.timer);
  const onIdle = w.onIdle;
  toolWatches.delete(threadId);
  setThreadToolBackground(threadId, false);
  setThreadToolJobs(threadId, []);
  try {
    onIdle?.();
  } catch {
    /* ignore */
  }
}

async function tickToolWatch(threadId: string): Promise<void> {
  const w = toolWatches.get(threadId);
  if (!w) return;

  try {
    const [jobsRes, msgRes] = await Promise.all([
      fetch(`/app/${w.brandSlug}/chat?thread=${threadId}&pending_tools=1`),
      w.onMessages
        ? fetch(`/app/${w.brandSlug}/chat?thread=${threadId}`)
        : Promise.resolve(null)
    ]);

    if (msgRes?.ok && w.onMessages) {
      const body = await msgRes.json();
      if (Array.isArray(body.messages)) w.onMessages(body.messages);
    }

    if (jobsRes.ok) {
      const { jobs } = await jobsRes.json();
      setThreadToolJobs(threadId, Array.isArray(jobs) ? jobs : []);
      if (!jobs?.length) {
        stopWatchingToolJobs(threadId);
      }
    }
  } catch {
    /* best-effort */
  }
}
