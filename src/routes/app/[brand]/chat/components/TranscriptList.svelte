<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { ChevronDown, ChevronRight } from '@lucide/svelte';
  import ChatLiveStatus from '$lib/components/ChatLiveStatus.svelte';
  import ChatUserMessageActions from '$lib/components/ChatUserMessageActions.svelte';
  import ChatDivider from '$lib/components/ChatDivider.svelte';
  import { dayDividers, firstUnreadIndex } from '$lib/chat-day-groups';
  import { renderMd, escapeChatText } from '$lib/chat-markdown';
  import { stripAttachedDocsForDisplay } from '$lib/chat-documents';
  import { dmAgents, dmMemberAvatar, dmNames, isDmReplyBackMessage } from '$lib/chat-dm';
  import { roomMemberAvatar, roomMemberKeys, roomMemberName, threadIdentity } from '$lib/thread-identity';
  import { chatThreads } from '$lib/stores/chat';
  import type { ChatStreamState, StreamToolCallState } from '$lib/chat-stream-events';
  import type { ChatReasoningSegment } from '$lib/chat-parts';
  import ChatAttStrip from './ChatAttStrip.svelte';
  import ChatSpeakerTag from './ChatSpeakerTag.svelte';
  import ChatTurn from './ChatTurn.svelte';
  import ChatArtifactCard from '$lib/components/ChatArtifactCard.svelte';
  import type { AgentAvatarFace } from '$lib/agent-avatars';
  import { parseToolCalls, type ChatArtifactUi, type ChatMessage, type PostPreview } from './transcript';
  import type { KitRun } from './kit-run';

  let {
    messages,
    artifacts = [],
    loading,
    speakerKey,
    streamBuf,
    streamToolCalls,
    streamReasoning,
    streamReasoningSegments,
    showLivePartial,
    orphanRun,
    orphanState,
    thread,
    brandSlug,
    hasActiveJob,
    lastReadAt,
    openedAt,
    error,
    onretrylast,
    ondismisserror,
    onzoomimage,
    onzoompost,
    oncopy,
    onedit,
    onresend,
    onredo,
    onfeedback,
    onsend,
    approvalStatuses,
    onapproval
  }: {
    messages: ChatMessage[];
    artifacts?: ChatArtifactUi[];
    loading: boolean;
    speakerKey: string | null | undefined;
    streamBuf: string;
    streamToolCalls: StreamToolCallState[];
    streamReasoning: string;
    streamReasoningSegments: ChatReasoningSegment[];
    showLivePartial: boolean;
    orphanRun: KitRun | null;
    orphanState: ChatStreamState;
    thread: {
      id: string;
      surface?: string | null;
      agent?: string | null;
      summary?: string | null;
      summary_upto?: string | null;
      summary_message_count?: number | null;
      room_agents?: unknown;
    };
    brandSlug: string;
    hasActiveJob: boolean;
    lastReadAt: string | null;
    openedAt: number;
    error: string | null;
    onretrylast: () => void;
    ondismisserror: () => void;
    onzoomimage: (src: string) => void;
    onzoompost: (p: PostPreview) => void;
    oncopy: (content: string) => void;
    onedit: (index: number) => void;
    onresend: (index: number) => void;
    onredo: (index: number) => void;
    onfeedback: (messageId: string | undefined, value: 1 | -1 | null, note?: string) => void;
    onsend: (text: string) => void;
    approvalStatuses: Record<string, string>;
    onapproval: (approvalId: string, approved: boolean) => void;
  } = $props();

  // La riga in store porta anche gli avatar dei custom agent; thread copre il primo paint.
  const live = $derived(
    showLivePartial
      ? {
          loading,
          text: streamBuf,
          tools: streamToolCalls,
          reasoning: streamReasoning,
          reasoningSegments: streamReasoningSegments
        }
      : orphanRun
        ? {
            loading: true,
            text: orphanState.text,
            tools: orphanState.tools,
            reasoning: orphanState.reasoning,
            reasoningSegments: [] as ChatReasoningSegment[]
          }
        : null
  );

  const threadWho = $derived(
    threadIdentity($chatThreads.find((t) => t.id === thread.id) ?? thread, (k) => $_(k))
  );

  let summaryOpen = $state(false);
  /** Dove finisce la parte compattata: la compattazione accorcia il contesto del modello, non
   * la cronologia dell'utente — i turni riassunti restano sopra il divisore, leggibili. */
  const compactionCutIndex = $derived.by(() => {
    const upto = thread.summary_upto;
    if (!thread.summary || !upto) return -1;
    return messages.findIndex((m) => !!m.created_at && m.created_at > upto);
  });

  const dayLines = $derived(dayDividers(messages, { locale: $locale, t: (k) => $_(k) }));
  const unreadIndex = $derived(firstUnreadIndex(messages, lastReadAt, openedAt));

  // DM fra agenti (marcatore su room_agents, vedi $lib/chat-dm): pagina in sola lettura, ogni
  // battuta etichettata col membro che l'ha scritta (chat_messages.name = chiave membro).
  const dmPair = $derived(dmAgents(thread.room_agents));
  const dmMemberNames = $derived(dmNames(thread.room_agents));
  const dmSpeakerLabel = (name: string | null | undefined) =>
    (name && dmMemberNames[name]) || (name ?? '');

  // Chat di gruppo (room_agents ARRAY): scrivibile, ma ogni battuta è firmata come in un DM.
  const roomKeys = $derived(roomMemberKeys(thread.room_agents));
  const roomAgentList = $derived(
    ($chatThreads.find((t) => t.id === thread.id) as
      | { agents?: Array<{ id: string; name: string; face?: string; color?: string }> }
      | undefined)?.agents ?? null
  );
  const speakerLabel = (name: string | null | undefined) =>
    dmPair ? dmSpeakerLabel(name) : roomMemberName(name ?? '', roomAgentList, (k) => $_(k));
  const speakerAvatar = (name: string | null | undefined) => {
    if (!name) return threadWho;
    if (dmPair) return dmMemberAvatar(name);
    return roomKeys.length >= 2 ? roomMemberAvatar(name, roomAgentList) : threadWho;
  };

  /** Chi sta parlando ora: in una stanza la voce cambia a ogni battuta. La firma arriva dal
   * server (header `X-Chat-Speaker`, o `speaker` del job accodato). */
  const liveWho = $derived(
    speakerKey ? roomMemberAvatar(speakerKey, roomAgentList) : threadWho
  );

  /**
   * La riga di checkpoint del turno VIVO: sta nel transcript (ci arriva dal server, ed è ciò che
   * fa vedere il lavoro dopo un reload) ma la disegna la bolla viva, quindi qui va saltata. Senza
   * un run vivo non c'è niente da saltare e la riga si mostra: è l'unica copia rimasta.
   */
  const liveCheckpointId = $derived(orphanRun?.partial_saved_msg_id ?? null);
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
  const renderedCallIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const m of messages) {
      // Il checkpoint vivo è saltato nel transcript (lo disegna la bolla): i suoi toolCallId
      // non contano come "già mostrati", o i fotogrammi sparirebbero per tutta la durata del turno.
      if (m.id && m.id === liveCheckpointId) continue;
      for (const part of parseToolCalls(m.tool_calls)) {
        const id = part.toolCallId;
        if (id) ids.add(id);
      }
    }
    return ids;
  });
  const looseArtifacts = $derived(
    artifacts.filter((a) => !a.tool_call_id || !renderedCallIds.has(a.tool_call_id))
  );

  /**
   * L'ultimo messaggio dell'utente, cercato UNA volta.
   *
   * Ogni riga se lo chiedeva scorrendo la coda della lista (`messages.slice(i + 1).some(...)`):
   * su cento turni sono cinquemila passi e cento array nuovi a ogni ridisegno, per un indice che
   * è lo stesso per tutti.
   */
  const lastUserIndex = $derived.by(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return i;
    }
    return -1;
  });
