<script lang="ts">
  import PageHead from '$lib/components/PageHead.svelte';
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import {
    CONTRAST_DEVICES,
    DISRUPTIVE_TESTS,
    contrastDeviceById,
    type DisruptiveStatus
  } from '$lib/disruptive';
  import { ugcFormatById } from '$lib/ugc-formats';

  let { data, form } = $props();

  type Filter = 'live' | DisruptiveStatus | 'all';
  let filter = $state<Filter>('live');
  let addOpen = $state(false);
  let openDevices = $state(false);

  const STATUS_LABEL: Record<DisruptiveStatus, string> = {
    new: 'Nuova',
    shortlisted: 'In lista',
    used: 'Usata',
    archived: 'Archiviata'
  };

  /** Il load lo popola sempre; il fallback tiene in piedi la pagina se un giorno non lo facesse. */
  const ideas = $derived(data.ideas ?? []);

  const filtered = $derived(
    ideas.filter((i) => {
      if (filter === 'all') return true;
      if (filter === 'live') return i.status === 'new' || i.status === 'shortlisted';
      return i.status === filter;
    })
  );

  const counts = $derived({
    live: ideas.filter((i) => i.status === 'new' || i.status === 'shortlisted').length,
    used: ideas.filter((i) => i.status === 'used').length,
    archived: ideas.filter((i) => i.status === 'archived').length,
    all: ideas.length
  });

  function when(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return '';
    }
  }
</script>

<svelte:head><title>Anomalia — {$_('ideas.title', { default: 'Banco idee' })}</title></svelte:head>

