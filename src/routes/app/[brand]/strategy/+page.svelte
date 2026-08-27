<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import HubOverview from '$lib/components/HubOverview.svelte';
  import HubOverviewCard from '$lib/components/HubOverviewCard.svelte';
  import TrendingUp from '@lucide/svelte/icons/trending-up';
  import CalendarDays from '@lucide/svelte/icons/calendar-days';

  let { data } = $props();
  const base = $derived(`/app/${$page.params.brand}`);
  const o = $derived(data.overview);
</script>

<svelte:head>
  <title>Anomalia — {$_('app.hub.strategy.label')}</title>
</svelte:head>

<HubOverview
  hub="strategy"
  title={$_('app.hub.overview.strategy.title')}
  subtitle={$_('app.hub.overview.strategy.subtitle')}
>
  <HubOverviewCard
    href={`${base}/gtm`}
    title={$_('app.hub.strategy.strategy')}
    description={$_('app.hub.overview.strategy.gtmDesc')}
    icon={TrendingUp}
    badge={o.gtm.proposedCount}
    accent={o.gtm.proposedCount > 0 || !o.gtm.ready}
    stats={[
      {
        label: $_('app.hub.overview.strategy.gtmPhase'),
        value: o.gtm.phaseName ?? $_('app.hub.overview.notSet')
      },
      {
        label: $_('app.hub.overview.strategy.status'),
        value: o.gtm.ready ? $_('app.hub.overview.ready') : $_('app.hub.overview.setup')
      }
    ]}
  />
  <HubOverviewCard
    href={`${base}/plan`}
    title={$_('app.hub.strategy.plan')}
    description={$_('app.hub.overview.strategy.planDesc')}
    icon={CalendarDays}
    badge={o.plan.proposedCount}
    accent={o.plan.proposedCount > 0 || !o.plan.ready}
    stats={[
      {
        label: $_('app.hub.overview.strategy.currentWeek'),
        value: o.plan.weekLabel ?? $_('app.hub.overview.notSet')
      },
      {
        label: $_('app.hub.overview.strategy.status'),
        value: o.plan.ready ? $_('app.hub.overview.ready') : $_('app.hub.overview.setup')
      }
    ]}
  />
</HubOverview>
