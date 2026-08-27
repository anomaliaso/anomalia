<script lang="ts">
  import { Check, Circle, Minus } from '@lucide/svelte';

  /**
   * I criteri di un obiettivo con la loro grammatica: spunta = fatto, cerchietto = ancora aperto,
   * trattino + barrato = lasciato cadere.
   *
   * Sta qui perché a mostrarli sono in due — ChatGoalCard (l'obiettivo vivo, appuntato in cima) e
   * ChatGoalStatusCard (la riga di fine turno) — ed erano due rese diverse della stessa cosa: una
   * con i segni di stato, l'altra una lista di righe tutte uguali in cui non si capiva nemmeno
   * quali fossero criteri. Due rese della stessa informazione divergono al primo ritocco.
   *
   * Niente cornice, niente fondo: sono righe di testo. La dimensione la eredita da chi la ospita
   * (`font-size: inherit`), così la card e la riga di chat restano ognuna col proprio peso senza
   * bisogno di un interruttore.
   */
  type Criterion = { id: string; text: string; status: string; note?: string | null };

  let { criteria }: { criteria: Criterion[] } = $props();
</script>

<ul class="gc-list">
  {#each criteria as c (c.id)}
    <li class="gc-item" class:is-done={c.status === 'done'} class:is-dropped={c.status === 'dropped'}>
      <span class="gc-mark">
        {#if c.status === 'done'}
          <Check size={13} strokeWidth={2.4} />
        {:else if c.status === 'dropped'}
          <Minus size={13} strokeWidth={2.4} />
        {:else}
          <Circle size={11} strokeWidth={2} />
        {/if}
      </span>
      <span class="gc-text">
        {c.text}
        {#if c.note}<span class="gc-note">{c.note}</span>{/if}
      </span>
    </li>
  {/each}
</ul>

<style>
  .gc-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .gc-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: inherit;
    line-height: 1.4;
    color: var(--ink);
    text-align: left;
  }
  .gc-mark {
    display: inline-flex;
    padding-top: 0.16rem;
    color: var(--ink-faint);
    flex-shrink: 0;
  }
  .gc-item.is-done .gc-mark {
    color: var(--accent);
  }
  .gc-item.is-done .gc-text,
  .gc-item.is-dropped .gc-text {
    color: var(--ink-soft);
  }
  .gc-item.is-dropped .gc-text {
    text-decoration: line-through;
    text-decoration-color: var(--ink-faint);
  }
  .gc-text {
    min-width: 0;
  }
  .gc-note {
    display: block;
    font-size: 0.92em;
    color: var(--ink-faint);
  }
</style>
