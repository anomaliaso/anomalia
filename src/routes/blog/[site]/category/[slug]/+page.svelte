<script lang="ts">
  import BlogIndex from '$lib/components/blog/BlogIndex.svelte';
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.category.name}</title>
  {#if data.category.description}<meta name="description" content={data.category.description.slice(0, 160)} />{/if}
</svelte:head>

<div class="cat-header">
  <h1>{data.category.name}</h1>
  {#if data.category.description}<p>{data.category.description}</p>{/if}
</div>

<BlogIndex articles={data.articles} base="" />

<style>
  .cat-header { margin-bottom: 32px; }
  .cat-header h1 { font-size: 36px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; }
  .cat-header p { font-size: 16px; color: #666; margin: 0; line-height: 1.55; }
  :global(:root[data-theme="dark"]) .cat-header p { color: #999; }
</style>
