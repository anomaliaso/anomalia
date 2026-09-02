<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { openPageModal } from '$lib/components/PageModal.svelte';
  import { postPreviewHref } from '$lib/page-modal-navigation';
  import {
    chatThreadId,
    chatPrefill,
    chatAgentPrefill,
    chatThreads,
    createThread,
    refreshThreads,
    setThreadAgent,
    setThreadCustomAgent,
    markThreadRead,
    clearUnread,
  } from '$lib/stores/chat';
  import { createModelChoiceSave, type ModelChoice } from '$lib/chat-model-choice.svelte';
  import { openPlanDocument } from '$lib/stores/plan-panel';
  import {
    chatSessions,
    startChatSession,
    enqueueChatMessage,
    fetchChatQueue,
    editQueuedChatMessage,
    deleteQueuedChatMessage,
    sendQueuedChatNow,
    reattachActiveChatJob,
    prepareOptimisticSend,
    takeOptimisticPending,
    clearOptimisticSend,
    primeChatSession,
    getSession,
    readPersistedSession,
    hydrateSessionFromStorage,
    beginJobPolling,
    cancelChatSession,
    dismissSession,
    type QueuedChatItem,
  } from '$lib/stores/chat-session';
  import ChatPrompt from '$lib/components/ChatPrompt.svelte';
  import ChatQueueChip from '$lib/components/ChatQueueChip.svelte';
  import ChatQuestionsCard from '$lib/components/ChatQuestionsCard.svelte';
  import ChatAgentProposalCard from '$lib/components/ChatAgentProposalCard.svelte';
  import ChatTeamCard from '$lib/components/ChatTeamCard.svelte';
  import ChatMediaCard from '$lib/components/ChatMediaCard.svelte';
  import ChatPlanCard from '$lib/components/ChatPlanCard.svelte';
  import ChatLiveStatus from '$lib/components/ChatLiveStatus.svelte';
  import ChatThought from '$lib/components/ChatThought.svelte';
  import ChatToolChips from '$lib/components/ChatToolChips.svelte';
  import ChatArtifactCard from '$lib/components/ChatArtifactCard.svelte';
  import ChatGoalCard from '$lib/components/ChatGoalCard.svelte';
  import ChatGoalStatusCard from '$lib/components/ChatGoalStatusCard.svelte';
  import { splitGoalStatus } from '$lib/goal-status';
  import { composerIdentity, roomMemberAvatar, threadIdentity } from '$lib/thread-identity';
  import { parseGoalCommand } from '$lib/goal-command';
  import { isClearCommand } from '$lib/chat-commands';
  import { sendDraftKey } from '$lib/chat-send-recovery';
  import { readChatDraft, writeChatDraft } from '$lib/chat-draft';
  import ChatUserMessageActions from '$lib/components/ChatUserMessageActions.svelte';
  import ChatMessageActions from '$lib/components/ChatMessageActions.svelte';
  import ChatSources from '$lib/components/ChatSources.svelte';
  import { materialPress } from '$lib/actions/material-press.js';
  import { parseChatSources, type ChatSource } from '$lib/chat-sources';
  import { parseToolCalls as parseAllParts, messageBlocks, previewsByCall, streamParts, textBubbleRange, type ChatPart, type ChatPostPreview } from '$lib/chat-parts';
  import ChatDmChip from '$lib/components/ChatDmChip.svelte';
  import ChatConnectCard from '$lib/components/ChatConnectCard.svelte';
  import { normalizeConnectPayload } from '$lib/chat-connect';
  import ChatDeviceLoginCard from '$lib/components/ChatDeviceLoginCard.svelte';
  import { normalizeDeviceLoginPayload } from '$lib/chat-device-login';
  import ChatDivider from '$lib/components/ChatDivider.svelte';
  import { dayDividers, firstUnreadIndex } from '$lib/chat-day-groups';
  import { dmAgents, isDmReplyBackMessage } from '$lib/chat-dm';
  import PostCard from '$lib/components/PostCard.svelte';
  import '$lib/styles/chat-messages.css';
  import type { ChatQuestion } from '$lib/chat-questions';
  import { normalizeAgentProposal } from '$lib/chat-agent-proposal';
  import { normalizeTeamPayload } from '$lib/chat-team';
  import { mediaFromToolCall, splitTextMedia, showMediaUrls } from '$lib/chat-media';
  import ChatRoutineEventRow from '$lib/components/ChatRoutineEventRow.svelte';
  import { ROUTINE_EVENT_TOOLS, normalizeRoutineEvent } from '$lib/chat-routine-event';
  import { renderMd, escapeChatText, handleChatColorBadgeClick, chatZoomableImageSrc } from '$lib/chat-markdown';
  import ChatImageLightbox from '$lib/components/ChatImageLightbox.svelte';
  import { snapshotWorkbench } from '$lib/workbench-context';
  import { workbenchTabLabel } from '$lib/workbench-paths';
  import type { ChatMode } from '$lib/chat-modes';
  import { coerceChatTier, type ChatTier } from '$lib/chat-tiers';
  import { DEFAULT_REASONING, type ChatReasoning } from '$lib/chat-reasoning';
  import type { ChatAttachmentsPayload } from '$lib/chat-attachments';
  import {
    attachedDocNamesFromContent,
    stripAttachedDocsForDisplay,
    type ChatDocument,
  } from '$lib/chat-documents';
  import {
    DEFAULT_AGENT_ID,
    NEW_CHAT_AGENT_ID,
    agentMetaForBrand,
    normalizeAgentIdForBrand
  } from '$lib/agent-icons';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import ChatRecipients from '$lib/components/ChatRecipients.svelte';
  import AgentStack3D from '$lib/components/AgentStack3D.svelte';
  import ChatExpressionStickers from '$lib/components/ChatExpressionStickers.svelte';
  import { BUILTIN_AGENT_AVATARS, chatFaceForPhase, type ChatFacePhase } from '$lib/agent-avatars';
  import type { ThreadAgentAvatar } from '$lib/stores/chat';
  import { browser } from '$app/environment';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { brandChannel } from '$lib/realtime/brand-channel.svelte';
  import { recipientsAgent } from '$lib/chat-recipients';

  // DEFAULT_AGENT: l'agente di un thread salvato senza agente. NEW_CHAT_AGENT: con chi PARTE
  // una chat nuova. Non sono intercambiabili.
  const DEFAULT_AGENT = DEFAULT_AGENT_ID;

  /** Overview composer prompt chips — labels from `app.home.chat.chips`, full text from `prompts`. */
  const PROMPT_CHIPS = ['plan', 'strategy', 'write', 'ideas', 'analyze'] as const;

  let {
    brandSlug,
    isOnboarding = false,
    webHubEnabled = true,
    /** Overview stack: height follows content instead of filling the viewport. */
    embedded = false,
  }: {
    brandSlug: string;
    isOnboarding?: boolean;
    /** Paid plan unlocks Web agent + SEO/blog commands (matches sidebar lock). */
    webHubEnabled?: boolean;
    embedded?: boolean;
  } = $props();

  const normalizeAgent = (raw: unknown) => normalizeAgentIdForBrand(raw, webHubEnabled, DEFAULT_AGENT);
  /**
   * Con chi parte una chat nuova su questo brand: lo specialista scelto a fine onboarding.
   * Ricaduta su NEW_CHAT_AGENT_ID, mai sul generalista.
   * ponytail: localStorage, non una colonna — si sposta in `brands` se deve seguire l'utente.
   */
  const firstAgentKey = () => `anomalia:first-agent:${brandSlug}`;
  function newChatAgent(): string {
    if (!browser) return NEW_CHAT_AGENT_ID;
    try {
      const saved = localStorage.getItem(firstAgentKey());
      return saved ? normalizeAgentIdForBrand(saved, webHubEnabled, NEW_CHAT_AGENT_ID) : NEW_CHAT_AGENT_ID;
    } catch {
      return NEW_CHAT_AGENT_ID;
    }
  }
  const NEW_CHAT_AGENT = newChatAgent();

  // Composer della Panoramica: mai legarsi a chatThreadId qui, o aprire un thread lo ribalta in
  // loadingHistory e sembra uno spinner infinito finché /chat/[id] non ha navigato.
  const threadId = $derived(embedded ? null : $chatThreadId);
  /** Embedded overview: track the thread we just created so loading/stream UI works mid-send. */
  let liveSendThreadId = $state<string | null>(null);
  /** Segnalibro all'APERTURA del thread: il confine del divisore «Nuovi messaggi». Scritto una
   * volta sola, o scivolerebbe in fondo a ogni risposta che arriva mentre si legge. */
  let lastReadAt = $state<string | null>(null);
  /** Quando si è entrati in questo thread, congelato: senza, nessun divisore. */
  let openedAt = $state(0);
  const sessionThreadId = $derived(threadId ?? liveSendThreadId);
  type OpenTabProposal = { path: string; href: string; reason?: string | null };
  type PostPreview = {
    post_id: string;
    platform: string;
    caption: string;
    media_url: string | null;
    media_urls?: string[];
    format?: string;
    status: string;
  };
  type ToolCallUi = {
    toolCallId?: string;
    toolName: string;
    input?: unknown;
    output?: unknown;
    openTab?: OpenTabProposal;
    questions?: ChatQuestion[];
    /** I cinque qui sotto: arricchiti al persist, `output` grezzo finché il turno è vivo. */
    agentProposal?: unknown;
    connect?: unknown;
    deviceLogin?: unknown;
    team?: unknown;
    routineEvent?: unknown;
    preview?: PostPreview[];
    plan?: { id: string; title: string; summary?: string | null };
  };
  type UiMsg = {
    id?: string;
    role: string;
    content: string;
    duration_ms?: number | null;
    model?: string | null;
    tier?: string | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
    feedback?: 1 | -1 | null;
    sources?: ChatSource[];
    /** Tool calls AND text segments, in the order the model produced them (chat-parts.ts). */
    tool_calls?: ChatPart[];
    attachments?: string[];
    /** Nomi dei documenti allegati (convertiti in markdown). */
    documents?: string[];
    /** Only used to drop already-summarized turns from the context meter. */
    created_at?: string | null;
  };

  /** Artefatti del thread, già firmati dal server. Fuori dai messaggi apposta: sopravvivono alla
   * riscrittura di un turno, così un turno salvato due volte non duplica il file prodotto. */
  type ChatArtifactUi = {
    id: string;
    tool_call_id?: string | null;
    title: string;
    description?: string | null;
    kind: string;
    file_name: string;
    bytes?: number | null;
    preview?: string | null;
    url?: string | null;
    created_at?: string;
  };
  let artifacts = $state<ChatArtifactUi[]>([]);
  /** Ancorati alla chiamata che li ha prodotti, così la card compare nel punto giusto del turno. */
  const artifactsByCall = $derived.by(() => {
    const map = new Map<string, ChatArtifactUi[]>();
    for (const a of artifacts) {
      if (!a.tool_call_id) continue;
      const list = map.get(a.tool_call_id) ?? [];
      list.push(a);
      map.set(a.tool_call_id, list);
    }
    return map;
  });
  /** Artefatti la cui chiamata non è in questa cronologia (turno morto prima del salvataggio, o
   * riscritto): mostrati in fondo invece che persi. */
  const renderedCallIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const m of messages) {
      for (const part of m.tool_calls ?? []) {
        const id = (part as { toolCallId?: string }).toolCallId;
        if (id) ids.add(id);
      }
    }
    return ids;
  });
  const looseArtifacts = $derived(
    artifacts.filter((a) => !a.tool_call_id || !renderedCallIds.has(a.tool_call_id))
  );

  /** L'obiettivo che l'agente si è dato per questa conversazione. Arriva con la cronologia e si
   * aggiorna da solo mentre il turno gira. */
  type ChatGoalUi = {
    id: string;
    statement: string;
    criteria: { id: string; text: string; status: string; note?: string | null }[];
    status: string;
    laps?: number;
    closing_note?: string | null;
  };
  let goal = $state<ChatGoalUi | null>(null);
  /** Riga effimera per i casi in cui non c'è una card da mostrare ("nessun obiettivo aperto"). */
  let goalHint = $state<string | null>(null);

  let messages = $state<UiMsg[]>([]);
  let input = $state('');
  let loadingHistory = $state(false);
  // DM fra agenti: il thread è in sola lettura per la persona (marcatore su room_agents).
  let threadRoomAgents = $state<unknown>(null);
  const dmPair = $derived(dmAgents(threadRoomAgents));
  let scrollEl = $state<HTMLDivElement | null>(null);
  let zoomImageSrc = $state<string | null>(null);
  let zoomPost = $state<ChatPostPreview | null>(null);
  let confirmedTabs = $state<Set<string>>(new Set());
  let chatMode = $state<ChatMode>('agent');
  // Il modello scelto nel composer vale per QUESTA conversazione; la prossima riparte dal
  // default del brand (Settings → Chat).
  const brandDefaultTier = $derived(coerceChatTier(($page.data as { brand?: { chat_default_tier?: unknown } }).brand?.chat_default_tier));
  const catalogModels = $derived(
    ($page.data as { chatModels?: Array<{ id: string; label: string; contextLength: number; inputUsdPerM: number; outputUsdPerM: number }> }).chatModels ?? []
  );
  let chatTier = $state<ChatTier>('auto');
  let chatReasoning = $state<ChatReasoning>(DEFAULT_REASONING.auto);
  const saveModelChoice = createModelChoiceSave({
    brandSlug: () => brandSlug,
    threadId: () => sessionThreadId,
    fallbackTier: () => brandDefaultTier
  });
  // Aprire una conversazione mostra il modello CHE HA, non il default del brand: la riga arriva
  // dalla lista dei thread, quindi si idrata quando c'è — una volta sola per thread, o la lista
  // che si aggiorna a ogni messaggio riscriverebbe la scelta appena fatta.
  // `undefined` e non `null`: senza thread (composer della home) il primo giro deve ENTRARE, o il
  // default di modello del brand non viene mai applicato e ogni chat nuova parte su Auto — con il
  // menu che mostra il modello scelto e il turno che gira su un altro.
  let hydratedThread: string | null | undefined = undefined;
  $effect(() => {
    const id = threadId ?? null;
    const row = id ? $chatThreads.find((t) => t.id === id) : null;
    if (id === hydratedThread || (id && !row)) return;
    hydratedThread = id;
    ({ tier: chatTier, reasoning: chatReasoning } = saveModelChoice.hydrate(row?.model));
  });

  function onModelChange(choice: ModelChoice) {
    saveModelChoice.save(choice, (back) => {
      chatTier = back.tier;
      chatReasoning = back.reasoning;
    });
  }
  let agentSel = $state<string>(NEW_CHAT_AGENT);
  // `agentSel` in coda: Anomalia rientra in lista solo se è già l'agente del thread aperto,
  // altrimenti una conversazione vecchia mostrerebbe un picker senza selezione.
  const agentOptions = $derived(agentMetaForBrand(webHubEnabled, agentSel));
  // Agenti custom offerti dal picker; quello legato al thread porta il suo brief come persona,
  // server-side.
  type CustomAgentOption = { id: string; name: string; face: string; color: string; agent: string | null };
  let customAgents = $state<CustomAgentOption[]>([]);
  let customAgentSel = $state<string | null>(null);
  // Membri scelti nel picker: vale solo finché il thread non esiste — dopo, la stanza è la
  // colonna `room_agents` e non si cambia più.
  let roomSel = $state<string[]>([]);
  /**
   * I destinatari del campo "A" (solo composer della home): la stessa scelta di
   * agentSel/customAgentSel/roomSel vista come UNA lista di chiavi, tradotta da `applyRecipients`.
   * In `sessionStorage` perché SOPRAVVIVA AL SMONTAGGIO: la Panoramica monta e distrugge questa
   * colonna a ogni andata e ritorno dalla sidebar, e con lei ogni `$state`.
   */
  const recipientsKey = () => `anomalia:to:${brandSlug}`;
  function readRecipients(): string[] {
    if (!browser) return [NEW_CHAT_AGENT];
    try {
      const raw = sessionStorage.getItem(recipientsKey());
      const arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) && arr.every((k) => typeof k === 'string') && arr.length
        ? arr
        : [NEW_CHAT_AGENT];
    } catch {
      return [NEW_CHAT_AGENT];
    }
  }
  let recipients = $state<string[]>(readRecipients());

  function applyRecipients(keys: string[], persist = true) {
    recipients = keys;
    if (persist && browser) {
      try {
        sessionStorage.setItem(recipientsKey(), JSON.stringify(keys));
      } catch {
        /* quota / private mode: si perde la memoria, non la selezione corrente */
      }
    }
  // Nessuna chiave si scarta qui: il server sa già cosa farne.
  // Due o più: è una stanza, e nasce col primo messaggio (ensureThread → createThread).
    const who = whoAnswers(keys);
    roomSel = who.room;
    // Una stanza non ha una persona custom sopra: lì l'identità sono i membri.
    if (!who.room.length) void onCustomAgentChange(who.customAgentId);
    if (who.agent) void onAgentChange(who.agent);
  }

  /** Chi risponde, dati i destinatari. La regola vive in `$lib/chat-recipients` perché la usa
   * anche il ramo "nessun thread" qui sotto: una copia locale diverge e sbaglia destinatario. */
  function whoAnswers(keys: string[]) {
    return recipientsAgent(keys, customAgents, {
      fallback: NEW_CHAT_AGENT,
      generalist: DEFAULT_AGENT
    });
  }

  /** Il campo "A" è l'AUTORITÀ anche al rimontaggio: senza, i chip tornano dalla memoria ma
   * agentSel/roomSel ripartono da zero. Gira una volta, appena il composer esiste. */
  $effect(() => {
    if (!embedded) return;
    untrack(() => applyRecipients(recipients, false));
  });

  /** Who is answering: a custom agent if one is bound, otherwise the hub agent. */
  const activeAgent = $derived(
    composerIdentity(agentSel, customAgentSel, customAgents, (k) => $_(k))
  );

  /** I destinatari come VOLTI, per la testata della Panoramica. Con UNO resta l'avatar grande;
   * da due in su li mostra tutti, o la testata direbbe una cosa falsa. */
  const recipientFaces = $derived<ThreadAgentAvatar[]>(
    recipients
      .map((k) => {
        if (k.startsWith('custom:')) {
          const a = customAgents.find((c) => c.id === k.slice('custom:'.length));
          return a ? { id: k, name: a.name, face: a.face, color: a.color } : null;
        }
        const av = BUILTIN_AGENT_AVATARS[k] ?? BUILTIN_AGENT_AVATARS.auto;
        return { id: k, name: $_(`chat.agents.${k}.label`), face: av.face, color: av.color };
      })
      .filter((a): a is ThreadAgentAvatar => !!a)
  );
  const heroStack = $derived(embedded && recipientFaces.length >= 2 ? recipientFaces : null);
  // La composizione in finto 3D vive in `AgentStack3D`: la stessa pila la usa l'onboarding.

  // Chi risponde davvero in QUESTO thread: l'identità fissa del thread (threadIdentity, la stessa
  // della sidebar) quando c'è; altrimenti l'agente del composer.
  const threadWho = $derived.by(() => {
    const id = sessionThreadId;
    if (!id) return null;
    const t = $chatThreads.find((th) => th.id === id);
    if (!t) return null;
    const who = threadIdentity(t, (k) => $_(k));
    return who.fixed ? who : null;
  });


  $effect(() => {
    const slug = brandSlug;
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/app/${slug}/chat/agents`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        customAgents = (data.agents ?? []) as CustomAgentOption[];
      } catch {
        /* the picker just shows the built-ins */
      }
    })();
    return () => {
      cancelled = true;
    };
  });
  let editingIndex = $state<number | null>(null);
  let queueItems = $state<QueuedChatItem[]>([]);
  let queueActionBusy = $state(false);
  let session = $state<ReturnType<typeof getSession>>(null);
  let promptRef = $state<{ focusPrompt?: () => void } | null>(null);

  function pickPrompt(key: (typeof PROMPT_CHIPS)[number]) {
    input = $_('app.home.chat.prompts.' + key);
    promptRef?.focusPrompt?.();
  }

  async function refreshQueue(id: string | null = threadId) {
    if (!id) {
      queueItems = [];
      return;
    }
    queueItems = await fetchChatQueue({ brandSlug, threadId: id });
  }

  async function onQueueEdit(jobId: string, text: string) {
    const id = threadId;
    if (!id) return;
    const r = await editQueuedChatMessage({ brandSlug, threadId: id, jobId, text });
    if (r.ok) await refreshQueue(id);
  }

  async function onQueueDelete(jobId: string) {
    const id = threadId;
    if (!id) return;
    const r = await deleteQueuedChatMessage({ brandSlug, threadId: id, jobId });
    if (r.ok) await refreshQueue(id);
  }

  async function onQueueSendNow(jobId: string) {
    const id = threadId;
    if (!id || queueActionBusy) return;
    queueActionBusy = true;
    try {
      const r = await sendQueuedChatNow({ brandSlug, threadId: id, jobId });
      await refreshQueue(id);
      if (!r.ok) return;
      // Send immediately as a normal live turn (running job was cancelled server-side).
      await send(r.text, {
        mode: (r.mode as ChatMode | undefined) ?? chatMode,
        tier: (r.tier as ChatTier | undefined) ?? chatTier,
        reasoning: (r.reasoning as ChatReasoning | undefined) ?? chatReasoning
      });
    } finally {
      queueActionBusy = false;
    }
  }

  $effect(() => {
    const id = threadId;
    if (!id) {
      queueItems = [];
      return;
    }
    void refreshQueue(id);
    if (!loading) return;
    const t = setInterval(() => void refreshQueue(id), 2500);
    return () => clearInterval(t);
  });

  onMount(() => {
    // Composer-only Overview must not reopen an in-flight thread into this pane.
    if (embedded) return;

    // Un turno partito dal desktop lega il thread solo in un memory store (l'URL resta sul
    // workbench): al reload chiedi quale thread sta ancora generando e riaprilo, così l'effetto
    // qui sotto si riattacca al job invece di mostrare una chat vuota.
    if (get(chatThreadId)) return;
    void (async () => {
      try {
        const res = await fetch(`/app/${brandSlug}/chat?active_chat=1`, { cache: 'no-store' });
        if (!res.ok) return;
        const { job } = await res.json();
        if (job?.thread_id && !get(chatThreadId)) chatThreadId.set(job.thread_id as string);
      } catch {
        /* best-effort: without it the user just sees the normal empty chat */
      }
    })();
  });

  // Keeps text parts in place — the renderer needs the full chronology (see chat-parts.ts).
  const parseToolCalls = (raw: unknown): ChatPart[] => parseAllParts(raw);

  function mapApiMessages(
    raw: Array<{
      id?: string;
      role: string;
      content: string;
      tool_calls?: unknown;
      duration_ms?: number | null;
      model?: string | null;
      tier?: string | null;
      input_tokens?: number | null;
      output_tokens?: number | null;
      feedback?: number | null;
      sources?: unknown;
      attachments?: unknown;
      created_at?: string | null;
    }>
  ): UiMsg[] {
    return raw
      .filter((m) => {
        if (m.role !== 'user' && m.role !== 'assistant') return false;
        const content = typeof m.content === 'string' ? m.content : '';
        // La risposta di un DM non entra MAI nella chat con l'utente: vive nel thread privato.
        if (m.role === 'user' && isDmReplyBackMessage(content)) return false;
        return true;
      })
      .map((m) => {
        const content = typeof m.content === 'string' ? m.content : '';
        return {
        id: m.id,
        role: m.role,
        content,
        duration_ms: m.duration_ms ?? null,
        model: m.model ?? null,
        tier: m.tier ?? null,
        input_tokens: m.input_tokens ?? null,
        output_tokens: m.output_tokens ?? null,
        feedback: m.feedback === 1 || m.feedback === -1 ? m.feedback : null,
        sources: parseChatSources(m.sources),
        tool_calls: parseToolCalls(m.tool_calls),
        attachments: Array.isArray(m.attachments) ? (m.attachments as string[]) : undefined,
        documents: m.role === 'user' ? attachedDocNamesFromContent(content) : undefined,
        created_at: m.created_at ?? null,
      };
      });
  }

  // Thread attivo dall'URL su navigazione. NON sottoscrivere chatThreadId qui: openThread()
  // store-first divergerebbe dall'URL ancora vecchio e questo effetto riporterebbe indietro lo
  // store. Il composer embedded resta senza thread.
  $effect(() => {
    if (embedded) return;
    const path = $page.url.pathname;
    const m = path.match(/\/chat\/([^/]+)\/?$/);
    if (!m?.[1] || m[1] === 'new') return;
    const urlThread = m[1];
    untrack(() => {
      if (get(chatThreadId) !== urlThread) chatThreadId.set(urlThread);
    });
  });

  $effect(() => {
    const id = sessionThreadId;
    if (!id) {
      session = null;
      return;
    }
    const unsub = chatSessions.subscribe((all) => {
      session = all[id] ?? null;
    });
    return unsub;
  });

  const loading = $derived(!!session?.loading);
  // Il primo invio deve nascere il thread: fra lo svuotamento della textarea e
  // `createThread` la sessione non esiste ancora e `loading` resta falso — senza
  // questo stato il bottone muto fa credere che il messaggio non sia partito.
  let sending = $state(false);
  const streamBuf = $derived(session?.streamBuf ?? '');
  const streamToolCalls = $derived(session?.streamToolCalls ?? []);
  const streamReasoning = $derived(session?.streamReasoning ?? '');
  const streamReasoningSegments = $derived(session?.streamReasoningSegments ?? []);
  /** Keep the live bubble mounted after Stop until buffers are folded into messages. */
  const showLivePartial = $derived(
    loading ||
      (!!session?.completedAt &&
        (!!streamBuf || streamToolCalls.length > 0 || !!streamReasoning))
  );
  const error = $derived(
    session?.error === 'chat.error' ? $_('chat.error') : session?.error ?? null
  );

  // A short pulse right after the user hits send, before the run reports anything back.
  let sentPulse = $state(false);
  let sentTimer: ReturnType<typeof setTimeout> | null = null;
  function flashSent() {
    sentPulse = true;
    if (sentTimer) clearTimeout(sentTimer);
    sentTimer = setTimeout(() => {
      sentPulse = false;
      sentTimer = null;
    }, 1100);
  }
  onDestroy(() => {
    if (sentTimer) clearTimeout(sentTimer);
  });

  /** waiting → sent → thinking → writing, and back to waiting when the turn lands. */
  const chatPhase = $derived<ChatFacePhase>(
    error ? 'error' : loading ? (streamBuf ? 'writing' : 'thinking') : sentPulse ? 'sent' : 'idle'
  );
  // A riposo la faccia è quella di CHI risponde: identità fissa del thread, o l'agente scelto
  // nel composer.
  const restingWho = $derived(threadWho ?? activeAgent);
  const chatFace = $derived(chatFaceForPhase(chatPhase, restingWho.face));
  // Chat di gruppo: la riga viva porta il volto di CHI scrive ADESSO (firma `speaker` sulla
  // sessione), non l'identità del thread — una stanza non ne ha una sola. Senza firma: restingWho.
  const liveWho = $derived.by(() => {
    const key = session?.speaker;
    if (!key) return restingWho;
    const t = $chatThreads.find((th) => th.id === sessionThreadId) as
      | { agents?: Array<{ id: string; face?: string; color?: string }> }
      | undefined;
    return roomMemberAvatar(key, t?.agents ?? null);
  });
  const liveFace = $derived(chatFaceForPhase(chatPhase, liveWho.face));

  /** La checklist si spunta mentre il turno gira: una riga di DB ogni 4s, e solo mentre l'agente
   * lavora. Nessun polling a riposo — a fine turno la cronologia porta lo stato definitivo. */
  $effect(() => {
    const id = sessionThreadId;
    if (!id || !loading) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/app/${brandSlug}/chat?thread=${id}&goal=1`, { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const data = await res.json();
        if (!stopped && sessionThreadId === id) goal = (data.goal ?? null) as ChatGoalUi | null;
      } catch {
        /* best-effort: la cronologia a fine turno è comunque la fonte di verità */
      }
    };
    const timer = setInterval(tick, 4000);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  });

  const hasTranscript = $derived(
    messages.length > 0 || !!streamBuf || loading || !!error
  );
  /** In Panoramica (`embedded`) la hero è l'UNICA cosa che questa colonna disegna: la
   * conversazione si legge sulla pagina del thread, mai qui. */
  const isEmptyChat = $derived(embedded || (!hasTranscript && !loadingHistory));

  // Divisori: stessa logica della chat a pagina piena, in $lib/chat-day-groups — non copiata qui.
  const dayLines = $derived(dayDividers(messages, { locale: $locale, t: (k) => $_(k) }));
  const unreadIndex = $derived(firstUnreadIndex(messages, lastReadAt, openedAt));

  $effect(() => {
    const id = threadId;
    if (!id) {
      // Composer / no thread: reset without re-subscribing to `messages` (read→write loop).
      if (untrack(() => messages.length > 0)) messages = [];
      // Chi risponde lo dice il campo "A", non una costante: questo ramo gira anche al
      // rimontaggio, e riscriverlo col default manda il messaggio all'agente sbagliato.
      if (!$chatAgentPrefill) {
        const who = untrack(() => whoAnswers(embedded ? recipients : []));
        const next = who.agent ?? NEW_CHAT_AGENT;
        if (untrack(() => agentSel !== next)) agentSel = next;
        if (untrack(() => customAgentSel !== who.customAgentId)) customAgentSel = who.customAgentId;
      } else if (untrack(() => customAgentSel !== null)) {
        customAgentSel = null;
      }
      loadingHistory = false;
      return;
    }
    // Preserve the optimistic first bubble when this thread just started generating: otherwise
    // createThread → threadId bind clears messages and leaves only "Thinking…".
    const fromQueue = takeOptimisticPending(brandSlug, id);
    const pending = fromQueue ?? getSession(id)?.pendingUserText?.trim() ?? null;
    messages = pending ? [{ role: 'user', content: pending }] : [];
    // L'obiettivo appartiene al thread: tenere il precedente mostrerebbe la checklist di una
    // conversazione sopra i messaggi di un'altra.
    goal = null;
    // Il pallino via SUBITO (locale, sincrono), ma il segnalibro sul server si sposta solo dopo
    // che la cronologia è tornata: quella risposta porta `last_read_at`, il confine del divisore
    // "Nuovi messaggi". Spostarlo prima vuol dire correre contro la propria GET e non vederlo mai.
    clearUnread(id);
    // Confine di questa apertura, azzerato prima di leggerne uno nuovo: il divisore di un thread
    // non deve mai comparire su quello che si sta aprendo.
    lastReadAt = null;
    openedAt = Date.now();
    const fromStore = get(chatThreads).find((t) => t.id === id);
    agentSel = fromStore?.agent
      ? normalizeAgent(fromStore.agent)
      : DEFAULT_AGENT;
    customAgentSel = fromStore?.custom_agent_id ?? null;
    let cancelled = false;
    loadingHistory = true;
    // Mai lasciare il flag del thread precedente: meglio un attimo senza composer che un composer
    // offerto su un thread dove il server risponderebbe 403.
    threadRoomAgents = null;
    (async () => {
      try {
        const res = await fetch(`/app/${brandSlug}/chat?thread=${id}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        let next = mapApiMessages(data.messages ?? []);
        const stillPending = getSession(id)?.pendingUserText?.trim();
        if (
          stillPending &&
          !next.some((m) => m.role === 'user' && m.content === stillPending)
        ) {
          next = [...next, { role: 'user', content: stillPending }];
        }
        messages = next;
        artifacts = (data.artifacts ?? []) as ChatArtifactUi[];
        goal = (data.goal ?? null) as ChatGoalUi | null;
        // Confine congelato per tutta la permanenza sul thread: nessun'altra riga lo riscrive.
        lastReadAt = (data.last_read_at ?? null) as string | null;
        markThreadRead(brandSlug, id);
        agentSel = normalizeAgent(data.agent);
        threadRoomAgents = data.room_agents ?? null;
        // Riattacco a un turno ancora in corso. La riga job del server è l'autorità (sopravvive
        // alla scheda); lo snapshot locale aggiunge solo ciò che era già arrivato in streaming.
        const persisted = readPersistedSession(id);
        const job = data.activeJob as { id?: string; status?: string } | null;
        const liveJobId =
          job?.id && (job.status === 'pending' || job.status === 'running') ? job.id : persisted?.jobId;
        if (liveJobId) {
          hydrateSessionFromStorage({ brandSlug, threadId: id, jobId: liveJobId });
          beginJobPolling({
            brandSlug,
            threadId: id,
            jobId: liveJobId,
            seed: persisted
              ? {
                  streamBuf: persisted.streamBuf,
                  streamToolCalls: persisted.streamToolCalls,
                  streamReasoning: persisted.streamReasoning,
                  pendingUserText: persisted.pendingUserText
                }
              : undefined
          });
        }
      } finally {
        if (!cancelled) loadingHistory = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    void messages.length;
    void streamBuf;
    void streamToolCalls.length;
    void streamReasoning;
    if (scrollEl) {
      requestAnimationFrame(() => {
        // Element may unmount between the effect and the frame (Safari race → scrollHeight on null).
        const el = scrollEl;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  });

  // Agent prefill must land before an auto-send prefill (same tick from openChatComposer).
  $effect(() => {
    const agentPre = $chatAgentPrefill;
    if (!agentPre || threadId) return;
    chatAgentPrefill.set(null);
    agentSel = normalizeAgent(agentPre);
  });

  // Deep-link da /chat/new?message=…&agent=… (nessun thread in DB fino all'invio). `agent` DA
  // SOLO vale quanto la coppia: è come atterra chi ha appena scelto il suo primo agente.
  // La bozza copre il deep-link interrotto fra il replaceState e l'accettazione del server, ed è
  // creata PRIMA dell'effect qui sotto così su un deep-link fresco gira a bozza ancora vuota.
  let draftRestored = false;
  $effect(() => {
    if (!embedded || draftRestored || threadId || input) return;
    draftRestored = true;
    const draft = readChatDraft(sendDraftKey(brandSlug));
    if (draft) {
      writeChatDraft(sendDraftKey(brandSlug), '');
      input = draft;
    }
  });

  let urlPrefillConsumed = false;
  $effect(() => {
    if (!embedded || urlPrefillConsumed || threadId) return;
    const msg = $page.url.searchParams.get('message')?.trim();
    const agentQ = $page.url.searchParams.get('agent');
    if (!msg && !agentQ) return;
    urlPrefillConsumed = true;
    if (agentQ?.startsWith('custom:')) {
      // ponytail: nessuna attesa della lista dei custom agent — chi arriva qui viene
      // dall'onboarding e di custom non ne ha; al peggio resta l'agente di default.
      applyRecipients([agentQ]);
    } else if (agentQ) {
      agentSel = normalizeAgent(agentQ);
      if (!msg) applyRecipients([agentSel]);
    }
    const url = new URL($page.url.href);
    url.searchParams.delete('message');
    url.searchParams.delete('agent');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    if (msg) {
      // La sopravvivenza del messaggio non è il param (il `goto` di ensureThread distrugge l'URL
      // prima che il POST atterri): è la bozza, cancellata solo quando il server accetta.
      writeChatDraft(sendDraftKey(brandSlug), msg);
      void send(msg);
    }
  });

  // HomeWorkbench / other surfaces drop a prompt here — send it once.
  $effect(() => {
    const pre = $chatPrefill;
    if (!pre) return;
    // Flush any pending agent before createThread inside send().
    const agentPre = get(chatAgentPrefill);
    if (agentPre && !threadId) {
      chatAgentPrefill.set(null);
      agentSel = normalizeAgent(agentPre);
    }
    chatPrefill.set(null);
    void send(pre);
  });

  async function ensureThread(): Promise<string | null> {
    if (threadId) return threadId;
    if (liveSendThreadId) return liveSendThreadId;
    // Chat di gruppo: la stanza scelta nel picker nasce insieme al thread, al primo messaggio.
    // Se il server la rifiuta (feature spenta, meno di due membri) resta un thread normale.
    const id = await createThread(brandSlug, undefined, agentSel, roomSel, roomSel.length ? null : customAgentSel);
    if (id) {
      liveSendThreadId = id;
      // Da qui in poi la stanza è il thread: la memoria del campo "A" copre solo l'attesa fra
      // la scelta e l'invio.
      if (browser) try { sessionStorage.removeItem(recipientsKey()); } catch { /* ignora */ }
      // La navigazione parte NELLO STESSO istante in cui il thread esiste: dopo altre chiamate
      // awaitate l'utente resta secondi sulla Panoramica a guardarsi la conversazione nella hero.
      void goto(`/app/${brandSlug}/chat/${id}`, { noScroll: true, keepFocus: true });
      // `createThread` ha già inserito la riga in `chatThreads`: il refetch è solo allineamento
      // e non deve trattenere il primo turno.
      void refreshThreads(brandSlug);
    }
    return id;
  }

  /** Once the URL is on this thread, the thread page owns fold/dismiss — not this composer. */
  function threadPageOwnsSettle(id: string): boolean {
    if (typeof window === 'undefined') return false;
    return window.location.pathname.includes(`/chat/${id}`);
  }

  async function settleSend(id: string) {
    if (threadPageOwnsSettle(id)) return;
    await finalizeStreamTurn(id, getSession(id)?.completedAt);
  }

  async function onAgentChange(id: string) {
    if (id === agentSel) return;
    agentSel = id;
    if (threadId) {
      await setThreadAgent(brandSlug, threadId, id);
    }
  }

  async function onCustomAgentChange(id: string | null) {
    if (id === customAgentSel) return;
    customAgentSel = id;
    if (threadId) {
      await setThreadCustomAgent(brandSlug, threadId, id);
    }
  }

  /** Le due forme locali di `/goal`: guardarlo e chiuderlo. Nessun turno, nessun messaggio nel
   * transcript — quello che resta è la card, che si aggiorna. */
  async function runGoalCommand(kind: 'show' | 'stop') {
    const id = threadId;
    if (!id) {
      goalHint = $_('chat.goal.hintNoThread');
      return;
    }
    try {
      const res = await fetch(`/app/${brandSlug}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: id, action: kind === 'stop' ? 'goal_stop' : 'goal_status' })
      });
      if (!res.ok) return;
      const data = await res.json();
      goal = (data.goal ?? null) as ChatGoalUi | null;
      goalHint = goal ? null : $_(kind === 'stop' ? 'chat.goal.hintClosed' : 'chat.goal.hintNone');
      if (goalHint) setTimeout(() => (goalHint = null), 4000);
    } catch {
      /* best-effort: la card resta com'era */
    }
  }

  /** Il transcript dal server, senza scriverlo. La riga salvata e lo smontaggio della bolla viva
   * devono entrare nello STESSO aggiornamento, o si vede il messaggio duplicato. */
  async function fetchThreadState(id: string) {
    try {
      const res = await fetch(`/app/${brandSlug}/chat?thread=${id}`, { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as { messages?: unknown[]; artifacts?: unknown[]; goal?: unknown };
    } catch {
      return null;
    }
  }

  function applyThreadState(data: { messages?: unknown[]; artifacts?: unknown[]; goal?: unknown }) {
    messages = mapApiMessages((data.messages ?? []) as Parameters<typeof mapApiMessages>[0]);
    artifacts = (data.artifacts ?? []) as ChatArtifactUi[];
    goal = (data.goal ?? null) as ChatGoalUi | null;
  }

  async function reloadMessages(id: string) {
    try {
      const data = await fetchThreadState(id);
      if (data) applyThreadState(data);
    } catch {
      /* best-effort */
    }
  }

  /** Live sync: una risposta può essere scritta da un compagno, da un'altra scheda o da un worker
   * senza browser. Il server notifica, il transcript si rifà dall'endpoint autorizzato — così
   * niente qui deve fidarsi del payload. */
  $effect(() => {
    const id = threadId;
    if (!id) return;
    return brandChannel.onThreadChanged((changed) => {
      if (changed !== id) return;
      // Il thread è aperto davanti all'utente: qualunque cosa arrivi è già letta.
      markThreadRead(brandSlug, id);
      // Il nostro turno sta già scorrendo qui: piegare il DB a metà stream litigherebbe coi
      // buffer vivi. Ci pensa l'effetto di completamento qui sotto.
      if (session?.loading) return;
      void reloadMessages(id);
    });
  });

  /** Un turno partito altrove (altra scheda, altro dispositivo, worker della coda): ci si
   * attacca per streamarlo invece di mostrare un puntino e un transcript vecchio.
   * `reattachActiveChatJob` è no-op se non c'è nulla di vivo, quindi un evento doppio è innocuo. */
  $effect(() => {
    const id = threadId;
    if (!id) return;
    return brandChannel.onTurnState((changed, live) => {
      if (changed !== id || !live || session?.loading) return;
      void reattachActiveChatJob({ brandSlug, threadId: id });
    });
  });

  /** Un turno che questa scheda NON ha streamato (chiusa o ricaricata durante la risposta) chiude
   * col polling del job: senza, la chat resterebbe su "Thinking…". `send()` chiude i suoi. */
  let handledCompletionAt = $state<number | null>(null);

  /** Il turno vivo come riga di transcript — SENZA scriverlo in `messages`: è solo la rete per
   * quando la GET non lo trova ancora. Aggiungerlo prima del reload lascia due copie a schermo
   * per tutta la fetch (`showLivePartial` cade solo con `dismissSession`). */
  function foldStreamSnapshot(id: string) {
    const snap = getSession(id);
    if (!snap?.streamBuf && !snap?.streamToolCalls?.length && !snap?.streamReasoning) return null;
    return {
      role: 'assistant' as const,
      content: snap.streamBuf || '',
      tool_calls: snap.streamToolCalls?.length || snap.streamReasoningSegments?.length
        ? streamParts(snap.streamBuf || '', snap.streamToolCalls ?? [], snap.streamReasoningSegments ?? [])
        : undefined
    };
  }

  async function finalizeStreamTurn(id: string, completedAt: number | null | undefined) {
    // Thread page owns fold/dismiss once navigation landed — do not wipe the live session.
    if (threadPageOwnsSettle(id)) return;
    if (completedAt != null && completedAt === handledCompletionAt) return;
    if (completedAt != null) handledCompletionAt = completedAt;
    const folded = foldStreamSnapshot(id);
    const fresh = await fetchThreadState(id);
    // Da qui in giù NIENTE await: transcript aggiornato e bolla viva smontata sono un solo
    // aggiornamento, quindi non esiste un fotogramma con due copie del turno.
    if (fresh) applyThreadState(fresh);
    // Stop/error salvage can lag the client — don't let a premature reload erase the fold.
    if (folded && messages[messages.length - 1]?.role !== 'assistant') {
      messages = [...messages, folded];
    }
    dismissSession(id);
    await reattachActiveChatJob({ brandSlug, threadId: id });
    await refreshQueue(id);
  }

  $effect(() => {
    const id = sessionThreadId;
    const at = session?.completedAt ?? null;
    if (!id || !at || at === handledCompletionAt || session?.loading) return;
    if (threadPageOwnsSettle(id)) return;
    void finalizeStreamTurn(id, at);
  });

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
    if ((!t && !hasAtt && !hasDocs && !opts?.redoMessageId)) return;

    // `/goal` da solo e `/goal stop` sono operazioni sulla riga dell'obiettivo, non domande: il
    // client le risolve senza pagare un turno. Col testo dietro invece prosegue (lo fa il server,
    // così vale anche da CLI).
    const cmd = parseGoalCommand(t);
    if (cmd && cmd.kind !== 'set' && !hasAtt && !hasDocs) {
      input = '';
      await runGoalCommand(cmd.kind);
      return;
    }

    // `/clear` nemmeno: azzerare il contesto è una scrittura, e la riga che il server lascia nel
    // thread è tutta la risposta che serve — arriva alle altre schede col push dei messaggi.
    if (isClearCommand(t) && !hasAtt && !hasDocs) {
      input = '';
      const clearThreadId = threadId;
      if (!clearThreadId) return; // niente thread, niente contesto da azzerare
      await fetch(`/app/${brandSlug}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: clearThreadId, action: 'clear_context' })
      }).catch(() => null);
      await reloadMessages(clearThreadId);
      return;
    }

    input = '';

    const displayText = t || (hasDocs ? meta!.documents!.map((d) => d.name).join(', ') : '📎');
    const fallbackUserText =
      t ||
      (hasDocs
        ? `(see attached: ${meta!.documents!.map((d) => d.name).join(', ')})`
        : '(see attached images)');
    const docNames = meta?.documents?.map((d) => d.name);

    // Chat already generating — queue server-side (survives tab close).
    if (loading && !opts?.redoMessageId && !opts?.truncateFromMessageId && !opts?.resend) {
      const id = threadId ?? (await ensureThread());
      if (!id) return;
      const queued = await enqueueChatMessage({
        brandSlug,
        threadId: id,
        userText: fallbackUserText,
        mode: meta?.mode ?? chatMode,
        tier: meta?.tier ?? chatTier,
        reasoning: meta?.reasoning ?? chatReasoning,
        agent: agentSel,
        documents: meta?.documents
      });
      if (queued.ok) await refreshQueue(id);
      return;
    }

    if (loading) return;

    // Must run before ensureThread: createThread sets threadId and can flush
    // the history $effect before we return here.
    sending = true;
    flashSent();
    prepareOptimisticSend(brandSlug, displayText);
    const id = await ensureThread();
    if (!id) {
      // Il thread non è nato (rete giù, 500, quota): il messaggio torna nel composer invece di
      // sparire, e il testo in attesa va buttato o riapparirebbe come bolla fantasma altrove.
      clearOptimisticSend();
      input = t;
      sending = false;
      return;
    }

    takeOptimisticPending(brandSlug, id);
    primeChatSession({ brandSlug, threadId: id, pendingUserText: displayText });
    // Il turno ora vive nella sessione (`loading`): la rotella del primo invio ha fatto il suo.
    sending = false;

    if (editingIndex !== null) {
      const idx = editingIndex;
      const truncateFromMessageId = messages[idx]?.id;
      editingIndex = null;
      messages = messages.slice(0, idx + 1);
      if (messages[idx]) messages[idx] = { ...messages[idx], content: displayText };
      messages = messages;
      const result = await startChatSession({
        brandSlug,
        threadId: id,
        userText: fallbackUserText,
        pendingUserText: displayText,
        workbench: snapshotWorkbench(brandSlug),
        mode: meta?.mode ?? chatMode,
        tier: meta?.tier ?? chatTier,
      reasoning: meta?.reasoning ?? chatReasoning,
        agent: agentSel,
        command: meta?.command,
        attachments: meta?.attachments,
        documents: meta?.documents,
        truncateFromMessageId,
      });
      if (result === 'busy' || result === 'busy_saved') {
        // ponytail: la coda non trasporta immagini (l'enqueue conosce solo i documenti) — meglio
        // ridare il messaggio al composer che farlo girare senza gli allegati.
        if (hasAtt) {
          input = t;
          await reloadMessages(id); // la modifica non è partita: si torna alla verità del server
          return;
        }
        await enqueueChatMessage({
          brandSlug,
          threadId: id,
          userText: fallbackUserText,
          mode: meta?.mode ?? chatMode,
          tier: meta?.tier ?? chatTier,
          reasoning: meta?.reasoning ?? chatReasoning,
          agent: agentSel,
          documents: meta?.documents,
          userMessageSaved: result === 'busy_saved'
        });
        return;
      }
      if (result === 'error' || result === 'cancelled' || result === 'ok') {
        await settleSend(id);
        return;
      }
      return;
    }

    const last = messages[messages.length - 1];
    const alreadyQueued =
      (opts?.resend || opts?.redoMessageId) && last?.role === 'user' && last.content === displayText;
    if (!alreadyQueued && !opts?.redoMessageId) {
      // Thumbs dal composer: la bolla mostra subito gli allegati, poi il reload mette le copie
      // salvate.
      messages = [...messages, { role: 'user', content: displayText, attachments: meta?.thumbs, documents: docNames }];
    }

    const result = await startChatSession({
      brandSlug,
      threadId: id,
      userText: fallbackUserText,
      pendingUserText: displayText,
      workbench: snapshotWorkbench(brandSlug),
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

    // Il server ha ricevuto il turno (ok/busy/cancelled): la bozza del deep-link ha finito
    // il suo lavoro. Su 'error' resta — il prossimo caricamento la rimette nel composer.
    if (result !== 'error') writeChatDraft(sendDraftKey(brandSlug), '');

    if (result === 'busy' || result === 'busy_saved') {
      // ponytail: come sopra — niente immagini in coda, il messaggio torna nel composer.
      if (hasAtt) {
        input = t;
        await reloadMessages(id); // via la bolla ottimistica con le thumb: quel turno non parte
        return;
      }
      await enqueueChatMessage({
        brandSlug,
        threadId: id,
        userText: fallbackUserText,
        mode: meta?.mode ?? chatMode,
        tier: meta?.tier ?? chatTier,
        reasoning: meta?.reasoning ?? chatReasoning,
        agent: agentSel,
        documents: meta?.documents,
        userMessageSaved: result === 'busy_saved'
      });
      return;
    }

    if (result === 'error' || result === 'cancelled' || result === 'ok') {
      await settleSend(id);
    }
  }

  function retryLast() {
    if (loading) return;
    const pending = session?.pendingUserText?.trim();
    const lastUserIdx = [...messages].map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0).pop();
    const lastUser = lastUserIdx != null ? messages[lastUserIdx] : undefined;
    const text = pending || lastUser?.content?.trim();
    if (!text) return;
    const nextAsst =
      lastUserIdx != null
        ? messages.slice(lastUserIdx + 1).find((m) => m.role === 'assistant')
        : undefined;
    if (nextAsst?.id) {
      void send(text, undefined, { resend: true, redoMessageId: nextAsst.id });
    } else if (lastUser?.id) {
      void send(text, undefined, { resend: true, truncateFromMessageId: lastUser.id });
    } else {
      void send(text, undefined, { resend: true });
    }
  }

  function copyMessage(content: string) {
    void navigator.clipboard.writeText(content).catch(() => {});
  }

  function startEdit(index: number) {
    const msg = messages[index];
    if (!msg || msg.role !== 'user' || loading) return;
    editingIndex = index;
    input = msg.content;
  }

  function resendAt(index: number) {
    if (loading) return;
    const msg = messages[index];
    if (!msg || msg.role !== 'user') return;
    editingIndex = null;
    const nextAsst = messages.slice(index + 1).find((m) => m.role === 'assistant');
    messages = messages.slice(0, index + 1);
    if (nextAsst?.id) {
      void send(msg.content, undefined, { resend: true, redoMessageId: nextAsst.id });
    } else if (msg.id) {
      void send(msg.content, undefined, { resend: true, truncateFromMessageId: msg.id });
    } else {
      void send(msg.content, undefined, { resend: true });
    }
  }

  function redoAssistant(index: number) {
    if (loading) return;
    const msg = messages[index];
    if (!msg || msg.role !== 'assistant' || !msg.id) return;
    const priorUser = [...messages.slice(0, index)].reverse().find((m) => m.role === 'user');
    messages = messages.slice(0, index);
    void send(priorUser?.content ?? '', undefined, { redoMessageId: msg.id });
  }

  async function sendFeedback(messageId: string | undefined, value: 1 | -1 | null, note?: string) {
    if (!messageId) return;
    const prev = messages.find((m) => m.id === messageId)?.feedback ?? null;
    messages = messages.map((m) => (m.id === messageId ? { ...m, feedback: value } : m));
    try {
      const res = await fetch('/api/v1/chat/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, value, ...(note ? { note } : {}) })
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      messages = messages.map((m) => (m.id === messageId ? { ...m, feedback: prev } : m));
    }
  }

  function dismissError() {
    if (threadId) dismissSession(threadId);
  }

  function stopRequest() {
    if (threadId) void cancelChatSession(threadId, brandSlug);
  }

  function tabLabelFor(pathOrHref: string): string {
    const base = `/app/${brandSlug}`;
    const pathname = pathOrHref.startsWith(base)
      ? pathOrHref.split('?')[0]
      : `${base}${pathOrHref.startsWith('/') ? pathOrHref : `/${pathOrHref}`}`.split('?')[0];
    return workbenchTabLabel(pathname, base, (k) => $_(k));
  }

  function confirmOpenTab(tab: OpenTabProposal, key: string) {
    confirmedTabs = new Set([...confirmedTabs, key]);
    // Se la rotta è classificata `page` (o siamo su mobile) `openPageModal` dice di no e si
    // naviga; altrimenti la pagina si apre SOPRA la chat, senza lasciare la conversazione.
    if (openPageModal(tab.href)) return;
    void goto(tab.href, { noScroll: true, keepFocus: true });
  }

  const placeholder = $derived(
    isOnboarding && isEmptyChat
      ? $_('app.onboarding.welcome.placeholder')
      : $_('app.home.chat.placeholder')
  );

  function onMsgClick(e: MouseEvent) {
    const zoomSrc = chatZoomableImageSrc(e);
    if (zoomSrc) {
      zoomImageSrc = zoomSrc;
      return;
    }
    if (handleChatColorBadgeClick(e)) return;
    const a = (e.target as HTMLElement | null)?.closest?.('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    // In-app pages (not chat) → SPA nav so they open as workbench tabs.
    if (href.startsWith(`/app/${brandSlug}/`) && !href.includes('/chat/')) {
      e.preventDefault();
      void goto(href, { noScroll: true, keepFocus: true });
    } else if (href === `/app/${brandSlug}` || href === `/app/${brandSlug}/`) {
      e.preventDefault();
      void goto(href, { noScroll: true, keepFocus: true });
    }
  }
</script>

<div
  class="chat-col"
  class:is-composer={isEmptyChat && !threadId}
  class:is-embedded={embedded}
  use:materialPress
  style="--material-press-fill: var(--paper-2)"
>
  <div class="chat-col-msgs" class:is-empty={isEmptyChat} bind:this={scrollEl} onclick={onMsgClick}>
    {#if loadingHistory && messages.length === 0}
      <div class="chat-col-empty" aria-busy="true" aria-label="Loading">
        <div class="chat-col-idle">
          <AgentAvatar face={chatFace} color={restingWho.color} size={56} busy />
        </div>
      </div>
    {:else if isEmptyChat}
      <div class="chat-col-hero">
        <div class="chat-col-welcome">
          {#if heroStack}
            <!-- Il parallasse non è un secondo loop: è lo stesso rAF di AgentAvatar con
                 `gazeAmount`/`gazeEase` diversi, e con reduced-motion non parte affatto. -->
            <AgentStack3D
              agents={heroStack}
              front={embedded ? 64 : 96}
              pitch={embedded ? 5.5 : 0}
              follow={embedded ? 'pointer' : 'none'}
              frontMirror={embedded}
            />
          {:else}
            <!-- `pitch` è il gemello verticale dello yaw: i tratti scorrono sulla palla, la
                 testa non ruota — così legge come uno sguardo e non come una testa inclinata. -->
            <AgentAvatar
              face={chatFace}
              color={restingWho.color}
              size={embedded ? 64 : 96}
              pitch={embedded ? 5.5 : 0}
              follow={embedded ? 'pointer' : 'none'}
              mirror={embedded}
              title={restingWho.name}
            />
          {/if}
          <h1 class="chat-col-greet">
            {isOnboarding
              ? $_('app.home.chat.greetOnboarding')
              : $_('app.home.chat.greetAsk')}
          </h1>
          {#if isOnboarding}
            <p class="chat-col-sub">{$_('app.onboarding.welcome.subtitle')}</p>
          {:else if threadId}
            <p class="chat-col-sub">{$_('chat.emptyThread')}</p>
          {:else if !embedded}
            <p class="chat-col-sub">{$_('app.home.chat.composerHint')}</p>
          {/if}
          {#if embedded && isEmptyChat}
            <div class="chat-col-chips">
              {#each PROMPT_CHIPS as key (key)}
                <button
                  type="button"
                  class="chat-chip"
                  onclick={() => pickPrompt(key)}
                  aria-label={$_('app.home.chat.prompts.' + key)}
                >
                  {$_('app.home.chat.chips.' + key)}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {:else}
      {#if goal}
        <div class="goal-pin"><ChatGoalCard {goal} /></div>
      {/if}
      {#if goalHint}
        <p class="goal-hint" role="status">{goalHint}</p>
      {/if}
      {#each messages as msg, i (i)}
        {#if msg.role === 'user' && isDmReplyBackMessage(msg.content)}
        {:else}
        <!-- Prima il giorno, poi il confine dei non letti: il secondo sta più vicino al messaggio
             da cui si riprende a leggere. -->
        {#if dayLines[i]}<ChatDivider label={dayLines[i]} />{/if}
        {#if i === unreadIndex}<ChatDivider label={$_('chat.newMessages')} tone="accent" />{/if}
        {#if msg.role === 'user'}
          {@const isLastUser =
            i === messages.length - 1 ||
            !messages.slice(i + 1).some((m) => m.role === 'user')}
          <div class="bubble-user-wrap">
            {#if msg.attachments?.length || msg.documents?.length}
              <div class="att-strip">
                {#each msg.attachments ?? [] as url (url)}
                  <img class="att-thumb" src={url} alt="" loading="lazy" />
                {/each}
                {#each msg.documents ?? [] as name (name)}
                  <span class="att-doc">{name}</span>
                {/each}
              </div>
            {/if}
            <div class="chat-msg-cell-user">
              {@html escapeChatText(stripAttachedDocsForDisplay(msg.content))}
            </div>
            {#if !dmPair}
              <!-- In un DM (sola lettura) modifica/reinvio finirebbero in un 403 del server. -->
              <ChatUserMessageActions
                disabled={loading}
                showResend={isLastUser}
                oncopy={() => copyMessage(msg.content)}
                onedit={() => startEdit(i)}
                onresend={() => (error && isLastUser ? retryLast() : resendAt(i))}
              />
            {/if}
          </div>
        {:else}
          <!-- Chronological replay: text, the tools it triggered, their cards, then more text. -->
          {@const blocks = messageBlocks(msg.content, msg.tool_calls)}
          {@const previewsOf = previewsByCall(blocks)}
          {@const shownUrls = showMediaUrls(blocks)}
          {@const bubbles = textBubbleRange(blocks)}
          <div class="bubble-assistant-wrap chat-turn">
              {#each blocks as block, bi (bi)}
              {#if block.type === 'text'}
              {@const gs = splitGoalStatus(block.text)}
              <!-- Un indirizzo del nostro storage da solo su una riga è una consegna, non una
                   frase: esce dalla bolla e diventa il suo player, qui sotto. -->
              {@const tm = splitTextMedia(gs.text, shownUrls)}
              {#if tm.text.trim()}
              <div class="chat-turn-line">
              {#if bi === bubbles.first}
                <!-- Il volto sta sulla PRIMA bolla, non in cima al turno: se la risposta comincia
                     col ragionamento o con una chip, l'avatar scende fin qui. Stessa identità che
                     mostra ChatLiveStatus, così la risposta non cambia faccia quando finisce. -->
                <span class="chat-turn-face" aria-hidden="true">
                  <AgentAvatar face={restingWho.face} color={restingWho.color} size={28} />
                </span>
              {/if}
              <div class="chat-msg-cell chat-msg">
              {@html renderMd(tm.text)}
              </div>
              {#if bi === bubbles.last}
                <!-- Le azioni sotto l'ULTIMA bolla: ciò che il turno produce dopo (fonti, card,
                     chip) resta al suo posto cronologico senza portarsi via copia/rigenera. -->
                <ChatMessageActions
                  role="assistant"
                  disabled={loading}
                  agentName={activeAgent.name}
                  agentFace={activeAgent.face}
                  agentColor={activeAgent.color}
                  feedback={msg.feedback ?? null}
                  durationMs={msg.duration_ms ?? null}
                  model={msg.model ?? null}
                  tier={msg.tier ?? null}
                  inputTokens={msg.input_tokens ?? null}
                  outputTokens={msg.output_tokens ?? null}
                  oncopy={() => copyMessage(msg.content)}
                  onredo={() => redoAssistant(i)}
                  onfeedback={(value, note) => void sendFeedback(msg.id, value, note)}
                />
              {/if}
              </div>
              {/if}
              {#if tm.media}
                <ChatMediaCard media={tm.media} />
              {/if}
              {#if gs.status}
                <ChatGoalStatusCard status={gs.status} live={i === messages.length - 1} />
              {/if}
              {:else if block.type === 'reasoning'}
              <ChatThought reasoning={block.text} />
              {:else}
              {@const calls = block.calls as ToolCallUi[]}
              <!-- Quali tool restino muti lo decide `chipCalls` DENTRO ChatToolChips: qui c'era
                   un elenco copiato a mano, e ogni surface ne aveva una versione diversa. -->
              <ChatToolChips {calls} />
              <ChatDmChip {calls} {brandSlug} />
              {#each calls.filter((tc) => ROUTINE_EVENT_TOOLS.includes(tc.toolName)) as tc, ti (`${tc.toolCallId ?? 're'}-${i}-${bi}-${ti}`)}
                {@const ev = normalizeRoutineEvent(tc.routineEvent ?? tc.output)}
                {#if ev}
                  <ChatRoutineEventRow event={ev} />
                {/if}
              {/each}
              {#each calls.filter((tc) => tc.openTab) as tc, ti (`${tc.toolCallId ?? 'ot'}-${i}-${bi}-${ti}`)}
                {@const tab = tc.openTab!}
                {@const key = `${i}:${tc.toolCallId ?? `${bi}-${ti}`}:${tab.href}`}
                {@const label = tabLabelFor(tab.path || tab.href)}
                <div class="open-tab-card">
                  <p class="ot-reason">{tab.reason || $_('app.shell.openTabReason')}</p>
                  {#if confirmedTabs.has(key)}
                    <span class="ot-done">{$_('app.shell.openTabOpened')}</span>
                  {:else}
                    <button type="button" class="ot-cta" onclick={() => confirmOpenTab(tab, key)}>
                      {$_('app.shell.openTabCta', { values: { label } })}
                    </button>
                  {/if}
                </div>
              {/each}
              {#each calls.filter((tc) => tc.plan) as tc, ti (`${tc.toolCallId ?? 'pl'}-${i}-${bi}-${ti}`)}
                <ChatPlanCard
                  plan={tc.plan!}
                  {brandSlug}
                  onopen={(href) => {
                    const id = href.split('/plans/')[1]?.split(/[?#]/)[0];
                    if (id) openPlanDocument({ brandSlug, planId: id, href });
                  }}
                />
              {/each}
              {#each calls.filter((tc) => tc.toolName === 'propose_app_connection') as tc, ti (`${tc.toolCallId ?? 'cn'}-${i}-${bi}-${ti}`)}
                {@const connect = normalizeConnectPayload(tc.connect ?? tc.output)}
                {#if connect}
                  <ChatConnectCard {connect} {brandSlug} />
                {/if}
              {/each}
              <!-- Device login: dal check del tool arriva l'esito, mai il token. -->
              {#each calls.filter((tc) => tc.toolName === 'sandbox_device_login') as tc, ti (`${tc.toolCallId ?? 'dl'}-${i}-${bi}-${ti}`)}
                {@const deviceLogin = normalizeDeviceLoginPayload(tc.deviceLogin ?? tc.output)}
                {#if deviceLogin}
                  <ChatDeviceLoginCard login={deviceLogin} />
                {/if}
              {/each}
              {#each calls.filter((tc) => tc.questions?.length) as tc, ti (`${tc.toolCallId ?? 'qq'}-${i}-${bi}-${ti}`)}
                <ChatQuestionsCard
                  questions={tc.questions!}
                  toolCallId={tc.toolCallId ?? `qq-${i}-${bi}-${ti}`}
                  threadId={threadId ?? ''}
                  followingUserTexts={messages.slice(i + 1).filter((m) => m.role === 'user' && !isDmReplyBackMessage(m.content)).map((m) => m.content)}
                  disabled={loading}
                  onanswer={(text) => send(text)}
                />
              {/each}
              <ChatExpressionStickers {calls} />
              <!-- Nessun testo dal modello: la card prende i mestieri da i18n. -->
              {#each calls.filter((tc) => tc.toolName === 'show_team') as tc, ti (`${tc.toolCallId ?? 'tm'}-${i}-${bi}-${ti}`)}
                {@const team = normalizeTeamPayload(tc.team ?? tc.output)}
                {#if team}
                  <ChatTeamCard {team} {brandSlug} />
                {/if}
              {/each}
              {#each calls as tc, ti (`${tc.toolCallId ?? 'md'}-${i}-${bi}-${ti}`)}
                {@const shown = mediaFromToolCall(tc)}
                {#if shown}
                  <ChatMediaCard media={shown} />
                {/if}
              {/each}
              {#each calls.filter((tc) => tc.toolName === 'propose_custom_agent') as tc, ti (`${tc.toolCallId ?? 'ap'}-${i}-${bi}-${ti}`)}
                {@const proposal = normalizeAgentProposal(tc.agentProposal ?? tc.output)}
                {#if proposal}
                  <ChatAgentProposalCard
                    {proposal}
                    toolCallId={tc.toolCallId ?? `ap-${i}-${bi}-${ti}`}
                    threadId={threadId ?? ''}
                    {brandSlug}
                    disabled={loading}
                    ondecline={(text) => send(text)}
                  />
                {/if}
              {/each}
              {@const arts = calls.flatMap((tc) => {
                if (mediaFromToolCall(tc)) return [];
                return tc.toolCallId ? artifactsByCall.get(tc.toolCallId) ?? [] : [];
              })}
              {#each arts as a (a.id)}
                <ChatArtifactCard artifact={a} />
              {/each}
              {@const previews = calls.flatMap((tc) => previewsOf.get(tc) ?? [])}
              {#if previews.length}
                <div class="post-previews">
                  {#each previews as p (p.post_id)}
                    <!-- Il CTA del lightbox porta `?post=`, che apre l'editor di QUESTO post
                         invece di scaricare l'utente sul calendario a ricercarselo. -->
                    <button type="button" class="post-preview-link" onclick={() => (zoomPost = p)}>
                      {#if p.media_urls && p.media_urls.length > 1}
                        <span class="carousel-badge">◱ {p.media_urls.length}</span>
                      {/if}
                      <PostCard
                        post={{
                          platform: p.platform,
                          caption: p.caption,
                          status: p.status,
                          thumbnail: p.media_url || p.media_urls?.[0] || undefined,
                          videoRenderStatus: p.video_render_status
                        }}
                        compact
                      />
                    </button>
                  {/each}
                </div>
              {/if}
              {/if}
              {/each}
            {#if msg.sources?.length}
              <ChatSources sources={msg.sources} {brandSlug} />
            {/if}
          </div>
        {/if}
        {/if}
      {/each}
      {#if looseArtifacts.length}
        <!-- Artefatti la cui chiamata non compare più nella cronologia: il file esiste, mostrarlo
             qui è meglio che perderlo. -->
        <div class="bubble-assistant-wrap chat-turn">
          {#each looseArtifacts as a (a.id)}
            <ChatArtifactCard artifact={a} />
          {/each}
        </div>
      {/if}
      {#if showLivePartial}
        <!-- Stesso gutter del turno finito: la bolla che sta scrivendo nasce già dove resterà. -->
        <div class="bubble-assistant-wrap chat-turn">
          <ChatLiveStatus
            {loading}
            {streamBuf}
            {streamToolCalls}
            {streamReasoning}
            {streamReasoningSegments}
            {brandSlug}
            face={liveFace}
            color={liveWho.color}
            />
        </div>
      {/if}
      {#if error && !loading}
        <div class="chat-error" role="alert">
          <span>{error}</span>
          <div class="chat-error-actions">
            <button type="button" class="retry-btn" onclick={retryLast}>{$_('chat.retry')}</button>
            <button type="button" class="chat-error-dismiss" onclick={dismissError} aria-label="Dismiss">×</button>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <div class="chat-col-prompt">
    {#if dmPair}
      <!-- Sola lettura (il server rifiuta comunque ogni POST): nota quieta al posto del composer. -->
      <div class="dm-viewonly" role="note">{$_('chat.dmViewOnly')}</div>
    {:else}
    {#if embedded}
      <!-- Il campo "A" vive SOLO sulla chat nuova: appena il thread esiste il destinatario è
           l'identità del thread e non si cambia più. -->
      <ChatRecipients
        keys={recipients}
        agentOptions={agentOptions}
        customAgents={customAgents}
        groupEnabled={!!$page.data.flags?.groupChats}
        disabled={loading}
        onchange={applyRecipients}
      />
    {/if}
    <ChatQueueChip
      items={queueItems}
      busy={queueActionBusy}
      onedit={onQueueEdit}
      ondelete={onQueueDelete}
      onsendnow={onQueueSendNow}
    />
    <!-- `agentOptions={null}` sulla home: il destinatario si sceglie nel campo "A" qui sopra, e
         due comandi per la stessa scelta a due centimetri di distanza sono peggio di uno. -->
    <ChatPrompt
      bind:this={promptRef}
      bind:value={input}
      bind:mode={chatMode}
      bind:tier={chatTier}
        bind:reasoning={chatReasoning}
      chatModels={catalogModels}
      brandSlug={brandSlug}
      draftKey={`anomalia:chat-draft:${brandSlug}:${threadId ?? 'new'}`}
      onsubmit={(text, meta) => send(text, meta)}
      onstop={stopRequest}
      loading={loading}
      sending={sending}
      placeholder={placeholder}
      showHint={false}
      agentOptions={embedded ? null : agentOptions}
      agentLocked={messages.length > 0}
      agent={agentSel}
      onagentchange={onAgentChange}
      onmodelchange={onModelChange}
      customAgents={customAgents}
      customAgent={customAgentSel}
      oncustomagentchange={onCustomAgentChange}
      roomEnabled={!!$page.data.flags?.groupChats}
      roomAgents={roomSel}
      onroomchange={(keys) => (roomSel = keys)}
      webHubEnabled={webHubEnabled}
    />
    {/if}
  </div>
</div>

{#if zoomImageSrc}
  <ChatImageLightbox src={zoomImageSrc} onclose={() => (zoomImageSrc = null)} />
{/if}

{#if zoomPost}
  <ChatImageLightbox
    src={zoomPost.media_urls?.length ? zoomPost.media_urls : (zoomPost.media_url ?? '')}
    caption={zoomPost.caption}
    calendarHref={postPreviewHref(`/app/${brandSlug}`, zoomPost.post_id)}
    onclose={() => (zoomPost = null)}
  />
{/if}

<style>
  .chat-col {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--paper);
  }
  /* Composer: greeting + prompt impilati e centrati. Il thread nasce al primo invio. */
  .chat-col.is-composer {
    justify-content: center;
    gap: 20px;
    padding: 24px 0 32px;
  }
  .chat-col.is-composer.is-embedded {
    /* Alto quanto il suo contenuto: centra .overview-composer. Con height:100% si mangiava il
       pannello e i chip finivano incollati al bordo invece che sotto al prompt. */
    height: auto;
    min-height: 0;
    justify-content: center;
    padding: 24px 0 32px;
    background: transparent;
    gap: 40px;
  }
  .chat-col.is-composer .chat-col-msgs {
    flex: 0 0 auto;
    overflow: visible;
    padding-bottom: 0;
  }
  .chat-col.is-composer .chat-col-hero {
    padding-top: 0;
    padding-bottom: 0;
  }
  .chat-col.is-composer .chat-col-prompt {
    flex: 0 0 auto;
    width: 100%;
    max-width: 520px;
    margin: 0 auto;
    padding: 0 16px;
    border-top: none;
  }
  .chat-col.is-composer.is-embedded .chat-col-prompt {
    max-width: none;
    padding: 0;
  }
  .chat-col.is-composer.is-embedded .chat-col-welcome {
    max-width: none;
    position: relative;
    gap: 8px;
  }
  .chat-col.is-composer.is-embedded .chat-col-welcome :global(.brandmark path) {
    fill: var(--ink);
  }
  .chat-col.is-composer.is-embedded .chat-col-greet {
    background: none !important;
    -webkit-background-clip: unset;
    background-clip: unset;
    /* Beat app.css `.chat-col-greet { font-size: var(--page-title-size) !important }`. */
    color: var(--ink) !important;
    font-size: clamp(1.65rem, 3.2vw, 2.15rem) !important;
    font-weight: 500 !important;
    letter-spacing: -0.03em !important;
    line-height: 1.15 !important;
    margin-top: 0 !important;
  }
  /* Sui token, non sul glow accent: il bianco fisso era leggibile solo sopra il gradiente. */
  .chat-col.is-composer.is-embedded .chat-col-sub {
    color: var(--ink-soft);
  }
  .chat-col.is-composer.is-embedded .chat-chip {
    border-color: var(--line);
    background: var(--paper);
    color: var(--ink-soft);
  }
  .chat-col.is-composer.is-embedded .chat-chip:hover {
    border-color: var(--ink-faint);
    background: var(--paper-2);
    color: var(--ink);
  }
  .chat-col-msgs {
    flex: 1;
    overflow-y: auto;
    padding: 16px 16px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    cursor: default;
  }
  .chat-col-msgs :global(a) {
    cursor: pointer;
  }
  .goal-hint {
    margin: 0;
    padding: 6px 10px;
    align-self: flex-start;
    font-size: 0.75rem;
    color: var(--ink-soft);
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 0.7rem;
  }
  /* Resta in cima mentre il turno scorre: è il momento in cui serve, non dopo. */
  .goal-pin {
    position: sticky;
    top: -16px;
    z-index: 3;
    margin: -4px 0 2px;
    padding-top: 4px;
    background: linear-gradient(var(--paper) 78%, transparent);
  }
  .chat-col-msgs.is-empty {
    justify-content: center;
  }
  .chat-col-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 12px;
    text-align: center;
  }
  /* Il primo avatar sta NEL FLUSSO — la testata conserva l'altezza che ha con un destinatario
     solo — e quelli dietro sono posizionati rispetto al suo centro: il saluto non si sposta. */
  .chat-col-welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 520px;
  }
  .chat-col-greet {
    margin: 4px 0 0;
    font-size: clamp(1.75rem, 3.2vw, 2.35rem);
    font-weight: 650;
    letter-spacing: -0.04em;
    line-height: 1.15;
    color: var(--ink);
  }
  .chat-col-sub {
    margin: 0;
    font-size: 14px;
    color: var(--ink-soft);
    line-height: 1.45;
  }
  .chat-col-chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 14px;
    max-width: 420px;
  }
  .chat-chip {
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 13px;
    font-weight: 550;
    padding: 7px 14px;
    border-radius: 999px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }
  .chat-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--paper-2);
  }
  .chat-chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .chat-col-prompt {
    flex-shrink: 0;
    padding: 12px 16px 16px;
    border-top: 1px solid var(--line);
  }
  @media (max-width: 1023px) {
    .chat-col.is-composer,
    .chat-col.is-composer.is-embedded {
      padding: 16px 0 16px;
    }
    .chat-col-msgs {
      padding: 16px 16px 10px;
    }
    .chat-col-prompt {
      padding: 12px 16px 16px;
    }
    .chat-col.is-composer .chat-col-prompt {
      padding: 0 16px 16px;
    }
    .chat-col.is-composer.is-embedded .chat-col-prompt {
      padding: 0 0 16px;
    }
  }
  .chat-col-empty {
    margin: auto;
    text-align: center;
    color: var(--ink-soft);
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .chat-col-idle {
    display: inline-flex;
    animation: chat-idle-scale 2.4s ease-in-out infinite;
    transform-origin: center;
    will-change: transform;
  }
  @keyframes chat-idle-scale {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.06);
    }
  }
  .bubble {
    max-width: 100%;
    padding: 10px 14px;
    border-radius: 16px;
    font-size: 13px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .att-strip { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; margin-bottom: 6px; }
  .att-thumb { width: 84px; height: 84px; object-fit: cover; border-radius: 10px; border: 1px solid var(--line, #e3e3e6); cursor: zoom-in; }
  .att-doc {
    display: inline-flex;
    align-items: center;
    max-width: 180px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--line, #e3e3e6);
    background: var(--paper-2, #f5f5f7);
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft, #6e6e73);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bubble-user-wrap {
    /* Full column width (same as prompt); cell itself stays fit-content for short texts. */
    align-self: stretch;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .bubble-assistant-wrap {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }
  .retry-btn {
    appearance: none;
    border: 1px solid var(--line, #e3e3e6);
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .retry-btn:hover {
    background: var(--paper-2, #f5f5f7);
  }
  .chat-error {
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid color-mix(in oklab, #dc2626 25%, transparent);
    background: color-mix(in oklab, #dc2626 8%, var(--paper));
    color: #b91c1c;
    font-size: 12.5px;
  }
  .chat-error-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .chat-error-dismiss {
    appearance: none;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 4px;
  }
  /* Evento di sistema: riga quieta CENTRATA nella colonna, niente card bordata. */
  .open-tab-card {
    align-self: center;
    margin: 6px 0 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    max-width: 420px;
    text-align: center;
  }
  .ot-reason {
    margin: 0;
    font-size: 0.76rem;
    color: var(--ink-soft);
    line-height: 1.4;
  }
  .ot-cta {
    appearance: none;
    border: none;
    background: none;
    padding: 0;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--accent);
    cursor: pointer;
  }
  .ot-cta:hover,
  .ot-cta:focus-visible {
    text-decoration: underline;
  }
  .ot-done {
    display: inline-block;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--ink-faint);
  }
  /* Tipografia markdown dei messaggi: src/lib/styles/chat-messages.css, condivisa con la thread
     page e ChatLiveStatus. */
  .post-previews {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
    margin: 10px 0 4px;
  }
  .post-preview-link {
    position: relative;
    text-decoration: none;
    color: inherit;
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .carousel-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 1;
    font-size: 10px;
    font-weight: 650;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    padding: 2px 7px;
    border-radius: 999px;
  }
  .bubble.thinking {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    align-self: flex-start;
    width: auto;
    max-width: none;
    padding: 14px 4px;
    background: none;
    border: none;
  }
  .bubble.thinking span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ink-faint);
    animation: blink 1.2s infinite ease-in-out;
  }
  .bubble.thinking span:nth-child(2) {
    animation-delay: 0.2s;
  }
  .bubble.thinking span:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes blink {
    0%,
    80%,
    100% {
      opacity: 0.35;
    }
    40% {
      opacity: 1;
    }
  }

  /* DM fra agenti: nota view-only al posto del composer. */
  .dm-viewonly {
    text-align: center;
    font-size: 12px;
    color: var(--ink-soft);
    padding: 10px 14px;
    border: 1px dashed var(--line);
    border-radius: 12px;
    background: var(--paper-2);
  }
</style>
