<script lang="ts">
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import StatsTiles from '$lib/components/StatsTiles.svelte';
  import { formatVideoScore } from '$lib/video-score';
  import { isImageUrl, mediaUrlLabel } from '$lib/content-formats';

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const base = $derived(`/app/${brand.slug}/settings/media-reviewer`);
  const filter = $derived(data.filter);
  const pagination = $derived(data.pagination);

  let openId = $state<string | null>(null);

  const filterHref = (status: string) => (status === 'all' ? base : `${base}?status=${status}`);
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (filter !== 'all') q.set('status', filter);
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  const pageNumbers = $derived.by(() => {
    const total = pagination.totalPages;
    const cur = pagination.page;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const set = new Set<number>([1, total, cur - 1, cur, cur + 1].filter((n) => n >= 1 && n <= total));
    return [...set].sort((a, b) => a - b);
  });

  const isStill = (r: (typeof data.reviews)[number]) =>
    isImageUrl(r.mediaUrl) || r.kind === 'image' || r.kind === 'graphic' || r.kind === 'carousel';

  const note = (r: (typeof data.reviews)[number]) => r.error || r.judgment || '';
</script>

<div class="mr">
  <StatsTiles
    tiles={[
      {
        label: $_('app.settings.mediaReviewer.tileTotal'),
        value: data.counts.total,
        delta: $_('app.settings.mediaReviewer.tileTotalDelta')
      },
      {
        label: $_('app.settings.mediaReviewer.tileReady'),
        value: data.counts.ready,
        delta: $_('app.settings.mediaReviewer.tileReadyDelta'),
        up: data.counts.ready > 0
      },
      {
        label: $_('app.settings.mediaReviewer.tileFailed'),
        value: data.counts.failed,
        delta: $_('app.settings.mediaReviewer.tileFailedDelta')
      },
      {
        label: $_('app.settings.mediaReviewer.tilePending'),
        value: data.counts.pending,
        delta: $_('app.settings.mediaReviewer.tilePendingDelta')
      }
    ]}
  />

  {#if form?.reviewQueued}
    <p class="banner ok">{$_('app.settings.mediaReviewer.rerunQueued')}</p>
  {:else if form?.skippedRunning}
    <p class="banner">{$_('app.settings.mediaReviewer.rerunRunning')}</p>
  {:else if form?.error}
    <p class="banner err">{form.error}</p>
  {/if}

  <section class="panel">
    <div class="panel-head">
      <div class="t">
        {$_('app.settings.mediaReviewer.logsTitle')}
        <span>{$_('app.settings.mediaReviewer.logsSub', { values: { total: pagination.total } })}</span>
      </div>
      <nav class="filters" aria-label={$_('app.settings.mediaReviewer.filterLabel')}>
        {#each ['all', 'failed', 'ready', 'pending'] as s (s)}
          <a class="chip" class:on={filter === s} href={filterHref(s)}>
            {$_(`app.settings.mediaReviewer.filter.${s}`)}
          </a>
        {/each}
      </nav>
    </div>

    {#if data.reviews.length}
      <div class="call-table-wrap">
        <table class="call-table">
          <thead>
            <tr>
              <th>{$_('app.settings.mediaReviewer.col.when')}</th>
              <th>{$_('app.settings.mediaReviewer.col.media')}</th>
              <th>{$_('app.settings.mediaReviewer.col.kind')}</th>
              <th>{$_('app.settings.mediaReviewer.col.status')}</th>
              <th>{$_('app.settings.mediaReviewer.col.score')}</th>
              <th>{$_('app.settings.mediaReviewer.col.verdict')}</th>
              <th>{$_('app.settings.mediaReviewer.col.note')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each data.reviews as r (r.id)}
              <tr class:fail={r.status === 'failed'} class:open={openId === r.id}>
                <td class="when">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}</td>
                <td class="media">
                  {#if isStill(r) && r.mediaUrl}
                    <img class="thumb" src={r.mediaUrl} alt="" />
                  {/if}
                  <div class="media-txt">
                    <a class="media-name" href={r.mediaUrl} target="_blank" rel="noreferrer">
                      {mediaUrlLabel(r.mediaUrl) || r.mediaUrl}
                    </a>
                    {#if r.postId}
                      <a class="post-link" href={`/app/${brand.slug}/posts/${r.postId}/edit`}>
                        {$_('app.settings.mediaReviewer.openPost')}
                      </a>
                    {/if}
                  </div>
                </td>
                <td>
                  <span class="pill muted">{$_(`app.settings.mediaReviewer.kind.${r.kind}`)}</span>
                  <div class="std">{r.standard}</div>
                </td>
                <td>
                  <span
                    class="pill"
                    class:ok={r.status === 'ready'}
                    class:bad={r.status === 'failed'}
                    class:wait={r.status === 'pending' || r.status === 'running'}
                  >
                    {$_(`app.settings.mediaReviewer.status.${r.status}`)}
                  </span>
                </td>
                <td class="score">{r.overall != null ? formatVideoScore(r.overall) : '—'}</td>
                <td>
                  {#if r.verdict}
                    <span class="pill" class:ok={r.verdict === 'ship'} class:fix={r.verdict === 'fix'} class:bad={r.verdict === 'kill'}>
                      {r.verdict}
                    </span>
                  {:else}
                    —
                  {/if}
                </td>
                <td class="note">
                  {#if note(r)}
                    <button type="button" class="note-btn" onclick={() => (openId = openId === r.id ? null : r.id)}>
                      {note(r)}
                    </button>
                  {:else}
                    —
                  {/if}
                </td>
                <td class="act">
                  {#if r.status !== 'running'}
                    <form method="POST" action="?/requestReview" use:enhance>
                      {#if r.postId}
                        <input type="hidden" name="post_id" value={r.postId} />
                      {:else}
                        <input type="hidden" name="review_id" value={r.id} />
                      {/if}
                      <button type="submit" class="rerun">{$_('app.settings.mediaReviewer.rerun')}</button>
                    </form>
                  {/if}
                </td>
              </tr>
              {#if openId === r.id}
                <tr class="detail">
                  <td colspan="8">
                    {#if r.error}
                      <div class="block">
                        <div class="block-h">{$_('app.settings.mediaReviewer.error')}</div>
                        <pre>{r.error}</pre>
                      </div>
                    {/if}
                    {#if r.judgment}
                      <div class="block">
                        <div class="block-h">{$_('app.settings.mediaReviewer.judgment')}</div>
                        <p>{r.judgment}</p>
                      </div>
                    {/if}
                    {#if r.scriptSpoken}
                      <div class="block">
                        <div class="block-h">{$_('app.settings.mediaReviewer.scriptSpoken')}</div>
                        <p>{r.scriptSpoken}</p>
                      </div>
                    {/if}
                    {#if r.scriptOnScreen}
                      <div class="block">
                        <div class="block-h">{$_('app.settings.mediaReviewer.scriptOnScreen')}</div>
                        <p>{r.scriptOnScreen}</p>
                      </div>
                    {/if}
                    {#if r.caption}
                      <div class="block">
                        <div class="block-h">{$_('app.settings.mediaReviewer.caption')}</div>
                        <p>{r.caption}</p>
                      </div>
                    {/if}
                    {#if r.attempts > 0}
                      <div class="attempts">
                        {$_('app.settings.mediaReviewer.attempts', { values: { n: r.attempts } })}
                      </div>
                    {/if}
                  </td>
                </tr>
              {/if}
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
      <div class="empty">{$_('app.settings.mediaReviewer.empty')}</div>
    {/if}
  </section>
</div>

<style>
  .mr {
    display: flex;
    flex-direction: column;
  }
  .banner {
    font-size: 13px;
    color: var(--ink-faint);
    margin: -8px 0 16px;
  }
  .banner.ok {
    color: var(--accent);
  }
  .banner.err {
    color: #c0392b;
  }
  .mr :global(.panel-head) {
    flex-wrap: wrap;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--ink-faint);
    text-decoration: none;
    background: var(--paper);
  }
  .chip.on {
    color: var(--accent);
    border-color: rgba(var(--accent-rgb), 0.35);
    background: rgba(var(--accent-rgb), 0.1);
  }
  .empty {
    padding: 28px 18px;
    text-align: center;
    color: var(--ink-faint);
    font-size: 13px;
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
  .media {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    min-width: 160px;
  }
  .thumb {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    object-fit: cover;
    background: var(--line);
    flex-shrink: 0;
  }
  .media-txt {
    min-width: 0;
  }
  .media-name {
    display: block;
    font-weight: 600;
    color: var(--ink);
    text-decoration: none;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .media-name:hover {
    color: var(--accent);
  }
  .post-link {
    display: block;
    font-size: 11px;
    color: var(--ink-faint);
    margin-top: 2px;
    text-decoration: none;
  }
  .post-link:hover {
    color: var(--accent);
  }
  .std {
    font-size: 11px;
    color: var(--ink-faint);
    margin-top: 4px;
    text-transform: capitalize;
  }
  .score {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .note-btn {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    max-width: 240px;
    text-align: left;
    font: inherit;
    font-size: 12px;
    color: var(--ink);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
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
  .pill.muted {
    color: var(--ink-faint);
    background: rgba(0, 0, 0, 0.04);
    text-transform: none;
    letter-spacing: 0;
  }
  .pill.ok {
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.12);
  }
  .pill.bad {
    color: #c0392b;
    background: rgba(192, 57, 43, 0.1);
  }
  .pill.fix {
    color: #b7791f;
    background: rgba(183, 121, 31, 0.12);
  }
  .pill.wait {
    color: var(--ink-faint);
    background: rgba(0, 0, 0, 0.04);
  }
  .detail td {
    background: rgba(0, 0, 0, 0.02);
    padding: 12px 18px 18px;
  }
  .block {
    margin-bottom: 12px;
  }
  .block-h {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-faint);
    margin-bottom: 4px;
  }
  .block p,
  .block pre {
    margin: 0;
    white-space: pre-wrap;
    font-size: 13px;
    line-height: 1.45;
  }
  .block pre {
    font-family: ui-monospace, monospace;
    color: #c0392b;
  }
  .attempts {
    font-size: 12px;
    color: var(--ink-faint);
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
    padding: 0 4px;
  }
  .act {
    white-space: nowrap;
    text-align: right;
  }
  .rerun {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .rerun:hover {
    text-decoration: underline;
  }
</style>
