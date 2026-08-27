<script lang="ts">
  import BlogCategoriesSettings from '$lib/components/blog/BlogCategoriesSettings.svelte';
  let { data, form } = $props();
</script>

<BlogCategoriesSettings {data} {form} />
