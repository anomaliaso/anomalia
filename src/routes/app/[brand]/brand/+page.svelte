<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import HubOverview from '$lib/components/HubOverview.svelte';
  import HubOverviewCard from '$lib/components/HubOverviewCard.svelte';
  import BookMarked from '@lucide/svelte/icons/book-marked';
  import Mic from '@lucide/svelte/icons/mic';
  import Layers from '@lucide/svelte/icons/layers';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';

  let { data } = $props();
  const base = $derived(`/app/${$page.params.brand}`);
  const o = $derived(data.overview);
</script>

<svelte:head>
  <title>Anomalia — {$_('app.hub.brand.label')}</title>
</svelte:head>

<HubOverview
  hub="brand"
  title={$_('app.hub.overview.brand.title')}
  subtitle={$_('app.hub.overview.brand.subtitle')}
  badgeByKey={{
    knowledge: o.knowledge.pending + o.knowledge.failed
  }}
>
  <HubOverviewCard
    href={`${base}/knowledge`}
    title={$_('app.hub.brand.knowledge')}
    description={$_('app.hub.overview.brand.knowledgeDesc')}
    icon={BookMarked}
    badge={o.knowledge.pending + o.knowledge.failed}
    accent={o.knowledge.pending > 0 || o.knowledge.failed > 0 || o.knowledge.documents === 0}
    stats={[
      {
        label: $_('app.hub.overview.brand.documents'),
        value: o.knowledge.documents
      },
      {
        label: $_('app.hub.overview.brand.memories'),
        value: o.knowledge.memories
      },
      {
        label: $_('app.hub.overview.brand.chunks'),
        value: o.knowledge.chunks || $_('app.hub.overview.notSet')
      }
    ]}
  />
  <HubOverviewCard
    href={`${base}/voice`}
    title={$_('app.hub.brand.voice')}
    description={$_('app.hub.overview.brand.voiceDesc')}
    icon={Mic}
    accent={!o.voice.hasVisualStyle && o.voice.examples === 0}
    stats={[
      {
        label: $_('app.hub.overview.brand.examples'),
        value: o.voice.examples
      },
      {
        label: $_('app.hub.overview.brand.visualStyle'),
        value: o.voice.hasVisualStyle
          ? $_('app.hub.overview.ready')
          : $_('app.hub.overview.notSet')
      }
    ]}
  />
  <HubOverviewCard
    href={`${base}/ideas`}
    title={$_('app.hub.brand.ideas')}
    description={$_('app.hub.overview.brand.ideasDesc')}
    icon={Lightbulb}
    accent={o.ideas.live === 0}
    stats={[
      {
        label: $_('app.hub.overview.brand.ideasLive'),
        value: o.ideas.live
      }
    ]}
  />
  <HubOverviewCard
    href={`${base}/rubrics`}
    title={$_('app.hub.brand.rubrics')}
    description={$_('app.hub.overview.brand.rubricsDesc')}
    icon={Layers}
    accent={o.rubrics.count === 0}
    stats={[
      {
        label: $_('app.hub.overview.brand.series'),
        value: o.rubrics.count
      }
    ]}
  />
</HubOverview>
