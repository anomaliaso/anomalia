<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import HubOverview from '$lib/components/HubOverview.svelte';
  import HubOverviewCard from '$lib/components/HubOverviewCard.svelte';
  import Search from '@lucide/svelte/icons/search';
  import Quote from '@lucide/svelte/icons/quote';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import Globe from '@lucide/svelte/icons/globe';
  import Link2 from '@lucide/svelte/icons/link-2';
  import Check from '@lucide/svelte/icons/check';
  import Circle from '@lucide/svelte/icons/circle';

  let { data } = $props();
  const base = $derived(`/app/${$page.params.brand}`);
  const o = $derived(data.overview);
  const steps = $derived(data.activationSteps);
  const allDone = $derived(steps.every((s) => s.done));
  const left = $derived(steps.filter((s) => !s.done).length);
</script>

<svelte:head>
  <title>Anomalia — {$_('app.hub.web.label')}</title>
</svelte:head>

<HubOverview
  hub="web"
  title={$_('app.hub.overview.web.title')}
  subtitle={$_('app.hub.overview.web.subtitle')}
  badgeByKey={{
    seo: o.seo.draftFixes,
    geo: o.citations.gaps,
    keywords: o.keywords.high,
    backlinks: o.network?.openOpportunities ?? 0,
    blog: o.blog.pending
  }}
