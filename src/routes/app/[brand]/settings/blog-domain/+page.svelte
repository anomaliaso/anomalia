<script lang="ts">
  import BlogDomainSettings from '$lib/components/blog/BlogDomainSettings.svelte';
  let { data, form } = $props();
</script>

<BlogDomainSettings {data} {form} />
