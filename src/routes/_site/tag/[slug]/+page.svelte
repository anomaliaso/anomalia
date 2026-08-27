<script lang="ts">
  import BlogIndex from '$lib/components/blog/BlogIndex.svelte';
  let { data } = $props();
</script>

<svelte:head>
  <title>Tag: {data.tag.name}</title>
</svelte:head>

<div class="tag-header">
  <h1>#{data.tag.name}</h1>
</div>

<BlogIndex articles={data.articles} base="" />

<style>
  .tag-header { margin-bottom: 32px; }
  .tag-header h1 { font-size: 36px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
</style>
