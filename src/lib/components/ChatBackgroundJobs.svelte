<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';
  import { _ } from 'svelte-i18n';
  import { slide } from 'svelte/transition';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Sheet from '$lib/components/ui/sheet';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import { backgroundJobLabel } from '$lib/chat-parts';
  import type { BackgroundToolJob } from '$lib/stores/chat-session';

  /**
   * I lavori che continuano fuori dal turno (render, audit, piano settimanale…).
   *
   * Prima erano un blocco dentro il transcript: tre pallini che rimbalzano, la frase "Working in
   * the background… you can leave and come back" e una pill per job. Occupava una card, e appena
   * la conversazione scorreva spariva — proprio l'informazione che serve mentre si aspetta.
   * Ora è UNA riga quieta accanto al prompt (fuori dallo scroll, quindi sempre visibile) che dice
   * solo quanti sono; il dettaglio sta dietro un click, con la stessa meccanica di ChatToolChips:
   * dialog su desktop, bottom sheet su mobile.
   */
  let {
    jobs = [] as BackgroundToolJob[],
    /** Il watcher sa che c'è lavoro prima di avere la lista: la riga non deve aspettarla. */
    active = false
  }: {
    jobs?: BackgroundToolJob[];
    active?: boolean;
  } = $props();

  const isMobile = new IsMobile();
  let open = $state(false);

  const visible = $derived(active || jobs.length > 0);
  /** Se la lista non è ancora arrivata ma qualcosa gira, "1" è più onesto di "0". */
  const countLabel = $derived(
    $_('chat.backgroundJob', { values: { n: jobs.length || 1 } })
  );
</script>

{#if visible}
  <div class="bgj-wrap" transition:slide={{ duration: 140 }}>
    <button type="button" class="bgj-row" aria-haspopup="dialog" onclick={() => (open = true)}>
      <LoaderCircle class="bgj-icon spin" strokeWidth={2.2} />
      <span class="bgj-count">{countLabel}</span>
    </button>
  </div>

  {#snippet jobList()}
    <ul class="bgj-list">
      {#if jobs.length}
        {#each jobs as job (job.id)}
          <!-- Il lavoro DICE cosa sta facendo: `partial` lo scrive in diretta il runner. Prima qui
               c'era solo il nome del job, e durante un render di dieci minuti questo era l'unico
               posto dove guardare — e non diceva niente. -->
          <li class="bgj-item">
            <span class="bgj-name">{backgroundJobLabel(job, $_)}</span>
            {#if job.partial?.tools?.length}
              <span class="bgj-tools">
                {#each job.partial.tools.slice(-3) as t (t.toolName ?? '')}
                  <span class="bgj-tool" class:live={t.status === 'running'}>{t.toolName}</span>
                {/each}
              </span>
            {/if}
            {#if job.partial?.text?.trim()}
              <span class="bgj-text">{job.partial.text.trim().slice(-220)}</span>
            {/if}
          </li>
        {/each}
      {:else}
        <li class="bgj-item">{$_('chat.backgroundJob', { values: { n: 1 } })}</li>
      {/if}
    </ul>
  {/snippet}

  {#if isMobile.current}
    <Sheet.Root bind:open>
      <Sheet.Content side="bottom" class="flex flex-col gap-0 rounded-t-xl p-0">
        <Sheet.Header class="p-4 pb-2">
          <Sheet.Title class="text-sm font-semibold">{countLabel}</Sheet.Title>
        </Sheet.Header>
        {@render jobList()}
      </Sheet.Content>
    </Sheet.Root>
  {:else}
    <Dialog.Root bind:open>
      <Dialog.Content class="flex flex-col gap-0 p-0 sm:max-w-md">
        <Dialog.Header class="p-4 pb-2">
          <Dialog.Title class="text-sm font-semibold">{countLabel}</Dialog.Title>
        </Dialog.Header>
        {@render jobList()}
      </Dialog.Content>
    </Dialog.Root>
  {/if}
{/if}

<style>
  /* Il dettaglio di un lavoro: nome, gli ultimi strumenti toccati, e le sue ultime parole. */
  .bgj-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .bgj-name {
    font-weight: 500;
  }
  .bgj-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .bgj-tool {
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    background: var(--paper-2);
    color: var(--ink-soft);
  }
  /* Quello in corso è l'unico che cambia: il resto è storia. */
  .bgj-tool.live {
    color: var(--ink);
    font-weight: 600;
  }
  .bgj-text {
    font-size: 0.78rem;
    line-height: 1.35;
    color: var(--ink-soft);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Una riga sola, niente bordo né sfondo: stessa grammatica minimal di ChatToolChips. */
  .bgj-wrap {
    display: flex;
    padding: 0 0 0.15rem;
  }
  .bgj-row {
    appearance: none;
    background: none;
    border: none;
    padding: 0.1rem 0;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    max-width: 100%;
    font-family: inherit;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .bgj-count {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bgj-row:hover .bgj-count,
  .bgj-row:focus-visible .bgj-count {
    color: var(--ink);
  }

  :global(.bgj-icon) {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: var(--ink-faint);
  }
  :global(.bgj-icon.spin) {
    animation: bgj-spin 0.9s linear infinite;
  }
  @keyframes bgj-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.bgj-icon.spin) {
      animation: none;
    }
  }

  .bgj-list {
    list-style: none;
    margin: 0;
    padding: 0 1rem 1rem;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    max-height: min(60vh, 420px);
  }
  .bgj-item {
    padding: 9px 2px;
    font-size: 0.76rem;
    color: var(--ink-soft);
    overflow-wrap: anywhere;
  }
  .bgj-item + .bgj-item {
    border-top: 1px solid var(--line);
  }
</style>
