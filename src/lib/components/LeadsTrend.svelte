<script lang="ts">
  import AnimatedNum from '$lib/components/AnimatedNum.svelte';
  import { _, locale } from 'svelte-i18n';

  let {
    days,
    day,
    threeDays,
    week
  }: {
    days: { date: string; count: number }[];
    day: number;
    threeDays: number;
    week: number;
  } = $props();

  const max = $derived(Math.max(1, ...days.map((d) => d.count)));
  const total = $derived(days.reduce((s, d) => s + d.count, 0));

  const fmtDay = (iso: string) =>
    new Date(iso + 'T00:00:00Z').toLocaleDateString($locale ?? undefined, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC'
    });
</script>

<section class="trend">
  <header class="trend-head">
    <div class="t">
      <span class="lbl">{$_('app.leads.trendTitle')}</span>
      <span class="range">{$_('app.leads.trendRange')}</span>
    </div>
    <div class="stats">
      <span class="stat"><b><AnimatedNum value={day} /></b>{$_('app.leads.stat24h')}</span>
      <span class="stat"><b><AnimatedNum value={threeDays} /></b>{$_('app.leads.stat3d')}</span>
      <span class="stat"><b><AnimatedNum value={week} /></b>{$_('app.leads.stat7d')}</span>
    </div>
  </header>

  {#if total > 0}
    <!-- One series, one hue: no legend needed, the header names it. Bars are plain divs so the
         hover tooltip is CSS-only. -->
    <div class="bars" role="img" aria-label={$_('app.leads.trendTitle')}>
      {#each days as d (d.date)}
        <div class="col">
          <div class="bar" class:zero={!d.count} style={d.count ? `height:${Math.max(6, (d.count / max) * 100)}%` : ''}></div>
          <span class="tip">{fmtDay(d.date)} · {$_('app.leads.trendCount', { values: { n: d.count } })}</span>
        </div>
      {/each}
    </div>
    <div class="axis">
      <span>{fmtDay(days[0].date)}</span>
      <span class="peak">{$_('app.leads.trendPeak', { values: { n: max } })}</span>
      <span>{fmtDay(days[days.length - 1].date)}</span>
    </div>
  {:else}
    <p class="none">{$_('app.leads.trendEmpty')}</p>
  {/if}
</section>

<style>
  .trend {
    position: relative;
    color: var(--ink);
    border-radius: 16px;
    padding: 16px 20px 14px;
    margin: 0 0 20px;
    background: var(--paper-2);
    border: 1px solid var(--line);
  }
  :global(:root[data-theme='dark']) .trend {
    background: var(--paper-3, var(--paper-2));
  }

  /* Title block and stat block are both two rows (value over caption) and share the same
     centre line, so nothing floats. */
  .trend-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .t { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .lbl { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.2; }
  .range { font-size: 11px; color: var(--ink-faint); line-height: 1.2; }
  .stats { display: flex; align-items: center; gap: 18px; }
  .stat {
    display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
    font-size: 11px; line-height: 1.2; color: var(--ink-faint); white-space: nowrap;
  }
  .stat b {
    font-size: 1.5rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1;
    color: var(--ink); font-variant-numeric: tabular-nums;
  }

  .bars {
    display: flex; align-items: flex-end; gap: 2px;
    height: 84px;
    border-bottom: 1px solid var(--line);
    padding-bottom: 1px;
  }
  .col { position: relative; flex: 1; height: 100%; display: flex; align-items: flex-end; }
  .bar {
    width: 100%;
    background: color-mix(in srgb, var(--accent) 72%, transparent);
    border-radius: 4px 4px 0 0;
    transition: background 0.15s var(--ease, ease);
  }
  /* Empty days still read as a day: a hairline on the baseline. */
  .bar.zero { height: 2px; border-radius: 2px; background: var(--line); }
  .col:hover .bar { background: var(--accent); }
  .col:hover .bar.zero { background: var(--line-2, var(--line)); }

  .tip {
    position: absolute; bottom: calc(100% + 6px); left: 50%; translate: -50% 0;
    padding: 4px 8px; border-radius: 8px; white-space: nowrap;
    font-size: 11px; font-weight: 600;
    background: var(--ink); color: var(--paper);
    opacity: 0; pointer-events: none; transition: opacity 0.12s var(--ease, ease);
    z-index: 2;
  }
  .col:hover .tip { opacity: 1; }

  .axis {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 6px; font-size: 10.5px; color: var(--ink-faint);
  }
  .peak { font-weight: 600; }

  .none { margin: 0; padding: 14px 0; text-align: center; font-size: 13px; color: var(--ink-faint); }

  @container workbench (max-width: 1020px) {
    .trend { padding: 14px 14px 12px; }
    .stats { gap: 14px; }
    .stat b { font-size: 1.25rem; }
    .bars { height: 64px; }
  }
</style>
