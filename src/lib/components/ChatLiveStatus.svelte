<script lang="ts">
  import { _ } from 'svelte-i18n';
  import ChatToolChips from '$lib/components/ChatToolChips.svelte';
  import { renderMd } from '$lib/chat-markdown';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { DEFAULT_CHAT_AGENT_AVATAR } from '$lib/agent-avatars';
  import type { StreamToolCall } from '$lib/stores/chat-session';
  import { expoOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  import { MORPH_MS } from '$lib/avatar-morph';
  import { streamBlocks, toolLabel, type ChatReasoningSegment } from '$lib/chat-parts';
  import { formatChatDuration } from '$lib/chat-duration';
  import ChatThought from '$lib/components/ChatThought.svelte';
  import ChatExpressionStickers from '$lib/components/ChatExpressionStickers.svelte';
  import ChatMediaCard from '$lib/components/ChatMediaCard.svelte';
  import { mediaFromToolCall } from '$lib/chat-media';
  import '$lib/styles/chat-messages.css';

  let {
    loading = false,
    streamBuf = '',
    streamToolCalls = [] as StreamToolCall[],
    streamReasoning = '',
    // Ordered thought blocks (chat-session.ts's `foldReasoningEvent`) — when a caller passes
    // these, ChatThought mounts once per block, in position. Callers that don't yet (the maker
    // workbenches, AgentComputerPanel) keep the single legacy block up top via `streamReasoning`.
    streamReasoningSegments = [] as ChatReasoningSegment[],
    compact = false,
    // The agent's own face, following the turn: thinking while it reasons, writing once
    // the text starts landing.
    face = DEFAULT_CHAT_AGENT_AVATAR.face as string,
    color = DEFAULT_CHAT_AGENT_AVATAR.color
  }: {
    loading?: boolean;
    streamBuf?: string;
    streamToolCalls?: StreamToolCall[];
    streamReasoning?: string;
    streamReasoningSegments?: ChatReasoningSegment[];
    /** Tighter layout for the home chat column. */
    compact?: boolean;
    face?: string;
    color?: string;
  } = $props();

  // While the turn runs the face is the spinner: it loops through the idle cycle, each
  // change cross-fading. The loop itself lives in AgentAvatar (`cycle`), shared with the
  // sidebar's busy thread rows — one animation, one source.

  // Text and tool chips replayed in the order they arrived, so a turn reads
  // "text \u2192 tool \u2192 text \u2192 tool" live, exactly as it will after reload.
  const blocks = $derived(streamBlocks(streamBuf, streamToolCalls, streamReasoningSegments));
  /**
   * DA QUANTO NON SI VEDE NIENTE — il numero che il contatore accanto al volto mostra adesso.
   * Prima mostrava il tempo del TURNO, che dice «lavora da 30 minuti» anche mentre il testo
   * scorre: non è la domanda che uno si fa davanti a un render lungo, che è *è fermo?*. Questo
   * riparte a ogni cosa che l'utente può vedere comparire — un pezzo di testo, una tool call, un
   * blocco nuovo — quindi se cresce vuol dire che non sta arrivando niente.
   *
   * E il tempo del turno smette di essere calcolato in due componenti con due `setInterval`
   * propri: il turno finito porta già la sua durata sulla riga delle azioni.
   */
  let lastSeenAt = $state(0);
  let nowMs = $state(0);
  const visibleMark = $derived(`${blocks.length}:${streamBuf.length}:${streamToolCalls.length}`);
  $effect(() => {
    void visibleMark;
    lastSeenAt = Date.now();
  });
  $effect(() => {
    if (!loading) return;
    nowMs = Date.now();
    const id = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(id);
  });
  const silentMs = $derived(lastSeenAt && nowMs > lastSeenAt ? nowMs - lastSeenAt : 0);
  const reasoningActive = $derived(streamReasoningSegments.length > 0 || !!streamReasoning);
  const hasTools = $derived(streamToolCalls.length > 0);
  const activeTool = $derived(
    [...streamToolCalls].reverse().find((t) => t.status !== 'done' && t.status !== 'error') ?? null
  );
  /**
   * La riga viva nasce e muore come un PALLINO: cresce da zero all'inizio del turno, e alla fine
   * si ritira nel punto dove sta il volto invece di sparire di scatto. L'origine è il centro
   * dell'avatar, non l'angolo della riga, o il testo collasserebbe verso sinistra da solo.
   *
   * L'altezza entra nell'interpolazione insieme alla scala: `transform` non toglie spazio, quindi
   * senza questo lo spazio della riga resterebbe aperto per tutta l'uscita e si chiuderebbe di
   * colpo alla fine — cioè il salto di scroll, spostato di 420ms.
   */
  function dot(node: Element, { duration = MORPH_MS }: { duration?: number } = {}): TransitionConfig {
    const h = (node as HTMLElement).offsetHeight;
    return {
      duration,
      easing: expoOut,
      css: (t: number) =>
        `opacity: ${t}; transform: scale(${t}); transform-origin: 14px 50%;` +
        `height: ${h * t}px; overflow: hidden;`
    };
  }

  const statusLabel = $derived.by(() => {
    if (!loading) return '';
    if (streamBuf) return $_('chat.generating');
    if (activeTool) {
      return $_('chat.runningTool', {
        values: { tool: toolLabel(activeTool.toolName) }
      });
    }
    if (reasoningActive) return $_('chat.thinking');
    return $_('chat.thinking');
  });
</script>

{#if loading || streamBuf || hasTools || reasoningActive}
  <div class="live-status" class:compact data-live-stream>
    {#if !streamReasoningSegments.length && streamReasoning}
      <!-- Legacy callers only (no positioned segments yet): one collapsed block up top, exactly
           as before — see AgentComputerPanel / the maker workbenches. -->
      <ChatThought reasoning={streamReasoning} live={loading} />
    {/if}

    {#each blocks as block, bi (bi)}
      {#if block.type === 'text'}
        <!-- Stessa scatola del turno finito (`.chat-turn-line` col suo gutter): il testo nasce
             dove resterà. Il volto NON è qui mentre il turno gira — sta nella riga viva in fondo,
             e si siede nel gutter solo a turno chiuso. `.chat-turn-face` è in posizione assoluta,
             quindi comparire non sposta niente. -->
        <div class="chat-turn-line">
          <div class="chat-msg-cell chat-msg">{@html renderMd(block.text)}</div>
        </div>
      {:else if block.type === 'reasoning'}
        <!-- One thought block per segment, chronological: only the LAST one, while the turn is
             still generating, can still be open. -->
        <ChatThought reasoning={block.text} live={loading && bi === blocks.length - 1} />
      {:else}
        <ChatToolChips calls={block.calls} live={loading} />
        <!-- Lo sticker compare mentre il turno gira, non solo dopo il ricaricamento: prima qui
             passavano tutte le chiamate senza filtro, quindi l'utente vedeva lampeggiare la chip
             `SET_EXPRESSION` e poi trovarsela sostituita da uno sticker. Un turno non deve
             cambiare forma fra lo streaming e la riapertura. -->
        <ChatExpressionStickers calls={block.calls} />
        {#each block.calls as tc, ti (`${tc.toolCallId ?? 'md'}-${bi}-${ti}`)}
          {@const shown = mediaFromToolCall(tc)}
          {#if shown}
            <ChatMediaCard media={shown} />
          {/if}
        {/each}
      {/if}
    {/each}

    {#if loading}
      <!-- LA RIGA VIVA, in fondo a TUTTO: sotto le bolle, sotto le chip dei tool, sotto il
           ragionamento. È lo stato del turno, non di una frase — appenderla all'ultima bolla la
           lasciava sopra le chiamate arrivate dopo. Resta lì per tutta la durata del caricamento,
           e se ne va quando il turno finisce. -->
      <div class="live-row" transition:dot>
        <AgentAvatar
          {face}
          {color}
          size={28}
          busy={loading}
          cycle={loading}
          alive
          follow="pointer"
        />
        <span class="live-time">{formatChatDuration(silentMs)}</span>
        <span class="live-label shimmer">{statusLabel}</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .live-status {
    display: flex;
    flex-direction: column;
    /* Lo stesso respiro fra i blocchi che avranno a turno chiuso, senza riscrivere il numero:
       il turno vivo e quello finito stanno nello STESSO contenitore (`.chat-turn`), quindi
       ereditarlo è l'unico modo di non vederli divergere al primo che cambia. Erano 0.5rem
       contro gli 0.75 del turno finito: ogni blocco si ridistanziava alla fine dello stream. */
    gap: inherit;
    align-self: stretch;
    width: 100%;
  }
  /* Solo per chi NON ha un turno finito con cui somigliarsi: le workbench dei maker mostrano
     questo e basta, quindi lì la misura stretta è una scelta e non una divergenza. */
  .live-status.compact {
    gap: 0.4rem;
  }
  .live-row :global(.brandmark) {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    opacity: 0.9;
  }
  .live-label.shimmer {
    background: linear-gradient(
      105deg,
      color-mix(in srgb, var(--ink-faint, #86868b) 85%, transparent) 0%,
      color-mix(in srgb, var(--ink-faint, #86868b) 85%, transparent) 35%,
      var(--ink, #1d1d1f) 50%,
      color-mix(in srgb, var(--ink-faint, #86868b) 85%, transparent) 65%,
      color-mix(in srgb, var(--ink-faint, #86868b) 85%, transparent) 100%
    );
    background-size: 220% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: live-shimmer 1.7s ease-in-out infinite;
  }
  @keyframes live-shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }
  /* La riga viva: avatar a sinistra, poi tempo ed etichetta. Figlia diretta del turno, quindi
     parte dal bordo sinistro della colonna — sotto le bolle, che invece sono rientrate. */
  .live-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }
  .live-time {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--ink-faint, #86868b);
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  /* Passare sopra la risposta che sta arrivando — il volto o la bolla, non solo la riga in
     fondo — scopre stato e tempo: è lì che l'occhio va a chiedere «sta ancora lavorando?». */
  .live-row:hover .live-time,
  .live-row:focus-within .live-time,
  .live-row:hover .live-time {
    opacity: 1;
  }
  .live-label {
    font-size: 12.5px;
    font-weight: 550;
    letter-spacing: 0.01em;
    line-height: 1.2;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .live-row:hover .live-label,
  .live-row:focus-within .live-label {
    opacity: 1;
  }
  /* Senza hover (touch) l'etichetta resta nascosta: avatar + tempo bastano. */
</style>
