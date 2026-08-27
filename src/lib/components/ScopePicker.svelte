<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import type { SubmitFunction } from '@sveltejs/kit';

  export type ScopeItem = { id: string; label: string; value?: string };

  let {
    action,
    inputName,
    items = [],
    listError = '',
    limit,
    selected = $bindable([]),
    i18nKey,
    busy = false,
    enhanceBusy,
    encodeValue
  }: {
    action: string;
    inputName: string;
    items?: ScopeItem[];
    listError?: string;
    limit: number;
    selected: string[];
    i18nKey: string;
    busy?: boolean;
    enhanceBusy: SubmitFunction;
    encodeValue?: (item: ScopeItem) => string;
  } = $props();

  let query = $state('');

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const picked = new Set(selected);
    const sorted = [...items].sort((a, b) => {
      const as = picked.has(a.id) ? 0 : 1;
      const bs = picked.has(b.id) ? 0 : 1;
      if (as !== bs) return as - bs;
      return a.label.localeCompare(b.label);
    });
    if (!q) return sorted;
    return sorted.filter((item) => item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q));
  });

  function toggle(id: string) {
    if (selected.includes(id)) {
      selected = selected.filter((x) => x !== id);
      return;
    }
    if (selected.length >= limit) return;
    selected = [...selected, id];
  }

  function valueFor(id: string): string {
    const item = items.find((i) => i.id === id);
    if (!item) return id;
    return encodeValue ? encodeValue(item) : (item.value ?? item.id);
  }
</script>

<form class="scope-picker" method="POST" {action} use:enhance={enhanceBusy}>
  {#each selected as id (id)}
    <input type="hidden" name={inputName} value={valueFor(id)} />
  {/each}
  <p class="picker-title">{$_(`${i18nKey}.pickTitle`)}</p>
  <p class="muted">{$_(`${i18nKey}.pickHint`)}</p>
  <p class="muted">{$_(`${i18nKey}.limit`, { values: { n: limit } })}</p>
  {#if listError}
    <p class="banner err tiny">{$_(`${i18nKey}.listError`)} {listError}</p>
  {:else if !items.length}
    <p class="muted">{$_(`${i18nKey}.empty`)}</p>
  {:else}
    <input class="repo-search" type="search" bind:value={query} placeholder={$_(`${i18nKey}.search`)} />
    <ul class="repo-list">
      {#each visible as item (item.id)}
        {@const checked = selected.includes(item.id)}
        <li>
          <label class="repo-row" class:checked>
            <input
              type="checkbox"
              checked={checked}
              disabled={!checked && selected.length >= limit}
              onchange={() => toggle(item.id)}
            />
            <span class="repo-name">{item.label}</span>
          </label>
        </li>
      {/each}
    </ul>
  {/if}
  <button class="btn primary" type="submit" disabled={busy || selected.length === 0}>
    {$_(`${i18nKey}.save`)}
  </button>
</form>

<style>
  .scope-picker {
    flex: 1 1 100%;
    display: grid;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--line, #e5e5e8);
    margin-top: 4px;
  }
  .picker-title { margin: 8px 0 0; font-size: 13px; font-weight: 600; }
  .repo-search {
    width: 100%;
    max-width: 420px;
    font: inherit;
    font-size: 13px;
    padding: 8px 10px;
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 8px;
    background: var(--paper, #fff);
    color: inherit;
  }
  .repo-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 240px;
    overflow: auto;
    display: grid;
    gap: 2px;
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 10px;
    background: var(--paper, #fff);
  }
  .repo-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    font-size: 13px;
    cursor: pointer;
  }
  .repo-row.checked { background: var(--paper-2, #f5f5f7); }
  .repo-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .muted { color: var(--ink-soft, #6e6e73); font-size: 13px; }
  .banner.err { color: #a11; margin: 0; }
  .banner.tiny { font-size: 12px; margin: 8px 0 0; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    border-radius: 10px;
    padding: 9px 14px;
    cursor: pointer;
    border: 1px solid transparent;
    font-family: inherit;
    color: inherit;
    justify-self: start;
  }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn.primary {
    background: var(--invert-surface, #1d1d1f);
    color: #fff;
    border-color: var(--invert-surface, #1d1d1f);
  }
</style>
