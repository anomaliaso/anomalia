<script lang="ts">
  import BlogIndex from '$lib/components/blog/BlogIndex.svelte';
  let { data } = $props();
</script>

<BlogIndex brand={data.brand} articles={data.articles} base={data.base} siteUrl={data.siteUrl} />
