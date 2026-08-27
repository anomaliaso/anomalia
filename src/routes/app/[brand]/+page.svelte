<script lang="ts">
  // Overview content is the ChatColumn composer mounted by the brand layout
  // (thread created only on first send). This page exists for the route + load.
  let { data } = $props();
</script>

<svelte:head>
  <title>Anomalia — {data.brand.name}</title>
</svelte:head>