>
  {#snippet banner()}
    <div class="web-activation">
      <div class="web-activation-head">
        <span class="web-activation-title">Web activation</span>
        {#if allDone}
          <span class="web-activation-state live">Loop attivo</span>
        {:else}
          <span class="web-activation-state">{left} {left === 1 ? 'step' : 'steps'} left</span>
        {/if}
      </div>
      <ol class="web-activation-steps">
        {#each steps as s (s.key)}
          <li class="web-activation-step" class:done={s.done}>
            {#if s.done}
              <Check class="web-activation-dot" size={14} strokeWidth={2.5} />
            {:else}
              <Circle class="web-activation-dot" size={14} strokeWidth={2} />
            {/if}
            <span class="web-activation-label">{s.label}</span>
            {#if !s.done}
              <a class="web-activation-cta" href={s.href}>Start</a>
            {/if}
          </li>
        {/each}
      </ol>
    </div>
  {/snippet}
  <HubOverviewCard
    href={`${base}/seo`}
    title={$_('app.hub.web.seo')}
    description={$_('app.hub.overview.web.seoDesc')}
    icon={Search}
    badge={o.seo.draftFixes}
    accent={o.seo.draftFixes > 0 || !o.seo.hasAudit}
    stats={[
      {
        label: $_('app.hub.overview.web.techScore'),
        value: o.seo.techScore ?? $_('app.hub.overview.notSet')
      },
      {
        label: $_('app.hub.overview.web.seoGrade'),
        value: o.seo.grade ?? $_('app.hub.overview.notSet')
      },
      {
        label: $_('app.hub.overview.web.domainRating'),
        value: o.backlinks ? o.backlinks.rank : $_('app.hub.overview.notSet')
      },
      {
        label: $_('app.hub.overview.web.traffic'),
        value: o.seo.traffic != null ? o.seo.traffic.toLocaleString() : $_('app.hub.overview.notSet')
      },
      {
        label: $_('app.hub.overview.web.keywordsNew'),
        value: o.seo.keywordsNew != null ? `+${o.seo.keywordsNew.toLocaleString()}` : $_('app.hub.overview.notSet')
      },
      {
        label: $_('app.hub.overview.web.referringDomains'),
        value: o.backlinks ? o.backlinks.referringDomains.toLocaleString() : $_('app.hub.overview.notSet')
      }
    ]}
  />
  <HubOverviewCard
    href={`${base}/geo`}
    title={$_('app.hub.web.geo')}
    description={$_('app.hub.overview.web.citationsDesc')}
    icon={Quote}
    badge={o.citations.gaps}
    accent={o.citations.gaps > 0 || o.citations.total === 0}
    stats={[
      {
        label: $_('app.hub.overview.web.shareOfVoice'),
        value:
          o.citations.shareOfVoice != null
            ? `${o.citations.shareOfVoice}%`
            : $_('app.hub.overview.notSet')
      },
      {
        label: $_('app.hub.overview.web.mentioned'),
        value: o.citations.total ? `${o.citations.mentioned}/${o.citations.total}` : '—'
      },
      {
        label: $_('app.hub.overview.web.citationGaps'),
        value: o.citations.gaps
      },
      // Google's own AI answer, alongside the LLM citation share. "Cited in 1 of 3" is the
      // fastest read of whether the brand exists above the blue links.
      {
        label: $_('app.hub.overview.web.aiOverview'),
        value: o.aiOverview
          ? `${o.aiOverview.cited}/${o.aiOverview.withOverview || o.aiOverview.checked}`
          : $_('app.hub.overview.notSet')
      }
    ]}
  />
  <HubOverviewCard
    href={`${base}/keywords`}
    title={$_('app.hub.web.keywords')}
    description={$_('app.hub.overview.web.keywordsDesc')}
    icon={KeyRound}
    badge={o.keywords.high}
    accent={o.keywords.high > 0 || o.keywords.total === 0}
    stats={[
      {
        label: $_('app.hub.overview.web.keywordsTotal'),
        value: o.keywords.total || $_('app.hub.overview.notSet')
      },
      {
        label: $_('app.hub.overview.web.keywordsHigh'),
        value: o.keywords.high
      }
    ]}
  />
  <HubOverviewCard
    href={`${base}/backlinks`}
    title={$_('app.hub.web.backlinks')}
    description={$_('app.hub.overview.web.backlinksDesc')}
    icon={Link2}
    badge={o.network?.enabled ? (o.network?.openOpportunities ?? 0) : 0}
    accent={o.network?.enabled && ((o.network?.openOpportunities ?? 0) > 0 || !(o.network?.outgoing || o.network?.incoming))}
    stats={[
      {
        label: $_('app.hub.overview.web.networkOutgoing'),
        value: o.network?.enabled ? (o.network?.outgoing ?? 0) : $_('app.hub.overview.setup')
      },
      {
        label: $_('app.hub.overview.web.networkIncoming'),
        value: o.network?.enabled ? (o.network?.incoming ?? 0) : $_('app.backlinks.upgradeCta')
      }
    ]}
  />
  <HubOverviewCard
    href={`${base}/settings/library`}
    title={$_('app.hub.web.library')}
    description={$_('app.hub.overview.web.libraryDesc')}
    icon={BookOpen}
    accent={o.library.pages > 0}
    stats={[{ label: $_('app.hub.overview.web.pages'), value: o.library.pages }]}
  />
  <HubOverviewCard
    href={`${base}/site`}
    title={$_('app.hub.web.blog')}
    description={$_('app.hub.overview.web.blogDesc')}
    icon={Globe}
    badge={o.blog.pending}
    accent={o.blog.enabled || o.blog.pending > 0}
    stats={[
      {
        label: $_('app.hub.overview.web.status'),
        value: o.blog.enabled ? $_('app.hub.overview.active') : $_('app.hub.overview.paused')
      },
      { label: $_('app.hub.overview.web.pendingBlog'), value: o.blog.pending },
      { label: $_('app.hub.overview.web.published'), value: o.blog.published }
    ]}
  />
</HubOverview>

<style>
  .web-activation {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  .web-activation-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .web-activation-title {
    font-size: 14px;
    font-weight: 700;
  }

  .web-activation-state {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--ink-soft);
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--paper-2);
    border: 1px solid var(--line);
    white-space: nowrap;
  }

  .web-activation-state.live {
    color: #0a7;
    background: color-mix(in srgb, #0a7 10%, var(--paper));
    border-color: color-mix(in srgb, #0a7 35%, var(--line));
  }

  .web-activation-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .web-activation-step {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--paper-2);
    border: 1px solid var(--line);
    font-size: 12.5px;
  }

  .web-activation-step.done {
    border-color: color-mix(in srgb, #0a7 30%, var(--line));
  }

  .web-activation-dot {
    color: var(--ink-faint);
    flex-shrink: 0;
  }

  .web-activation-step.done .web-activation-dot {
    color: #0a7;
  }

  .web-activation-label {
    color: var(--ink);
  }

  .web-activation-cta {
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    text-decoration: none;
  }
</style>
