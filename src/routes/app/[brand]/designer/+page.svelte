<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import HubOverview from '$lib/components/HubOverview.svelte';
  import HubOverviewCard from '$lib/components/HubOverviewCard.svelte';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Video from '@lucide/svelte/icons/video';
  import Film from '@lucide/svelte/icons/film';
  import Images from '@lucide/svelte/icons/images';

  const base = $derived(`/app/${$page.params.brand}`);
</script>

<svelte:head>
  <title>Anomalia — {$_('app.hub.designer.label')}</title>
</svelte:head>

<HubOverview
  hub="designer"
  title={$_('app.hub.overview.designer.title')}
  subtitle={$_('app.hub.overview.designer.subtitle')}
>
  <HubOverviewCard
    href={`${base}/media-generator`}
    title={$_('app.hub.designer.mediaGenerator')}
    description={$_('app.hub.overview.designer.mediaGeneratorDesc')}
    icon={Sparkles}
  />
  <HubOverviewCard
    href={`${base}/ugc-creator`}
    title={$_('app.hub.designer.ugcCreator')}
    description={$_('app.hub.overview.designer.ugcCreatorDesc')}
    icon={Video}
  />
  <HubOverviewCard
    href={`${base}/motion-video`}
    title={$_('app.hub.designer.motionVideo')}
    description={$_('app.hub.overview.designer.motionVideoDesc')}
    icon={Film}
  />
  <HubOverviewCard
    href={`${base}/media`}
    title={$_('app.hub.designer.mediaLibrary')}
    description={$_('app.hub.overview.designer.mediaLibraryDesc')}
    icon={Images}
  />
</HubOverview>
