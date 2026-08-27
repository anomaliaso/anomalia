<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Check } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Sheet from '$lib/components/ui/sheet';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import ChatGoalCriteria from './ChatGoalCriteria.svelte';
  import type { GoalStatus } from '$lib/goal-status';

  /**
   * Il notice di fine turno dell'obiettivo — una RIGA, non un pannello.
   *
   * Prima era una card bordata; poi una riga che, aperta, srotolava in linea una lista di voci
   * tutte uguali dove la motivazione dello stop stava fra i criteri e i criteri già chiusi non
   * comparivano affatto ("0/5" seguito da cinque righe indistinguibili). Ora segue la grammatica
   * di ChatToolChips: in chat resta una riga sola che dice quanto manca, e il dettaglio — i
   * criteri col loro stato, il perché di uno stop — sta nel dialog (bottom sheet su mobile).
   *
   * I criteri li disegna ChatGoalCriteria, lo stesso pezzo che usa la card dell'obiettivo vivo:
   * spunta = fatto, cerchietto = aperto, barrato = lasciato cadere.
   */
  let { status, live = true }: { status: GoalStatus; live?: boolean } = $props();

  /** false = card storica (esistono messaggi successivi): niente riga di stato "vivo". */
  const stale = $derived(!live && (status.state === 'resuming' || status.state === 'waiting'));

  const pct = $derived(status.total > 0 ? status.done / status.total : 0);
  // Anello di avanzamento: r=6 → circonferenza ~37.7.
  const CIRC = 2 * Math.PI * 6;

  const isMet = $derived(status.state === 'met');

  const stateLine = $derived(
    status.state === 'resuming'
      ? $_('chat.goal.turn.resuming')
      : status.state === 'waiting'
        ? $_('chat.goal.turn.waiting')
        : $_('chat.goal.turn.stopped')
  );

  /** L'etichetta della riga: il lavoro che resta. A obiettivo chiuso, "0 task" sarebbe assurdo. */
  const countLabel = $derived(
    isMet
      ? $_('chat.goal.reached')
      : $_('chat.goal.turn.remaining', { values: { n: status.open.length } })
  );

  /**
   * L'avviso nomina i criteri chiusi in QUEL turno (pochi, e solo da oggi) più quelli aperti. Dei
   * chiusi PRIMA si conosce solo il numero — e degli avvisi vecchi, scritti quando il server non
   * nominava niente, si conosce solo quello: la riga di conteggio resta per loro, meglio di N
   * spunte inventate e onesta con la frazione.
   */
  const doneEarlier = $derived(Math.max(0, status.done - status.closed.length));
  const criteria = $derived([
    ...status.closed.map((text, i) => ({ id: `d${i}`, text, status: 'done' })),
    ...(doneEarlier > 0 && !isMet
      ? [
          {
            id: '_done',
            text: $_('chat.goal.turn.doneCount', { values: { count: doneEarlier } }),
            status: 'done'
          }
        ]
      : []),
    ...status.open.map((text, i) => ({ id: `o${i}`, text, status: 'open' }))
  ]);

  /** met: lo statement dell'obiettivo, in cima. stopped: il perché, staccato sotto i criteri. */
  const statement = $derived(isMet ? status.detail : null);
  const why = $derived(status.state === 'stopped' ? status.detail : null);
  const hasDetails = $derived(criteria.length > 0 || !!statement || !!why);

  const isMobile = new IsMobile();
  let detailsOpen = $state(false);
</script>

