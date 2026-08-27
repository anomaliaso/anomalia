<script lang="ts">
  import { _ } from 'svelte-i18n';

  let { base = '' } = $props();

  let open = $state(false);
  let query = $state('');
  let results = $state<Array<{ slug: string; title: string; excerpt: string }>>([]);
  let loading = $state(false);
  let debounce: ReturnType<typeof setTimeout> | null = null;

  function toggle() {
    open = !open;
    if (!open) { query = ''; results = []; }
  }

  function onInput() {
    if (debounce) clearTimeout(debounce);
    if (query.trim().length < 2) { results = []; return; }
    debounce = setTimeout(async () => {
      loading = true;
      try {
        const res = await fetch(`${base}/search?q=${encodeURIComponent(query.trim())}`);
        const html = await res.text();
        // Parse minimal results from the page (title + slug)
        // For simplicity, just link to the search page
        results = [];
      } finally {
        loading = false;
      }
    }, 300);
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (query.trim().length >= 2) {
      window.location.href = `${base}/search?q=${encodeURIComponent(query.trim())}`;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { open = false; query = ''; results = []; }
  }
</script>

{#if open}
  <form class="search-inline" onsubmit={handleSubmit} onkeydown={onKeydown}>
    <input
      type="text"
      bind:value={query}
      oninput={onInput}
      placeholder={$_('blog.search')}
      autofocus
    />
    <button type="button" class="close" onclick={toggle} aria-label={$_('blog.closeSearch')}>✕</button>
  </form>
{:else}
  <button class="search-trigger" onclick={toggle} aria-label={$_('blog.search')}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  </button>
{/if}

<style>
  .search-trigger {
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; padding: 0;
    background: none; border: none; border-radius: 8px; cursor: pointer;
    color: #666; transition: color 0.15s, background 0.15s;
  }
  .search-trigger:hover { color: var(--accent); background: #f5f5f5; }
  .search-trigger svg { width: 18px; height: 18px; }
  .search-inline {
    display: flex; align-items: center; gap: 6px;
    animation: fadeIn 0.15s ease-out;
  }
  .search-inline input {
    font-size: 14px; padding: 6px 12px; width: 200px;
    border: 1px solid #ddd; border-radius: 8px;
    background: #fff; color: #1a1a1a; outline: none;
    transition: border-color 0.15s, width 0.2s;
  }
  .search-inline input:focus { border-color: var(--accent); width: 260px; }
  .close {
    background: none; border: none; font-size: 16px; color: #888;
    cursor: pointer; padding: 4px; border-radius: 6px;
  }
  .close:hover { background: #f5f5f5; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  :global(:root[data-theme="dark"]) .search-trigger { color: #999; }
  :global(:root[data-theme="dark"]) .search-trigger:hover { background: #222; }
  :global(:root[data-theme="dark"]) .search-inline input { background: #1a1a1a; border-color: #333; color: #e8e8e8; }
  :global(:root[data-theme="dark"]) .close { color: #999; }
  :global(:root[data-theme="dark"]) .close:hover { background: #222; }
</style>
