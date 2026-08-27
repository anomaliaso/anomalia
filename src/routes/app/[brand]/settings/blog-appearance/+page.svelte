<script lang="ts">
  import BlogAppearanceSettings from '$lib/components/blog/BlogAppearanceSettings.svelte';
  let { data, form } = $props();
</script>

<BlogAppearanceSettings {data} {form} />
