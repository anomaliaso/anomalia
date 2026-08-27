<script lang="ts">
  import { _ } from 'svelte-i18n';
  import AnimatedNum from '$lib/components/AnimatedNum.svelte';
  import type { MediaReviewStats } from '$lib/server/media-review-stats';
  import { formatVideoScore } from '$lib/video-score';

  let {
    stats,
    brandSlug,
    compact = false
  }: {
    stats: MediaReviewStats;
    brandSlug: string;
    compact?: boolean;
  } = $props();

  const base = $derived(`/app/${brandSlug}`);
  const logHref = $derived(`${base}/settings/media-reviewer`);
  const scored = $derived(stats.scored);
  const bucketMax = $derived(
    Math.max(1, stats.buckets.lt4, stats.buckets.lt6, stats.buckets.lt8, stats.buckets.high)
  );

  function share(n: number) {
    if (!scored) return 0;
    return Math.max(n > 0 ? 4 : 0, (n / scored) * 100);
  }

  const buckets = $derived([
    { key: 'low' as const, n: stats.buckets.lt4, tone: 'kill' },
    { key: 'weak' as const, n: stats.buckets.lt6, tone: 'fix' },
    { key: 'ok' as const, n: stats.buckets.lt8, tone: 'ok' },
    { key: 'high' as const, n: stats.buckets.high, tone: 'ship' }
  ]);
</script>

