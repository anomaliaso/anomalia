<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { Target, ChevronDown } from '@lucide/svelte';
  import ChatGoalCriteria from './ChatGoalCriteria.svelte';

  /**
   * L'obiettivo che l'agente si è dato, appuntato in cima alla conversazione.
   *
   * Non è una barra di avanzamento: è la promessa contro cui l'utente può misurare la risposta. Per
   * questo mostra i criteri con le loro parole e non una percentuale — "3/5" dice quanto manca,
   * "restano le copertine degli articoli" dice cosa manca, ed è l'unica delle due che permette di
   * dire "no, quello lascialo stare".
   *
   * Sta in alto e resta lì mentre il turno scorre, perché il momento in cui serve è esattamente
   * quello in cui la chat produce testo più in fretta di quanto si legga.
   */
  type Criterion = { id: string; text: string; status: string; note?: string | null };
  type Goal = {
    id: string;
    statement: string;
    criteria: Criterion[];
    status: string;
    laps?: number;
    closing_note?: string | null;
  };

  let { goal }: { goal: Goal } = $props();

  const criteria = $derived(goal.criteria ?? []);
  const counted = $derived(criteria.filter((c) => c.status !== 'dropped'));
  const done = $derived(criteria.filter((c) => c.status === 'done').length);
  const isOpen = $derived(goal.status === 'open');
  const isMet = $derived(goal.status === 'met');

  // Un obiettivo chiuso bene non ha più bisogno di occupare mezzo schermo: si apre se interessa.
  let expanded = $state(true);
  $effect(() => {
    expanded = goal.status === 'open' || goal.status === 'handed_back';
  });

  const stateLabel = $derived(
    isMet
      ? $_('chat.goal.reached')
      : goal.status === 'handed_back'
        ? $_('chat.goal.stopped')
        : goal.status === 'abandoned'
          ? $_('chat.goal.dropped')
          : $_('chat.goal.label')
  );
</script>

<div class="goal-card" class:is-met={isMet} class:is-stopped={goal.status === 'handed_back'}>
  <button
    type="button"
    class="goal-head"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    <span class="goal-icon"><Target size={15} strokeWidth={1.8} /></span>
    <span class="goal-heading">
      <span class="goal-label">{stateLabel}</span>
      <span class="goal-statement">{goal.statement}</span>
    </span>
    <span class="goal-count">{done}/{counted.length}</span>
    <span class="goal-chevron" class:is-open={expanded}><ChevronDown size={14} /></span>
  </button>

  {#if expanded}
    <div class="goal-list"><ChatGoalCriteria {criteria} /></div>

    {#if goal.closing_note && !isOpen}
      <p class="goal-foot">{goal.closing_note}</p>
    {:else if isOpen && (goal.laps ?? 0) > 0}
      <p class="goal-foot">{$_('chat.goal.resumes', { values: { count: goal.laps ?? 0 } })}</p>
    {/if}
  {/if}
</div>

<style>
  .goal-card {
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line));
    background: color-mix(in srgb, var(--accent) 5%, var(--paper-2));
    border-radius: 0.85rem;
    overflow: hidden;
  }
  .goal-card.is-met {
    border-color: var(--line);
    background: var(--paper-2);
  }
  .goal-card.is-stopped {
    border-color: color-mix(in srgb, var(--amber) 45%, var(--line));
    background: color-mix(in srgb, var(--amber) 6%, var(--paper-2));
  }

  .goal-head {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    background: none;
    border: 0;
    text-align: left;
    color: var(--ink);
    cursor: pointer;
  }
  .goal-icon {
    display: inline-flex;
    padding-top: 0.15rem;
    color: var(--accent);
    flex-shrink: 0;
  }
  .is-met .goal-icon {
    color: var(--ink-faint);
  }
  .is-stopped .goal-icon {
    color: var(--amber);
  }
  .goal-heading {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    flex: 1;
    min-width: 0;
  }
  .goal-label {
    font-size: 0.62rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .goal-statement {
    font-size: 0.82rem;
    line-height: 1.35;
    color: var(--ink);
  }
  .goal-count {
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
    padding-top: 0.55rem;
    flex-shrink: 0;
  }
  .goal-chevron {
    display: inline-flex;
    padding-top: 0.5rem;
    color: var(--ink-faint);
    transition: transform 0.18s var(--ease);
    flex-shrink: 0;
  }
  .goal-chevron.is-open {
    transform: rotate(180deg);
  }

  /* Solo la scatola: i criteri e i loro segni stanno in ChatGoalCriteria, che eredita da qui la
     dimensione del testo. */
  .goal-list {
    padding: 0 0.75rem 0.35rem 0.75rem;
    font-size: 0.78rem;
  }
  .goal-foot {
    margin: 0;
    padding: 0 0.75rem 0.6rem 2.05rem;
    font-size: 0.72rem;
    color: var(--ink-faint);
  }
</style>
