<script lang="ts">
  import StudioPage from '$lib/components/studio/StudioPage.svelte';
  import BrandTimezone from '$lib/components/settings/BrandTimezone.svelte';

  let { data, form } = $props();

  // L'ordine è quello di `get_brand_settings`: fuso, piattaforme, hashtag, esempi di voce. Il
  // kit (logo, colori, tono) resta in cima perché è il brand prima ancora di come lavora.
  const SECTIONS = ['brand', 'platforms', 'hashtags', 'voice-examples'] as const;
</script>

<BrandTimezone timezone={data.brand.timezone} {form} />
<StudioPage {data} {form} section={[...SECTIONS]} />
