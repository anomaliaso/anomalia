<script lang="ts">
  import BlogTerms from '$lib/components/blog/BlogTerms.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Termini — {data.brand.name}</title></svelte:head>

<BlogTerms brand={data.brand} base={data.base} />
