<script lang="ts">
  import PlanDocumentView from '$lib/components/PlanDocumentView.svelte';

  let { data } = $props();
</script>

<svelte:head><title>{data.plan.title}</title></svelte:head>

<PlanDocumentView plan={data.plan} />
