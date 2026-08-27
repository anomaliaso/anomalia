<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import PageHead from '$lib/components/PageHead.svelte';
  import AdsReadiness from '$lib/components/AdsReadiness.svelte';
  import AdsCampaignList from '$lib/components/AdsCampaignList.svelte';
  import AdsStats from '$lib/components/AdsStats.svelte';
  import AdsOverview from '$lib/components/AdsOverview.svelte';
  import AdsBookCallPlaceholder from '$lib/components/AdsBookCallPlaceholder.svelte';
  import { adsErrorMessage } from '$lib/ads-fee';

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const selfServe = $derived(!!data.selfServe);
  const newHref = $derived(`/app/${brand.slug}/ads/google/new`);

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
        : (n.toFixed?.(2)?.replace(/\.00$/, '') ?? String(n));

  let syncing = $state(false);
</script>

<PageHead
  title={$_('app.ads.google.title')}
  subtitle={$_('app.ads.google.subtitle', { values: { brand: brand.name } })}
>
  {#snippet actions()}
    {#if selfServe}
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
    {#if data.justConnected}<div class="banner ok">{$_('app.ads.connectedOk')}</div>{/if}

    <!-- What is missing comes before what happened: the checklist leads the page while it has
         anything pending, and renders nothing once it does not. -->
    <AdsReadiness checks={data.readiness.checks} channel="google" />

    <AdsStats totals={data.summary.totals} {fmt} />

    <AdsOverview
      series={data.summary.series ?? []}
      campaigns={data.summary.campaigns}
      accountAds={data.summary.accountAds ?? []}
      {fmt}
    />

    <!-- Which Google account the spend lands on is the one thing worth showing before the list. -->
    <section class="panel block">
      <div class="panel-head">
        <div class="t">{$_('app.ads.accountsTitle')} <span>{$_('app.ads.accountsSub')}</span></div>
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
          <button class="mini edit" type="submit" disabled={syncing}>
            {syncing ? $_('app.ads.syncing') : $_('app.ads.refresh')}
          </button>
        </form>
      </div>

      {#if data.readiness.adAccounts.length}
        <ul class="accs">
          {#each data.readiness.adAccounts as a (a.id)}
            <li>
              <span class="nm">{a.name ?? a.id.slice(0, 12)}</span>
              <span class="cur">{a.currency ?? '—'}</span>
              <span class="ok">{$_('app.ads.accountActive')}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="empty">
          <p>{$_('app.ads.noGoogleAccount')}</p>
          <a class="mini connect" href={`/app/${brand.slug}/ads/connect/googleads`}>
            {$_('app.settings.ads.connectGoogle')}
          </a>
        </div>
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
  .accs { list-style: none; margin: 0; padding: 0 22px 16px; }
  .accs li {
    display: flex; gap: 12px; align-items: center; padding: 10px 0;
    border-bottom: 1px solid var(--line); font-size: 0.9rem;
  }
  .accs li:last-child { border-bottom: none; }
  .nm { font-weight: 500; }
  .cur { color: var(--muted); }
  .ok { margin-left: auto; color: var(--accent); font-size: 0.8rem; }
  .empty { padding: 22px; color: var(--muted); display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
</style>
