<script lang="ts">
  import { _ } from 'svelte-i18n';
  import HomeHead from '$lib/components/HomeHead.svelte';
  import HomeWorkbench from '$lib/components/HomeWorkbench.svelte';
  import WorkbenchPageShimmer from '$lib/components/WorkbenchPageShimmer.svelte';

  let { data } = $props();
</script>

<svelte:head><title>Anomalia — {$_('app.home.workbench.title')}</title></svelte:head>

<!-- La guida per collegare un agente non è più qui. Si leggeva una volta e poi occupava il primo
     terzo della pagina per sempre; ora è «Installa», in fondo alla barra, sempre allo stesso posto
     e sempre raggiungibile — anche il secondo giorno, che è quello in cui la si cerca davvero. -->

<!-- `extras` non si passa di proposito: erano i badge differiti del layout, e qui dentro
     non ci sono. Servivano solo come sovrascrittura anticipata — `overview` porta già
     ognuno di quei numeri, quindi il workbench è identico, appena meno impaziente.

     Se un giorno questo shimmer non finisce più, il sospettato NON è la promessa: è
     `HomeWorkbench` che esplode mentre si disegna. Il ramo `:then` muore a metà, `{#await}`
     resta su quello in attesa e l'errore finisce solo in console — visto una volta, con una
     variabile rimasta nel markup dopo che la sua dichiarazione era stata tolta. -->
{#await data.overview}
  <WorkbenchPageShimmer variant="home" />
{:then overview}
  <HomeHead {overview} brandSlug={data.brand.slug} />
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
