<script lang="ts">
  import { enhance } from '$app/forms';
  import { SvelteSet } from 'svelte/reactivity';

  let {
    data,
    form
  }: {
    data: {
      categories: Array<{ id: string; name: string; description?: string | null }>;
      tags: Array<{ id: string; name: string }>;
    };
    form?: Record<string, unknown> | null;
  } = $props();

  const busy = new SvelteSet<string>();
  const isBusy = (key: string) => busy.has(key);
  const withBusy = (key: string) => () => {
    busy.add(key);
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy.delete(key);
    };
  };
</script>

{#if form?.categoryCreated}<p class="banner ok">Categoria creata.</p>
{:else if form?.categoryDeleted}<p class="banner ok">Categoria eliminata.</p>
{:else if form?.tagCreated}<p class="banner ok">Tag creato.</p>
{:else if form?.tagDeleted}<p class="banner ok">Tag eliminato.</p>{/if}

<div class="tax-layout">
  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Categorie</div>
        <p class="panel-sub">Organizzano gli articoli in sezioni del blog.</p>
      </div>
    </div>
    <div class="panel-body">
      {#if data.categories.length}
        <ul class="tax-list">
          {#each data.categories as cat (cat.id)}
            <li>
              <div class="tax-item">
                <span class="tax-name">{cat.name}</span>
                {#if cat.description}<span class="muted small">{cat.description}</span>{/if}
              </div>
              <form method="POST" action="?/deleteCategory" use:enhance={withBusy(`del-cat-${cat.id}`)}>
                <input type="hidden" name="id" value={cat.id} />
                <button class="btn-link danger" type="submit" disabled={isBusy(`del-cat-${cat.id}`)}
                  >Elimina</button
                >
              </form>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted empty">Nessuna categoria ancora.</p>
      {/if}

      <form method="POST" action="?/createCategory" use:enhance={withBusy('new-cat')} class="add-card">
        <div class="add-card-title">Nuova categoria</div>
        <label>
          Nome
          <input
            type="text"
            name="name"
            placeholder="Es. Guide, Novità, Case study"
            required
            maxlength="80"
            disabled={isBusy('new-cat')}
          />
        </label>
        <label>
          Descrizione <span class="opt">(opzionale)</span>
          <input
            type="text"
            name="description"
            placeholder="Una riga che spiega la sezione"
            maxlength="300"
            disabled={isBusy('new-cat')}
          />
        </label>
        <div class="add-card-actions">
          <button
            class="btn primary"
            class:loading={isBusy('new-cat')}
            type="submit"
            disabled={isBusy('new-cat')}>Aggiungi categoria</button
          >
        </div>
      </form>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Tag</div>
        <p class="panel-sub">Etichette trasversali per filtrare e collegare gli articoli.</p>
      </div>
    </div>
    <div class="panel-body">
      {#if data.tags.length}
        <ul class="tag-cloud">
          {#each data.tags as tag (tag.id)}
            <li>
              <span class="tag-chip">#{tag.name}</span>
              <form method="POST" action="?/deleteTag" use:enhance={withBusy(`del-tag-${tag.id}`)}>
                <input type="hidden" name="id" value={tag.id} />
                <button
                  class="tag-del"
                  type="submit"
                  aria-label="Elimina {tag.name}"
                  disabled={isBusy(`del-tag-${tag.id}`)}>✕</button
                >
              </form>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted empty">Nessun tag ancora.</p>
      {/if}

      <form method="POST" action="?/createTag" use:enhance={withBusy('new-tag')} class="add-card">
        <div class="add-card-title">Nuovo tag</div>
        <label>
          Nome
          <div class="tag-input-row">
            <span class="tag-hash" aria-hidden="true">#</span>
            <input
              type="text"
              name="name"
              placeholder="es. seo, prodotto, tutorial"
              required
              maxlength="50"
              disabled={isBusy('new-tag')}
            />
          </div>
        </label>
        <div class="add-card-actions">
          <button
            class="btn primary"
            class:loading={isBusy('new-tag')}
            type="submit"
            disabled={isBusy('new-tag')}>Aggiungi tag</button
          >
        </div>
      </form>
    </div>
  </section>
</div>

<style>
  .tax-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: start;
  }
  .panel-body {
    padding: 18px 22px 22px;
  }
  .panel-sub {
    margin: 4px 0 0;
    font-size: 13px;
    font-weight: 400;
    color: var(--ink-faint);
    line-height: 1.4;
  }
  .banner {
    font-size: 13px;
    border-radius: 10px;
    padding: 10px 14px;
    margin: 0 0 16px;
  }
  .banner.ok {
    background: #dcfce7;
    color: #166534;
  }
  .empty {
    margin: 0 0 16px;
  }
  .tax-list {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tax-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--paper);
  }
  .tax-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .tax-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .tag-cloud {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tag-cloud li {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px 4px 4px 10px;
    border-radius: 999px;
    background: var(--paper-2);
    border: 1px solid var(--line);
  }
  .tag-chip {
    font-size: 13px;
    font-weight: 500;
    color: var(--ink);
  }
  .tag-del {
    background: none;
    border: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--ink-faint);
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .tag-del:hover {
    color: #dc2626;
    background: rgba(220, 38, 38, 0.08);
  }
  .tag-del:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn-link {
    background: none;
    border: none;
    color: var(--ink-faint);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    flex-shrink: 0;
  }
  .btn-link.danger {
    color: #dc2626;
  }
  .add-card {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px 18px;
    background: var(--paper-2);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .add-card-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--ink);
  }
  .add-card label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .opt {
    font-weight: 400;
    color: var(--ink-faint);
  }
  .add-card input {
    font-size: 14px;
    padding: 9px 11px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 400;
    font-family: inherit;
  }
  .tag-input-row {
    display: flex;
    align-items: center;
    gap: 0;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    overflow: hidden;
  }
  .tag-hash {
    padding: 0 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ink-faint);
  }
  .tag-input-row input {
    border: none;
    border-radius: 0;
    flex: 1;
    min-width: 0;
  }
  .tag-input-row input:focus {
    outline: none;
  }
  .tag-input-row:focus-within {
    border-color: var(--accent);
  }
  .add-card-actions {
    display: flex;
    justify-content: flex-end;
  }
  .muted {
    color: var(--ink-faint);
  }
  .small {
    font-size: 12px;
  }
  .btn {
    font-size: 13px;
    font-weight: 600;
    border-radius: 10px;
    padding: 9px 16px;
    cursor: pointer;
    border: 1px solid transparent;
    line-height: 1;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    background: transparent;
    color: inherit;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .btn.primary {
    background: var(--accent, #7c5cff);
    color: #fff;
  }
  .loading {
    position: relative;
    color: transparent !important;
    pointer-events: none;
  }
  .loading::after {
    content: '';
    position: absolute;
    inset: 0;
    margin: auto;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid #fff;
    border-top-color: transparent;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (max-width: 720px) {
    .tax-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
