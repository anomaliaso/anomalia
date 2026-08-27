<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import HubOverview from '$lib/components/HubOverview.svelte';
  import HubOverviewCard from '$lib/components/HubOverviewCard.svelte';
  import Calendar from '@lucide/svelte/icons/calendar';
  import PenLine from '@lucide/svelte/icons/pen-line';
  import Megaphone from '@lucide/svelte/icons/megaphone';
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
  import Search from '@lucide/svelte/icons/search';
  import Quote from '@lucide/svelte/icons/quote';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Globe from '@lucide/svelte/icons/globe';
  import Swords from '@lucide/svelte/icons/swords';
  import VideoScoreRing from '$lib/components/VideoScoreRing.svelte';

  let { data } = $props();
  const base = $derived(`/app/${$page.params.brand}`);
  const o = $derived(data.overview);

  function captionPreview(text: string | null, n = 72) {
    if (!text) return '';
    const t = text.trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  }
</script>

<svelte:head>
  <title>Anomalia — {$_('app.hub.publish.label')}</title>
</svelte:head>

{#snippet upgradeBanner()}
  <p>{$_('app.home.upgrade.banner')}</p>
  <a href={`${base}/activate?plan=starter`}>{$_('app.home.upgrade.cta')}</a>
{/snippet}

<HubOverview
  hub="publish"
  title={$_('app.hub.overview.publish.title')}
  subtitle={$_('app.hub.overview.publish.subtitle')}
  badgeByKey={{ calendar: o.queue.pending }}
  banner={o.paid ? undefined : upgradeBanner}
>
  {#if o.queue.pending > 0 && o.queue.posts.length}
    <div class="publish-previews">
      <div class="publish-previews-head">
        <span
          >{$_('app.home.overview.postsToAccept', { values: { n: o.queue.pending } })}</span
        >
        <a href={`${base}/calendar?status=pending_user`}>{$_('app.home.overview.review')} →</a>
      </div>
      <div class="publish-preview-row">
        {#each o.queue.posts as post (post.id)}
          <a class="publish-preview" href={`${base}/calendar?status=pending_user`}>
            <div class="publish-preview-media">
              {#if post.media_url}
                <img src={post.media_url} alt="" loading="lazy" />
                <VideoScoreRing url={post.media_url} size={24} />
              {:else}
                <div class="publish-preview-ph"
                  >{(post.platform ?? '?').slice(0, 2).toUpperCase()}</div
                >
              {/if}
            </div>
            <div class="publish-preview-body">
              {#if post.platform}<span class="plat">{post.platform}</span>{/if}
              <span class="cap">{captionPreview(post.caption) || '—'}</span>
            </div>
          </a>
        {/each}
      </div>
    </div>
  {/if}

  <HubOverviewCard
    href={`${base}/manual-posting`}
    title={$_('app.hub.publish.manualPosting')}
    description={$_('app.hub.overview.publish.manualPostingDesc')}
    icon={PenLine}
  />
  <HubOverviewCard
    href={`${base}/calendar`}
    title={$_('app.hub.publish.calendar')}
    description={$_('app.hub.overview.publish.calendarDesc')}
    icon={Calendar}
    badge={o.queue.pending}
    accent={o.queue.pending > 0 || o.calendar.upcoming > 0}
    stats={[
      { label: $_('app.hub.overview.publish.pending'), value: o.queue.pending },
      { label: $_('app.hub.overview.publish.scheduled'), value: o.queue.scheduled },
      { label: $_('app.hub.overview.publish.next7days'), value: o.calendar.upcoming }
    ]}
  />
  <HubOverviewCard
    href={`${base}/campaigns`}
    title={$_('app.hub.publish.campaigns')}
    description={$_('app.hub.overview.publish.campaignsDesc')}
    icon={Megaphone}
    stats={[{ label: $_('app.hub.overview.publish.activeCampaigns'), value: o.campaigns.count }]}
  />
  <HubOverviewCard
    href={`${base}/analytics`}
    title={$_('app.hub.publish.analytics')}
    description={$_('app.hub.overview.publish.analyticsDesc')}
    icon={BarChart3}
    stats={[
      { label: $_('app.hub.overview.publish.published'), value: o.analytics.published },
      { label: $_('app.hub.overview.publish.tracked'), value: o.analytics.trackedPosts }
    ]}
  />
  <HubOverviewCard
    href={`${base}/competitors`}
    title={$_('app.hub.publish.competitors')}
    description={$_('app.hub.overview.publish.competitorsDesc')}
    icon={Swords}
    accent={o.competitors.count > 0}
    stats={[
      { label: $_('app.hub.overview.publish.competitorsCount'), value: o.competitors.count },
      { label: $_('app.hub.overview.publish.competitorPosts'), value: o.competitors.posts }
    ]}
  />

  <HubOverviewCard
    href={`${base}/seo`}
    title={$_('app.hub.web.seo')}
    description={$_('app.hub.overview.web.seoDesc')}
    icon={Search}
    accent={!o.web.techScore && !o.web.seoGrade}
    stats={[
      {
        label: $_('app.hub.overview.web.techScore'),
        value: o.web.techScore ?? $_('app.hub.overview.notSet')
      },
      {
        label: $_('app.hub.overview.web.seoGrade'),
        value: o.web.seoGrade ?? $_('app.hub.overview.notSet')
      }
    ]}
  />
  <HubOverviewCard
    href={`${base}/geo`}
    title={$_('app.hub.web.geo')}
    description={$_('app.hub.overview.web.citationsDesc')}
    icon={Quote}
    badge={o.web.citationGaps}
    accent={o.web.citationGaps > 0}
    stats={[
      {
        label: $_('app.hub.overview.web.shareOfVoice'),
        value: o.web.shareOfVoice != null ? `${o.web.shareOfVoice}%` : $_('app.hub.overview.notSet')
      },
      { label: $_('app.hub.overview.web.citationGaps'), value: o.web.citationGaps }
    ]}
  />
  <HubOverviewCard
    href={`${base}/keywords`}
    title={$_('app.hub.web.keywords')}
    description={$_('app.hub.overview.web.keywordsDesc')}
    icon={KeyRound}
    badge={o.web.keywordsHigh}
    accent={o.web.keywordsHigh > 0 || o.web.keywordsTotal === 0}
    stats={[
      {
        label: $_('app.hub.overview.web.keywordsTotal'),
        value: o.web.keywordsTotal || $_('app.hub.overview.notSet')
      },
      { label: $_('app.hub.overview.web.keywordsHigh'), value: o.web.keywordsHigh }
    ]}
  />
  <HubOverviewCard
    href={`${base}/site`}
    title={$_('app.hub.web.blog')}
    description={$_('app.hub.overview.web.blogDesc')}
    icon={Globe}
    badge={o.web.blogPending}
    accent={o.web.blogPending > 0}
    stats={[
      { label: $_('app.hub.overview.web.pendingBlog'), value: o.web.blogPending },
      { label: $_('app.hub.overview.publish.published'), value: o.analytics.published }
    ]}
  />
</HubOverview>

<style>
  .publish-previews {
    grid-column: 1 / -1;
    margin-bottom: 4px;
  }
  .publish-previews-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .publish-previews-head a {
    color: var(--accent);
    text-decoration: none;
    font-size: 12.5px;
  }
  .publish-preview-row {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .publish-preview {
    flex: 0 0 148px;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--paper);
    overflow: hidden;
    text-decoration: none;
    color: var(--ink);
  }
  .publish-preview:hover {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
  }
  .publish-preview-media {
    position: relative;
    aspect-ratio: 1;
    background: var(--paper-2);
    overflow: hidden;
  }
  .publish-preview-media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .publish-preview-ph {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 700;
    color: var(--ink-faint);
  }
  .publish-preview-body {
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-height: 48px;
  }
  .plat {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-faint);
  }
  .cap {
    font-size: 12px;
    line-height: 1.35;
    color: var(--ink-soft);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
