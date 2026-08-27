<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { Clock3 } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Sheet from '$lib/components/ui/sheet';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { BUILTIN_AGENT_AVATARS, fallbackAvatarColor, fallbackAvatarFace } from '$lib/agent-avatars';
  import { parseRoutineOwner } from '$lib/agent-owners';
  import { describeSchedule } from '$lib/chat-agent-proposal';
  import type { ChatRoutineEvent } from '$lib/chat-routine-event';

  /**
   * IL CICLO DI VITA DI UNA ROUTINE, in chat.
   *
   * Quando in una conversazione nasce, cambia, si spegne, riparte o sparisce un incarico
   * ricorrente, il fatto merita una traccia che non scorra via con la prosa: una RIGA di sistema
   * centrata — `Nuova routine "X tech news radar"` — con la stessa grammatica quieta di
   * ChatToolChips ("N azioni fatte") e ChatSources ("N fonti usate"), e lo stesso modo di aprirsi:
   * dialog su desktop, bottom sheet su mobile.
   *
   * La riga dice anche PER CHI, quando la routine non è di chi parla ("Nuova routine per Web
   * Specialist"): è la differenza fra darsi del lavoro e darne a un collega, ed è invisibile in
   * qualsiasi frase abbastanza corta da stare in una riga di chat.
   *
   * Il testo è tutto qui, non nel payload (chat-routine-event.ts): un thread salvato mesi fa si
   * rilegge nella lingua di chi guarda, non in quella in cui è stato scritto. Le uniche stringhe
   * che arrivano dal server sono i "prima" di una modifica — quelli sono una fotografia, e una
   * fotografia non si traduce.
   */
  let { event }: { event: ChatRoutineEvent } = $props();

  let open = $state(false);

  /** Il breakpoint mobile della chat (lo stesso di ChatToolChips/ChatSources/ChatThought). */
  const isMobile = new IsMobile();

  /** "per gli altri": lo diciamo solo quando c'è davvero un altro. */
  const forOther = $derived(!event.self && !!event.ownerName);

  const label = $derived(
    forOther
      ? $_(`chat.routineEvent.${event.kind}For`, { values: { name: event.name, owner: event.ownerName } })
      : $_(`chat.routineEvent.${event.kind}`, { values: { name: event.name } })
  );

  // Faccia e colore del proprietario, dagli stessi cataloghi di ChatAgentProposalCard: un
  // avatar tirato a sorte dal nome del compito farebbe sembrare ogni routine un collega nuovo.
  const owner = $derived(parseRoutineOwner(event.agent));
  const builtin = $derived(owner?.kind === 'builtin' ? BUILTIN_AGENT_AVATARS[owner.agentId] : null);
  const face = $derived(builtin?.face ?? fallbackAvatarFace(event.ownerName || event.name));
  const color = $derived(builtin?.color ?? fallbackAvatarColor(event.ownerName || event.name));

  const schedule = $derived(describeSchedule(event.days, event.times, String($locale ?? 'en')));

  /** Il prossimo giro nella forma in cui una persona lo legge, o '' se non c'è. */
  const nextRun = $derived.by(() => {
    if (!event.nextRun) return '';
    const d = new Date(event.nextRun);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(String($locale ?? 'en'), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  });
</script>

{#snippet detail()}
  <div class="re-body">
    <div class="re-head">
      <AgentAvatar {face} {color} size={34} title={event.ownerName || event.name} />
      <div class="re-id">
        <strong>{event.name}</strong>
        <span>{event.ownerName || $_('chat.routineEvent.noOwner')}</span>
      </div>
    </div>

    <dl class="re-facts">
      {#if schedule}
        <dt>{$_('chat.routineEvent.cadence')}</dt>
        <dd>{schedule}</dd>
      {/if}
      {#if nextRun}
        <dt>{$_('chat.routineEvent.nextRun')}</dt>
        <dd>{nextRun}</dd>
      {/if}
      {#if event.by}
        <!-- Chi l'ha fatto: per uno spegnimento è la domanda che si fa per prima. -->
        <dt>{$_('chat.routineEvent.by')}</dt>
        <dd>{event.by}</dd>
      {/if}
    </dl>

    {#if event.changes.length}
      <section class="re-changes">
        <h4>{$_('chat.routineEvent.changed')}</h4>
        {#each event.changes as c (c.field)}
          <div class="re-change">
            <span class="re-field">{$_(`chat.routineEvent.field.${c.field}`, { default: c.field })}</span>
            <span class="re-from">{c.from}</span>
            <span class="re-arrow" aria-hidden="true">→</span>
            <span class="re-to">{c.to}</span>
          </div>
        {/each}
      </section>
    {/if}

    {#if event.prompt}
      <section class="re-brief">
        <h4>{$_('chat.routineEvent.brief')}</h4>
        <p>{event.prompt}</p>
      </section>
    {/if}
  </div>
{/snippet}

<button type="button" class="re-row" aria-haspopup="dialog" onclick={() => (open = true)}>
  <Clock3 class="re-icon" strokeWidth={2.2} />
  <span class="re-label">{label}</span>
</button>

{#if isMobile.current}
  <Sheet.Root bind:open>
    <Sheet.Content side="bottom" class="flex flex-col gap-0 rounded-t-xl p-0">
      <Sheet.Header class="p-4 pb-2">
        <Sheet.Title class="text-sm font-semibold">{label}</Sheet.Title>
      </Sheet.Header>
      {@render detail()}
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <Dialog.Root bind:open>
    <Dialog.Content class="flex flex-col gap-0 p-0 sm:max-w-lg">
      <Dialog.Header class="p-4 pb-2">
        <Dialog.Title class="text-sm font-semibold">{label}</Dialog.Title>
      </Dialog.Header>
      {@render detail()}
    </Dialog.Content>
  </Dialog.Root>
{/if}

<style>
  /* Evento di sistema: riga quieta CENTRATA, senza box/bordo/sfondo — identica a "N fonti usate"
     di ChatSources, più la lancetta che dice che si parla di lavoro ricorrente. */
  .re-row {
    appearance: none;
    background: none;
    border: none;
    padding: 0.15rem 0;
    margin: 2px 0;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    min-width: 0;
    font-family: inherit;
    color: var(--ink-soft);
    cursor: pointer;
    transition: color 0.12s ease;
  }
  .re-label {
    font-size: 0.76rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .re-row:hover,
  .re-row:focus-visible {
    color: var(--ink);
  }
  :global(.re-icon) {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: var(--ink-faint);
  }

  /* I dettagli dentro dialog/sheet. Scrolla lui, non la pagina sotto. */
  .re-body {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 0 1rem 1rem;
    overflow-y: auto;
    max-height: min(65vh, 560px);
  }
  .re-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .re-id {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .re-id strong {
    font-size: 13.5px;
    font-weight: 650;
    line-height: 1.2;
    color: var(--ink);
  }
  .re-id span {
    font-size: 11.5px;
    color: var(--ink-soft);
  }

  .re-facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
  }
  .re-facts dt {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    align-self: center;
  }
  .re-facts dd {
    margin: 0;
    font-size: 12.5px;
    color: var(--ink);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .re-changes,
  .re-brief {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .re-changes h4,
  .re-brief h4 {
    margin: 0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .re-change {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    font-size: 12.5px;
    line-height: 1.5;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 8px;
    min-width: 0;
  }
  .re-field {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-faint);
    flex-shrink: 0;
  }
  .re-from {
    color: var(--ink-soft);
    text-decoration: line-through;
    overflow-wrap: anywhere;
  }
  .re-arrow {
    color: var(--ink-faint);
    flex-shrink: 0;
  }
  .re-to {
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .re-brief p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    color: var(--ink);
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
    overflow-wrap: anywhere;
  }
</style>
