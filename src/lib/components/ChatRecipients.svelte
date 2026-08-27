<script lang="ts">
  /**
   * IL CAMPO "A" — a chi sto scrivendo, sopra il composer.
   *
   * Prima il destinatario era un bottoncino dentro la barra dei controlli del prompt, in fila
   * con modello e ragionamento: diceva "impostazione", non "interlocutore". Qui è un campo a sé,
   * staccato ma della stessa famiglia visiva del composer, e i destinatari sono chip con volto e
   * nome — l'intestazione di una mail, non un menu a tendina.
   *
   * NON c'è una seconda macchina sotto: le chiavi che escono da qui sono le stesse del picker
   * (`content`, `custom:<uuid>`), e con due o più diventano `room_agents` al primo invio, dove
   * il server le rinormalizza con `parseRoomAgents`. Questo componente non decide niente sul
   * thread: alza la mano, e ChatColumn traduce.
   */
  import { _ } from 'svelte-i18n';
  import { Plus, X, Check } from '@lucide/svelte';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { BUILTIN_AGENT_AVATARS, hoverFaceFor } from '$lib/agent-avatars';

  let {
    keys = [],
    agentOptions = [],
    customAgents = [],
    /**
     * GROUP_CHATS. Spento: il campo resta a UN destinatario e sceglierne un altro sostituisce
     * quello che c'è — nessuna spunta, nessun conto, nessuna promessa che il server rifiuterebbe.
     */
    groupEnabled = false,
    disabled = false,
    onchange = (_keys: string[]) => {}
  }: {
    keys?: string[];
    agentOptions?: Array<{ id: string }>;
    customAgents?: Array<{ id: string; name: string; face: string; color: string }>;
    groupEnabled?: boolean;
    disabled?: boolean;
    onchange?: (keys: string[]) => void;
  } = $props();

  /** Lo stesso tetto di ROOM_MAX_MEMBERS lato server (`$lib/server/chat/room.ts`), che di qui
   *  non si può importare. Oltre, il prompt del router smette di essere corto. */
  const MAX = 4;
  /*
   * ANOMALIA È UN MEMBRO COME GLI ALTRI, e per questo qui dentro non c'è nessun caso particolare.
   *
   * Prima non lo era: `AGENT_IDS` non contiene `auto` (non è un mestiere, è il caso "nessuna
   * specializzazione, tutti i tool"), quindi `parseRoomAgents` la scartava — e questo componente
   * applicava il vincolo del server togliendole il chip appena entrava uno specialista. L'utente
   * premeva "+" per AGGIUNGERE e si ritrovava un destinatario in meno, senza una parola.
   * Ora `parseRoomAgents` accetta `auto` e `roomRoster` le dà nome, volto e la riga che il router
   * legge: in stanza è la voce che risponde quando la richiesta non è di nessuno specialista.
   */

  /** La soglia oltre la quale l'elenco si cerca invece di scorrerlo. */
  const SEARCH_FROM = 8;

  type Option = { key: string; name: string; face: string; color: string; desc: string };

  let open = $state(false);
  let q = $state('');
  let hovered = $state<string | null>(null);
  let rootEl = $state<HTMLDivElement>();
  let searchEl = $state<HTMLInputElement>();

  const builtins = $derived<Option[]>(
    agentOptions.map((a) => {
      const av = BUILTIN_AGENT_AVATARS[a.id] ?? BUILTIN_AGENT_AVATARS.auto;
      return {
        key: a.id,
        name: $_(`chat.agents.${a.id}.label`),
        face: av.face,
        color: av.color,
        desc: $_(`chat.agents.${a.id}.desc`)
      };
    })
  );
  const customs = $derived<Option[]>(
    customAgents.map((a) => ({
      key: `custom:${a.id}`,
      name: a.name,
      face: a.face,
      color: a.color,
      desc: ''
    }))
  );
  const byKey = $derived(new Map([...builtins, ...customs].map((o) => [o.key, o])));
  /** I chip seguono l'ORDINE delle chiavi scelte, non quello del catalogo. */
  const chips = $derived(keys.map((k) => byKey.get(k)).filter((o): o is Option => !!o));

  const needle = $derived(q.trim().toLowerCase());
  const match = (o: Option) => !needle || o.name.toLowerCase().includes(needle);
  const showSearch = $derived(builtins.length + customs.length > SEARCH_FROM);
  const full = $derived(groupEnabled && keys.length >= MAX);

  function close() {
    open = false;
    q = '';
  }

  function pick(key: string) {
    if (keys.includes(key)) {
      // Ripicchiare un destinatario già scelto lo toglie: la spunta è un interruttore.
      onchange(keys.filter((k) => k !== key));
      if (!groupEnabled) close();
      return;
    }
    if (!groupEnabled) {
      // Gruppo spento: un destinatario solo, e sceglierne un altro sostituisce. Qui la
      // sostituzione è l'unico gesto possibile, quindi non sorprende nessuno.
      onchange([key]);
      close();
      return;
    }
    if (keys.length >= MAX) return;
    // "+" AGGIUNGE. Sempre. Chi è già nel campo ci resta finché non lo si toglie con la ×.
    onchange([...keys, key]);
    q = '';
    searchEl?.focus();
  }

  function remove(key: string) {
    onchange(keys.filter((k) => k !== key));
  }

  function toggle() {
    open = !open;
    if (open) requestAnimationFrame(() => searchEl?.focus());
    else q = '';
  }

  // Click fuori / Escape: le stesse due uscite di ogni altro menu del composer.
  $effect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootEl?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="to-box" bind:this={rootEl}>
  <span class="to-label">{$_('chat.recipients.label')}</span>
  <div class="to-chips">
    {#each chips as c (c.key)}
      <!-- L'espressione cambia sotto il cursore: stessa faccia derivata dal seme che usano la
           sidebar e la pila degli avatar, e il morph lo fa già AgentAvatar da solo. -->
      <span
        class="to-chip"
        role="group"
        aria-label={c.name}
        onmouseenter={() => (hovered = c.key)}
        onmouseleave={() => (hovered = null)}
        onfocusin={() => (hovered = c.key)}
        onfocusout={() => (hovered = null)}
      >
        <AgentAvatar
          face={hovered === c.key ? hoverFaceFor(c.key) : c.face}
          color={c.color}
          size={18}
        />
        <span class="to-chip-n">{c.name}</span>
        <button
          type="button"
          class="to-x"
          {disabled}
          onclick={() => remove(c.key)}
          aria-label={$_('chat.recipients.remove')}
          title={$_('chat.recipients.remove')}
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      </span>
    {:else}
      <button type="button" class="to-empty" {disabled} onclick={toggle}>
        {$_('chat.recipients.empty')}
      </button>
    {/each}

    <button
      type="button"
      class="to-add"
      class:on={open}
      disabled={disabled || full}
      onclick={toggle}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={$_('chat.recipients.add')}
      title={full ? $_('chat.agents.groupHint') : $_('chat.recipients.add')}
    >
      <Plus size={14} strokeWidth={2.4} />
    </button>
  </div>

  {#if open}
    <div class="to-menu" role="listbox" aria-label={$_('chat.recipients.add')}>
      {#if showSearch}
        <input
          class="to-search"
          bind:this={searchEl}
          bind:value={q}
          type="text"
          placeholder={$_('chat.recipients.search')}
          aria-label={$_('chat.recipients.search')}
        />
      {/if}
      {#if groupEnabled && keys.length >= 1}
        <div class="to-hint">
          {keys.length < 2 ? $_('chat.agents.groupPick') : $_('chat.agents.groupHint')}
        </div>
      {/if}

      {#each builtins.filter(match) as o (o.key)}
        {@const on = keys.includes(o.key)}
        <button
          type="button"
          class="to-opt"
          class:sel={on}
          role="option"
          aria-selected={on}
          onclick={() => pick(o.key)}
        >
          <span class="to-opt-ico"><AgentAvatar face={o.face} color={o.color} size={22} /></span>
          <span class="to-opt-text">
            <span class="to-opt-lbl">{o.name}</span>
            <span class="to-opt-desc">{o.desc}</span>
          </span>
          {#if on}<span class="to-opt-check"><Check size={14} /></span>{/if}
        </button>
      {/each}

      {#if customs.filter(match).length}
        <div class="to-group">{$_('chat.agents.custom')}</div>
        {#each customs.filter(match) as o (o.key)}
          {@const on = keys.includes(o.key)}
          <button
            type="button"
            class="to-opt"
            class:sel={on}
            role="option"
            aria-selected={on}
            onclick={() => pick(o.key)}
          >
            <span class="to-opt-ico"><AgentAvatar face={o.face} color={o.color} size={22} /></span>
            <span class="to-opt-text"><span class="to-opt-lbl">{o.name}</span></span>
            {#if on}<span class="to-opt-check"><Check size={14} /></span>{/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Stessa superficie del composer (paper + line + ombra bassa), stesso raggio: un secondo
     riquadro della stessa famiglia, staccato di un respiro sopra la casella. */
  .to-box {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    padding: 7px 12px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 22px;
    box-shadow: 0 6px 28px rgba(0, 0, 0, 0.06);
  }
  .to-label {
    flex: none;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-faint, #a1a1a6);
  }
  .to-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .to-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 4px 0 6px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--paper-2, #f5f5f7);
    color: var(--ink, #1d1d1f);
    font-size: 12.5px;
    font-weight: 550;
    max-width: 200px;
  }
  .to-chip-n {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .to-x,
  .to-add,
  .to-empty {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--ink-soft, #6e6e73);
    font: inherit;
    cursor: pointer;
  }
  .to-x {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    flex: none;
  }
  .to-x:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 14%, transparent);
    color: var(--ink, #1d1d1f);
  }
  .to-add {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    border: 1px dashed var(--line);
    flex: none;
  }
  .to-add:hover:not(:disabled),
  .to-add.on {
    background: var(--paper-2, #f5f5f7);
    color: var(--ink, #1d1d1f);
    border-style: solid;
  }
  .to-add:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .to-empty {
    font-size: 12.5px;
    color: var(--ink-faint, #a1a1a6);
  }

  /* Verso l'ALTO come ogni altro menu del composer: il campo sta a metà schermo e un elenco che
     scende finisce sotto la piega, tagliato dal bordo della finestra invece che dal suo scroll. */
  .to-menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + 8px);
    z-index: 34;
    min-width: 268px;
    max-width: min(340px, 86vw);
    max-height: 340px;
    overflow-y: auto;
    padding: 6px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
  .to-search {
    width: 100%;
    height: 32px;
    margin-bottom: 4px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--paper-2, #f5f5f7);
    color: var(--ink, #1d1d1f);
    font: inherit;
    font-size: 13px;
    outline: none;
  }
  .to-search:focus {
    border-color: var(--accent);
  }
  .to-hint {
    padding: 4px 10px 8px;
    font-size: 11.5px;
    line-height: 1.35;
    color: var(--ink-soft, #6e6e73);
  }
  .to-group {
    padding: 8px 10px 4px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .to-opt {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    width: 100%;
    padding: 9px 10px;
    border: none;
    border-radius: 9px;
    background: none;
    color: var(--ink, #1d1d1f);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .to-opt:hover {
    background: var(--paper-2, #f5f5f7);
  }
  .to-opt.sel .to-opt-lbl {
    font-weight: 650;
  }
  .to-opt-ico {
    display: inline-flex;
    margin-top: 2px;
    flex-shrink: 0;
    color: var(--ink-soft, #6e6e73);
    line-height: 0;
  }
  .to-opt-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .to-opt-lbl {
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.25;
  }
  .to-opt-desc {
    font-size: 11.5px;
    color: var(--ink-soft, #6e6e73);
    line-height: 1.35;
  }
  .to-opt-check {
    display: inline-flex;
    align-items: center;
    margin-top: 2px;
    flex-shrink: 0;
    color: var(--ink-soft, #6e6e73);
  }
</style>
