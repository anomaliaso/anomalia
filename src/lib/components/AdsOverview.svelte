<script lang="ts">
  import { _ } from 'svelte-i18n';
  import AnimatedNum from '$lib/components/AnimatedNum.svelte';
  import PlatformGlyph from '$lib/components/PlatformGlyph.svelte';

  type SeriesPoint = { date: string; spend: number; impressions: number; clicks: number };
  type AccountAd = {
    id: string;
    name: string | null;
    platform: string | null;
    status: string | null;
    goal: string | null;
    budgetAmount: number | null;
    budgetType: string | null;
    currency: string | null;
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number | null;
    cpc: number | null;
    roas: number | null;
    ours: boolean;
    platformCampaignId: string | null;
    platformAdId: string | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Campaign = any;

  let {
    series = [],
    campaigns = [],
    accountAds = [],
    fmt
  }: {
    series?: SeriesPoint[];
    campaigns?: Campaign[];
    accountAds?: AccountAd[];
    fmt: (n: number) => string;
  } = $props();

  let statusFilter = $state('all');
  let sourceFilter = $state('all');
  let query = $state('');

  const spendSeries = $derived(series.map((p) => p.spend));
  const clickSeries = $derived(series.map((p) => p.clicks));
  const maxClicks = $derived(Math.max(1, ...clickSeries, 0));

  function sparkPath(values: number[], w = 560, h = 120): string {
    if (!values.length) return '';
    const max = Math.max(1, ...values);
    const step = values.length > 1 ? w / (values.length - 1) : w;
    return values
      .map((v, i) => {
        const x = i * step;
        const y = h - (v / max) * (h - 8) - 4;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  function sparkArea(values: number[], w = 560, h = 120): string {
    const line = sparkPath(values, w, h);
    if (!line) return '';
    return `${line} L${w} ${h} L0 ${h} Z`;
  }

  const spendPath = $derived(sparkPath(spendSeries));
  const spendArea = $derived(sparkArea(spendSeries));

  const oursSpend = $derived(
    campaigns.reduce((s, c) => s + Number(c.metrics?.spend ?? 0), 0)
  );
  const externalSpend = $derived(
    accountAds.filter((a) => !a.ours).reduce((s, a) => s + (a.spend || 0), 0)
  );

  const filteredOurs = $derived(
    campaigns.filter((c) => {
      if (sourceFilter === 'external') return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = `${c.name ?? ''} ${c.goal ?? ''} ${c.platform ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
  );

  const filteredAccount = $derived(
    accountAds.filter((a) => {
      if (sourceFilter === 'ours' && !a.ours) return false;
      if (sourceFilter === 'external' && a.ours) return false;
      if (statusFilter !== 'all') {
        const st = (a.status ?? '').toLowerCase();
        if (statusFilter === 'active' && !/active/.test(st)) return false;
        if (statusFilter === 'paused' && !/pause/.test(st)) return false;
        if (statusFilter === 'proposed') return false;
      }
      if (query) {
        const q = query.toLowerCase();
        const hay = `${a.name ?? ''} ${a.goal ?? ''} ${a.platform ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
  );

  const topBySpend = $derived(
    [...campaigns]
      .filter((c) => Number(c.metrics?.spend ?? 0) > 0)
      .sort((a, b) => Number(b.metrics?.spend ?? 0) - Number(a.metrics?.spend ?? 0))
      .slice(0, 6)
  );
  const maxCampSpend = $derived(
    Math.max(1, ...topBySpend.map((c) => Number(c.metrics?.spend ?? 0)), 0)
  );

  function dayLabel(iso: string) {
    const d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function glyph(platform: string | null) {
    return String(platform ?? '').replace(/ads$/, '') || 'meta';
  }
</script>

<section class="charts" aria-label={$_('app.ads.overview.charts')}>
  <div class="card spend">
    <div class="head">
      <div>
        <div class="lbl">{$_('app.ads.overview.spendTrend')}</div>
        <div class="sub">{$_('app.ads.overview.spendTrendSub')}</div>
      </div>
      <div class="val"><AnimatedNum value={oursSpend} format={fmt} /></div>
    </div>
    {#if spendSeries.length}
      <svg class="spark" viewBox="0 0 560 120" preserveAspectRatio="none" aria-hidden="true">
        <path class="area" d={spendArea} />
        <path class="line" d={spendPath} />
      </svg>
      <div class="axis" style={`--cols:${series.length}`}>
        {#each series as p, i (p.date)}
          <span class:edge={i === 0 || i === series.length - 1}>{dayLabel(p.date)}</span>
        {/each}
      </div>
    {:else}
      <div class="empty-chart">{$_('app.ads.overview.noSeries')}</div>
    {/if}
  </div>

  <div class="card clicks">
    <div class="head">
      <div>
        <div class="lbl">{$_('app.ads.overview.clicksTrend')}</div>
        <div class="sub">{$_('app.ads.overview.clicksTrendSub')}</div>
      </div>
    </div>
    {#if clickSeries.length}
      <div class="bars" aria-hidden="true">
        {#each clickSeries as v, i (series[i]?.date ?? i)}
          <span
            style={`height:${Math.max(6, (v / maxClicks) * 100)}%`}
            class:hot={v === maxClicks && v > 0}
            title={`${series[i] ? dayLabel(series[i].date) : ''}: ${fmt(v)}`}
          ></span>
        {/each}
      </div>
    {:else}
      <div class="empty-chart">{$_('app.ads.overview.noSeries')}</div>
    {/if}
  </div>

  <div class="card split">
    <div class="head">
      <div>
        <div class="lbl">{$_('app.ads.overview.spendSplit')}</div>
        <div class="sub">{$_('app.ads.overview.spendSplitSub')}</div>
      </div>
    </div>
    <div class="split-rows">
      <div class="split-row">
        <span>{$_('app.ads.overview.ours')}</span>
        <div class="track"><div class="fill ours" style={`width:${(oursSpend / Math.max(1, oursSpend + externalSpend)) * 100}%`}></div></div>
        <b>{fmt(oursSpend)}</b>
      </div>
      <div class="split-row">
        <span>{$_('app.ads.overview.external')}</span>
        <div class="track"><div class="fill ext" style={`width:${(externalSpend / Math.max(1, oursSpend + externalSpend)) * 100}%`}></div></div>
        <b>{fmt(externalSpend)}</b>
      </div>
    </div>
  </div>

  <div class="card top">
    <div class="head">
      <div>
        <div class="lbl">{$_('app.ads.overview.topCampaigns')}</div>
        <div class="sub">{$_('app.ads.overview.topCampaignsSub')}</div>
      </div>
    </div>
    {#if topBySpend.length}
      <div class="top-list">
        {#each topBySpend as c (c.id)}
          <div class="top-row">
            <span class="nm" title={c.name}>{c.name}</span>
            <div class="track"><div class="fill" style={`width:${(Number(c.metrics?.spend ?? 0) / maxCampSpend) * 100}%`}></div></div>
            <b>{fmt(Number(c.metrics?.spend ?? 0))}</b>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-chart">{$_('app.ads.overview.noOurs')}</div>
    {/if}
  </div>
</section>

<!-- Nothing to filter yet? The controls are noise — an empty three-field form reads as broken. -->
{#if campaigns.length || accountAds.length}
<section class="panel filters">
  <div class="panel-head">
    <div class="t">{$_('app.ads.overview.filters')}</div>
  </div>
  <div class="filter-row">
    <label class="fld">
      <span class="lb">{$_('app.ads.overview.source')}</span>
      <select bind:value={sourceFilter}>
        <option value="all">{$_('app.ads.overview.sourceAll')}</option>
        <option value="ours">{$_('app.ads.overview.ours')}</option>
        <option value="external">{$_('app.ads.overview.external')}</option>
      </select>
    </label>
    <label class="fld">
      <span class="lb">{$_('app.ads.overview.status')}</span>
      <select bind:value={statusFilter}>
        <option value="all">{$_('app.ads.overview.statusAll')}</option>
        <option value="proposed">{$_('app.ads.status.proposed')}</option>
        <option value="active">{$_('app.ads.status.active')}</option>
        <option value="pending_review">{$_('app.ads.status.pending_review')}</option>
        <option value="paused">{$_('app.ads.status.paused')}</option>
        <option value="failed">{$_('app.ads.status.failed')}</option>
      </select>
    </label>
    <label class="fld grow">
      <span class="lb">{$_('app.ads.overview.search')}</span>
      <input type="search" bind:value={query} placeholder={$_('app.ads.overview.searchPh')} />
    </label>
  </div>
</section>
{/if}

{#if sourceFilter !== 'external'}
  <section class="panel block">
    <div class="panel-head">
      <div class="t">
        {$_('app.ads.overview.oursTitle')}
        <span>{$_('app.ads.overview.oursSub', { values: { n: filteredOurs.length } })}</span>
      </div>
    </div>
    {#if !filteredOurs.length}
      <div class="empty"><p>{$_('app.ads.overview.noOurs')}</p></div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{$_('app.ads.name')}</th>
              <th>{$_('app.ads.overview.status')}</th>
              <th>{$_('app.ads.goal')}</th>
              <th>{$_('app.ads.dailyBudget')}</th>
              <th>{$_('app.ads.spend')}</th>
              <th>{$_('app.ads.impressions')}</th>
              <th>{$_('app.ads.clicks')}</th>
              <th>CTR</th>
              <th>CPC</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredOurs as c (c.id)}
              {@const m = c.metrics}
              <tr>
                <td class="nm">
                  <PlatformGlyph platform={glyph(c.platform)} />
                  <span>{c.name}</span>
                </td>
                <td><span class="badge s-{c.status}">{$_(`app.ads.status.${c.status}`, { default: String(c.status) })}</span></td>
                <td>{c.goal}</td>
                <td>{c.budget_amount} {c.currency ?? ''}</td>
                <td>{m ? fmt(Number(m.spend)) : '—'}</td>
                <td>{m ? fmt(Number(m.impressions)) : '—'}</td>
                <td>{m ? fmt(Number(m.clicks)) : '—'}</td>
                <td>{m?.ctr != null ? `${Number(m.ctr).toFixed(2)}%` : '—'}</td>
                <td>{m?.cpc != null ? fmt(Number(m.cpc)) : '—'}</td>
                <td>{m?.roas != null ? fmt(Number(m.roas)) : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}

{#if sourceFilter !== 'ours'}
  <section class="panel block">
    <div class="panel-head">
      <div class="t">
        {$_('app.ads.overview.accountTitle')}
        <span>{$_('app.ads.overview.accountSub', { values: { n: filteredAccount.length } })}</span>
      </div>
    </div>
    {#if !filteredAccount.length}
      <div class="empty"><p>{$_('app.ads.overview.noAccount')}</p></div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{$_('app.ads.name')}</th>
              <th>{$_('app.ads.overview.source')}</th>
              <th>{$_('app.ads.overview.status')}</th>
              <th>{$_('app.ads.goal')}</th>
              <th>{$_('app.ads.dailyBudget')}</th>
              <th>{$_('app.ads.spend')}</th>
              <th>{$_('app.ads.impressions')}</th>
              <th>{$_('app.ads.clicks')}</th>
              <th>CTR</th>
              <th>CPC</th>
            </tr>
          </thead>
          <tbody>
            <!-- Top 5 only: the account can hold hundreds of pre-existing ads and this is a
                 summary panel, not the ad manager. The head count still says how many matched. -->
            {#each filteredAccount.slice(0, 5) as a (a.id)}
              <tr>
                <td class="nm">
                  <PlatformGlyph platform={glyph(a.platform)} />
                  <span>{a.name ?? a.platformAdId ?? a.id.slice(0, 8)}</span>
                </td>
                <td>
                  <span class="badge" class:ours={a.ours}>{a.ours ? $_('app.ads.overview.ours') : $_('app.ads.overview.external')}</span>
                </td>
                <td>{a.status ?? '—'}</td>
                <td>{a.goal ?? '—'}</td>
                <td>{a.budgetAmount != null ? `${a.budgetAmount} ${a.currency ?? ''}` : '—'}</td>
                <td>{fmt(a.spend)}</td>
                <td>{fmt(a.impressions)}</td>
                <td>{fmt(a.clicks)}</td>
                <td>{a.ctr != null ? `${a.ctr.toFixed(2)}%` : '—'}</td>
                <td>{a.cpc != null ? fmt(a.cpc) : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}

<style>
  .charts {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  .card {
    background: var(--panel, #fff);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px 18px;
    min-height: 180px;
    display: flex;
    flex-direction: column;
  }
  .head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  .lbl { font-weight: 600; font-size: 0.95rem; }
  .sub { color: var(--muted); font-size: 0.8rem; margin-top: 2px; }
  .val { font-size: 1.5rem; font-variant-numeric: tabular-nums; font-weight: 600; }
  .spark { width: 100%; height: 110px; margin-top: 8px; }
  .area { fill: color-mix(in srgb, var(--accent) 18%, transparent); }
  .line { fill: none; stroke: var(--accent); stroke-width: 2.5; }
  .axis {
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    gap: 0;
    margin-top: 6px;
    font-size: 0.68rem;
    color: var(--muted);
  }
  .axis span { opacity: 0; text-align: center; }
  .axis span.edge { opacity: 1; }
  .bars {
    display: flex; align-items: flex-end; gap: 3px; height: 110px; margin-top: 10px;
  }
  .bars span {
    flex: 1; background: color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 3px 3px 0 0; min-width: 2px;
  }
  .bars span.hot { background: var(--accent); }
  .empty-chart {
    flex: 1; display: grid; place-items: center; color: var(--muted); font-size: 0.85rem;
    text-align: center; padding: 20px;
  }
  .split-rows, .top-list { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
  .split-row, .top-row {
    display: grid; grid-template-columns: 90px 1fr 56px; gap: 10px; align-items: center;
    font-size: 0.85rem;
  }
  .top-row { grid-template-columns: minmax(0, 1.2fr) 1fr 56px; }
  .top-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track { height: 8px; background: color-mix(in srgb, var(--line) 80%, transparent); border-radius: 99px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); border-radius: 99px; }
  .fill.ext { background: color-mix(in srgb, var(--accent) 45%, #888); }
  /* Controls inherit the global .fld form styling (src/app.css) so they follow the theme. */
  .filters { margin-bottom: 12px; }
  .filter-row { --control-h: 40px; display: flex; flex-wrap: wrap; gap: 12px; padding: 4px 22px 18px; }
  .filter-row .grow { flex: 1; min-width: 180px; }
  .block { margin-top: 12px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { color: var(--muted); font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.02em; }
  td.nm { display: flex; align-items: center; gap: 8px; max-width: 280px; }
  td.nm span { overflow: hidden; text-overflow: ellipsis; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem;
    background: color-mix(in srgb, var(--line) 70%, transparent);
  }
  .badge.ours { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
  .badge.s-active, .badge.s-pending_review { background: color-mix(in srgb, #22c55e 18%, transparent); }
  .badge.s-proposed { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .badge.s-paused, .badge.s-failed { background: color-mix(in srgb, #f59e0b 18%, transparent); }
  .empty { padding: 22px; color: var(--muted); }
  @media (max-width: 900px) {
    .charts { grid-template-columns: 1fr; }
  }
</style>
