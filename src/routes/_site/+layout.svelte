<script lang="ts">
  import BlogShell from '$lib/components/blog/BlogShell.svelte';
  let { data, children } = $props();
</script>

<BlogShell brand={data.brand} categories={data.categories}>{@render children()}</BlogShell>
