<script lang="ts">
  import { LoaderCircle, Check, X, ChevronRight, Copy } from '@lucide/svelte';
  import { _ } from 'svelte-i18n';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Sheet from '$lib/components/ui/sheet';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import { chipCalls, failedCallCount, toolLabel } from '$lib/chat-parts';
  import { toolCallDetail, type ToolCallDetail, type ToolPayloadView } from '$lib/chat-tool-detail';

  /**
   * The tool calls of one step of a turn. Used both while streaming (calls carry a live status)
   * and when replaying a saved turn (no status — a stored call has already run), so a finished
   * turn looks exactly like the one the user just watched.
   *
   * Prima era una barra di chip, una per call: in un turno pieno di tool pesava più del messaggio.
   * Ora è una RIGA quieta ("N azioni fatte", grammatica di ChatGoalStatusCard) che al click apre
   * i dettagli: dialog centrata su desktop, bottom sheet su mobile (stessi componenti ui/dialog e
   * ui/sheet del resto della chat — Esc, backdrop e focus li gestisce bits-ui). Dentro c'è la
   * stessa lista di prima: nome, stato, e per ogni call i params e il risultato, invariati.
   *
   * Il filtro dei tool muti (`chipCalls`) è QUI e non nei chiamanti: era copiato in ogni surface,
   * e quella a pagina piena si era dimenticata `set_expression` — stesso thread, sticker nella
   * colonna Overview e chip maiuscola nuda nella chat. Applicato dentro, non può più scollarsi.
   */
  type ChipCall = {
    toolCallId?: string;
    toolName: string;
    status?: 'running' | 'done' | 'error';
    input?: unknown;
    args?: unknown;
    output?: unknown;
    errorText?: unknown;
  };

  let {
    calls = [] as ChipCall[],
    /** Stream still open: calls with no status yet are the ones being executed right now. */
    live = false
  }: {
    calls?: ChipCall[];
    live?: boolean;
  } = $props();

  const keyOf = (tc: ChipCall, i: number) => tc.toolCallId || `tc-${i}`;

  const shown = $derived(chipCalls(calls));

  /** Params + result per call, recomputed with the calls so a running call opens the moment its
   *  output lands instead of waiting for the turn to end. */
  const details = $derived(
    new Map<string, ToolCallDetail>(
      shown.flatMap((tc, i) => {
        const d = toolCallDetail(tc);
        return d ? ([[keyOf(tc, i), d]] as Array<[string, ToolCallDetail]>) : [];
      })
    )
  );

  const isRunning = (tc: ChipCall) => tc.status === 'running' || (!tc.status && live);

  /** L'azione in corso adesso, mostrata come testo mutato accanto al conteggio: era
   *  l'informazione che davano le chip live (spinner + nome), e la riga non la perde. */
  const runningLabel = $derived(
    live ? (shown.filter(isRunning).map((tc) => toolLabel(tc.toolName)).at(-1) ?? '') : ''
  );
  const failed = $derived(failedCallCount(shown));
  const anyError = $derived(failed > 0);

  // «12 azioni fatte» era vero e taceva la sola cosa che contava. Vedi failedCallCount.
  const countLabel = $derived(
    failed > 0
      ? $_('chat.toolDetail.actionsSomeFailed', { values: { n: shown.length, failed } })
      : $_('chat.toolDetail.actionsDone', { values: { n: shown.length } })
  );

  /** Il breakpoint mobile della chat (lo stesso di is-mobile.svelte): sotto, bottom sheet. */
  const isMobile = new IsMobile();

  /** Dialog/sheet dei dettagli aperto. */
  let detailsOpen = $state(false);
  /** Call espanse dentro la lista, per chiave. Più di una può stare aperta — confrontare due
   *  call è il punto. */
  let open = $state(new Set<string>());
  /** Payload che l'utente ha chiesto di vedere per intero, oltre il cap di scroll. */
  let expanded = $state(new Set<string>());
  let copied = $state('');
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  function toggle(key: string) {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    open = next;
  }

  function toggleExpanded(key: string) {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expanded = next;
  }

  $effect(() => () => {
    if (copyTimer) clearTimeout(copyTimer);
  });

  async function copy(slot: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = slot;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = ''), 1400);
    } catch {
      /* clipboard blocked (insecure origin, denied permission) — the text is selectable anyway */
    }
  }

  const sizeLabel = (p: ToolPayloadView) =>
    $_('chat.toolDetail.chars', { values: { n: p.length.toLocaleString() } });
</script>

