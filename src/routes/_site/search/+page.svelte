<script lang="ts">
  import BlogIndex from '$lib/components/blog/BlogIndex.svelte';
  let { data } = $props();
  let query = $state(data.query);

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (query.trim().length >= 2) {
      window.location.href = `/search?q=${encodeURIComponent(query.trim())}`;
    }
  }
</script>

<svelte:head>
  <title>Ricerca{data.query ? `: ${data.query}` : ''}</title>
</svelte:head>

<div class="search-page">
  <form class="search-form" onsubmit={handleSubmit}>
    <input type="text" bind:value={query} placeholder="Cerca articoli..." autofocus />
    <button type="submit">Cerca</button>
  </form>

  {#if data.query}
    <p class="result-count">
      {data.articles.length} {data.articles.length === 1 ? 'risultato' : 'risultati'} per "<strong>{data.query}</strong>"
    </p>
  {/if}

  {#if data.articles.length}
    <BlogIndex articles={data.articles} base="" />
  {:else if data.query}
    <p class="empty">Nessun articolo trovato per questa ricerca.</p>
  {/if}
</div>

<style>
  .search-page { max-width: 960px; }
  .search-form { display: flex; gap: 8px; margin-bottom: 24px; }
  .search-form input {
    flex: 1; font-size: 18px; padding: 12px 16px;
    border: 2px solid #e5e5e5; border-radius: 12px;
    background: #fff; color: #1a1a1a; outline: none;
    transition: border-color 0.15s;
  }
  .search-form input:focus { border-color: var(--accent); }
  .search-form button {
    font-size: 15px; font-weight: 600; padding: 12px 24px;
    border: none; border-radius: 12px;
    background: var(--accent); color: #fff; cursor: pointer;
    transition: opacity 0.15s;
  }
  .search-form button:hover { opacity: 0.85; }
  .result-count { font-size: 14px; color: #888; margin: 0 0 20px; }
  .empty { color: #999; font-size: 15px; }
  :global(:root[data-theme="dark"]) .search-form input { background: #1a1a1a; border-color: #333; color: #e8e8e8; }
  :global(:root[data-theme="dark"]) .result-count { color: #777; }
</style>
