<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import PageHead from '$lib/components/PageHead.svelte';
  import TopbarCta from '$lib/components/TopbarCta.svelte';
  import { refreshCredits } from '$lib/stores/credits';
  import { RefreshCw } from '@lucide/svelte';

  let { data, form } = $props();

  const brandSlug = $derived($page.params.brand ?? '');
  let busy = $state(false);
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
      if (brandSlug) setTimeout(() => refreshCredits(brandSlug), 600);
    };
  };

  const strategy = $derived(data.strategy);
  const keywords = $derived(strategy?.keywords ?? []);
  const highCount = $derived(keywords.filter((k) => k.opportunity === 'high').length);

  function oppClass(o: string): string {
    if (o === 'high') return 'opp-high';
    if (o === 'medium') return 'opp-med';
    return 'opp-low';
  }

  function formatVolume(n: number | undefined): string {
    if (n == null || n <= 0) return '—';
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return String(n);
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }
</script>

<svelte:head>
  <title>Anomalia — {$_('app.hub.web.keywords')}</title>
</svelte:head>

<div class="content">
  <PageHead title={$_('app.keywords.pageTitle')} subtitle={$_('app.keywords.pageSubtitle')}>
    {#snippet actions()}
      <form class="topbar-cta-wrap" class:is-busy={busy} method="POST" action="?/refresh" use:enhance={withBusy}>
        <TopbarCta {busy} Icon={RefreshCw}>
          {busy
            ? $_('app.keywords.refreshing')
            : strategy
              ? $_('app.keywords.refresh')
              : $_('app.keywords.emptyCta')}
        </TopbarCta>
      </form>
    {/snippet}
  </PageHead>

  {#if form?.error}<div class="err">{form.error}</div>{/if}

  {#if data.gsc?.configured && !data.gscReady && data.gscGate}
    <section class="card gsc-panel gsc-gate">
      {#if data.gsc?.connected && !data.gsc?.siteUrl}
        <h3>Choose a Search Console property</h3>
        <p class="muted">Google is connected. Pick which domain this brand should use so keyword research can use real queries.</p>
        <a class="tiny" href={`/app/${brandSlug}/settings/search-console`}>Choose property →</a>
      {:else if data.gsc?.connected}
        <h3>Sync Search Console</h3>
        <p class="muted">GSC is connected but data is missing or stale. Sync it so keyword research can use your real queries.</p>
        <a class="tiny" href={`/app/${brandSlug}/settings/search-console`}>Sync Search Console →</a>
      {:else}
        <h3>Connect Search Console</h3>
        <p class="muted">GSC is available on this environment. Connect and sync it so keyword research can use your real queries — not just estimates.</p>
        <a class="tiny" href={`/app/${brandSlug}/settings/search-console`}>Connect Search Console →</a>
      {/if}
    </section>
  {:else if data.gscReady}
    <section class="card gsc-panel">
      <h3>Search Console (28d)</h3>
      <p class="muted tiny">{data.gsc.clicks28d} clicks · {data.gsc.impressions28d} impressions
        {#if data.gsc.siteUrl} · {data.gsc.siteUrl}{/if}
      </p>
      {#if data.gsc.topQueries?.length}
        <ul class="gsc-list">
          {#each data.gsc.topQueries.slice(0, 5) as q (q.query)}
            <li><strong>{q.query}</strong> — {q.clicks} clicks · pos {q.position}</li>
          {/each}
        </ul>
      {/if}
      <a class="tiny" href={`/app/${brandSlug}/settings/search-console`}>Manage connection →</a>
    </section>
  {:else if data.gsc?.connected && !data.gsc?.siteUrl}
    <section class="card gsc-panel">
      <h3>Search Console</h3>
      <p class="muted">Google is connected — pick which property this brand should use.</p>
      <a class="tiny" href={`/app/${brandSlug}/settings/search-console`}>Choose property →</a>
    </section>
  {:else if data.gsc?.connected}
    <section class="card gsc-panel">
      <h3>Search Console</h3>
      <p class="muted">Connected, but data is missing or stale — sync from Settings so keyword priorities can use owned queries.</p>
      <a class="tiny" href={`/app/${brandSlug}/settings/search-console`}>Sync →</a>
    </section>
  {:else}
    <section class="card gsc-panel">
      <h3>Search Console</h3>
      <p class="muted">Without GSC, keyword priorities are estimates from web research + DataForSEO.</p>
      <a class="tiny" href={`/app/${brandSlug}/settings/search-console`}>Connect →</a>
    </section>
  {/if}

  {#if data.ranks?.length}
    <section class="card ranks-panel">
      <div class="ranks-head">
        <h3>Rank tracker</h3>
        <form method="POST" action="?/checkRanks" use:enhance={withBusy}>
          <button type="submit" class="linkish" disabled={busy}>Check now</button>
        </form>
      </div>
      <table class="ranks-table">
        <thead><tr><th>Keyword</th><th>Pos</th><th>Δ</th><th>AIO</th></tr></thead>
        <tbody>
          {#each data.ranks as r (r.id)}
            <tr>
              <td>{r.keyword}</td>
              <td>{r.position ?? '—'}</td>
              <td class:up={r.delta != null && r.delta > 0} class:down={r.delta != null && r.delta < 0}>
                {r.delta == null ? '—' : r.delta > 0 ? `+${r.delta}` : r.delta}
              </td>
              <td>{r.hasAiOverview ? 'yes' : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <form class="add-kw" method="POST" action="?/addKeyword" use:enhance={withBusy}>
        <input name="keyword" placeholder="Track a keyword" required />
        <button type="submit" disabled={busy}>Add</button>
      </form>
    </section>
  {/if}

  {#if !strategy}
    <div class="empty">
      <h3>{$_('app.keywords.emptyTitle')}</h3>
      {#if $page.data.flags?.navTeam}
        <!-- FEATURE_NAV_TEAM: la ricerca keyword è mestiere dell'agente SEO — si propone lui. -->
      {:else}
        <p class="muted">{$_('app.keywords.emptyDesc')}</p>
      {/if}
      <form method="POST" action="?/refresh" use:enhance={withBusy}>
        <TopbarCta {busy} Icon={RefreshCw} class="empty-cta">
          {busy ? $_('app.keywords.refreshing') : $_('app.keywords.emptyCta')}
        </TopbarCta>
      </form>
    </div>
  {:else}
    <section class="focus card">
      <div class="focus-meta">
        <span class="pill">{$_('app.keywords.focus')}</span>
        {#if data.updatedAt}
          <span class="muted tiny">{$_('app.keywords.updated', { values: { date: formatDate(data.updatedAt) } })}</span>
        {/if}
        <span class="muted tiny">{$_('app.keywords.autoRefresh')}</span>
      </div>
      <p class="focus-text">{strategy.focusSummary}</p>
      <div class="stats">
        <div class="stat">
          <div class="stat-val">{keywords.length}</div>
          <div class="stat-label">{$_('app.keywords.statTotal')}</div>
        </div>
        <div class="stat">
          <div class="stat-val high">{highCount}</div>
          <div class="stat-label">{$_('app.keywords.statHigh')}</div>
        </div>
        <div class="stat">
          <div class="stat-val">{strategy.competitorGaps?.length ?? 0}</div>
          <div class="stat-label">{$_('app.keywords.statGaps')}</div>
        </div>
      </div>
    </section>

    <section class="kw-section">
      <h3>{$_('app.keywords.listTitle')}</h3>
      <p class="muted section-sub">{$_('app.keywords.listSubtitle')}</p>
      <div class="kw-table-wrap">
        <table class="kw-table">
          <thead>
            <tr>
              <th>{$_('app.keywords.col.keyword')}</th>
              <th>{$_('app.keywords.col.opportunity')}</th>
              <th>{$_('app.keywords.col.volume')}</th>
              <th>{$_('app.keywords.col.difficulty')}</th>
              <th>{$_('app.keywords.col.intent')}</th>
              <th>{$_('app.keywords.col.action')}</th>
            </tr>
          </thead>
          <tbody>
            {#each keywords as k (k.keyword)}
              <tr>
                <td>
                  <div class="kw-name">{k.keyword}</div>
                  <div class="kw-rationale muted">{k.rationale}</div>
                </td>
                <td>
                  <span class="opp {oppClass(k.opportunity)}">{$_(`app.keywords.opp.${k.opportunity}`)}</span>
                </td>
                <td class="num">{formatVolume(k.volume)}</td>
                <td class="num">{k.difficulty != null && k.difficulty > 0 ? k.difficulty : '—'}</td>
                <td>
                  <span class="intent">{$_(`app.keywords.intent.${k.intent}`)}</span>
                </td>
                <td class="action-cell">{k.action}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    {#if strategy.competitorGaps?.length}
      <section class="kw-section">
        <h3>{$_('app.keywords.gapsTitle')}</h3>
        <div class="gaps">
          {#each strategy.competitorGaps as g (g.competitor + g.gap)}
            <div class="gap card">
              <div class="gap-comp">{g.competitor}</div>
              <p>{g.gap}</p>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if data.citations?.length}
      <section class="kw-section">
        <h3>{$_('app.keywords.sourcesTitle')}</h3>
        <ul class="citations">
          {#each data.citations.slice(0, 12) as c}
            <li><a href={c.uri} target="_blank" rel="noopener noreferrer">{c.title || c.uri}</a></li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

<style>
  .page-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 4px;
  }
  .page-head h2 {
    margin: 0 0 4px;
  }
  .muted {
    color: var(--ink-soft);
  }
  .tiny {
    font-size: 12px;
  }
  .err {
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecaca;
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 14px;
    font-size: 13px;
  }
  .empty {
    text-align: center;
    padding: 48px 20px;
    border: 1px dashed var(--line);
    border-radius: 16px;
    background: var(--paper);
  }
  .empty h3 {
    margin: 0 0 8px;
  }
  .empty p {
    margin: 0 0 20px;
    max-width: 420px;
    margin-inline: auto;
  }
  :global(.empty-cta.topbar-cta) {
    padding: 11px 20px;
    font-size: 14px;
  }
  .card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 20px;
  }
  .focus {
    margin-bottom: 22px;
  }
  .focus-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin-bottom: 10px;
  }
  .pill {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--paper-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 10px;
  }
  .focus-text {
    margin: 0 0 16px;
    line-height: 1.55;
    font-size: 15px;
  }
  .stats {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }
  .stat-val {
    font-size: 1.4rem;
    font-weight: 700;
    line-height: 1;
  }
  .stat-val.high {
    color: #16a34a;
  }
  .stat-label {
    font-size: 12px;
    color: var(--ink-soft);
    margin-top: 4px;
  }
  .kw-section {
    margin-bottom: 28px;
  }
  .kw-section h3 {
    margin: 0 0 4px;
    font-size: 1.05rem;
  }
  .section-sub {
    margin: 0 0 14px;
    font-size: 13px;
  }
  .kw-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--paper);
  }
  .kw-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .kw-table th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--ink-soft);
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .kw-table td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  .kw-table tr:last-child td {
    border-bottom: none;
  }
  .kw-name {
    font-weight: 600;
    margin-bottom: 2px;
  }
  .kw-rationale {
    font-size: 12px;
    line-height: 1.4;
    max-width: 320px;
  }
  .num {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .opp {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    border-radius: 999px;
    padding: 2px 8px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .opp-high {
    background: #dcfce7;
    color: #166534;
  }
  .opp-med {
    background: #fef3c7;
    color: #92400e;
  }
  .opp-low {
    background: var(--paper-2);
    color: var(--ink-soft);
  }
  .intent {
    font-size: 12px;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .action-cell {
    max-width: 260px;
    line-height: 1.4;
    color: var(--ink);
  }
  .gaps {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }
  .gap-comp {
    font-weight: 700;
    margin-bottom: 6px;
  }
  .gap p {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--ink-soft);
  }
  .citations {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
  }
  .citations a {
    color: var(--ink-soft);
  }
  @media (max-width: 720px) {
    .page-head {
      flex-direction: column;
    }
    .action-cell {
      max-width: 180px;
    }
  }
  .gsc-panel, .ranks-panel { margin-bottom: 16px; padding: 16px; }
  .gsc-list { margin: 8px 0; padding-left: 18px; font-size: 13px; }
  .ranks-head { display: flex; justify-content: space-between; align-items: center; }
  .ranks-table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0; }
  .ranks-table th, .ranks-table td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--border, #eee); }
  .ranks-table .up { color: #0a7; }
  .ranks-table .down { color: #b00020; }
  .linkish { background: none; border: 0; color: var(--accent, #5b4); cursor: pointer; font-size: 13px; }
  .add-kw { display: flex; gap: 8px; margin-top: 8px; }
  .add-kw input { flex: 1; padding: 8px; border: 1px solid var(--border, #ddd); border-radius: 6px; }
  .add-kw button { padding: 8px 12px; border-radius: 6px; border: 0; background: #111; color: #fff; cursor: pointer; }
</style>
