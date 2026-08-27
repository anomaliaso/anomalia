<script lang="ts">
  import { goto } from '$app/navigation';
  import { openPageModal } from '$lib/components/PageModal.svelte';
  import { _ } from 'svelte-i18n';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Sheet from '$lib/components/ui/sheet';
  import ChatKnowledgePanel from '$lib/components/ChatKnowledgePanel.svelte';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import type { ChatSource } from '$lib/chat-sources';

  /**
   * Le fonti citate da un messaggio AI. Prima era una barra di chip ("Brand / GTM strategy …
   * +8 more") che pesava più del messaggio; ora è una RIGA quieta e centrata ("N fonti usate",
   * stessa grammatica di ChatToolChips) che al click apre l'elenco completo — dialog su
   * desktop, bottom sheet su mobile — dove ogni fonte resta cliccabile e nessuna è troncata.
   */
  let {
    sources = [],
    brandSlug
  }: {
    sources?: ChatSource[];
    brandSlug: string;
  } = $props();

  let open = $state(false);

  /**
   * Il documento aperto nel pannello a destra. Come le fonti `brand` che chiamano
   * `openPageModal`, una fonte knowledge NON è una destinazione: si legge sopra la
   * conversazione, l'URL non cambia.
   */
  let docOpen = $state(false);
  let docId = $state<string | null>(null);
  let docSection = $state('');
  let docTitle = $state('');

  /** Il breakpoint mobile della chat (lo stesso di ChatToolChips): sotto, bottom sheet. */
  const isMobile = new IsMobile();

  const countLabel = $derived($_('chat.sourcesUsed', { values: { n: sources.length } }));

  function sourceKey(src: ChatSource, i: number): string {
    if (src.kind === 'web' || src.kind === 'social' || src.kind === 'drive' || src.kind === 'notion') {
      return `${src.kind}:${src.url}`;
    }
    if (src.kind === 'knowledge') return `k:${src.documentId}:${src.chunkId ?? i}`;
    if (src.kind === 'brand') return `b:${src.href}:${i}`;
    return `m:${src.memoryId}`;
  }

  function kindLabel(kind: ChatSource['kind']): string {
    return $_('chat.sourceKind.' + kind, { default: kind });
  }

  function onClick(src: ChatSource) {
    // La navigazione chiude l'elenco: la fonte è la destinazione, non un dettaglio da tenere aperto.
    open = false;
    if (src.kind === 'web' || src.kind === 'social' || src.kind === 'drive' || src.kind === 'notion') {
      if (src.url.startsWith('/')) {
        void goto(src.url);
      } else {
        window.open(src.url, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    if (src.kind === 'brand') {
      // Legacy chips pointed at /blog which was never a route — blog lives under /site.
      const href = src.href.replace(/\/blog\/?$/, '/site');
      // Le fonti brand puntano anche a sezioni settings (prodotti, persone): su
      // desktop si aprono nella modal. Qui non c'è un <a> da intercettare — è un
      // <button> dentro uno Sheet/Popover che naviga a mano — quindi la modal va
      // chiesta esplicitamente. Se dice di no (mobile, fuori perimetro), si naviga.
      if (openPageModal(href)) return;
      void goto(href);
      return;
    }
    if (src.kind === 'knowledge') {
      // Il documento si legge SOPRA la conversazione, in un pannello a destra: prima
      // questo `goto` era l'ultima fonte che ti portava via dalla chat.
      docId = src.documentId;
      docSection = src.headingPath ?? '';
      docTitle = src.label;
      docOpen = true;
      return;
    }
    if (src.kind === 'memory') {
      // Un ricordo non è un documento: non c'è markdown da mostrare nel pannello, solo la
      // lista dei ricordi sulla pagina Knowledge. Stessa cura però — la si apre in overlay
      // come le fonti `brand`, e si naviga solo se la modal non può occuparsene (mobile).
      const href = `/app/${brandSlug}/knowledge`;
      if (openPageModal(href)) return;
      void goto(href);
    }
  }
</script>

{#snippet sourceList()}
  <div class="src-list">
    {#each sources as src, i (sourceKey(src, i))}
      <button type="button" class="src-item" title={src.label} onclick={() => onClick(src)}>
        <span class="src-kind">{kindLabel(src.kind)}</span>
        <span class="src-label">{src.label}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#if sources.length}
  <button type="button" class="src-row" aria-haspopup="dialog" onclick={() => (open = true)}>
    {countLabel}
  </button>

  {#if isMobile.current}
    <Sheet.Root bind:open>
      <Sheet.Content side="bottom" class="flex flex-col gap-0 rounded-t-xl p-0">
        <Sheet.Header class="p-4 pb-2">
          <Sheet.Title class="text-sm font-semibold">{$_('chat.sources')}</Sheet.Title>
        </Sheet.Header>
        {@render sourceList()}
      </Sheet.Content>
    </Sheet.Root>
  {:else}
    <Dialog.Root bind:open>
      <Dialog.Content class="flex flex-col gap-0 p-0 sm:max-w-md">
        <Dialog.Header class="p-4 pb-2">
          <Dialog.Title class="text-sm font-semibold">{$_('chat.sources')}</Dialog.Title>
        </Dialog.Header>
        {@render sourceList()}
      </Dialog.Content>
    </Dialog.Root>
  {/if}

  <ChatKnowledgePanel
    bind:open={docOpen}
    {brandSlug}
    documentId={docId}
    title={docTitle}
    headingPath={docSection}
  />
{/if}

<style>
  /* Evento di sistema: riga quieta CENTRATA, senza box/bordo/sfondo né chevron —
     stessa grammatica della riga "N azioni fatte" di ChatToolChips. */
  .src-row {
    appearance: none;
    background: none;
    border: none;
    padding: 0.15rem 0;
    margin: 2px 0;
    align-self: center;
    font-family: inherit;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--ink-soft);
    cursor: pointer;
    transition: color 0.12s ease;
  }
  .src-row:hover,
  .src-row:focus-visible {
    color: var(--ink);
  }

  /* L'elenco dentro dialog/sheet: tutte le fonti, nessun "+N more". Scrolla lui, non la pagina. */
  .src-list {
    display: flex;
    flex-direction: column;
    padding: 0 1rem 1rem;
    overflow-y: auto;
    max-height: min(65vh, 520px);
  }
  .src-item {
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
    cursor: pointer;
  }
  .src-item + .src-item {
    border-top: 1px solid var(--line);
  }
  .src-item:hover,
  .src-item:focus-visible {
    color: var(--ink);
  }
  .src-kind {
    flex-shrink: 0;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--ink-faint);
    font-size: 9.5px;
  }
  .src-label {
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
</style>
