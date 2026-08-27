<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import HubOverview from '$lib/components/HubOverview.svelte';
  import HubOverviewCard from '$lib/components/HubOverviewCard.svelte';
  import Radar from '@lucide/svelte/icons/radio';
  import Users from '@lucide/svelte/icons/users';
  import Bot from '@lucide/svelte/icons/bot';

  let { data } = $props();
  const base = $derived(`/app/${$page.params.brand}`);
  const o = $derived(data.overview);
  // Una sola card per la squadra: agenti scritti dal cliente + lavori inclusi nel prodotto.
  const team = $derived({
    total: (o.custom?.total ?? 0) + (data.jobs?.total ?? 0),
    enabled: (o.custom?.enabled ?? 0) + (data.jobs?.enabled ?? 0)
  });
</script>

<svelte:head>
  <title>Anomalia — {$_('app.hub.automations.label')}</title>
</svelte:head>

<HubOverview
  hub="automations"
  title={$_('app.hub.overview.automations.title')}
  subtitle={$_('app.hub.overview.automations.subtitle')}
  badgeByKey={{ leads: o.leads.pending, radar: o.radar.reviewCount }}
>
  <HubOverviewCard
    href={`${base}/radar`}
    title={$_('app.hub.automations.radar')}
    description={$_('app.hub.overview.automations.radarDesc')}
    icon={Radar}
    badge={o.radar.reviewCount}
    accent={o.radar.reviewCount > 0}
    stats={[
      {
        label: $_('app.hub.overview.automations.sources'),
        value: o.radar.sources
      },
      {
        label: $_('app.hub.overview.automations.news7d'),
        value: o.radar.recentItems
      },
      {
        label: $_('app.hub.overview.automations.status'),
        value: o.radar.enabled ? $_('app.hub.overview.active') : $_('app.hub.overview.paused')
      }
    ]}
  />
  <HubOverviewCard
    href={`${base}/leads`}
    title={$_('app.hub.automations.leads')}
    description={$_('app.hub.overview.automations.leadsDesc')}
    icon={Users}
    badge={o.leads.pending}
    accent={o.leads.pending > 0}
    stats={[
      { label: $_('app.hub.overview.automations.pendingLeads'), value: o.leads.pending },
      { label: $_('app.hub.overview.automations.totalLeads'), value: o.leads.total }
    ]}
  />
  <HubOverviewCard
    href={`${base}/agents`}
    title={$_('app.hub.automations.custom')}
    description={$_('app.hub.overview.automations.customDesc')}
    icon={Bot}
    badge={team.enabled}
    accent={team.enabled > 0}
    stats={[
      { label: $_('app.hub.overview.automations.customActive'), value: team.enabled },
      { label: $_('app.hub.overview.automations.customTotal'), value: team.total }
    ]}
  />
</HubOverview>
