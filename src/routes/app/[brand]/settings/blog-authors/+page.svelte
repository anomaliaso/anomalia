<script lang="ts">
  import BlogAuthorsSettings from '$lib/components/blog/BlogAuthorsSettings.svelte';
  let { data, form } = $props();
</script>

<BlogAuthorsSettings {data} {form} />
