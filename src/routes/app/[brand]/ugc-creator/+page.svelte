<script lang="ts">
  import MediaGeneratorWorkbench from '$lib/components/media-generator/MediaGeneratorWorkbench.svelte';

  let { data } = $props();
</script>

<MediaGeneratorWorkbench {data} mode="ugc" />
