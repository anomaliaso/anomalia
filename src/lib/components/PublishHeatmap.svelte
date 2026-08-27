<!-- GitHub / cal-heatmap style contribution grid.
     Shows the last ~12 months: columns = weeks, rows = Mon→Sun. -->
<script lang="ts">
  import { _ } from 'svelte-i18n';

  type DayCount = { day: string; count: number };

  let { heatmap, timezone }: { heatmap: DayCount[]; timezone: string } = $props();

  const countMap = $derived(new Map(heatmap.map((d) => [d.day, d.count])));

  // "Today" in the brand's timezone.
  const today = $derived.by(() => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date())
        .map((x) => [x.type, x.value])
    );
    return `${p.year}-${p.month}-${p.day}`; // YYYY-MM-DD
  });

  // Build the full grid: start on the Monday on or before 53 weeks ago from today.
  type Cell = { key: string; count: number; future: boolean };

  const grid = $derived.by(() => {
    const [ty, tm, td] = today.split('-').map(Number);
    const todayDate = new Date(Date.UTC(ty, tm - 1, td));
    const todayDow = todayDate.getUTCDay(); // 0=Sun
    const todayMonOffset = (todayDow + 6) % 7; // days since Monday

    // Start: Monday 53 weeks ago.
    const startDate = new Date(todayDate);
    startDate.setUTCDate(startDate.getUTCDate() - todayMonOffset - 52 * 7);

    const cols: Cell[][] = [];
    const d = new Date(startDate);
    while (d <= todayDate) {
      const col: Cell[] = [];
      for (let r = 0; r < 7; r++) {
        const key = fmt(d);
        const isFuture = d > todayDate;
        col.push({ key, count: countMap.get(key) ?? 0, future: isFuture });
        d.setUTCDate(d.getUTCDate() + 1);
      }
      cols.push(col);
    }
    return cols;
  });

  // Month labels: one per column where the month changes.
  const monthLabels = $derived.by(() => {
    const labels: { col: number; label: string }[] = [];
    let prevMonth = -1;
    const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'short' });
    for (let i = 0; i < grid.length; i++) {
      // Use the first non-future day in the column to determine the month.
      const firstDay = grid[i].find((c) => !c.future) ?? grid[i][0];
      if (!firstDay.key) continue;
      const m = +firstDay.key.split('-')[1];
      if (m !== prevMonth) {
        labels.push({ col: i, label: fmtMonth.format(new Date(firstDay.key + 'T00:00:00')) });
        prevMonth = m;
      }
    }
    return labels;
  });

  // Short weekday labels (Mon, Wed, Fri).
  const dowLabels = $derived.by(() => {
    const fmtDow = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => {
      // 2024-01-01 = Monday
      return fmtDow.format(new Date(Date.UTC(2024, 0, i + 1)));
    });
  });

  // Intensity → CSS class (5-level, GitHub style).
  function level(count: number, future: boolean): string {
    if (future) return 'future';
    if (count <= 0) return 'l0';
    if (count === 1) return 'l1';
    if (count === 2) return 'l2';
    if (count <= 4) return 'l3';
    return 'l4';
  }

  function fmt(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Tooltip.
  let tipEl = $state<HTMLDivElement | null>(null);
  let tipText = $state('');
  let tipX = $state(0);
  let tipY = $state(0);
  let tipVisible = $state(false);

  function showTip(e: MouseEvent, cell: Cell) {
    if (cell.future || !cell.key) return;
    const d = new Date(cell.key + 'T00:00:00');
    const label = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
    tipText = cell.count === 0
      ? `${label} — ${$_('app.home.heatmapNoPost')}`
      : `${label} — ${cell.count} ${cell.count === 1 ? $_('app.home.heatmapPost') : $_('app.home.heatmapPosts')}`;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    tipX = rect.left + rect.width / 2;
    tipY = rect.top - 8;
    tipVisible = true;
  }

  function hideTip() {
    tipVisible = false;
  }
</script>

<div class="heatmap-wrap">
  <!-- Month labels along the top -->
  <div class="month-row">
    {#each monthLabels as m}
      <span class="month-label" style="left:{(m.col / grid.length) * 100}%">{m.label}</span>
    {/each}
  </div>

  <div class="heatmap-grid">
    <!-- Day-of-week labels -->
    <div class="dow-col">
      {#each dowLabels as lbl, i}
        <div class="dow" class:hide={i % 2 === 1}>{lbl}</div>
      {/each}
    </div>

    <!-- Week columns -->
    {#each grid as week}
      <div class="week-col">
        {#each week as cell}
          <div
            class="cell {level(cell.count, cell.future)}"
            role="img"
            aria-label={cell.key}
            onmouseenter={(e) => showTip(e, cell)}
            onmouseleave={hideTip}
          ></div>
        {/each}
      </div>
    {/each}
  </div>

  <!-- Legend -->
  <div class="legend">
    <span class="legend-label">{$_('app.home.heatmapLess')}</span>
    <div class="cell l0 sm"></div>
    <div class="cell l1 sm"></div>
    <div class="cell l2 sm"></div>
    <div class="cell l3 sm"></div>
    <div class="cell l4 sm"></div>
    <span class="legend-label">{$_('app.home.heatmapMore')}</span>
  </div>
</div>

<!-- Floating tooltip -->
{#if tipVisible}
  <div class="tip" bind:this={tipEl} style="left:{tipX}px;top:{tipY}px;">{tipText}</div>
{/if}

<style>
  .heatmap-wrap {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px 22px 14px;
    overflow-x: auto;
  }

  /* Month labels row */
  .month-row {
    position: relative;
    height: 14px;
    margin-bottom: 4px;
    margin-left: 36px; /* offset for dow-col */
  }
  .month-label {
    position: absolute;
    top: 0;
    font-size: 10px;
    color: var(--ink-faint);
    white-space: nowrap;
    line-height: 1;
  }

  /* Main grid — flex so columns stay compact, row wraps on mobile */
  .heatmap-grid {
    display: flex;
    gap: 3px;
    width: 100%;
  }
  .dow-col {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex-shrink: 0;
    width: 32px;
  }
  .dow {
    height: 11px;
    font-size: 9px;
    line-height: 11px;
    color: var(--ink-faint);
    text-align: right;
    white-space: nowrap;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 4px;
  }
  .dow.hide { visibility: hidden; }

  .week-col {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }

  .cell {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 2px;
    min-width: 0;
    transition: outline 0.1s;
    cursor: default;
  }
  .cell:not(.future):not(.empty):hover {
    outline: 2px solid var(--ink-soft);
    outline-offset: 1px;
  }

  /* Intensity scale — accent palette */
  .cell.l0 { background: var(--paper-2); }
  .cell.l1 { background: rgba(var(--accent-rgb), 0.20); }
  .cell.l2 { background: rgba(var(--accent-rgb), 0.40); }
  .cell.l3 { background: rgba(var(--accent-rgb), 0.62); }
  .cell.l4 { background: rgba(var(--accent-rgb), 0.88); }
  .cell.future { background: transparent; }

  /* Tooltip */
  .tip {
    position: fixed;
    transform: translate(-50%, -100%);
    background: var(--ink);
    color: var(--paper);
    font-size: 11px;
    font-weight: 500;
    padding: 5px 10px;
    border-radius: 6px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 100;
    line-height: 1.3;
  }

  /* Legend */
  .legend {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 10px;
  }
  .legend-label {
    font-size: 10px;
    color: var(--ink-faint);
    margin: 0 3px;
  }
  .cell.sm {
    width: 10px;
    height: 10px;
    aspect-ratio: auto;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .cell.sm:hover { outline: none; }

  /* Mobile: scroll horizontally */
  @container workbench (max-width: 700px) {
    .heatmap-wrap { padding: 14px 12px 10px; }
    .heatmap-grid { min-width: 560px; }
    .month-row { min-width: 560px; }
  }
</style>
