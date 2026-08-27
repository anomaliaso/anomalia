<script lang="ts">
  import { _ } from 'svelte-i18n';

  let { data } = $props();
  const brand = $derived(data.brand);
  const post = $derived(data.post);

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
        : Number.isInteger(n)
          ? String(n)
          : n.toFixed(2).replace(/\.00$/, '');

  const metricOrder = [
    'views',
    'impressions',
    'likes',
    'comments',
    'shares',
    'saves',
    'engagementRate'
  ] as const;

  const organicTiles = $derived.by(() => {
    const m = data.organic?.metrics ?? {};
    return metricOrder
      .filter((k) => m[k] != null && Number(m[k]) !== 0)
      .map((k) => ({
        key: k,
        value:
          k === 'engagementRate'
            ? `${((Number(m[k]) || 0) * 100).toFixed(1)}%`
            : fmt(Number(m[k]) || 0)
      }));
  });
</script>

<section class="stack">
  <div class="panel">
    <div class="panel-head">
      <div class="t">{$_('app.post.analytics.title')}</div>
      {#if data.organic?.syncedAt}
        <div class="s">{$_('app.post.analytics.synced', { values: { when: new Date(data.organic.syncedAt).toLocaleString() } })}</div>
      {/if}
    </div>

    {#if !data.published}
      <p class="empty">{$_('app.post.analytics.notPublished')}</p>
    {:else if organicTiles.length}
      <div class="tiles">
        {#each organicTiles as t (t.key)}
          <div class="tile">
            <div class="lbl">{$_('app.post.analytics.metric.' + t.key)}</div>
            <div class="val">{t.value}</div>
          </div>
        {/each}
      </div>
      {#if data.organic?.url}
        <a class="link" href={data.organic.url} target="_blank" rel="noopener">{$_('app.post.analytics.viewLive')}</a>
      {/if}
    {:else}
      <p class="empty">{$_('app.post.analytics.noMetrics')}</p>
      {#if post.published_url}
        <a class="link" href={post.published_url} target="_blank" rel="noopener">{$_('app.post.analytics.viewLive')}</a>
      {/if}
    {/if}
  </div>

  {#if data.paid.length}
    <div class="panel">
      <div class="panel-head"><div class="t">{$_('app.post.analytics.paidTitle')}</div></div>
      <ul class="paid">
        {#each data.paid as c (c.id)}
          <li>
            <div class="paid-main">
              <span class="paid-name">{c.name}</span>
              <span class="paid-st">{c.status}</span>
            </div>
            <div class="paid-metrics">
              <span>{$_('app.ads.spend')}: {fmt(c.spend)} {c.currency}</span>
              <span>{$_('app.ads.impressions')}: {fmt(c.impressions)}</span>
              <span>{$_('app.ads.clicks')}: {fmt(c.clicks)}</span>
            </div>
          </li>
        {/each}
      </ul>
      <a class="link" href={`/app/${brand.slug}/posts/${post.id}/boost`}>{$_('app.post.analytics.manageBoost')}</a>
    </div>
  {/if}

  {#if data.publishLog.length}
    <div class="panel">
      <div class="panel-head"><div class="t">{$_('app.post.analytics.logTitle')}</div></div>
      <ul class="log">
        {#each data.publishLog as row (row.id)}
          <li>
            <span class="log-st">{row.status}</span>
            <span class="log-plat">{row.platform ?? '—'}</span>
            <span class="log-when">{new Date(row.createdAt).toLocaleString()}</span>
            {#if row.error}<span class="log-err">{row.error}</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .stack { display: flex; flex-direction: column; gap: 16px; }
  .panel {
    padding: 18px 20px 22px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper);
  }
  .panel-head { margin-bottom: 14px; }
  .t { font-size: 15px; font-weight: 700; }
  .s { font-size: 12px; color: var(--ink-faint); margin-top: 4px; }
  .empty { margin: 0; font-size: 14px; color: var(--ink-soft); line-height: 1.5; }
  .tiles {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px;
  }
  .tile {
    padding: 14px 12px; border-radius: 12px; background: var(--paper-2);
    border: 1px solid var(--line);
  }
  .lbl { font-size: 11px; font-weight: 650; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.03em; }
  .val { font-size: 1.35rem; font-weight: 700; letter-spacing: -0.03em; margin-top: 6px; }
  .link {
    display: inline-block; margin-top: 14px; font-size: 13px; font-weight: 650;
    color: var(--accent); text-decoration: none;
  }
  .paid, .log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .paid li, .log li {
    padding: 12px 0; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px;
  }
  .paid li:first-child, .log li:first-child { border-top: none; padding-top: 0; }
  .paid-main { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .paid-name { font-weight: 650; font-size: 13.5px; }
  .paid-st, .log-st {
    font-size: 11px; font-weight: 650; padding: 2px 8px; border-radius: 999px;
    background: var(--paper-2); border: 1px solid var(--line); color: var(--ink-soft);
  }
  .paid-metrics { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12.5px; color: var(--ink-soft); }
  .log li { display: grid; grid-template-columns: auto auto 1fr; gap: 10px; align-items: baseline; font-size: 12.5px; }
  .log-plat { color: var(--ink-soft); }
  .log-when { color: var(--ink-faint); text-align: right; }
  .log-err { grid-column: 1 / -1; color: #c0392b; }
</style>