<section class="mqc" class:compact aria-label={$_('app.analytics.mediaQc.title')}>
  <div class="mqc-head">
    <div class="mqc-copy">
      <h3>{$_('app.analytics.mediaQc.title')}</h3>
      <p>
        {compact ? $_('app.analytics.mediaQc.subCompact') : $_('app.analytics.mediaQc.sub')}
      </p>
    </div>
    <a class="mqc-link" href={logHref}>{$_('app.analytics.mediaQc.seeAll')}</a>
  </div>

  {#if scored === 0}
    <p class="mqc-empty">
      {$_('app.analytics.mediaQc.empty')}
      {#if stats.pending}
        {$_('app.analytics.mediaQc.emptyPending', { values: { n: stats.pending } })}
      {/if}
    </p>
  {:else}
    <div class="mqc-kpis">
      <div class="kpi">
        <span class="n"><AnimatedNum value={scored} /></span>
        <span class="l">{$_('app.analytics.mediaQc.scored')}</span>
      </div>
      <div class="kpi">
        <span class="n">{stats.avg == null ? '–' : formatVideoScore(stats.avg)}</span>
        <span class="l">{$_('app.analytics.mediaQc.avg')}</span>
      </div>
      <a class="kpi" class:hot={stats.weak > 0} href={`${base}/calendar`}>
        <span class="n"><AnimatedNum value={stats.weak} /></span>
        <span class="l">{$_('app.analytics.mediaQc.remake')}</span>
        {#if !compact}
          <span class="s">{$_('app.analytics.mediaQc.remakeDelta')}</span>
        {/if}
      </a>
      <div class="kpi">
        <span class="n"><AnimatedNum value={stats.pending} /></span>
        <span class="l">{$_('app.analytics.mediaQc.pending')}</span>
        {#if stats.failed > 0}
          <span class="s">{$_('app.analytics.mediaQc.failedDelta', { values: { n: stats.failed } })}</span>
        {/if}
      </div>
    </div>

    <div class="mqc-viz" class:full={!compact}>
      <div class="mix">
        <div class="viz-lbl">{$_('app.analytics.mediaQc.verdictMix')}</div>
        <div class="mix-bar" role="img" aria-label={$_('app.analytics.mediaQc.verdictMix')}>
          {#if stats.ship}<span class="seg ship" style={`width:${share(stats.ship)}%`}></span>{/if}
          {#if stats.fix}<span class="seg fix" style={`width:${share(stats.fix)}%`}></span>{/if}
          {#if stats.kill}<span class="seg kill" style={`width:${share(stats.kill)}%`}></span>{/if}
        </div>
        <div class="mix-legend">
          <span><i class="dot ship"></i>{$_('app.videoReview.ship')} {stats.ship}</span>
          <span><i class="dot fix"></i>{$_('app.videoReview.fix')} {stats.fix}</span>
          <span><i class="dot kill"></i>{$_('app.videoReview.kill')} {stats.kill}</span>
        </div>
      </div>

      {#if !compact}
        <div class="hist">
          <div class="viz-lbl">{$_('app.analytics.mediaQc.distribution')}</div>
          <div class="hist-bars" aria-hidden="true">
            {#each buckets as b (b.key)}
              <div class="hist-col">
                <span class="hist-n">{b.n}</span>
                <span
                  class="hist-bar"
                  data-tone={b.tone}
                  style={`height:${Math.max(b.n ? 8 : 4, (b.n / bucketMax) * 100)}%`}
                ></span>
                <span class="hist-l">{$_(`app.analytics.mediaQc.bucket.${b.key}`)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    {#if !compact && stats.weakest.length}
      <div class="weak">
        <div class="viz-lbl">{$_('app.analytics.mediaQc.weakest')}</div>
        <ul>
          {#each stats.weakest as w, i (w.postId ?? i)}
            <li>
              <span class="score" data-verdict={w.verdict}>{formatVideoScore(w.overall)}</span>
              <div class="weak-body">
                <p class="cap">
                  {w.caption?.trim() || $_('app.analytics.noCaption')}
                </p>
                {#if w.judgment}
                  <p class="why">{w.judgment}</p>
                {/if}
              </div>
              <span class="verdict" data-verdict={w.verdict}>{$_(`app.videoReview.${w.verdict}`)}</span>
              {#if w.postId}
                <a class="open" href={`${base}/posts/${w.postId}/edit`}>{$_('app.analytics.mediaQc.openPost')}</a>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</section>

<style>
  .mqc {
    margin: 0 0 16px;
    padding: 18px 20px 16px;
    border-radius: 18px;
    border: 1px solid var(--line);
    background: var(--paper);
  }
  .mqc.compact {
    margin: 10px 0 0;
    padding: 14px;
    border-radius: 14px;
  }
  .mqc-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .mqc-copy h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .compact .mqc-copy h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .mqc-copy p {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: var(--ink-faint);
    line-height: 1.4;
  }
  .mqc-link {
    flex: none;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
  }
  .mqc-empty {
    margin: 0;
    padding: 12px;
    border-radius: 12px;
    border: 1px dashed var(--line);
    font-size: 13px;
    color: var(--ink-soft);
    text-align: center;
  }
  .mqc-kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .kpi {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--paper-2, var(--paper));
    text-decoration: none;
    color: inherit;
    min-width: 0;
  }
  .kpi.hot {
    border-color: color-mix(in srgb, #d4a017 45%, var(--line));
    background: color-mix(in srgb, #d4a017 8%, var(--paper));
  }
  .kpi .n {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .compact .kpi .n {
    font-size: 18px;
  }
  .kpi .l {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .kpi .s {
    font-size: 11px;
    color: var(--ink-faint);
  }
  .mqc-viz {
    margin-top: 14px;
  }
  .mqc-viz.full {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 16px;
    align-items: end;
  }
  .viz-lbl {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-faint);
    margin-bottom: 8px;
  }
  .mix-bar {
    display: flex;
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--ink) 8%, transparent);
  }
  .seg {
    display: block;
    height: 100%;
  }
  .seg.ship,
  .dot.ship {
    background: #3d9a5f;
  }
  .seg.fix,
  .dot.fix {
    background: #d4a017;
  }
  .seg.kill,
  .dot.kill {
    background: #e0564a;
  }
  .mix-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
    margin-top: 8px;
    font-size: 12px;
    color: var(--ink-soft);
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-right: 5px;
    vertical-align: middle;
  }
  .hist-bars {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    height: 88px;
  }
  .hist-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 0;
    height: 100%;
  }
  .hist-n {
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
  }
  .hist-bar {
    width: 100%;
    max-width: 36px;
    border-radius: 6px 6px 3px 3px;
    background: color-mix(in srgb, var(--accent) 55%, var(--ink));
  }
  .hist-bar[data-tone='kill'] {
    background: #e0564a;
  }
  .hist-bar[data-tone='fix'] {
    background: #d4a017;
  }
  .hist-bar[data-tone='ok'] {
    background: color-mix(in srgb, var(--accent) 45%, var(--ink));
  }
  .hist-bar[data-tone='ship'] {
    background: #3d9a5f;
  }
  .hist-l {
    font-size: 11px;
    color: var(--ink-faint);
  }
  .weak {
    margin-top: 16px;
  }
  .weak ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .weak li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    gap: 10px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
  }
  .score {
    font-size: 16px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
  }
  .score[data-verdict='fix'],
  .verdict[data-verdict='fix'] {
    color: #b8860b;
  }
  .score[data-verdict='kill'],
  .verdict[data-verdict='kill'] {
    color: #c4473c;
  }
  .score[data-verdict='ship'],
  .verdict[data-verdict='ship'] {
    color: #2f7a4b;
  }
  .cap {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .why {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--ink-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .verdict {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .open {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
  }

  @container workbench (max-width: 720px) {
    .mqc-kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .mqc-viz.full {
      grid-template-columns: 1fr;
    }
    .weak li {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .verdict,
    .open {
      grid-column: 2;
    }
  }
</style>