{#snippet statusIcon(tc: ChipCall)}
  {#if tc.status === 'error'}
    <X class="tc-icon is-error" strokeWidth={2.4} />
  {:else if isRunning(tc)}
    <LoaderCircle class="tc-icon spin" strokeWidth={2.2} />
  {:else}
    <Check class="tc-icon" strokeWidth={2.4} />
  {/if}
{/snippet}

{#snippet payloadSection(slotKey: string, label: string, view: ToolPayloadView)}
  <section class="tp-section">
    <header class="tp-section-head">
      <span class="tp-label">{label}</span>
      <span class="tp-size">{sizeLabel(view)}</span>
      <button type="button" class="tp-copy" onclick={() => copy(slotKey, view.text)}>
        <Copy class="tp-copy-icon" strokeWidth={2.2} />
        {copied === slotKey ? $_('chat.toolDetail.copied') : $_('chat.toolDetail.copy')}
      </button>
    </header>
    <pre class="tp-body" class:full={expanded.has(slotKey)} class:prose={!view.json}>{view.text}</pre>
    {#if view.truncated}
      <p class="tp-note">{$_('chat.toolDetail.truncated')}</p>
    {/if}
    {#if view.long}
      <button type="button" class="tp-more" onclick={() => toggleExpanded(slotKey)}>
        {expanded.has(slotKey) ? $_('chat.toolDetail.collapse') : $_('chat.toolDetail.expand')}
      </button>
    {/if}
  </section>
{/snippet}

{#snippet callList()}
  <div class="tc-list">
    {#each shown as tc, ti (keyOf(tc, ti))}
      {@const key = keyOf(tc, ti)}
      {@const detail = details.get(key)}
      <div class="tc-item">
        {#if detail}
          <button
            type="button"
            class="tc-item-head openable"
            aria-expanded={open.has(key)}
            aria-controls={`tool-panel-${key}`}
            title={$_('chat.toolDetail.toggle', { values: { tool: toolLabel(tc.toolName) } })}
            onclick={() => toggle(key)}
          >
            {@render statusIcon(tc)}
            <span class="tc-item-name">{toolLabel(tc.toolName).toUpperCase()}</span>
            <span class="tc-chev" class:open={open.has(key)} aria-hidden="true">
              <ChevronRight size={13} strokeWidth={2} />
            </span>
          </button>
        {:else}
          <!-- Call consegnata col solo nome (log compatto del post editor, riga legacy):
               niente da aprire, resta testo. -->
          <span class="tc-item-head">
            {@render statusIcon(tc)}
            <span class="tc-item-name">{toolLabel(tc.toolName).toUpperCase()}</span>
          </span>
        {/if}

        {#if detail && open.has(key)}
          <div class="tool-panel" id={`tool-panel-${key}`}>
            <div class="tp-head">
              <code class="tp-name">{tc.toolName}</code>
              {#if isRunning(tc)}
                <span class="tp-state running">{$_('chat.toolDetail.pending')}</span>
              {/if}
            </div>

            {#if detail.error}
              <p class="tp-error">{detail.error}</p>
            {/if}

            {#if detail.input}
              {@render payloadSection(`${key}:input`, $_('chat.toolDetail.params'), detail.input)}
            {/if}
            {#if detail.output}
              {@render payloadSection(`${key}:output`, $_('chat.toolDetail.result'), detail.output)}
            {:else if !detail.error}
              <p class="tp-note">{$_('chat.toolDetail.noResultYet')}</p>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/snippet}

{#if shown.length}
  <button type="button" class="tc-row" aria-haspopup="dialog" onclick={() => (detailsOpen = true)}>
    {#if live && runningLabel}
      <LoaderCircle class="tc-icon spin" strokeWidth={2.2} />
    {:else if anyError}
      <X class="tc-icon is-error" strokeWidth={2.4} />
    {:else}
      <Check class="tc-icon" strokeWidth={2.4} />
    {/if}
    <span class="tc-count">{countLabel}</span>
    {#if live && runningLabel}
      <span class="tc-sep" aria-hidden="true">·</span>
      <span class="tc-running tc-shimmer">{runningLabel}</span>
    {/if}
  </button>

  {#if isMobile.current}
    <Sheet.Root bind:open={detailsOpen}>
      <Sheet.Content side="bottom" class="flex flex-col gap-0 rounded-t-xl p-0">
        <Sheet.Header class="p-4 pb-2">
          <Sheet.Title class="text-sm font-semibold">{countLabel}</Sheet.Title>
        </Sheet.Header>
        {@render callList()}
      </Sheet.Content>
    </Sheet.Root>
  {:else}
    <Dialog.Root bind:open={detailsOpen}>
      <Dialog.Content class="flex flex-col gap-0 p-0 sm:max-w-xl">
        <Dialog.Header class="p-4 pb-2">
          <Dialog.Title class="text-sm font-semibold">{countLabel}</Dialog.Title>
        </Dialog.Header>
        {@render callList()}
      </Dialog.Content>
    </Dialog.Root>
  {/if}
{/if}

<style>
  /* La riga chiusa: stessa grammatica di ChatGoalStatusCard — testo piccolo, --ink-soft,
     niente bordo né sfondo. Evento di sistema, quindi CENTRATA nella colonna (i wrapper
     sono flex column); niente chevron — l'affordance è l'hover che scurisce il testo. */
  .tc-row {
    appearance: none;
    background: none;
    border: none;
    padding: 0.15rem 0;
    margin: 2px 0;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    max-width: 100%;
    text-align: left;
    font-family: inherit;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .tc-count {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--ink-soft);
    flex-shrink: 0;
  }
  .tc-row:hover .tc-count,
  .tc-row:focus-visible .tc-count {
    color: var(--ink);
  }
  .tc-sep {
    color: var(--ink-faint);
    flex-shrink: 0;
  }
  .tc-running {
    font-size: 0.74rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .tc-chev {
    display: inline-flex;
    color: var(--ink-faint);
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }
  .tc-chev.open {
    transform: rotate(90deg);
  }

  :global(.tc-icon) {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: var(--ink-faint);
  }
  :global(.tc-icon.is-error) {
    color: #b91c1c;
  }
  :global(.tc-icon.spin) {
    animation: tc-spin 0.85s linear infinite;
  }
  @keyframes tc-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Stesso shimmer della riga Goal (ChatGoalStatusCard): il lavoro continua davvero. */
  .tc-shimmer {
    background: linear-gradient(
      105deg,
      color-mix(in srgb, var(--ink-faint) 85%, transparent) 0%,
      color-mix(in srgb, var(--ink-faint) 85%, transparent) 35%,
      var(--ink) 50%,
      color-mix(in srgb, var(--ink-faint) 85%, transparent) 65%,
      color-mix(in srgb, var(--ink-faint) 85%, transparent) 100%
    );
    background-size: 220% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: tc-shimmer 1.7s ease-in-out infinite;
  }
  @keyframes tc-shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tc-shimmer {
      animation: none;
      background: none;
      color: var(--ink-soft);
      -webkit-background-clip: initial;
      background-clip: initial;
    }
    :global(.tc-icon.spin) {
      animation: none;
    }
  }

  /* La lista dentro dialog/sheet. Scrolla lei, non la pagina. */
  .tc-list {
    display: flex;
    flex-direction: column;
    padding: 0 1rem 1rem;
    overflow-y: auto;
    max-height: min(65vh, 520px);
  }
  .tc-item + .tc-item {
    border-top: 1px solid var(--line);
  }
  .tc-item-head {
    appearance: none;
    background: none;
    border: none;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 2px;
    font-family: inherit;
    text-align: left;
    color: var(--ink-soft);
  }
  .tc-item-head.openable {
    cursor: pointer;
  }
  .tc-item-head.openable:hover,
  .tc-item-head.openable:focus-visible {
    color: var(--ink);
  }
  .tc-item-name {
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.03em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .tc-item-head .tc-chev {
    margin-left: auto;
  }

  /* Il pannello dei dettagli: la stessa resa di prima (params/result/copy), spostata qui. */
  .tool-panel {
    margin: 0 0 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper-2);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 100%;
    overflow: hidden;
  }
  .tp-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tp-name {
    font-size: 11px;
    font-weight: 650;
    color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .tp-state.running {
    font-size: 10.5px;
    color: var(--ink-soft);
  }
  .tp-error {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: #b91c1c;
    background: color-mix(in oklab, #dc2626 8%, transparent);
    border-radius: 6px;
    padding: 6px 8px;
    word-break: break-word;
  }
  .tp-section {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .tp-section-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tp-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .tp-size {
    font-size: 10px;
    color: var(--ink-soft);
    opacity: 0.75;
    margin-right: auto;
  }
  .tp-copy,
  .tp-more {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--ink-soft);
    background: none;
    border: none;
    padding: 2px 4px;
    border-radius: 5px;
    cursor: pointer;
  }
  .tp-copy:hover,
  .tp-more:hover {
    color: var(--ink);
    background: color-mix(in oklab, var(--ink) 6%, transparent);
  }
  :global(.tp-copy .tp-copy-icon) {
    width: 11px;
    height: 11px;
  }
  .tp-more {
    align-self: flex-start;
  }
  .tp-body {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 8px 10px;
    max-height: 220px;
    overflow: auto;
    white-space: pre;
    tab-size: 2;
  }
  .tp-body.prose {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    font-size: 12px;
  }
  .tp-body.full {
    max-height: none;
  }
  .tp-note {
    margin: 0;
    font-size: 10.5px;
    color: var(--ink-soft);
  }
</style>
