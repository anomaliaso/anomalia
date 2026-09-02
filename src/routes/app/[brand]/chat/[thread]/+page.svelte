<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { afterNavigate } from '$app/navigation';
  import { notifyChatReady } from '$lib/chat-notifications';
  import { Monitor } from '@lucide/svelte';
  import { chatThreadId, markThreadRead, refreshThreads, setThreadAgent } from '$lib/stores/chat';
  import { createModelChoiceSave, type ModelChoice } from '$lib/chat-model-choice.svelte';
  import { hasWebHub } from '$lib/plans';
  import { openPlanDocument } from '$lib/stores/plan-panel';
  import { pageTopActions } from '$lib/stores/page-meta';
  import { postPreviewHref } from '$lib/page-modal-navigation';
  import TopbarCta from '$lib/components/TopbarCta.svelte';
  import AgentComputerPanel from '$lib/components/AgentComputerPanel.svelte';
  import {
    chatSessions,
    backgroundToolThreads,
    backgroundToolJobs,
    startChatSession,
    enqueueChatMessage,
    fetchChatQueue,
    editQueuedChatMessage,
    deleteQueuedChatMessage,
    sendQueuedChatNow,
    reattachActiveChatJob,
    cancelChatSession,
    beginJobPolling,
    dismissSession,
    getSession,
    readPersistedSession,
    hydrateSessionFromStorage,
    watchToolJobs,
    detachToolJobMessages,
    isWatchingToolJobs,
    type QueuedChatItem
  } from '$lib/stores/chat-session';
  import { isClearCommand } from '$lib/chat-commands';
  import { isPreStreamFailure, sendDraftKey } from '$lib/chat-send-recovery';
  import { readChatDraft, writeChatDraft } from '$lib/chat-draft';
  import ChatImageLightbox from '$lib/components/ChatImageLightbox.svelte';
  import { materialPress } from '$lib/actions/material-press.js';
  import { streamParts, backgroundJobLabel, type ChatPostPreview } from '$lib/chat-parts';
  import { handleChatColorBadgeClick, chatZoomableImageSrc } from '$lib/chat-markdown';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import { readAgentPanelPref, writeAgentPanelPref } from '$lib/chat-agent-panel-pref';
  import { snapshotWorkbench } from '$lib/workbench-context';
  import type { ChatMode } from '$lib/chat-modes';
  import { coerceChatTier, type ChatTier } from '$lib/chat-tiers';
  import { DEFAULT_REASONING, type ChatReasoning } from '$lib/chat-reasoning';
  import type { ChatAttachmentsPayload } from '$lib/chat-attachments';
  import type { ChatDocument } from '$lib/chat-documents';
  import { DEFAULT_AGENT_ID, agentMetaForBrand, normalizeAgentIdForBrand } from '$lib/agent-icons';
  import { brandChannel } from '$lib/realtime/brand-channel.svelte';
  import { emptyStreamState, type StreamToolCallState } from '$lib/chat-stream-events';
  import { applyLiveChunk, applyLiveSnapshot, type PendingChunk } from '$lib/chat-live-join';
  import { foldThreadCursor, latestRunProgress, seedThreadProjection, type RawThreadEvent } from '$lib/thread-cursor';
  import '$lib/styles/chat-messages.css';
  import TranscriptList from '../components/TranscriptList.svelte';
  import ComposerDock from '../components/ComposerDock.svelte';
  import EditMessageDialog from '../components/EditMessageDialog.svelte';
  import AgentComputerDock from '../components/AgentComputerDock.svelte';
  import { consolidateMessages, mapMsg, planIdsIn, parseToolCalls, redoIdOf, type ChatArtifactUi, type ChatMessage, type PostPreview } from '../components/transcript';
  import { type KitRun } from '../components/kit-run';
  import { startLiveRunPoll } from '../components/live-run-poll.svelte';
  import { createLifecycle, assistantReportOf, assistantWorkOf } from './lifecycle.svelte';
  import { dmAgents } from '$lib/chat-dm';

  let { data } = $props();

  const webHubEnabled = $derived(hasWebHub($page.data.brand?.plan));
  const dmViewOnly = $derived(dmAgents(data.thread?.room_agents));
  const normalizeAgent = (raw: unknown) => normalizeAgentIdForBrand(raw, webHubEnabled, DEFAULT_AGENT_ID);

  $effect(() => {
    chatThreadId.set(data.thread.id);
  });

  let messages = $state<ChatMessage[]>([]);
  let approvalStatuses = $state<Record<string, string>>(data.approvalStatuses ?? {});
  let artifacts = $state<ChatArtifactUi[]>([]);
  let agentSel = $state(DEFAULT_AGENT_ID);
  // `agentSel` in coda: Anomalia non è più fra le scelte ma va rimessa in lista se è l'agente
  // di un thread già esistente.
  const agentOptions = $derived(agentMetaForBrand(webHubEnabled, agentSel));
  /** Guards against applying a stale load when switching threads quickly. */
  let loadedForThread = $state<string | null>(null);
  let openedAt = $state(0);

  const life = createLifecycle({
    brandSlug: () => data.brandSlug,
    threadId: () => data.thread.id,
    pendingSeed: () => data.pendingToolJobs,
    loading: () => loading,
    messages: () => messages,
    setMessages: (m) => (messages = m),
    handled: () => handledCompletionAt,
    touchHandled: (at) => (handledCompletionAt = at),
    finalize: (at) => finalizeCompletedSession(at),
    send
  });

  function loadMessagesFromData() {
    // `next` locale: rileggere `messages` subito dopo averlo assegnato dentro un $effect
    // ri-sottoscrive l'effect e fa scattare effect_update_depth_exceeded.
    const next = consolidateMessages((data.messages ?? []).map(mapMsg));
    messages = next;
    approvalStatuses = { ...(data.approvalStatuses ?? {}) };
    artifacts = (data.artifacts ?? []) as ChatArtifactUi[];
    // I piani già nel thread sono cronologia, non una proposta da aprire.
    autoOpenedPlans = new Set(planIdsIn(next));
    loadedForThread = data.thread.id;
  }

  $effect(() => {
    const id = data.thread.id;
    void data.messages;
    agentSel = normalizeAgent(data.thread?.agent);
    // untrack: non rieseguire l'effect solo perché abbiamo scritto messages/loadedForThread.
    untrack(() => {
      if (loadedForThread !== id) messages = [];
      loadMessagesFromData();
      // Il divisore di questa visita è già al sicuro in `data.lastReadAt` (letto dal server
      // PRIMA, dentro la load): segnare letto qui sposta il confine solo dalla prossima volta.
      openedAt = Date.now();
      markThreadRead(data.brandSlug, id);
      life.resumeActiveGeneration(data);
    });
  });

  // Anche in navigazione client: l'$effect può non riscattare quando SvelteKit riusa la stessa
  // istanza del componente per un thread diverso.
  afterNavigate(({ to }) => {
    const id = to?.params?.thread;
    if (id && id !== loadedForThread) {
      messages = [];
    }
    loadMessagesFromData();
    life.resumeActiveGeneration(data);
    life.maybeStartToolPolling();
  });

  let input = $state('');
  let chatMode = $state<ChatMode>('agent');
  const brandDefaultTier = $derived(coerceChatTier($page.data.brand?.chat_default_tier));
  let chatTier = $state<ChatTier>('auto');
  let chatReasoning = $state<ChatReasoning>(DEFAULT_REASONING.auto);
  const saveModelChoice = createModelChoiceSave({
    brandSlug: () => data.brandSlug,
    threadId: () => data.thread.id,
    fallbackTier: () => brandDefaultTier
  });
  $effect(() => {
    void data.thread.id;
    ({ tier: chatTier, reasoning: chatReasoning } = saveModelChoice.hydrate(data.thread.model));
  });

  function onModelChange(choice: ModelChoice) {
    saveModelChoice.save(choice, (back) => {
      chatTier = back.tier;
      chatReasoning = back.reasoning;
    });
  }

  let queueItems = $state<QueuedChatItem[]>([]);
  let queueActionBusy = $state(false);

  async function refreshQueue() {
    queueItems = await fetchChatQueue({ brandSlug: data.brandSlug, threadId: data.thread.id });
  }

  async function onQueueEdit(jobId: string, text: string) {
    const r = await editQueuedChatMessage({
      brandSlug: data.brandSlug,
      threadId: data.thread.id,
      jobId,
      text
    });
    if (r.ok) await refreshQueue();
  }

  async function onQueueDelete(jobId: string) {
    const r = await deleteQueuedChatMessage({
      brandSlug: data.brandSlug,
      threadId: data.thread.id,
      jobId
    });
    if (r.ok) await refreshQueue();
    else staleError = 'chat.error';
  }

  async function onQueueSendNow(jobId: string) {
    if (queueActionBusy) return;
    queueActionBusy = true;
    try {
      const r = await sendQueuedChatNow({
        brandSlug: data.brandSlug,
        threadId: data.thread.id,
        jobId
      });
      await refreshQueue();
      if (!r.ok) {
        staleError = 'chat.error';
        return;
      }
      await send(r.text, {
        mode: (r.mode as ChatMode | undefined) ?? chatMode,
        tier: (r.tier as ChatTier | undefined) ?? chatTier,
        reasoning: (r.reasoning as ChatReasoning | undefined) ?? chatReasoning
      });
    } finally {
      queueActionBusy = false;
    }
  }

  // Lo stato dello stream vive nello store a livello di modulo: lasciare la pagina non uccide il
  // reader SSE. Subscribe esplicita (non solo $derived) o al remount i buffer già scritti non si
  // ridipingono fino al chunk successivo.
  let session = $state<ReturnType<typeof getSession>>(null);
  $effect(() => {
    const threadId = data.thread.id;
    const unsub = chatSessions.subscribe((all) => {
      session = all[threadId] ?? null;
    });
    return unsub;
  });
  const loading = $derived(!!session?.loading);
  const streamBuf = $derived(session?.streamBuf ?? '');
  const streamToolCalls = $derived(session?.streamToolCalls ?? []);
  const streamReasoning = $derived(session?.streamReasoning ?? '');
  const streamReasoningSegments = $derived(session?.streamReasoningSegments ?? []);
  let failedDismissed = $state(false);
  // Copia locale dell'errore che sopravvive al dismiss della sessione: senza, il banner rosso
  // lampeggia e Riprova non si fa in tempo a premerlo. La azzerano solo Riprova/× o il cambio thread.
  let staleError = $state<string | null>(null);
  $effect(() => {
    void data.thread.id;
    failedDismissed = false;
    staleError = null;
  });
  const tailFailed = $derived(
    !session &&
      !failedDismissed &&
      !!data.failedJob &&
      messages.length > 0 &&
      messages[messages.length - 1]?.role !== 'assistant'
  );
  const rawError = $derived(
    session?.error ?? staleError ?? (tailFailed ? 'chat.error' : null)
  );
  const error = $derived(rawError === 'chat.error' ? $_('chat.error') : rawError);

  $effect(() => {
    void data.thread.id;
    void refreshQueue();
  });
  $effect(() => {
    if (!loading) return;
    const t = setInterval(() => void refreshQueue(), 2500);
    return () => clearInterval(t);
  });

  const hasLivePartial = $derived(
    !!(streamBuf || streamToolCalls.length || streamReasoning)
  );
  /** Tiene su la bolla viva dopo Stop finché i buffer non sono confluiti in `messages`. */
  const showLivePartial = $derived(
    loading || (!!session?.completedAt && hasLivePartial)
  );

  function seedProjectionFromData() {
    return seedThreadProjection(data.liveProgress ?? {}, data.eventCursor ?? 0);
  }

  // Reload a metà turno: il turno CONTINUA sul server (consumeStream) e il suo stato vive in
  // agent_kit_runs. Qui lo si riaggancia (Realtime, o il poll qui sotto) e a run chiuso si
  // ricaricano i messaggi: l'utente non deve mai pensare di aver perso tutto.
  let orphanRun = $state<KitRun | null>((data.liveRun as KitRun | null) ?? null);
  let orphanState = $state(emptyStreamState());
  let orphanStateRunId = '';
  /** I chunk del canale che non continuano dove siamo: aspettano lo snapshot che colma il buco. */
  let orphanPending: PendingChunk[] = [];

  /** La proiezione durevole del thread aperto: `thread-seq` la spinge oltre `kit_stream`/poll. */
  let threadProjection = $state(seedProjectionFromData());
  let threadCursorFetching = false;

  $effect(() => {
    void data.thread.id;
    threadProjection = seedProjectionFromData();
    // `orphanRun` nasce dal caricamento, e cambiando thread SENZA ricaricare quel valore
    // iniziale resterebbe quello del thread precedente: va riseminato qui, dove si rifà anche
    // la proiezione. Il poll lo aggiorna dopo; questo è ciò che si vede al primo fotogramma.
    orphanRun = (data.liveRun as KitRun | null) ?? null;
  });

  $effect(() => {
    const threadId = data.thread.id;
    return brandChannel.onThreadSeq(({ threadId: seqThreadId, seq }) => {
      if (seqThreadId !== threadId || seq <= threadProjection.cursor) return;
      void syncThreadCursor(threadId);
    });
  });

  /**
   * Un turno può essere scritto da qualcuno che non è questa scheda: il worker della coda che
   * riporta un lavoro finito in background, un compagno, un altro dispositivo. Qui non c'è nessuno
   * stream a cui appoggiarsi — `thread-seq` muove la proiezione degli eventi, non il transcript —
   * e senza questo la risposta atterrava nel database mentre a schermo restava la chat di prima.
   * È lo stesso riaggancio che `ChatColumn` ha da sempre: il server notifica, il transcript si
   * rifà dall'endpoint autorizzato, quindi niente qui deve fidarsi di quello che arriva.
   */
  $effect(() => {
    const threadId = data.thread.id;
    return brandChannel.onThreadChanged((changed) => {
      if (changed !== threadId) return;
      void life.checkPendingTools();
      // Il nostro turno sta già scorrendo: piegare il database a metà stream litigherebbe coi
      // buffer vivi. Ci pensa la chiusura del turno.
      if (loading) return;
      void reloadMessages();
    });
  });

  /**
   * Il canale Realtime può cadere mentre la scheda è nascosta, e al ritorno la pagina resterebbe
   * ferma su una fotografia vecchia — proprio quando l'utente torna a vedere se il lavoro lungo
   * è finito. Al rientro si richiede quello che conta.
   */
  $effect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || loading) return;
      void life.checkPendingTools();
      void reloadMessages();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  async function syncThreadCursor(threadId: string) {
    if (threadCursorFetching) return;
    threadCursorFetching = true;
    try {
      const after = threadProjection.cursor;
      const res = await fetch(
        `/app/${data.brandSlug}/chat?thread=${threadId}&events_after=${after}`,
        { cache: 'no-store' }
      );
      if (!res.ok || threadId !== data.thread.id) return;
      const { events } = (await res.json()) as { events?: RawThreadEvent[] };
      const fold = foldThreadCursor(threadProjection, events ?? []);
      threadProjection = fold.projection;

      if (orphanRun) {
        const progress = latestRunProgress(threadProjection, orphanRun.id);
        if (progress) {
          applyLiveSnapshot(
            orphanState,
            orphanPending,
            progress as { text?: string; reasoning?: string; tools?: StreamToolCallState[] }
          );
        }
      }

      // La prima sincronizzazione di un thread è una SEMINA: il cursore parte da zero e
      // rilegge tutto l'arretrato, che la pagina ha già a schermo dal caricamento. Ricaricare
      // lì sarebbe un lampo a ogni apertura.
      if (fold.hasMessage && !fold.seeded) await reloadMessages();
    } finally {
      threadCursorFetching = false;
    }
  }

  // LE DUE SORGENTI HANNO UNA POSIZIONE SOLA. Realtime consegna INCREMENTI, il poll il testo
  // ASSOLUTO: appendere gli uni sopra l'altro produce testo mescolato carattere per carattere —
  // «Il nastro è risultato troppoo compress… batt peruta con certzaez» (26/8). Chi si aggancia a
  // metà turno non è mai allineato, e il canale è best-effort: un chunk perso lascia un buco.
  // `chat-live-join.ts` applica un chunk solo se continua ESATTAMENTE dove siamo, e lo snapshot
  // ricuce il resto.
  $effect(() => {
    if (!orphanRun) {
      orphanStateRunId = '';
      orphanState = emptyStreamState();
      orphanPending = [];
      return;
    }
    if (orphanRun.id !== orphanStateRunId) {
      orphanStateRunId = orphanRun.id;
      orphanState = emptyStreamState();
      orphanPending = [];
    }
    applyLiveSnapshot(orphanState, orphanPending, orphanRun.partial);
  });

  $effect(() => {
    if (!orphanRun) return;
    const seeded = latestRunProgress(threadProjection, orphanRun.id);
    if (seeded) {
      applyLiveSnapshot(
        orphanState,
        orphanPending,
        seeded as { text?: string; reasoning?: string; tools?: StreamToolCallState[] }
      );
    }
  });

  // Stesso reducer che usa il server per scrivere `partial` (chat-stream-events.ts): a canale
  // connesso il testo cresce token per token invece che a scatti.
  $effect(() => {
    const runId = orphanRun?.id;
    if (!runId) return;
    const offChunk = brandChannel.onKitStream(({ runId: rid, chunk, at }) => {
      if (rid !== runId) return;
      applyLiveChunk(orphanState, orphanPending, chunk, at);
    });
    const offDone = brandChannel.onKitStreamDone(({ runId: rid }) => {
      if (rid !== runId) return;
      void finalizeOrphanRun();
    });
    return () => {
      offChunk();
      offDone();
    };
  });

  // Il ritmo del battito sta in `live-run-poll.svelte.ts`, e il run lo legge da `untrack`: qui
  // dentro l'effetto leggeva `orphanRun` e la risposta lo riscriveva, quindi ogni risposta
  // smontava e rimontava il battito — 840 giri al secondo, il thread principale saturo, e
  // l'utente che ricarica a metà turno non vede più muoversi niente.
  $effect(() => {
    void data.brandSlug;
    void data.thread.id;
    if (loading) {
      orphanRun = null;
      return;
    }
    return startLiveRunPoll({
      isBusy: () => loading,
      currentRun: () => orphanRun,
      isHidden: () => typeof document !== 'undefined' && document.hidden,
      fetchRun: () => fetch(`/app/${data.brandSlug}/chat/${data.thread.id}/kit-run`),
      onRun: (run) => (orphanRun = run as KitRun),
      onFinished: () => void finalizeOrphanRun()
    });
  });

  // Il computer dell'agente: colonna affiancata sopra ~1100px, Sheet sotto.
  // La preferenza segue l'AGENTE (custom prima dello specialista): riaprendo una chat dalla
  // sidebar, il pannello torna com'era stato lasciato — aperto o chiuso.
  let agentPanelOpen = $state(false);
  const panelNarrow = new IsMobile(1100);

  // Atterraggio (e cambio thread): il pannello torna com'era per l'agente di QUESTA chat.
  $effect(() => {
    agentPanelOpen = readAgentPanelPref(data.brandSlug, data.thread.custom_agent_id ?? data.thread.agent);
  });
  // Ogni cambio dopo — toggle in topbar, X del pannello — resta la preferenza.
  $effect(() => {
    writeAgentPanelPref(data.brandSlug, data.thread.custom_agent_id ?? data.thread.agent, agentPanelOpen);
  });

  const panelLastReport = $derived(assistantReportOf(messages));
  const panelWork = $derived(assistantWorkOf(messages));

  // Cleanup esplicito: senza, la Panoramica erediterebbe il bottone del thread appena lasciato.
  $effect(() => {
    pageTopActions.set(agentPanelTopAction);
    return () => pageTopActions.set(null);
  });

  $effect(() => {
    const pending = session?.pendingUserText;
    if (!pending || !session?.loading) return;
    const last = messages[messages.length - 1];
    if (last?.role === 'user' && last.content === pending) return;
    if (messages.some((m) => m.role === 'user' && m.content === pending)) return;
    messages = [...messages, { role: 'user', content: pending }];
  });

  /** I piani che NON devono aprirsi da soli: seminato con quelli già nel thread al load, così
   * riaprire una vecchia conversazione non strappa via la pagina. */
  let autoOpenedPlans = $state<Set<string>>(new Set());
  $effect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || loading) return;
    const plan = parseToolCalls(last.tool_calls).find((tc) => tc.plan)?.plan;
    if (!plan) return;
    // untrack: leggere il Set non deve ri-sottoscrivere questo effect a se stesso.
    if (untrack(() => autoOpenedPlans.has(plan.id))) return;
    autoOpenedPlans = new Set([...untrack(() => autoOpenedPlans), plan.id]);
  });

  let scrollEl = $state<HTMLDivElement>();
  let zoomImageSrc = $state<string | null>(null);
  let zoomPost = $state<PostPreview | null>(null);
  let editingMessageIndex = $state<number | null>(null);
  let editingMessageText = $state('');
  let handledCompletionAt = $state<number | null>(null);

  let backgroundToolsActive = $derived($backgroundToolThreads.has(data.thread.id));
  let backgroundJobs = $derived($backgroundToolJobs[data.thread.id] ?? []);
  const panelBgLabels = $derived(backgroundJobs.map((j) => backgroundJobLabel(j, $_)));

  function stopRequest() {
    void cancelChatSession(data.thread.id, data.brandSlug);
  }

  function dismissError() {
    failedDismissed = true;
    staleError = null;
    dismissSession(data.thread.id);
  }

  function copyMessage(content: string) {
    navigator.clipboard.writeText(content).catch(() => {});
  }

  function editMessage(messageIndex: number) {
    const msg = messages[messageIndex];
    if (!msg || msg.role !== 'user') return;

    editingMessageIndex = messageIndex;
    editingMessageText = msg.content;
  }

  function confirmEdit() {
    if (editingMessageIndex === null) return;

    const newText = editingMessageText.trim();
    if (!newText) {
      editingMessageIndex = null;
      editingMessageText = '';
      return;
    }

    const truncateFromMessageId = messages[editingMessageIndex]?.id;

    messages = messages.slice(0, editingMessageIndex + 1);

    messages[editingMessageIndex].content = newText;
    messages = messages;

    editingMessageIndex = null;
    editingMessageText = '';

    // Il server tronca a partire dalla riga user originale
    void send(newText, undefined, { truncateFromMessageId });
  }

  function cancelEdit() {
    editingMessageIndex = null;
    editingMessageText = '';
  }

  async function finalizeCompletedSession(completedAt: number) {
    if (handledCompletionAt === completedAt) return;
    handledCompletionAt = completedAt;
    const snap = getSession(data.thread.id);
    // Errore senza job id né un byte streamato = il POST non è mai arrivato al server. Non si
    // finalizza e non si dismissa: la sessione resta viva col suo banner e il suo Riprova, e il
    // messaggio non viene mostrato come inviato quando non lo è.
    if (isPreStreamFailure(snap)) return;
    const folded =
      snap?.streamBuf || snap?.streamToolCalls?.length || snap?.streamReasoning
        ? {
            role: 'assistant' as const,
            content: snap.streamBuf || '',
            tool_calls: snap.streamToolCalls?.length || snap.streamReasoningSegments?.length
              ? streamParts(snap.streamBuf || '', snap.streamToolCalls ?? [], snap.streamReasoningSegments ?? [])
              : undefined
          }
        : null;
    // NIENTE fold prima del reload: la bolla viva resta montata finché `dismissSession` non
    // cancella la sessione, quindi aggiungere qui il turno salvato terrebbe DUE copie della
    // stessa risposta per tutta la fetch. Un solo elemento rappresenta il turno in ogni istante.
    const fresh = await fetchFreshMessages();
    // Da qui in giù NIENTE await: transcript aggiornato e bolla viva spenta devono essere un
    // aggiornamento solo, o esiste un fotogramma con due copie del turno.
    if (fresh) messages = fresh;
    // Se il turno non è nel transcript, il buffer vivo è l'unica copia che abbiamo.
    if (folded && messages[messages.length - 1]?.role !== 'assistant') {
      messages = [...messages, folded];
    }
    // L'errore passa nella copia locale PRIMA che dismissSession se lo porti via.
    if (snap?.error) staleError = snap.error;
    dismissSession(data.thread.id);
    refreshThreads(data.brandSlug);
    void notifyChatReady({
      title: get(_)('chat.notifyTitle'),
      body: get(_)('chat.notifyReady'),
    });
    await reattachActiveChatJob({ brandSlug: data.brandSlug, threadId: data.thread.id });
    await refreshQueue();
  }

  $effect(() => {
    const completedAt = session?.completedAt;
    if (!completedAt || session?.loading) return;
    // Anche gli errori finalizzano: un assistant parziale può essere già salvato sul server.
    void finalizeCompletedSession(completedAt);
  });

  onMount(() => {
    life.resumeActiveGeneration(data);
    life.maybeStartToolPolling();

    const initialMessage = $page.url.searchParams.get('message');
    if (initialMessage) {
      // Il param resta nell'URL finché il server non ha ACCETTATO il messaggio: cancellarlo
      // prima significa perdere il testo per sempre se il POST non arriva.
      const clearParam = () => {
        const url = new URL(window.location.href);
        url.searchParams.delete('message');
        window.history.replaceState({}, '', url.toString());
      };
      setTimeout(async () => {
        const t = initialMessage.trim();
        if (messages.some((m) => m.role === 'user' && m.content === t)) {
          clearParam();
          return;
        }
        input = initialMessage;
        await send();
        if (!isPreStreamFailure(getSession(data.thread.id))) clearParam();
      }, 100);
    } else {
      // Bozza superstite di un deep-link interrotto (vedi chat-send-recovery).
      setTimeout(() => {
        const draft = readChatDraft(sendDraftKey(data.brandSlug));
        if (!draft) return;
        const already =
          messages.some((m) => m.role === 'user' && m.content === draft) ||
          getSession(data.thread.id)?.pendingUserText === draft;
        // Si cancella solo DOPO aver deciso: cancellare sempre distrugge la bozza anche quando
        // il composer è occupato, cioè proprio il testo che questa rete doveva salvare.
        if (already) {
          writeChatDraft(sendDraftKey(data.brandSlug), '');
          return;
        }
        if (input) return; // composer occupato: la bozza resta per il prossimo mount a vuoto
        writeChatDraft(sendDraftKey(data.brandSlug), '');
        input = draft;
      }, 0);
    }
  });

  onDestroy(() => {
    // SSE e watcher restano vivi nello store di modulo (il pulse in sidebar deve spegnersi anche
    // dopo aver lasciato la pagina): si stacca solo la callback che tocca questo componente.
    detachToolJobMessages(data.thread.id);
  });

  /** Incollati in fondo solo finché l'utente ci sta: chi ha scrollato indietro sta LEGGENDO, e
   * la fine di un turno non deve strappargli la pagina. */
  let stickToBottom = $state(true);
  function onChatScroll(e: Event) {
    const el = e.currentTarget as HTMLElement;
    stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // Auto-scroll (messages + live stream)
  $effect(() => {
    void messages.length;
    void streamBuf;
    void streamReasoning;
    void streamToolCalls.length;
    void loading;
    // Senza questi, lo scroll non segue il parziale ORFANO (vedi orphanRun) mentre cresce.
    void orphanRun;
    void orphanState.text;
    void orphanState.reasoning;
    void orphanState.tools.length;
    void artifacts.length;
    if (scrollEl && stickToBottom) {
      requestAnimationFrame(() => {
        // L'elemento può smontarsi fra l'effect e il frame (Safari: scrollHeight su null).
        const el = scrollEl;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  });

  async function onAgentChange(id: string) {
    if (id === agentSel) return;
    agentSel = id;
    await setThreadAgent(data.brandSlug, data.thread.id, id);
  }

  async function decideApproval(approvalId: string, approved: boolean) {
    const result = await startChatSession({
      brandSlug: data.brandSlug,
      threadId: data.thread.id,
      userText: '',
      pendingUserText: '',
      mode: chatMode,
      tier: chatTier,
      reasoning: chatReasoning,
      agent: agentSel,
      approval: { approvalId, approved }
    });
    if (result === 'ok') {
      approvalStatuses = { ...approvalStatuses, [approvalId]: approved ? 'approved' : 'denied' };
    }
    if (result === 'error') staleError = 'chat.error';
  }

  async function send(
    text?: string,
    meta?: {
      mode: ChatMode;
      tier?: ChatTier;
      reasoning?: ChatReasoning;
      command?: string;
      attachments?: ChatAttachmentsPayload;
      thumbs?: string[];
      documents?: ChatDocument[];
    },
    opts?: { resend?: boolean; redoMessageId?: string; truncateFromMessageId?: string }
  ) {
    const t = (text ?? input).trim();
    const hasAtt =
      !!meta?.attachments &&
      (meta.attachments.uploads.length > 0 ||
        meta.attachments.brandImageIds.length > 0 ||
        meta.attachments.postThumbIds.length > 0 ||
        meta.attachments.peopleIds.length > 0 ||
        meta.attachments.talentIds.length > 0);
    const hasDocs = !!meta?.documents?.length;
    if (!t && !hasAtt && !hasDocs && !opts?.redoMessageId) return;
    staleError = null;

    // `/clear` azzera la memoria dell'agente, non la conversazione. Va risolto PRIMA del ramo
    // `loading` qui sotto: là dentro verrebbe accodato come testo, in coda dietro il turno che
    // deve proprio azzerare. Il server risponde sempre con una riga nel thread.
    if (isClearCommand(t) && !hasAtt && !hasDocs && !opts?.redoMessageId) {
      input = '';
      await fetch(`/app/${data.brandSlug}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: data.thread.id, action: 'clear_context' })
      }).catch(() => null);
      await reloadMessages();
      return;
    }

    const displayText = t || (hasDocs ? meta!.documents!.map((d) => d.name).join(', ') : '📎');
    const fallbackUserText =
      t ||
      (hasDocs
        ? `(see attached: ${meta!.documents!.map((d) => d.name).join(', ')})`
        : '(see attached images)');
    const docNames = meta?.documents?.map((d) => d.name);

    // `orphanRun` conta come "sta generando": dopo un refresh la session store è vuota
    // (loading=false) ma il run kit vive ancora sul server, e inviare qui creerebbe un turno
    // concorrente (409).
    if ((loading || orphanRun) && !opts?.redoMessageId && !opts?.truncateFromMessageId && !opts?.resend) {
      // ponytail: la coda non trasporta immagini (vedi il ramo 'busy' più sotto).
      if (hasAtt) {
        staleError = 'chat.error';
        return;
      }
      input = '';
      const queued = await enqueueChatMessage({
        brandSlug: data.brandSlug,
        threadId: data.thread.id,
        userText: fallbackUserText,
        mode: meta?.mode ?? chatMode,
        tier: meta?.tier ?? chatTier,
        reasoning: meta?.reasoning ?? chatReasoning,
        agent: agentSel,
        documents: meta?.documents,
        // Con un run orfano a schermo, il poll del job creerebbe una sessione finta a
        // `loading:true` e il parziale che l'utente guarda sparirebbe dietro uno spinner vuoto
        // per tutto il run. Il riaggancio avviene a run finito.
        attachPolling: !orphanRun
      });
      if (queued.ok) {
        await refreshQueue();
      } else {
        // Enqueue mai arrivato al server: il testo torna nel composer e il banner lo dice.
        input = t;
        staleError = 'chat.error';
      }
      return;
    }

    if (loading) return;

    input = '';
    const last = messages[messages.length - 1];
    const alreadyQueued =
      (opts?.resend || opts?.redoMessageId) && last?.role === 'user' && last.content === displayText;
    if (!alreadyQueued && !opts?.redoMessageId) {
      messages = [
        ...messages,
        { role: 'user', content: displayText, attachments: meta?.thumbs, documents: docNames }
      ];
    }

    const result = await startChatSession({
      brandSlug: data.brandSlug,
      threadId: data.thread.id,
      userText: fallbackUserText,
      pendingUserText: displayText,
      workbench: snapshotWorkbench(data.brandSlug),
      mode: meta?.mode ?? chatMode,
      tier: meta?.tier ?? chatTier,
      reasoning: meta?.reasoning ?? chatReasoning,
      agent: agentSel,
      command: meta?.command,
      attachments: meta?.attachments,
      documents: meta?.documents,
      redoMessageId: opts?.redoMessageId,
      truncateFromMessageId: opts?.truncateFromMessageId,
    });

    if (result === 'busy' || result === 'busy_saved') {
      // ponytail: la coda non trasporta immagini, l'enqueue conosce solo i documenti. Accodare
      // qui farebbe girare il turno senza gli allegati che l'utente crede di aver mandato.
      if (hasAtt) {
        input = t;
        staleError = 'chat.error';
        await reloadMessages();
        return;
      }
      const queuedBusy = await enqueueChatMessage({
        brandSlug: data.brandSlug,
        threadId: data.thread.id,
        userText: fallbackUserText,
        mode: meta?.mode ?? chatMode,
        tier: meta?.tier ?? chatTier,
        reasoning: meta?.reasoning ?? chatReasoning,
        agent: agentSel,
        documents: meta?.documents,
        userMessageSaved: result === 'busy_saved'
      });
      if (queuedBusy.ok) {
        await refreshQueue();
      } else {
        // Enqueue mai arrivato: via la bolla ottimistica fantasma, testo di nuovo nel composer.
        input = t;
        staleError = 'chat.error';
        await reloadMessages();
      }
      return;
    }

    if (result === 'cancelled') {
      // Stop: si tiene quello che era già arrivato in streaming.
      const snapCancel = getSession(data.thread.id);
      if (snapCancel?.completedAt != null) {
        await finalizeCompletedSession(snapCancel.completedAt);
      } else {
        await reloadMessages();
        dismissSession(data.thread.id);
        await reattachActiveChatJob({ brandSlug: data.brandSlug, threadId: data.thread.id });
        await refreshQueue();
      }
      // Un turno fermato può aver già avviato un render: il lavoro resta vivo anche quando la
      // risposta non c'è più, e questa è l'unica riga che lo dice.
      await life.checkPendingTools();
      return;
    }

    if (result === 'error') {
      const snapErr = getSession(data.thread.id);
      if (snapErr?.completedAt != null) {
        await finalizeCompletedSession(snapErr.completedAt);
      } else {
        await reloadMessages();
        dismissSession(data.thread.id);
        await reattachActiveChatJob({ brandSlug: data.brandSlug, threadId: data.thread.id });
      }
      await life.checkPendingTools();
      return;
    }

    // Fold prima del dismiss: il solo reload può correre contro la scrittura e mostrare una chat vuota.
    const snapOk = getSession(data.thread.id);
    if (snapOk?.completedAt != null) {
      await finalizeCompletedSession(snapOk.completedAt);
    } else {
      handledCompletionAt = snapOk?.completedAt ?? handledCompletionAt;
      await reloadMessages();
      refreshThreads(data.brandSlug);
      dismissSession(data.thread.id);
      await reattachActiveChatJob({ brandSlug: data.brandSlug, threadId: data.thread.id });
    }

    await life.checkPendingTools();
  }

  /** Legge il transcript senza scriverlo: serve separato perché riga salvata e smontaggio della
   * bolla viva avvengano nello STESSO aggiornamento, o si vede il messaggio doppio. */
  async function fetchFreshMessages(): Promise<ReturnType<typeof consolidateMessages> | null> {
    try {
      const res = await fetch(`/app/${data.brandSlug}/chat?thread=${data.thread.id}`, {
        cache: 'no-store'
      });
      if (!res.ok) return null;
      const { messages: freshMessages, artifacts: freshArts } = await res.json();
      if (Array.isArray(freshArts)) artifacts = freshArts as ChatArtifactUi[];
      return freshMessages?.length ? consolidateMessages(freshMessages.map(mapMsg)) : null;
    } catch {
      /* best-effort */
      return null;
    }
  }

  async function reloadMessages() {
    try {
      const fresh = await fetchFreshMessages();
      if (fresh) {
        messages = fresh;
        // `thread-changed` (persistence.ts) arriva PRIMA di `kit_stream_done` (live.ts): il
        // messaggio vero di un run orfano può atterrare qui prima che l'effetto dedicato spenga
        // la bolla. Stesso aggiornamento, non uno dopo, o per un fotogramma coesistono.
        orphanRun = null;
        orphanState = emptyStreamState();
      }
    } catch {
      /* best-effort */
    }
  }

  /** Il run orfano è finito. Il `finally` non è un dettaglio: qui il segnale dice che il run non
   * c'è più, quindi la bolla "sta lavorando" va spenta anche se il refetch fallisce. */
  async function finalizeOrphanRun() {
    try {
      const fresh = await fetchFreshMessages();
      if (fresh) messages = fresh;
    } finally {
      orphanRun = null;
      orphanState = emptyStreamState();
    }
    // Un follow-up accodato con `attachPolling: false` va riagganciato ora, o la pagina resta
    // muta finché il job non finisce.
    await reattachActiveChatJob({ brandSlug: data.brandSlug, threadId: data.thread.id });
    await refreshQueue();
  }

  async function clearHistory() {
    if (!confirm($_('chat.clearConfirm'))) return;
    try {
      await cancelChatSession(data.thread.id, data.brandSlug);
      await fetch(`/app/${data.brandSlug}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', thread_id: data.thread.id })
      });
      messages = [];
    } catch {
      /* best-effort */
    }
  }

  function onChatScrollClick(e: MouseEvent) {
    const zoomSrc = chatZoomableImageSrc(e);
    if (zoomSrc) {
      zoomImageSrc = zoomSrc;
      return;
    }
    handleChatColorBadgeClick(e);
  }

</script>

{#snippet agentPanelTopAction()}
  <TopbarCta
    type="button"
    variant="neutral"
    Icon={Monitor}
    title={$_('chat.computer.toggle')}
    onclick={() => (agentPanelOpen = !agentPanelOpen)}
  >
    {$_('chat.computer.toggle')}
  </TopbarCta>
{/snippet}

{#snippet agentPanelContent()}
  {#if data.agentDesktopEnabled}
    <AgentComputerPanel
      brandSlug={data.brandSlug}
      thread={data.thread}
      job={data.agentPanel?.job ?? null}
      custom={data.agentPanel?.custom ?? null}
      renders={data.agentPanel?.renders ?? []}
      live={{ loading, streamBuf, streamToolCalls, streamReasoning }}
      backgroundLabels={panelBgLabels}
      lastReport={panelLastReport}
      lastPostId={panelWork.post}
      lastPlanId={panelWork.plan}
      onclose={() => (agentPanelOpen = false)}
    />
  {/if}
{/snippet}

<div class="chat-thread-shell">
<div class="chat-page" use:materialPress style="--material-press-fill: var(--paper-2)">
  <div class="chat-scroll" bind:this={scrollEl} onclick={onChatScrollClick} onscroll={onChatScroll}>
    <TranscriptList
      {messages}
      {artifacts}
      {loading}
      speakerKey={session?.speaker}
      {streamBuf}
      {streamToolCalls}
      {streamReasoning}
      {streamReasoningSegments}
      {showLivePartial}
      {orphanRun}
      {orphanState}
      thread={data.thread}
      brandSlug={data.brandSlug}
      hasActiveJob={!!data.activeJob}
      lastReadAt={data.lastReadAt}
      {openedAt}
      {error}
      onretrylast={() => life.retryLast(session?.pendingUserText)}
      ondismisserror={dismissError}
      onzoomimage={(src) => (zoomImageSrc = src)}
      onzoompost={(p) => (zoomPost = p)}
      oncopy={copyMessage}
      onedit={editMessage}
      onresend={(index) => life.resendAt(index)}
      onredo={(index) => life.redoAssistant(index)}
      onfeedback={(id, value, note) => void life.sendFeedback(id, value, note)}
      onsend={(text) => send(text)}
      {approvalStatuses}
      onapproval={decideApproval}
    />
  </div>

  <ComposerDock
    brandSlug={data.brandSlug}
    threadId={data.thread.id}
    {loading}
    remoteBusy={!!orphanRun}
    dmViewOnly={!!dmViewOnly}
    bgJobs={backgroundJobs}
    bgActive={backgroundToolsActive}
    {queueItems}
    queueBusy={queueActionBusy}
    bind:value={input}
    bind:mode={chatMode}
    bind:tier={chatTier}
    bind:reasoning={chatReasoning}
    agentOptions={agentOptions}
    agentLocked={messages.length > 0}
    agent={agentSel}
    webHubEnabled={webHubEnabled}
    onsubmit={send}
    onstop={stopRequest}
    onagentchange={onAgentChange}
    onmodelchange={onModelChange}
    onqueueedit={onQueueEdit}
    onqueuedelete={onQueueDelete}
    onqueuesendnow={onQueueSendNow}
  />
</div>

<AgentComputerDock bind:open={agentPanelOpen} narrow={panelNarrow.current}>
  {@render agentPanelContent()}
</AgentComputerDock>
</div>

{#if zoomImageSrc}
  <ChatImageLightbox src={zoomImageSrc} onclose={() => (zoomImageSrc = null)} />
{/if}

{#if zoomPost}
  <ChatImageLightbox
    src={zoomPost.media_urls?.length ? zoomPost.media_urls : (zoomPost.media_url ?? '')}
    caption={zoomPost.caption}
    calendarHref={postPreviewHref(`/app/${data.brandSlug}`, zoomPost.post_id)}
    onclose={() => (zoomPost = null)}
  />
{/if}

{#if editingMessageIndex !== null}
  <EditMessageDialog bind:text={editingMessageText} oncancel={cancelEdit} onconfirm={confirmEdit} />
{/if}

<style>
  .chat-thread-shell {
    display: flex;
    height: 100%;
    min-height: 0;
  }
  .chat-page {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    min-height: 0;
    /* La misura di lettura vive sulla SINGOLA bolla (chat-messages.css, 75ch), non sulla colonna. */
    --chat-col: none;
  }
  .chat-scroll {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    cursor: default;
  }
  .chat-scroll :global(a) {
    cursor: pointer;
  }
  /* La tipografia markdown dei messaggi vive in src/lib/styles/chat-messages.css: qui, senza
     :global(), il compilatore la scarterebbe come inutilizzata. */
</style>
