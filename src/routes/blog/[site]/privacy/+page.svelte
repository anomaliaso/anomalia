<script lang="ts">
  import BlogPrivacy from '$lib/components/blog/BlogPrivacy.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Privacy &amp; Cookie — {data.brand.name}</title></svelte:head>

<BlogPrivacy brand={data.brand} base={data.base} />
