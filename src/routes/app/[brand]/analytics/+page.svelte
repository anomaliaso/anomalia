<script lang="ts">
  import { _ } from 'svelte-i18n';
  import StatsTiles from '$lib/components/StatsTiles.svelte';
  import PerfCards from '$lib/components/PerfCards.svelte';
  import PostRow from '$lib/components/PostRow.svelte';
  import TopPostCard from '$lib/components/TopPostCard.svelte';
  import PlatformGlyph from '$lib/components/PlatformGlyph.svelte';
  import { getPlatform } from '$lib/components/platform-meta';
  import PageHead from '$lib/components/PageHead.svelte';
  import AnimatedNum from '$lib/components/AnimatedNum.svelte';
  import { fmtCompactNum } from '$lib/fmt-num';
  let { data } = $props();
  const brand = $derived(data.brand);

  // Platform breakdown bars are sourced from posts (the full plan); the activity sections
  // below are sourced from publish_logs (what actually went out).
  const maxPlat = $derived(Math.max(1, ...data.platforms.map(([, n]) => n)));

  const pkey = (p: string | null) => (p ?? 'other').toLowerCase();
  const plabel = (p: string | null) => getPlatform(p).label;
  const pbg = (p: string | null) => getPlatform(p).bg;

  // Compact number formatting for engagement totals (12 345 → "12.3K").
  const fmtNum = fmtCompactNum;
  const METRIC_ORDER = ['views', 'likes', 'comments', 'shares'] as const;
  const metricsOf = (totals: Record<string, number>) =>
    METRIC_ORDER.filter((k) => (totals[k] ?? 0) > 0).map((k) => ({ key: k, val: totals[k] }));

  const BG = getPlatform('').bg; // fallback

  const viewsByDay = $derived(data.engagement.viewsByDay);
  const likesByDay = $derived(data.engagement.likesByDay);
  const blogByDay = $derived(data.blogViewsByDay);
  const sparkDays = $derived(data.engagement.sparkDays);
  const maxViewsDay = $derived(Math.max(1, ...viewsByDay));
  const maxLikesDay = $derived(Math.max(1, ...likesByDay));
  const maxBlogDay = $derived(Math.max(1, ...blogByDay));
  const blogPeriod = $derived(blogByDay.reduce((n, v) => n + v, 0));
  const hasHeroSignal = $derived(
    data.engagement.viewsPeriod > 0 ||
      data.engagement.likesPeriod > 0 ||
      blogPeriod > 0 ||
      data.socialPerformance.some((s) => Object.values(s.totals).some((v) => v > 0))
  );

  const dayLabels = $derived(
    Array.from({ length: sparkDays }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (sparkDays - 1 - i));
      return d.toLocaleDateString(undefined, { weekday: 'narrow' });
    })
  );

  function sparkPath(vals: number[], w = 560, h = 120, pad = 8) {
    const max = Math.max(1, ...vals);
    const step = (w - pad * 2) / Math.max(1, vals.length - 1);
    return vals
      .map((v, i) => {
        const x = pad + i * step;
        const y = h - pad - (v / max) * (h - pad * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }
  function sparkArea(vals: number[], w = 560, h = 120, pad = 8) {
    const line = sparkPath(vals, w, h, pad);
    return `${line} L${(w - pad).toFixed(1)},${(h - pad).toFixed(1)} L${pad},${(h - pad).toFixed(1)} Z`;
  }

  const viewsPath = $derived(sparkPath(viewsByDay));
  const viewsArea = $derived(sparkArea(viewsByDay));
  const blogPath = $derived(sparkPath(blogByDay, 280, 72, 6));
  const blogArea = $derived(sparkArea(blogByDay, 280, 72, 6));

  const platformEngagement = $derived(
    data.socialPerformance
      .map((s) => ({
        platform: s.platform,
        value: s.totals.views + s.totals.likes + s.totals.comments + s.totals.shares
      }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value)
  );
  const maxPlatEng = $derived(Math.max(1, ...platformEngagement.map((p) => p.value)));

  function formatStatsUpdated(iso: string | null | undefined) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return iso;
    }
  }
</script>

<div class="content">
  <PageHead
    title={$_('app.analytics.title')}
    subtitle={$_('app.analytics.subtitlePre', { values: { brand: brand.name } }) + $_('app.analytics.subtitleBold') + $_('app.analytics.subtitlePost')}
  />

  <section class="hero-charts" aria-label={$_('app.analytics.heroLabel')}>
    <div class="hero-card hero-views">
      <div class="hero-card-head">
        <div>
          <div class="hero-lbl">{$_('app.analytics.heroViews')}</div>
          <div class="hero-sub">{$_('app.analytics.heroViewsSub', { values: { days: sparkDays } })}</div>
        </div>
        <div class="hero-val"><AnimatedNum value={data.engagement.viewsPeriod} format={fmtNum} /></div>
      </div>
      <svg class="hero-spark" viewBox="0 0 560 120" preserveAspectRatio="none" aria-hidden="true">
        <path class="hero-area" d={viewsArea} />
        <path class="hero-line" d={viewsPath} />
      </svg>
      <div class="hero-axis" style={`--spark-cols:${sparkDays}`} aria-hidden="true">
        {#each dayLabels as lab, i (i)}
          <span class:hot={viewsByDay[i] === maxViewsDay && viewsByDay[i] > 0}>{lab}</span>
        {/each}
      </div>
    </div>

    <div class="hero-card hero-likes">
      <div class="hero-card-head">
        <div>
          <div class="hero-lbl">{$_('app.analytics.heroLikes')}</div>
          <div class="hero-sub">{$_('app.analytics.heroLikesSub', { values: { days: sparkDays } })}</div>
        </div>
        <div class="hero-val"><AnimatedNum value={data.engagement.likesPeriod} format={fmtNum} /></div>
      </div>
      <div class="hero-bars" aria-hidden="true">
        {#each likesByDay as v, i (i)}
          <span
            style={`height:${Math.max(8, (v / maxLikesDay) * 100)}%`}
            class:hot={v === maxLikesDay && v > 0}
            title={`${dayLabels[i]}: ${fmtNum(v)}`}
          ></span>
        {/each}
      </div>
      <div class="hero-axis" style={`--spark-cols:${sparkDays}`} aria-hidden="true">
        {#each dayLabels as lab, i (i)}
          <span class:hot={likesByDay[i] === maxLikesDay && likesByDay[i] > 0}>{lab}</span>
        {/each}
      </div>
    </div>

    <div class="hero-card hero-platforms">
      <div class="hero-card-head">
        <div>
          <div class="hero-lbl">{$_('app.analytics.heroPlatforms')}</div>
          <div class="hero-sub">{$_('app.analytics.heroPlatformsSub')}</div>
        </div>
      </div>
      {#if platformEngagement.length}
        <div class="hero-plat">
          {#each platformEngagement.slice(0, 5) as p (p.platform)}
            {@const pk = pkey(p.platform)}
            <div class="hero-plat-row">
              <div class="hero-plat-id">
                <PlatformGlyph platform={pk} />
                <span>{plabel(p.platform)}</span>
              </div>
              <div class="hero-plat-track">
                <div class="hero-plat-fill" style={`width:${(p.value / maxPlatEng) * 100}%`}></div>
              </div>
              <span class="hero-plat-n"><AnimatedNum value={p.value} format={fmtNum} /></span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="hero-empty">{$_('app.analytics.heroEmptyPlatforms')}</div>
      {/if}
    </div>

    <div class="hero-card hero-blog">
      <div class="hero-card-head">
        <div>
          <div class="hero-lbl">{$_('app.analytics.heroBlog')}</div>
          <div class="hero-sub">{$_('app.analytics.heroBlogSub', { values: { days: sparkDays } })}</div>
        </div>
        <div class="hero-val"><AnimatedNum value={blogPeriod} format={fmtNum} /></div>
      </div>
      {#if blogPeriod > 0}
        <svg class="hero-spark sm" viewBox="0 0 280 72" preserveAspectRatio="none" aria-hidden="true">
          <path class="hero-area" d={blogArea} />
          <path class="hero-line" d={blogPath} />
        </svg>
        <div class="hero-axis" style={`--spark-cols:${sparkDays}`} aria-hidden="true">
          {#each dayLabels as lab, i (i)}
            <span class:hot={blogByDay[i] === maxBlogDay && blogByDay[i] > 0}>{lab}</span>
          {/each}
        </div>
      {:else}
        <div class="hero-empty">{$_('app.analytics.heroEmptyBlog')}</div>
      {/if}
    </div>

    {#if !hasHeroSignal}
      <p class="hero-footnote">{$_('app.analytics.heroEmpty')}</p>
    {/if}
  </section>

  <StatsTiles tiles={[
    { label: $_('app.analytics.postsPlanned'), value: data.total, delta: $_('app.analytics.inContentPlan') },
    { label: $_('app.analytics.scheduled'), value: data.scheduled, delta: $_('app.analytics.queued'), up: true },
    { label: $_('app.analytics.awaitingApproval'), value: data.pending, delta: data.pending ? $_('app.analytics.reviewThem') : $_('app.analytics.allCaughtUp') },
    { label: $_('app.analytics.failed'), value: data.failed, delta: data.failed ? $_('app.analytics.needsAttention') : $_('app.analytics.none') },
  ]} />


  {#if data.socialPerformance.length}
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div class="t">
          {$_('app.analytics.perPlatform')}
          <span>{$_('app.analytics.perPlatformSub')}</span>
          {#if data.statsUpdatedAt}
            <span class="stats-updated"
              >{$_('app.analytics.statsUpdated', {
                values: { date: formatStatsUpdated(data.statsUpdatedAt) }
              })}</span
            >
          {/if}
        </div>
      </div>
      <div class="perf-grid">
        {#each data.socialPerformance as s (s.platform)}
          {@const pk = pkey(s.platform)}
          {@const ms = metricsOf(s.totals)}
          <div class="perf-card">
            <div class="perf-head">
              <PlatformGlyph platform={pk} size="lg" />
              <div class="perf-id">
                <div class="perf-name">{plabel(s.platform)}</div>
                <div class="perf-posts">{$_('app.analytics.postsTracked', { values: { count: s.posts } })}</div>
              </div>
            </div>
            {#if ms.length}
              <div class="perf-metrics">
                {#each ms as m (m.key)}
                  <div class="metric"><div class="mv"><AnimatedNum value={m.val} format={fmtNum} /></div><div class="ml">{$_('app.analytics.metric.' + m.key)}</div></div>
                {/each}
              </div>
            {:else}
              <div class="perf-noeng">{$_('app.analytics.noEngagement')}</div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    {#if data.topPosts.length}
      <section class="panel" style="margin-top:16px;">
        <div class="panel-head"><div class="t">{$_('app.analytics.topPosts')}</div></div>
        <div class="top-grid">
          {#each data.topPosts as p (p.id)}
            {@const pk = pkey(p.platform)}
            <svelte:element this={p.url ? 'a' : 'div'} class="top-card" href={p.url ?? undefined} target={p.url ? '_blank' : undefined} rel={p.url ? 'noopener noreferrer' : undefined}>
              <div class="top-thumb" style={`background:${pbg(p.platform)};`}>
                {#if p.thumbnail_url}
                  <img src={p.thumbnail_url} alt="" loading="lazy" />
                {/if}
                <span class="badge-wrap">
                  <PlatformGlyph platform={pk} />
                </span>
              </div>
              <div class="top-body">
                <div class="top-cap">{p.caption ?? $_('app.analytics.noCaption')}</div>
                <div class="top-meta">
                  {#each METRIC_ORDER as k (k)}
                    {#if p.metrics[k]}<span class="tm">{fmtNum(p.metrics[k])} {$_('app.analytics.metricLower.' + k)}</span>{/if}
                  {/each}
                </div>
                <div class="top-date">{p.published_formatted}</div>
                {#if data.paid}
                  <a class="boost-link" href={`/app/${brand.slug}/ads`} onclick={(e) => e.stopPropagation()}>{$_('app.analytics.boostThis')} →</a>
                {/if}
              </div>
            </svelte:element>
          {/each}
        </div>
      </section>
    {/if}
  {/if}

  {#if data.paid}
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div class="t">{$_('app.analytics.paid')} <span>{$_('app.analytics.paidSub')}</span></div>
        <a class="mini" href={`/app/${brand.slug}/ads`}>{$_('app.analytics.openAds')} →</a>
      </div>
      <div class="paid-stats">
        <div><b><AnimatedNum value={data.paid.totals.spend} format={fmtNum} /></b><span>{$_('app.ads.spend')}</span></div>
        <div><b><AnimatedNum value={data.paid.totals.impressions} format={fmtNum} /></b><span>{$_('app.ads.impressions')}</span></div>
        <div><b><AnimatedNum value={data.paid.totals.clicks} format={fmtNum} /></b><span>{$_('app.ads.clicks')}</span></div>
        <div><b><AnimatedNum value={data.paid.totals.active} /></b><span>{$_('app.ads.active')}</span></div>
      </div>
      {#if data.paid.campaigns.length}
        <ul class="paid-list">
          {#each data.paid.campaigns as c (c.id)}
            <li>
              <span>{c.name}</span><span class="ps">{c.status}</span><span>{fmtNum(c.spend)}</span>
              {#if c.fatigue}
                <!-- The diagnosis, not just the number: "spend went up" and "the audience is
                     exhausted" call for opposite decisions. -->
                <span class="fatigue" title={c.fatigue.action}>{c.fatigue.label}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if data.blogViews.length}
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head"><div class="t">{$_('app.analytics.blogViews')} <span>{$_('app.analytics.blogViewsSub')}</span></div></div>
      <ul class="blog-views">
        {#each data.blogViews as a (a.id)}
          <li>
            <span class="bv-title">{a.title}</span>
            <span class="bv-nums">
              <span class="bv-stat">
                <b><AnimatedNum value={a.total} format={fmtNum} /></b>
                <span class="bv-lbl">{$_('app.analytics.blogViewsTotal')}</span>
              </span>
              {#if a.last7}
                <span class="bv-stat bv-recent">
                  <b>+<AnimatedNum value={a.last7} format={fmtNum} /></b>
                  <span class="bv-lbl">{$_('app.analytics.blogViews7d')}</span>
                </span>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="charts">
    <section class="panel">
      <div class="panel-head"><div class="t">{$_('app.analytics.postsByPlatform')}</div></div>
      {#if data.platforms.length}
        <div class="hbars">
          {#each data.platforms as [name, n] (name)}
            <div class="hbar">
              <div class="top"><span>{plabel(name)}</span><span class="v"><AnimatedNum value={n} /></span></div>
              <div class="track"><div class="fill" style={`width:${(n / maxPlat) * 100}%`}></div></div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty">{$_('app.analytics.noPostsYet')}</div>
      {/if}
    </section>

    <section class="panel">
      <div class="panel-head"><div class="t">{$_('app.analytics.brand')}</div></div>
      <div class="acct"><div class="glyph" style="background:#7c5cff;">P</div><div class="nm"><div class="h">{$_('app.analytics.productsCount', { values: { count: data.products } })}</div><div class="s">{$_('app.analytics.imported')}</div></div></div>
      <div class="acct"><div class="glyph" style="background:#1877f2;">A</div><div class="nm"><div class="h">{$_('app.analytics.accountsCount', { values: { count: data.accounts } })}</div><div class="s">{$_('app.analytics.connected')}</div></div></div>
    </section>
  </div>

  <div class="charts" style="margin-top:16px;">
    <section class="panel">
      <div class="panel-head"><div class="t">{$_('app.analytics.upcoming')} <span>{$_('app.analytics.upcomingSub')}</span></div></div>
      {#if data.upcomingPosts.length}
        {#each data.upcomingPosts as p (p.id)}
          {@const pk = pkey(p.platform)}
          <div class="post-row">
            <div class="thumb" style={p.media_url ? `background-image:url(${p.media_url});` : `background:${pbg(p.platform)};`}></div>
            <div class="body">
              <div class="plat">
                <PlatformGlyph platform={pk} />
                {plabel(p.platform).toUpperCase()}
              </div>
              <div class="cap">{p.caption ?? $_('app.analytics.noCaption')}</div>
              <div class="time">{p.scheduled_for_formatted}{p.slot ? ` · ${p.slot}` : ''}</div>
            </div>
            <span class="state ok"><span class="d"></span>{$_('app.analytics.statusScheduled')}</span>
          </div>
        {/each}
      {:else}
        <div class="empty">{$_('app.analytics.emptyUpcoming')}</div>
      {/if}
    </section>

    <section class="panel">
      <div class="panel-head"><div class="t">{$_('app.analytics.recentActivity')}</div></div>
      {#if data.recentActivity.length}
        {#each data.recentActivity as a (a.id)}
          {@const pk = pkey(a.platform)}
          <div class="post-row">
            <div class="thumb" style={a.media_url ? `background-image:url(${a.media_url});` : `background:${pbg(a.platform)};`}></div>
            <div class="body">
              <div class="plat">
                <PlatformGlyph platform={pk} />
                {plabel(a.platform).toUpperCase()}
              </div>
              <div class="cap">{a.caption ?? $_('app.analytics.postRemoved')}</div>
              <div class="time">{a.created_at_formatted}{a.error ? ` · ${a.error}` : ''}</div>
            </div>
            {#if a.status === 'failed'}
              <span class="state bad"><span class="d"></span>{$_('app.analytics.statusFailed')}</span>
            {:else if a.status === 'scheduled'}
              <span class="state ok"><span class="d"></span>{$_('app.analytics.statusScheduled')}</span>
            {:else if a.status === 'canceled'}
              <span class="state muted"><span class="d"></span>{$_('app.analytics.statusCanceled')}</span>
            {:else if a.status === 'published' || a.status === 'sent'}
              <span class="state ok"><span class="d"></span>{$_('app.analytics.statusPublished')}</span>
            {:else}
              <span class="state muted"><span class="d"></span>{a.status}</span>
            {/if}
          </div>
        {/each}
      {:else}
        <div class="empty">{$_('app.analytics.emptyActivity')}</div>
      {/if}
    </section>
  </div>
</div>

<style>
  .acct .glyph { color: #fff; font-weight: 700; font-size: 12px; display: flex; align-items: center; justify-content: center; }

  /* Hero charts — first visual composition of Analisi */
  .hero-charts {
    display: grid;
    grid-template-columns: 1.45fr 1fr;
    gap: 12px;
    margin: 0 0 22px;
  }
  .hero-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 18px 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .hero-views { grid-row: span 2; }
  .hero-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .hero-lbl { font-size: 13px; font-weight: 700; letter-spacing: -0.01em; color: var(--ink); }
  .hero-sub { margin-top: 3px; font-size: 12px; color: var(--ink-faint); line-height: 1.35; }
  .hero-val { font-size: 1.65rem; font-weight: 700; letter-spacing: -0.04em; line-height: 1; color: var(--ink); font-variant-numeric: tabular-nums; }
  .hero-spark { width: 100%; height: 120px; display: block; }
  .hero-spark.sm { height: 72px; }
  .hero-area { fill: color-mix(in srgb, var(--accent) 14%, transparent); }
  .hero-line {
    fill: none; stroke: var(--accent); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round;
    stroke-dasharray: 900; animation: hero-draw 1s ease both;
  }
  @keyframes hero-draw {
    from { stroke-dashoffset: 900; }
    to { stroke-dashoffset: 0; }
  }
  .hero-bars {
    display: flex; align-items: flex-end; gap: 5px; height: 108px; padding-top: 4px; flex: 1;
  }
  .hero-bars span {
    flex: 1; border-radius: 7px 7px 3px 3px;
    background: color-mix(in srgb, var(--accent) 50%, var(--ink));
    min-height: 8px; opacity: 0.72; transition: height 0.55s ease;
  }
  .hero-bars span.hot { opacity: 1; background: var(--accent); }
  .hero-axis {
    display: grid; grid-template-columns: repeat(var(--spark-cols, 14), 1fr); gap: 2px;
  }
  .hero-axis span {
    text-align: center; font-size: 10px; font-weight: 600; color: var(--ink-faint);
    text-transform: uppercase; letter-spacing: 0.02em;
  }
  .hero-axis span.hot { color: var(--accent); }
  .hero-plat { display: flex; flex-direction: column; gap: 10px; }
  .hero-plat-row {
    display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) auto;
    align-items: center; gap: 10px;
  }
  .hero-plat-id {
    display: inline-flex; align-items: center; gap: 8px; min-width: 0;
    font-size: 13px; font-weight: 600; color: var(--ink);
  }
  .hero-plat-id span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hero-plat-track {
    height: 8px; border-radius: 980px; background: var(--paper-2); overflow: hidden;
  }
  .hero-plat-fill {
    height: 100%; border-radius: 980px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2, var(--accent)));
    transition: width 0.55s ease;
  }
  .hero-plat-n { font-size: 12.5px; font-weight: 700; color: var(--ink-soft, var(--ink)); }
  .hero-empty {
    flex: 1; display: flex; align-items: center; min-height: 72px;
    font-size: 13px; color: var(--ink-faint); line-height: 1.4;
  }
  .hero-footnote {
    grid-column: 1 / -1; margin: 0; padding: 2px 4px 0;
    font-size: 12.5px; color: var(--ink-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    .hero-line { animation: none; }
    .hero-bars span, .hero-plat-fill { transition: none; }
  }
  @container workbench (max-width: 900px) {
    .hero-charts { grid-template-columns: 1fr; }
    .hero-views { grid-row: auto; }
  }
  @media (max-width: 720px) {
    .hero-charts { grid-template-columns: 1fr; }
    .hero-views { grid-row: auto; }
    .hero-spark { height: 96px; }
    .hero-bars { height: 88px; }
    .hero-plat-row { grid-template-columns: minmax(0, 1fr) auto; }
    .hero-plat-track { grid-column: 1 / -1; }
  }

  .empty { padding: 30px 22px; text-align: center; color: var(--ink-faint); font-size: 14px; }

  .panel-head .t .stats-updated {
    display: inline;
    font-size: 12px;
    font-weight: 500;
    color: var(--ink-faint);
  }

  /* Per-platform performance cards */
  .perf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; padding: 16px; }
  .perf-card { border: 1px solid var(--line, #ececef); border-radius: 16px; padding: 14px; }
  .perf-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .perf-name { font-size: 14px; font-weight: 700; }
  .perf-posts { font-size: 11.5px; color: var(--ink-faint); }
  .perf-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .metric .mv { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .metric .ml { font-size: 11px; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .04em; }
  .perf-noeng { font-size: 12.5px; color: var(--ink-faint); }

  /* Top performing posts */
  .top-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; padding: 16px; }
  .top-card { display: flex; flex-direction: column; border: 1px solid var(--line, #ececef); border-radius: 16px;
    overflow: hidden; text-decoration: none; color: inherit; transition: box-shadow .15s, transform .15s; }
  a.top-card:hover { box-shadow: 0 14px 30px -20px rgba(0,0,0,.3); transform: translateY(-2px); }
  .top-thumb { position: relative; aspect-ratio: 16 / 10; background-size: cover; background-position: center; background-repeat: no-repeat; overflow: hidden; }
  .top-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
  .top-thumb .badge-wrap { position: absolute; top: 8px; left: 8px;
    width: 22px; height: 22px; border-radius: 7px; overflow: hidden;
    box-shadow: 0 2px 6px rgba(0,0,0,.25); display: flex; align-items: center; justify-content: center; }
  .top-thumb .badge-wrap :global(.pglyph) { width: 22px; height: 22px; border-radius: 7px; }
  .top-thumb .badge-wrap :global(.pglyph svg) { width: 13px; height: 13px; }
  .top-body { padding: 11px 12px 12px; display: flex; flex-direction: column; gap: 6px; }
  .top-cap { font-size: 13px; line-height: 1.35; color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .top-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; }
  .tm { font-size: 12px; font-weight: 600; color: var(--accent); }
  .top-date { font-size: 11.5px; color: var(--ink-faint); }
  .boost-link { font-size: 11.5px; color: var(--accent); font-weight: 600; margin-top: 2px; }
  .paid-stats {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 0 16px 12px;
  }
  .paid-stats div { display: flex; flex-direction: column; gap: 2px; }
  .paid-stats b { font-size: 18px; }
  .paid-stats span { font-size: 11px; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.04em; }
  /* The row is a 3-column grid; the diagnosis spans it on its own line. */
  .fatigue {
    grid-column: 1 / -1;
    font-size: 11px;
    line-height: 1.35;
    color: #92400e;
    background: #fffbeb;
    border: 1px solid #fcd34d;
    border-radius: 8px;
    padding: 3px 8px;
    margin-top: 4px;
  }
  .paid-list { list-style: none; margin: 0; padding: 0 16px 14px; }
  .paid-list li {
    display: grid; grid-template-columns: 1fr auto auto; gap: 10px; padding: 8px 0;
    border-top: 1px solid var(--line); font-size: 13px;
  }
  .paid-list .ps { opacity: 0.65; text-transform: uppercase; font-size: 11px; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

  .post-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--line, #ececef); }
  .post-row:first-of-type { border-top: none; }
  .thumb { width: 52px; height: 52px; border-radius: 12px; flex: 0 0 auto;
    background-size: cover; background-position: center; background-repeat: no-repeat; }
  .post-row .body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .post-row .plat { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: var(--ink-faint); letter-spacing: .03em; }
  .post-row .cap { font-size: 13.5px; color: var(--ink); line-height: 1.35;
    overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .post-row .time { font-size: 12px; color: var(--ink-faint); }
  .state { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; flex: 0 0 auto; }
  .state .d { width: 7px; height: 7px; border-radius: 50%; }
  .state.ok { color: var(--accent); } .state.ok .d { background: var(--accent); }
  .state.bad { color: #c0392b; } .state.bad .d { background: #c0392b; }
  .state.muted { color: var(--ink-faint, #86868b); text-transform: capitalize; } .state.muted .d { background: var(--ink-faint, #86868b); }
  /* blog article views — same row rhythm as .acct / panel body (22px sides) */
  .blog-views { list-style: none; margin: 0; padding: 0; }
  .blog-views li {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 22px; border-top: 1px solid var(--line);
  }
  .blog-views li:first-child { border-top: none; }
  .bv-title {
    flex: 1 1 auto; min-width: 0; font-size: 13.5px; font-weight: 500; color: var(--ink);
    line-height: 1.35; overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .bv-nums { flex: 0 0 auto; display: flex; align-items: baseline; gap: 18px; }
  .bv-stat { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; min-width: 4.5rem; }
  .bv-stat b { font-size: 15px; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; line-height: 1; }
  .bv-lbl { font-size: 11px; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
  .bv-recent b { color: var(--accent); }
  @media (max-width: 560px) {
    .blog-views li { flex-direction: column; align-items: flex-start; gap: 10px; }
    .bv-nums { width: 100%; justify-content: flex-start; gap: 20px; }
    .bv-stat { align-items: flex-start; min-width: 0; }
  }
</style>
