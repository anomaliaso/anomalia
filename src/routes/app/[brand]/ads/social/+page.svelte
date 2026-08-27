<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import PageHead from '$lib/components/PageHead.svelte';
  import PlatformGlyph from '$lib/components/PlatformGlyph.svelte';
  import AdsReadiness from '$lib/components/AdsReadiness.svelte';
  import AdsCampaignList from '$lib/components/AdsCampaignList.svelte';
  import AdsStats from '$lib/components/AdsStats.svelte';
  import AdsOverview from '$lib/components/AdsOverview.svelte';
  import AdsBookCallPlaceholder from '$lib/components/AdsBookCallPlaceholder.svelte';
  import { adsErrorMessage } from '$lib/ads-fee';

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const selfServe = $derived(!!data.selfServe);
  const newHref = $derived(`/app/${brand.slug}/ads/social/new`);

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
        : (n.toFixed?.(2)?.replace(/\.00$/, '') ?? String(n));

  let proposing = $state(false);
  let syncing = $state(false);
</script>

<PageHead
  title={$_('app.ads.social.title')}
  subtitle={$_('app.ads.social.subtitle', { values: { brand: brand.name } })}
>
  {#snippet actions()}
    {#if selfServe}
      <form
        method="POST"
        action="?/sync"
        use:enhance={() => {
          syncing = true;
          return async ({ update }) => {
            await update();
            syncing = false;
          };
        }}
      >
        <button class="approve-all" type="submit" disabled={syncing}>
          {syncing ? $_('app.ads.syncing') : $_('app.ads.refresh')}
        </button>
      </form>
      <a class="mini connect" href={newHref}>{$_('app.ads.newCampaign')}</a>
    {/if}
  {/snippet}
</PageHead>

{#if !selfServe}
  <AdsBookCallPlaceholder />
{:else}
  <div class="content">
    {#if form?.error}
      {@const e = adsErrorMessage(form.error)}
      <div class="banner err">{$_(e.key, { values: e.values, default: form.error })}</div>
    {/if}
    {#if form?.approved}<div class="banner ok">{$_('app.ads.approvedOk')}</div>{/if}
    {#if form?.proposed}
      <div class="banner ok">{$_('app.ads.proposedOk', { values: { n: form.proposed.created } })}</div>
    {/if}
    {#if form?.synced}<div class="banner ok">{$_('app.ads.connectedOk')}</div>{/if}
    {#if data.justConnected}<div class="banner ok">{$_('app.ads.connectedOk')}</div>{/if}

    <!-- What is missing comes before what happened: the checklist leads the page while it has
         anything pending, and renders nothing once it does not. -->
    <AdsReadiness checks={data.readiness.checks} channel="social" />

    <AdsStats totals={data.summary.totals} {fmt} />

    <AdsOverview
      series={data.summary.series ?? []}
      campaigns={data.summary.campaigns}
      accountAds={data.summary.accountAds ?? []}
      {fmt}
    />

    <!-- Amplifying an organic winner is the cheapest paid move, so it gets its own section. -->
    <section class="panel block">
      <div class="panel-head">
        <div class="t">{$_('app.ads.candidates')} <span>{$_('app.ads.candidatesSub')}</span></div>
        <form
          method="POST"
          action="?/propose"
          use:enhance={() => {
            proposing = true;
            return async ({ update }) => {
              await update();
              proposing = false;
            };
          }}
        >
          <button class="mini edit" type="submit" disabled={!data.readiness.ready || proposing}>
            {proposing ? $_('app.ads.proposing') : $_('app.ads.proposeBoosts')}
          </button>
        </form>
      </div>

      {#if data.candidates.length}
        <div class="cands">
          {#each data.candidates as c (c.postId ?? c.externalPostId)}
            <article class="cand">
              <header>
                <PlatformGlyph platform={c.platform} />
                <span class="plat">{c.platform}</span>
                <span class="score">{Math.round(c.score)}</span>
              </header>
              <p class="cap">{c.caption ?? '—'}</p>
              <p class="why">{c.reason}</p>
            </article>
          {/each}
        </div>
        <p class="foot-hint">{$_('app.ads.candidatesHint')}</p>
      {:else}
        <div class="empty"><p>{$_('app.ads.noCandidates')}</p></div>
      {/if}
    </section>

    <AdsCampaignList
      campaigns={data.summary.campaigns}
      {fmt}
      {newHref}
      emptyCta={$_('app.ads.newCampaign')}
    />
  </div>
{/if}

<style>
  .block { margin-top: 16px; }
  .cands {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px; padding: 8px 22px 18px;
  }
  .cand {
    border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .cand header { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; }
  .plat { text-transform: capitalize; color: var(--muted); }
  .score { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
  .cap { font-size: 0.9rem; margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .why { margin: 0; font-size: 0.78rem; color: var(--muted); }
  .foot-hint { padding: 0 22px 16px; font-size: 0.8rem; color: var(--muted); }
  .empty { padding: 22px; color: var(--muted); }
</style>
