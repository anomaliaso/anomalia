<script lang="ts">
  import BlogIntegrationsSettings from '$lib/components/blog/BlogIntegrationsSettings.svelte';
  let { data, form } = $props();
</script>

<BlogIntegrationsSettings {data} {form} />
