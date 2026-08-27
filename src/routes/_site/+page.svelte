<script lang="ts">
  import BlogIndex from '$lib/components/blog/BlogIndex.svelte';
  let { data } = $props();
</script>

<svelte:head>
  <link rel="alternate" type="application/rss+xml" title={data.brand.name} href="{data.origin}/rss.xml" />
</svelte:head>

<BlogIndex brand={data.brand} articles={data.articles} base={data.base} siteUrl={data.siteUrl} />