{#snippet body()}
  <div class="gd-body">
    {#if statement}
      <p class="gd-statement">{statement}</p>
    {/if}
    {#if criteria.length}
      <ChatGoalCriteria {criteria} />
    {/if}
    {#if why}
      <!-- La motivazione NON è un criterio: sta fuori dall'elenco, per posizione e per peso. -->
      <p class="gd-why">{why}</p>
    {/if}
  </div>
{/snippet}

<button
  type="button"
  class="gs-line"
  class:is-stopped={status.state === 'stopped'}
  disabled={!hasDetails}
  aria-haspopup="dialog"
  onclick={() => (detailsOpen = true)}
>
  {#if isMet}
    <span class="gs-badge"><Check size={11} strokeWidth={2.6} /></span>
  {:else}
    <svg class="gs-ring" viewBox="0 0 16 16" aria-hidden="true">
      <circle class="gs-ring-track" cx="8" cy="8" r="6" />
      <circle
        class="gs-ring-fill"
        cx="8"
        cy="8"
        r="6"
        stroke-dasharray={`${pct * CIRC} ${CIRC}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
    <span class="gs-name">{$_('chat.goal.label')}</span>
  {/if}
  <span class="gs-count">{countLabel}</span>
  {#if !stale && !isMet}
    <span class="gs-sep" aria-hidden="true">·</span>
    {#if status.state === 'resuming'}
      <span class="gs-state gs-shimmer">{stateLine}</span>
    {:else}
      <span class="gs-state">{stateLine}</span>
    {/if}
  {/if}
</button>

{#if hasDetails}
  {#if isMobile.current}
    <Sheet.Root bind:open={detailsOpen}>
      <Sheet.Content side="bottom" class="flex flex-col gap-0 rounded-t-xl p-0">
        <Sheet.Header class="p-4 pb-2">
          <Sheet.Title class="text-sm font-semibold">{countLabel}</Sheet.Title>
        </Sheet.Header>
        {@render body()}
      </Sheet.Content>
    </Sheet.Root>
  {:else}
    <Dialog.Root bind:open={detailsOpen}>
      <Dialog.Content class="flex flex-col gap-0 p-0 sm:max-w-lg">
        <Dialog.Header class="p-4 pb-2">
          <Dialog.Title class="text-sm font-semibold">{countLabel}</Dialog.Title>
        </Dialog.Header>
        {@render body()}
      </Dialog.Content>
    </Dialog.Root>
  {/if}
{/if}

<style>
  /* Evento di sistema, non contenuto del turno: sta al centro della colonna come le altre righe
     di servizio (azioni, fonti, DM), senza bordo né sfondo. Stessa riga di ChatToolChips. */
  .gs-line {
    appearance: none;
    background: none;
    border: none;
    padding: 0.15rem 0;
    margin: 2px 0;
    align-self: center;
    max-width: min(100%, 460px);
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    text-align: left;
    font-family: inherit;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .gs-line:disabled {
    cursor: default;
  }
  .gs-name {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ink);
    flex-shrink: 0;
  }
  .gs-count {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--ink-soft);
    flex-shrink: 0;
  }
  .gs-line:hover .gs-count,
  .gs-line:focus-visible .gs-count {
    color: var(--ink);
  }
  .gs-sep {
    color: var(--ink-faint);
    flex-shrink: 0;
  }
  .gs-state {
    font-size: 0.74rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .is-stopped .gs-state {
    color: color-mix(in srgb, var(--amber) 70%, var(--ink-soft));
  }

  .gs-ring {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }
  .gs-ring-track,
  .gs-ring-fill {
    fill: none;
    stroke-width: 2.4;
  }
  .gs-ring-track {
    stroke: color-mix(in srgb, var(--ink) 14%, transparent);
  }
  .gs-ring-fill {
    stroke: var(--accent);
    stroke-linecap: round;
  }
  .is-stopped .gs-ring-fill {
    stroke: var(--amber);
  }
  .gs-badge {
    display: inline-flex;
    color: var(--ink-soft);
    flex-shrink: 0;
  }

  /* Dentro il dialog: testo e spazio, nessun contenitore. */
  .gd-body {
    padding: 0 1rem 1rem;
    font-size: 0.82rem;
  }
  .gd-statement {
    margin: 0 0 0.7rem;
    line-height: 1.4;
    color: var(--ink);
  }
  .gd-why {
    margin: 0.85rem 0 0;
    padding-left: 1.28rem; /* allineata al testo dei criteri, non ai loro segni */
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--ink-faint);
  }

  /* Stesso shimmer della riga "Generating…" (ChatLiveStatus): il lavoro continua davvero. */
  .gs-shimmer {
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
    animation: gs-shimmer 1.7s ease-in-out infinite;
  }
  @keyframes gs-shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .gs-shimmer {
      animation: none;
      background: none;
      color: var(--ink-soft);
      -webkit-background-clip: initial;
      background-clip: initial;
    }
  }
</style>