</script>

<div class="chat-column">
<!-- Non nel thread di onboarding: lì un turno sta già partendo e un "cosa vuoi fare?" sarebbe sbagliato. -->
{#if messages.length === 0 && !loading && !hasActiveJob && thread.surface !== 'onboarding'}
  <div class="text-center py-12 text-muted-foreground">
    <div class="text-4xl mb-4">✨</div>
    <p class="text-sm leading-relaxed">{$_('chat.welcome')}</p>
  </div>
{/if}

<!-- La chiave resta la POSIZIONE, e non è una svista. `consolidateMessages` può emettere due
     righe con lo stesso `id` (misurato l'1/9: 100 righe, un id ripetuto su una cronologia vera),
     e Svelte su una chiave duplicata non disegna la lista: transcript vuoto, nessun errore a
     schermo. Chiavare sull'id si può solo dopo che il consolidamento produce una chiave sua. -->
{#each messages as msg, i (i)}
  {#if msg.role === 'user' && isDmReplyBackMessage(msg.content)}
    <!-- La risposta di un DM non sta in questa chat: vive nel thread privato (chip). -->
  {:else}
  {#if i === compactionCutIndex}
    <button
      type="button"
      class="compaction-divider"
      onclick={() => (summaryOpen = !summaryOpen)}
      aria-expanded={summaryOpen}
    >
      <span class="compaction-rule"></span>
      <span class="compaction-label">
        {$_('chat.compacted', { values: { count: thread.summary_message_count ?? 0 } })}
        {#if summaryOpen}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
      </span>
      <span class="compaction-rule"></span>
    </button>
    {#if summaryOpen}
      <div class="compaction-summary">{@html renderMd(thread.summary ?? '')}</div>
    {/if}
  {/if}
  {#if dayLines[i]}<ChatDivider label={dayLines[i]} />{/if}
  {#if i === unreadIndex}<ChatDivider label={$_('chat.newMessages')} tone="accent" />{/if}
  {#if msg.role === 'user'}
    {@const isLastUser = i === lastUserIndex}
    <div class="self-end flex flex-col gap-1.5 items-end w-[80%] max-w-[80%] min-w-0 box-border">
      {#if msg.attachments?.length || msg.documents?.length}
        <ChatAttStrip urls={msg.attachments} docs={msg.documents} />
      {/if}
      {#if dmPair}
        <!-- In un DM la riga user è la battuta dell'agente mittente: etichetta, non azioni. -->
        <ChatSpeakerTag label={dmSpeakerLabel(msg.name)} />
      {/if}
      <div class="user-bubble chat-msg-cell-user">
        {@html escapeChatText(stripAttachedDocsForDisplay(msg.content))}
      </div>
      {#if !dmPair}
        <ChatUserMessageActions
          disabled={loading}
          showResend={isLastUser}
          oncopy={() => oncopy(msg.content)}
          onedit={() => onedit(i)}
          onresend={() => (error && isLastUser ? onretrylast() : onresend(i))}
        />
      {/if}
    </div>
  {:else if msg.role === 'assistant' && msg.id !== liveCheckpointId}
    <div class="assistant-msg-wrap chat-turn">
      <ChatTurn
        {msg}
        index={i}
        isLast={i === messages.length - 1}
        {loading}
        {brandSlug}
        threadId={thread.id}
        dmPair={!!dmPair}
        {roomKeys}
        {speakerLabel}
        {speakerAvatar}
        {artifactsByCall}
        followingUserTexts={() =>
          messages
            .slice(i + 1)
            .filter((m) => m.role === 'user' && !isDmReplyBackMessage(m.content))
            .map((m) => m.content)}
        oncopy={oncopy}
        onredo={onredo}
        onfeedback={onfeedback}
        onsend={onsend}
        onpreview={onzoompost}
        {approvalStatuses}
        onapproval={onapproval}
      />
    </div>
  {/if}
  {/if}
{/each}

{#if looseArtifacts.length}
  <!-- Artefatti la cui chiamata non compare più nella cronologia: il file esiste, mostrarlo
       qui è meglio che perderlo. Il checkpoint vivo è escluso da renderedCallIds, quindi
       i fotogrammi restano visibili anche mentre la bolla copre quella riga. -->
  <div class="assistant-msg-wrap chat-turn">
    {#each looseArtifacts as a (a.id)}
      <ChatArtifactCard artifact={a} />
    {/each}
  </div>
{/if}

<!-- Entrare in una chat che sta parlando deve somigliare al non esserne mai usciti: la stessa
     bolla viva, nello stesso punto. `ChatLiveStatus` a buffer vuoto mostra gia' «sta pensando»,
     quindi non serve nessuna riga di stato accanto — e un pulsante da solo, senza il testo che
     sta arrivando, era peggio del silenzio: diceva che c'era un turno senza mostrarlo. -->
{#if live}
  <div class="assistant-msg-wrap chat-turn">
    <ChatLiveStatus
      loading={live.loading}
      streamBuf={live.text}
      streamToolCalls={live.tools}
      streamReasoning={live.reasoning}
      streamReasoningSegments={live.reasoningSegments}
      {brandSlug}
      face={liveWho.face}
      color={liveWho.color}
    />
  </div>
{/if}

{#if error}
  <div class="flex items-center justify-between gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
    <span>{error}</span>
    <div class="flex items-center gap-2 shrink-0">
      <button type="button" class="retry-pill" onclick={onretrylast}>{$_('chat.retry')}</button>
      <button type="button" class="border-0 bg-transparent text-red-700 text-base cursor-pointer px-1" onclick={ondismisserror}>×</button>
    </div>
  </div>
{/if}
</div>

<style>
  .assistant-msg-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-self: stretch;
    min-width: 0;
  }
  .compaction-divider {
    appearance: none;
    background: none;
    border: 0;
    padding: 0.25rem 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    cursor: pointer;
  }
  .compaction-rule {
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .compaction-label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.6875rem;
    color: var(--ink-faint);
    white-space: nowrap;
  }
  .compaction-summary {
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--ink-faint);
    background: var(--paper-2);
    border-radius: 0.75rem;
    padding: 0.75rem 1rem;
    user-select: text;
  }
  .retry-pill {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    line-height: 1.2;
  }
  .retry-pill:hover {
    background: var(--paper-2);
  }
  .chat-column {
    width: 100%;
    max-width: var(--chat-col);
    margin-inline: auto;
    box-sizing: border-box;
    padding: 1rem 24px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  @media (max-width: 1023px) {
    .chat-column {
      padding: 1rem 16px;
    }
  }
</style>
