<script lang="ts">
  import { _ } from 'svelte-i18n';
  import StatsTiles from '$lib/components/StatsTiles.svelte';

  let { data } = $props();
  const brand = $derived(data.brand);
  const base = $derived(`/app/${brand.slug}/settings/usage`);

  const fmtCredits = (n: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
  const fmtUsd = (n: number) =>
    n < 0.01 && n > 0
      ? `$${n.toFixed(4)}`
      : `$${n.toFixed(2)}`;
  const fmtTokens = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
        : String(n);
  const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

  const periodLabel = $derived.by(() => {
    const start = new Date(data.credits.periodStart);
    const end = new Date(data.credits.periodEnd);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
  });

  const maxDaily = $derived(Math.max(0.000001, ...data.daily.map((d) => d.costUsd)));
  const maxProvider = $derived(Math.max(0.000001, ...data.byProvider.map((p) => p.costUsd)));

  // SVG area chart geometry
  const chartW = 560;
  const chartH = 140;
  const padX = 8;
  const padY = 12;
  const dailyPath = $derived.by(() => {
    const pts = data.daily;
    if (!pts.length) return { line: '', area: '' };
    const n = pts.length;
    const coords = pts.map((p, i) => {
      const x = padX + (n === 1 ? chartW / 2 : (i / (n - 1)) * (chartW - padX * 2));
      const y = chartH - padY - (p.costUsd / maxDaily) * (chartH - padY * 2);
      return [x, y] as const;
    });
    const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${chartH - padY} L${coords[0][0].toFixed(1)},${chartH - padY} Z`;
    return { line, area };
  });

  const pageHref = (p: number) => `${base}?page=${p}`;
  const pagination = $derived(data.pagination);
  const pageNumbers = $derived.by(() => {
    const total = pagination.totalPages;
    const cur = pagination.page;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const set = new Set<number>([1, total, cur - 1, cur, cur + 1].filter((n) => n >= 1 && n <= total));
    return [...set].sort((a, b) => a - b);
  });
</script>

<div class="usage">
  <div class="period-note">{$_('app.settings.usage.period', { values: { range: periodLabel } })}</div>

  <StatsTiles
    tiles={[
      {
        label: $_('app.settings.usage.creditsUsed'),
        value: data.credits.used,
        format: fmtCredits,
        delta: $_('app.settings.usage.ofQuota', {
          values: { quota: fmtCredits(data.credits.quota), pct: data.credits.percent }
        }),
        up: data.credits.percent < 80
      },
      {
        label: $_('app.settings.usage.cost'),
        value: data.summary.totalCostUsd,
        format: fmtUsd,
        delta: $_('app.settings.usage.callsCount', { values: { count: data.summary.totalCalls } })
      },
      {
        label: $_('app.settings.usage.tokens'),
        value: data.summary.totalInputTokens + data.summary.totalOutputTokens,
        format: fmtTokens,
        delta: $_('app.settings.usage.tokensBreakdown', {
          values: {
            in: fmtTokens(data.summary.totalInputTokens),
            out: fmtTokens(data.summary.totalOutputTokens)
          }
        })
      },
      {
        label: $_('app.settings.usage.agentRuns'),
        value: data.summary.agentRuns,
        delta: $_('app.settings.usage.agentCost', {
          values: { cost: fmtUsd(data.summary.agentCostUsd) }
        })
      }
    ]}
  />

  <div class="charts">
    <section class="panel">
      <div class="panel-head">
        <div class="t">{$_('app.settings.usage.dailyCost')} <span>{$_('app.settings.usage.dailyCostSub')}</span></div>
      </div>
      {#if data.daily.some((d) => d.calls > 0)}
        <div class="area-chart" role="img" aria-label={$_('app.settings.usage.dailyCost')}>
          <svg viewBox="0 0 {chartW} {chartH}" preserveAspectRatio="none">
            <defs>
              <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28" />
                <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <path d={dailyPath.area} fill="url(#usageFill)" />
            <path d={dailyPath.line} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
          <div class="area-axis">
            <span>{data.daily[0]?.date?.slice(5) ?? ''}</span>
            <span>{fmtUsd(maxDaily)}</span>
            <span>{data.daily[data.daily.length - 1]?.date?.slice(5) ?? ''}</span>
          </div>
        </div>
      {:else}
        <div class="empty">{$_('app.settings.usage.noCalls')}</div>
      {/if}
    </section>

    <section class="panel">
      <div class="panel-head">
        <div class="t">{$_('app.settings.usage.byProvider')} <span>{$_('app.settings.usage.byProviderSub')}</span></div>
      </div>
      {#if data.byProvider.length}
        <div class="hbars">
          {#each data.byProvider as p (p.provider)}
            <div class="hbar">
              <div class="top">
                <span class="prov">{p.provider}</span>
                <span class="v">{fmtUsd(p.costUsd)} · {p.calls}</span>
              </div>
              <div class="track"><div class="fill" style={`width:${(p.costUsd / maxProvider) * 100}%`}></div></div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty">{$_('app.settings.usage.noCalls')}</div>
      {/if}
    </section>
  </div>

  <section class="panel" style="margin-top:16px;">
    <div class="panel-head">
      <div class="t">{$_('app.settings.usage.sessionsTitle')} <span>{$_('app.settings.usage.sessionsSub')}</span></div>
    </div>
    {#if data.sessions.length}
      <div class="agent-list">
        {#each data.sessions as s (s.id)}
          <a class="agent-row link" class:fail={s.status === 'failed' || s.status === 'aborted'} href={`${base}/sessions/${s.id}`}>
            <div class="agent-main">
              <span class="agent-name">{s.agent}</span>
              {#if s.mode}<span class="agent-mode">{s.mode}</span>{/if}
              <span class="agent-status" class:ok={s.status === 'finished'}>{s.status}</span>
              {#if s.model}<span class="agent-mode">{s.model}</span>{/if}
            </div>
            <div class="agent-meta">
              <span class="agent-cost">{s.event_count} events</span>
              <span class="agent-date">{new Date(s.created_at).toLocaleString()}</span>
            </div>
          </a>
        {/each}
      </div>
    {:else}
      <div class="empty">{$_('app.settings.usage.sessionEmpty')}</div>
    {/if}
  </section>

  {#if data.agents.length}
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div class="t">{$_('app.settings.usage.agentsTitle')} <span>{$_('app.settings.usage.agentsSub')}</span></div>
      </div>
      <div class="agent-list">
        {#each data.agents as a (a.id)}
          <div class="agent-row" class:fail={!a.finished_ok}>
            <div class="agent-main">
              <span class="agent-name">{a.agent}</span>
              <span class="agent-mode">{a.mode}</span>
              <span class="agent-status" class:ok={a.finished_ok}>{a.status}</span>
            </div>
            <div class="agent-meta">
              <span class="agent-cost">{a.cost_usd_estimate != null ? fmtUsd(Number(a.cost_usd_estimate)) : '—'}</span>
              <span class="agent-date">{new Date(a.created_at).toLocaleString()}</span>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="panel" style="margin-top:16px;">
    <div class="panel-head">
      <div class="t">
        {$_('app.settings.usage.callsTitle')}
        <span
          >{$_('app.settings.usage.callsSub', {
            values: { total: data.pagination.total, failed: data.summary.failedCalls }
          })}</span
        >
      </div>
    </div>

    {#if data.calls.length}
      <div class="call-table-wrap">
        <table class="call-table">
          <thead>
            <tr>
              <th>{$_('app.settings.usage.col.when')}</th>
              <th>{$_('app.settings.usage.col.label')}</th>
              <th>{$_('app.settings.usage.col.provider')}</th>
              <th>{$_('app.settings.usage.col.tokens')}</th>
              <th>{$_('app.settings.usage.col.cost')}</th>
              <th>{$_('app.settings.usage.col.latency')}</th>
              <th>{$_('app.settings.usage.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.calls as c (c.id)}
              <tr class:fail={!c.ok}>
                <td class="when">{new Date(c.created_at).toLocaleString()}</td>
                <td class="label">
                  <div class="label-main">{c.label}</div>
                  {#if c.model}<div class="label-sub">{c.model}</div>{/if}
                  {#if c.context}<div class="label-sub">{c.context}</div>{/if}
                  {#if c.error}<div class="label-err">{c.error}</div>{/if}
                </td>
                <td class="prov">{c.provider}</td>
                <td class="tok">
                  {#if c.input_tokens != null || c.output_tokens != null}
                    <span title="in">{fmtTokens(c.input_tokens ?? 0)}</span>
                    <span class="sep">/</span>
                    <span title="out">{fmtTokens(c.output_tokens ?? 0)}</span>
                  {:else}
                    —
                  {/if}
                </td>
                <td class="cost">{c.cost_usd != null ? fmtUsd(Number(c.cost_usd)) : '—'}</td>
                <td class="ms">{fmtMs(c.ms)}</td>
                <td class="st">
                  <span class="pill" class:ok={c.ok} class:bad={!c.ok}>{c.ok ? 'ok' : 'fail'}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if pagination.totalPages > 1}
        <nav class="pager" aria-label="Pagination">
          <a
            class="pg-btn"
            class:disabled={pagination.page <= 1}
            href={pagination.page > 1 ? pageHref(pagination.page - 1) : undefined}
            aria-disabled={pagination.page <= 1}
          >←</a>
          {#each pageNumbers as n, i (n)}
            {#if i > 0 && n - pageNumbers[i - 1] > 1}
              <span class="pg-gap">…</span>
            {/if}
            <a class="pg-btn" class:active={n === pagination.page} href={pageHref(n)}>{n}</a>
          {/each}
          <a
            class="pg-btn"
            class:disabled={pagination.page >= pagination.totalPages}
            href={pagination.page < pagination.totalPages ? pageHref(pagination.page + 1) : undefined}
            aria-disabled={pagination.page >= pagination.totalPages}
          >→</a>
        </nav>
      {/if}
    {:else}
      <div class="empty">{$_('app.settings.usage.noCalls')}</div>
    {/if}
  </section>
</div>

<style>
  .usage {
    display: flex;
    flex-direction: column;
  }
  .period-note {
    font-size: 12.5px;
    color: var(--ink-faint);
    margin: -8px 0 18px;
  }

  .charts {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 16px;
  }
  @container workbench (max-width: 900px) {
    .charts {
      grid-template-columns: 1fr;
    }
  }

  .area-chart {
    padding: 8px 16px 14px;
  }
  .area-chart svg {
    width: 100%;
    height: 140px;
    display: block;
  }
  .area-axis {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--ink-faint);
    margin-top: 6px;
  }

  .hbars {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 18px 18px;
  }
  .hbar .top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 12.5px;
    margin-bottom: 6px;
  }
  .hbar .prov {
    font-weight: 600;
    text-transform: capitalize;
  }
  .hbar .v {
    color: var(--ink-faint);
    white-space: nowrap;
  }
  .hbar .track {
    height: 6px;
    border-radius: 999px;
    background: rgba(var(--accent-rgb), 0.1);
    overflow: hidden;
  }
  .hbar .fill {
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
  }

  .empty {
    padding: 28px 18px;
    text-align: center;
    color: var(--ink-faint);
    font-size: 13px;
  }

  .agent-list {
    display: flex;
    flex-direction: column;
  }
  .agent-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 18px;
    border-top: 1px solid var(--line);
  }
  a.agent-row.link {
    text-decoration: none;
    color: inherit;
  }
  a.agent-row.link:hover {
    background: rgba(var(--accent-rgb), 0.04);
  }
  .agent-row:first-child {
    border-top: none;
  }
  .agent-main {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .agent-name {
    font-weight: 600;
    font-size: 13px;
  }
  .agent-mode,
  .agent-status {
    font-size: 11.5px;
    color: var(--ink-faint);
    padding: 2px 7px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.04);
  }
  :global([data-theme='dark']) .agent-mode,
  :global([data-theme='dark']) .agent-status {
    background: rgba(255, 255, 255, 0.06);
  }
  .agent-status.ok {
    color: var(--accent);
  }
  .agent-row.fail .agent-status {
    color: #c0392b;
  }
  .agent-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }
  .agent-cost {
    font-weight: 600;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .agent-date {
    font-size: 11px;
    color: var(--ink-faint);
  }

  .call-table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .call-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .call-table th {
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-faint);
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .call-table td {
    padding: 11px 14px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  .call-table tr.fail td {
    background: rgba(192, 57, 43, 0.04);
  }
  .when {
    white-space: nowrap;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }
  .label-main {
    font-weight: 600;
  }
  .label-sub {
    font-size: 11px;
    color: var(--ink-faint);
    margin-top: 2px;
  }
  .label-err {
    font-size: 11px;
    color: #c0392b;
    margin-top: 4px;
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .prov {
    text-transform: capitalize;
    white-space: nowrap;
  }
  .tok {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .tok .sep {
    color: var(--ink-faint);
    margin: 0 2px;
  }
  .cost,
  .ms {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .pill {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 6px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .pill.ok {
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.12);
  }
  .pill.bad {
    color: #c0392b;
    background: rgba(192, 57, 43, 0.1);
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 14px 12px 16px;
    flex-wrap: wrap;
  }
  .pg-btn {
    min-width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink);
    text-decoration: none;
    border: 1px solid var(--line);
    background: var(--paper);
    padding: 0 8px;
  }
  .pg-btn:hover:not(.disabled):not(.active) {
    background: rgba(0, 0, 0, 0.04);
  }
  .pg-btn.active {
    color: var(--accent);
    border-color: rgba(var(--accent-rgb), 0.35);
    background: rgba(var(--accent-rgb), 0.1);
  }
  .pg-btn.disabled {
    opacity: 0.35;
    pointer-events: none;
  }
  .pg-gap {
    color: var(--ink-faint);
    padding: 0 2px;
  }
</style>
