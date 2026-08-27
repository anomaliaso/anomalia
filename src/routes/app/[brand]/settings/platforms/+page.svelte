<script lang="ts">
  import StudioPage from '$lib/components/studio/StudioPage.svelte';
  let { data, form } = $props();
</script>

<StudioPage {data} {form} section="platforms" />
