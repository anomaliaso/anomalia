<script lang="ts" module>
  export type DocsSearchItem = { title: string; href: string; group: string };
</script>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import { tick } from 'svelte';

  let {
    open = $bindable(false),
    items
  }: {
    open?: boolean;
    items: DocsSearchItem[];
  } = $props();

  let query = $state('');
  let active = $state(0);
  let inputEl = $state<HTMLInputElement | undefined>();
  let listEl = $state<HTMLDivElement | undefined>();

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.group.toLowerCase().includes(q)
    );
  });

  $effect(() => {
    // Reset highlight when the result list changes.
    void filtered;
    active = 0;
  });

  $effect(() => {
    if (!open) return;
    query = '';
    active = 0;
    tick().then(() => inputEl?.focus());

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function close() {
    open = false;
  }

  async function select(item: DocsSearchItem) {
    close();
    await goto(item.href);
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!filtered.length) return;
      active = (active + 1) % filtered.length;
      scrollActiveIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filtered.length) return;
      active = (active - 1 + filtered.length) % filtered.length;
      scrollActiveIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[active];
      if (item) void select(item);
    }
  }

  function scrollActiveIntoView() {
    tick().then(() => {
      const el = listEl?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="docs-search-scrim" onclick={close} role="presentation"></div>
  <div
    class="docs-search"
    role="dialog"
    aria-modal="true"
    aria-label={$_('docs.layout.s47')}
  >
    <div class="docs-search-bar">
      <svg class="docs-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        bind:this={inputEl}
        class="docs-search-input"
        type="search"
        placeholder={$_('docs.layout.s47')}
        autocomplete="off"
        spellcheck="false"
        bind:value={query}
        onkeydown={onInputKeydown}
      />
      <kbd class="docs-search-esc">esc</kbd>
    </div>

    <div class="docs-search-list" bind:this={listEl} role="listbox">
      {#if filtered.length === 0}
        <div class="docs-search-empty">{$_('docs.layout.s52')}</div>
      {:else}
        {#each filtered as item, i (item.href + item.title)}
          <button
            type="button"
            class="docs-search-item"
            class:active={i === active}
            data-idx={i}
            role="option"
            aria-selected={i === active}
            onmouseenter={() => (active = i)}
            onclick={() => select(item)}
          >
            <span class="docs-search-item-title">{item.title}</span>
            <span class="docs-search-item-group">{item.group}</span>
          </button>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .docs-search-scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(2px);
  }
  .docs-search {
    position: fixed;
    z-index: 61;
    top: min(18vh, 140px);
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, calc(100vw - 32px));
    background: var(--paper, #fff);
    border: 1px solid var(--line, #d2d2d7);
    border-radius: 14px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
    overflow: hidden;
  }
  .docs-search-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line, #d2d2d7);
  }
  .docs-search-icon {
    width: 16px;
    height: 16px;
    flex: none;
    opacity: 0.45;
    color: var(--ink-soft, #6e6e73);
  }
  .docs-search-input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    font: inherit;
    font-size: 15px;
    color: var(--ink, #1d1d1f);
  }
  .docs-search-input::placeholder {
    color: var(--ink-soft, #6e6e73);
  }
  .docs-search-esc {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 5px;
    border: 1px solid var(--line, #d2d2d7);
    color: var(--ink-soft, #6e6e73);
    background: var(--paper-2, #f5f5f7);
  }
  .docs-search-list {
    max-height: min(360px, 50vh);
    overflow-y: auto;
    padding: 6px;
  }
  .docs-search-empty {
    padding: 28px 12px;
    text-align: center;
    font-size: 13px;
    color: var(--ink-soft, #6e6e73);
  }
  .docs-search-item {
    width: 100%;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    appearance: none;
    border: 0;
    background: transparent;
    text-align: left;
    padding: 10px 12px;
    border-radius: 9px;
    cursor: pointer;
    font: inherit;
    color: var(--ink, #1d1d1f);
  }
  .docs-search-item.active {
    background: rgba(0, 0, 0, 0.06);
  }
  .docs-search-item-title {
    font-size: 14px;
    font-weight: 550;
  }
  .docs-search-item-group {
    font-size: 12px;
    color: var(--ink-soft, #6e6e73);
    flex: none;
  }

  :global(:root[data-theme='dark']) .docs-search {
    background: var(--paper-2, #111);
    border-color: var(--line, #2a2a2a);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  :global(:root[data-theme='dark']) .docs-search-item.active {
    background: rgba(255, 255, 255, 0.08);
  }
  :global(:root[data-theme='dark']) .docs-search-esc {
    background: var(--paper, #0a0a0a);
  }
</style>
