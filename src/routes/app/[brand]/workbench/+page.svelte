<script lang="ts">
  import { _ } from 'svelte-i18n';
  import HomeWorkbench from '$lib/components/HomeWorkbench.svelte';
  import McpGuide from '$lib/components/McpGuide.svelte';
  import WorkbenchPageShimmer from '$lib/components/WorkbenchPageShimmer.svelte';

  let { data } = $props();
</script>

<svelte:head><title>Anomalia — {$_('app.home.workbench.title')}</title></svelte:head>

<!-- Sopra il blocco `{#await}`, non dentro: collegare il proprio agente è la prima cosa da fare,
     e non dipende dalle ~30 query della panoramica. Aspettarle vorrebbe dire mostrarla al
     secondo giro d'occhio, quando la pagina si è già riempita d'altro. -->
<McpGuide />

<!-- `extras` non si passa di proposito: erano i badge differiti del layout, e qui dentro
     non ci sono. Servivano solo come sovrascrittura anticipata — `overview` porta già
     ognuno di quei numeri, quindi il workbench è identico, appena meno impaziente. -->
{#await data.overview}
  <WorkbenchPageShimmer variant="home" />
{:then overview}
  <HomeWorkbench
    brandSlug={data.brand.slug}
    {overview}
    launchedAt={data.brand?.launched_at ?? null}
  />
{:catch}
  <p class="wb-failed">{$_('app.home.workbench.failed')}</p>
{/await}

<style>
  .wb-failed {
    margin: 0;
    font-size: 13.5px;
    color: var(--ink-soft);
  }
</style>