<div class="content">
  <PageHead
    title={$_('ideas.title', { default: 'Banco idee' })}
    subtitle={$_('ideas.subtitle', {
      default:
        'Le idee dirompenti che gli agenti salvano mentre lavorano — qui si ripescano, si mettono in lista e si segnano come usate.'
    })}
  />

  {#if form?.error}<p class="err">{$_('ideas.error', { default: 'Operazione non riuscita.' })}</p>{/if}

  <section class="card">
    <h3 class="card-t">{$_('ideas.testsTitle', { default: 'I tre test' })}</h3>
    <p class="card-s">
      Un'idea entra nel banco solo se li passa tutti e tre. Vale per gli agenti e vale per te.
    </p>
    <ul class="tests">
      {#each DISRUPTIVE_TESTS as t (t.key)}
        <li><b>{t.label}</b> — {t.question} <span class="fail">{t.fail}</span></li>
      {/each}
    </ul>
    <button type="button" class="linkish" onclick={() => (openDevices = !openDevices)}>
      {openDevices ? 'Nascondi' : 'Mostra'} le dodici leve di contrasto
    </button>
    {#if openDevices}
      <ul class="devices">
        {#each CONTRAST_DEVICES as d (d.id)}
          <li>
            <b>{d.label}</b> — {d.what}
            <div class="ex">Es: {d.example}</div>
            <div class="limit">Limite: {d.limit}</div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <div class="bar">
    <div class="tabs">
      {#each [['live', `Da girare (${counts.live})`], ['used', `Usate (${counts.used})`], ['archived', `Archiviate (${counts.archived})`], ['all', `Tutte (${counts.all})`]] as [key, label] (key)}
        <button
          type="button"
          class="tab"
          class:on={filter === key}
          onclick={() => (filter = key as Filter)}
        >
          {label}
        </button>
      {/each}
    </div>
    <button type="button" class="add-btn" onclick={() => (addOpen = !addOpen)}>
      {addOpen ? 'Chiudi' : 'Aggiungi idea'}
    </button>
  </div>

  {#if addOpen}
    <section class="card">
      <form
        method="POST"
        action="?/add"
        use:enhance={() =>
          async ({ update }) => {
            addOpen = false;
            await update();
          }}
      >
        <div class="grid2">
          <label class="field">
            <span>Titolo</span>
            <input type="text" name="title" required placeholder="La maglia che brucia" />
          </label>
          <label class="field">
            <span>Leva di contrasto</span>
            <select name="device">
              <option value="">—</option>
              {#each CONTRAST_DEVICES as d (d.id)}
                <option value={d.id}>{d.label}</option>
              {/each}
            </select>
          </label>
        </div>
        <label class="field">
          <span>L'idea — cosa si VEDE, non cosa si comunica</span>
          <textarea name="idea" rows="3" required></textarea>
        </label>
        <div class="grid2">
          <label class="field">
            <span>Perché rompe l'aspettativa</span>
            <input type="text" name="why_it_contrasts" />
          </label>
          <label class="field">
            <span>A chi dà fastidio</span>
            <input type="text" name="who_it_annoys" />
          </label>
        </div>
        <button type="submit" class="primary">Salva nel banco</button>
      </form>
    </section>
  {/if}

  {#if filtered.length === 0}
    <section class="card empty">
      <p>
        {#if ideas.length === 0}
          Nessuna idea ancora. Gli agenti ne salvano una ogni volta che ne pensano una che passa i tre
          test — chiedine una in chat, o aggiungila a mano.
        {:else}
          Niente in questa vista.
        {/if}
      </p>
    </section>
  {:else}
    <div class="ideas">
      {#each filtered as idea (idea.id)}
        <article class="idea" class:used={idea.status === 'used'} class:archived={idea.status === 'archived'}>
          <div class="i-head">
            <h4>{idea.title}</h4>
            <span class="chips">
              {#if idea.score != null}<span class="chip score">{idea.score}</span>{/if}
              <span class="chip">{STATUS_LABEL[idea.status]}</span>
            </span>
          </div>
          <p class="i-body">{idea.idea}</p>
          <ul class="i-meta">
            {#if idea.device}
              <li><b>Leva:</b> {contrastDeviceById(idea.device)?.label ?? idea.device}</li>
            {/if}
            {#if idea.why_it_contrasts}<li><b>Contrasto:</b> {idea.why_it_contrasts}</li>{/if}
            {#if idea.who_it_annoys}<li><b>Infastidisce:</b> {idea.who_it_annoys}</li>{/if}
            {#if idea.format}
              <li><b>Formato:</b> {ugcFormatById(idea.format)?.label ?? idea.format}</li>
            {/if}
          </ul>
          <div class="i-foot">
            <span class="origin">
              {idea.surface ?? 'app'}{idea.agent ? ` · ${idea.agent}` : ''} · {when(idea.created_at)}
            </span>
            <span class="acts">
              {#each [['shortlisted', 'In lista'], ['used', 'Usata'], ['archived', 'Archivia'], ['new', 'Riapri']] as [status, label] (status)}
                {#if idea.status !== status}
                  <form method="POST" action="?/setStatus" use:enhance>
                    <input type="hidden" name="id" value={idea.id} />
                    <input type="hidden" name="status" value={status} />
                    <button type="submit" class="mini">{label}</button>
                  </form>
                {/if}
              {/each}
              <form method="POST" action="?/remove" use:enhance>
                <input type="hidden" name="id" value={idea.id} />
                <button type="submit" class="mini danger">Elimina</button>
              </form>
            </span>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .content {
    max-width: 1040px;
    margin: 0 auto;
    padding: 0 16px 80px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--paper);
    padding: 14px 16px;
  }
  .card-t {
    margin: 0 0 4px;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--ink);
  }
  .card-s {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--ink-soft);
  }
  .err {
    color: #b3261e;
    font-size: 13px;
    margin: 0;
  }

  .tests,
  .devices {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--ink-soft);
    line-height: 1.5;
  }
  .tests .fail {
    color: var(--ink-faint);
  }
  .devices {
    margin-top: 10px;
    gap: 10px;
  }
  .devices .ex,
  .devices .limit {
    font-size: 12px;
    color: var(--ink-faint);
    margin-top: 2px;
  }
  .linkish {
    margin-top: 10px;
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font-size: 12.5px;
    cursor: pointer;
  }

  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tab {
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink-soft);
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 12.5px;
    cursor: pointer;
  }
  .tab.on {
    border-color: var(--accent);
    color: var(--ink);
  }
  .add-btn,
  .primary {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--paper);
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 12.5px;
    cursor: pointer;
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  @media (max-width: 640px) {
    .grid2 {
      grid-template-columns: 1fr;
    }
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
  .field span {
    font-size: 12px;
    color: var(--ink-soft);
  }
  .field input,
  .field select,
  .field textarea {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 9px;
    font: inherit;
    font-size: 13px;
    background: var(--paper);
    color: var(--ink);
  }

  .ideas {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 10px;
  }
  .idea {
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--paper);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .idea.used,
  .idea.archived {
    opacity: 0.62;
  }
  .i-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .i-head h4 {
    margin: 0;
    font-size: 14px;
    color: var(--ink);
  }
  .chips {
    display: flex;
    gap: 4px;
    flex: 0 0 auto;
  }
  .chip {
    font-size: 10.5px;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 1px 7px;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .chip.score {
    border-color: var(--accent);
    color: var(--accent);
  }
  .i-body {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink);
  }
  .i-meta {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
    color: var(--ink-soft);
  }
  .i-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    border-top: 1px solid var(--line);
    padding-top: 8px;
  }
  .origin {
    font-size: 11px;
    color: var(--ink-faint);
  }
  .acts {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .mini {
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink-soft);
    border-radius: 999px;
    padding: 3px 9px;
    font-size: 11.5px;
    cursor: pointer;
  }
  .mini:hover {
    border-color: var(--accent);
    color: var(--ink);
  }
  .mini.danger:hover {
    border-color: #b3261e;
    color: #b3261e;
  }
  .empty p {
    margin: 0;
    font-size: 13px;
    color: var(--ink-soft);
  }
</style>
