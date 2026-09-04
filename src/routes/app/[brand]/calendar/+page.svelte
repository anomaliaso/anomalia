<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import PageHead from '$lib/components/PageHead.svelte';
  import CreateContentModal from '$lib/components/CreateContentModal.svelte';
  import { captionViolations } from '$lib/platform-limits';
  import { siInstagram, siTiktok, siFacebook, siX, siThreads, siYoutube, siBluesky, siReddit } from 'simple-icons';
  import { _ } from 'svelte-i18n';
  import type { CalendarPost } from './+page.server';

  let { data, form } = $props();
  const brand = $derived(data.brand);

  const PLATFORMS: Record<string, { label: string; glyph: string; bg: string }> = {
    instagram: { label: 'Instagram', glyph: 'IG', bg: 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af)' },
    tiktok: { label: 'TikTok', glyph: 'TT', bg: '#111' },
    facebook: { label: 'Facebook', glyph: 'f', bg: '#1877f2' },
    linkedin: { label: 'LinkedIn', glyph: 'in', bg: '#0a66c2' },
    x: { label: 'X', glyph: 'X', bg: '#0a0a0a' },
    threads: { label: 'Threads', glyph: '@', bg: '#000000' },
    youtube: { label: 'YouTube', glyph: 'YT', bg: '#ff0000' },
    bluesky: { label: 'Bluesky', glyph: 'BS', bg: '#0285ff' },
    reddit: { label: 'Reddit', glyph: 'RD', bg: '#ff4500' }
  };
  const ICONS: Record<string, { path: string; hex: string }> = {
    instagram: siInstagram,
    tiktok: siTiktok,
    facebook: siFacebook,
    x: siX,
    threads: siThreads,
    youtube: siYoutube,
    bluesky: siBluesky,
    reddit: siReddit
  };
  const platMeta = (p: string | null) => PLATFORMS[(p ?? '').toLowerCase()];
  const platIcon = (p: string | null) => ICONS[(p ?? '').toLowerCase()];

  const pad = (n: number) => String(n).padStart(2, '0');
  const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  /** How many post cards fit in a day cell before "+N more". */
  const MAX_CELL_POSTS = 3;

  // ── Client-side search — filters the server's month/status window before grouping/grid/list. ──
  let searchQuery = $state('');
  function matchesSearch(p: CalendarPost, q: string): boolean {
    const hay = [
      p.caption,
      p.platform,
      ...(p.platforms ?? []),
      p.pillar,
      p.angle,
      p.product_name,
      p.format,
      p.whenLabel
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  }
  const filteredPosts = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? data.posts.filter((p) => matchesSearch(p, q)) : data.posts;
  });

  // Posts grouped by brand-timezone day (server computed dayKey).
  const byDay = $derived.by(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const p of filteredPosts) {
      const arr = map.get(p.dayKey) ?? [];
      arr.push(p);
      map.set(p.dayKey, arr);
    }
    return map;
  });

  // Full month grid, Monday-start. Pure UTC calendar math (no time component → no DST cross),
  // same technique as schedule.ts. Trims the trailing all-next-month week when the month fits 5 rows.
  const grid = $derived.by(() => {
    const y = data.year;
    const m = data.month;
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=Sun..6=Sat
    const lead = (firstDow + 6) % 7; // days before the 1st to reach Monday
    const cells: Array<{ key: string; dayNum: number; inMonth: boolean; isToday: boolean; posts: CalendarPost[] }> = [];
    for (let i = 0; i < 42; i++) {
      const dt = new Date(Date.UTC(y, m - 1, 1 - lead + i));
      const key = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
      cells.push({
        key,
        dayNum: dt.getUTCDate(),
        inMonth: dt.getUTCMonth() + 1 === m,
        isToday: key === data.todayKey,
        posts: byDay.get(key) ?? []
      });
    }
    return cells.slice(35).every((c) => !c.inMonth) ? cells.slice(0, 35) : cells;
  });

  const STATUS_KEY: Record<string, string> = {
    scheduled: 'scheduled',
    approved: 'approved',
    pending_user: 'pendingApproval',
    published: 'published',
    failed: 'failed'
  };

  // Mese (grid) vs Lista (chronological) — same data, two read layouts. Month is the default.
  // La vista sta nell'URL: un calendario in lista si manda a un collega, e il tasto indietro
  // torna a com'era.
  const view = $derived(data.view as 'month' | 'list');

  /** Lo stesso URL con dei parametri cambiati: filtri e mese restano dove sono. */
  function hrefWith(patch: Record<string, string | null>): string {
    const url = new URL(page.url);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    return `${url.pathname}${url.search}`;
  }

  // Il post si apre nel pannello a destra, sopra il calendario: `?post=<id>`, quindi
  // condivisibile e chiudibile col tasto indietro. La scheda completa resta a un link dentro.
  function postHref(id: string) {
    return hrefWith({ post: id });
  }
  const fullPostHref = $derived(
    data.selectedId ? `/app/${brand.slug}/posts/${data.selectedId}/preview` : ''
  );

  let PostPanel = $state<typeof import('$lib/components/PostPanel.svelte').default | null>(null);
  $effect(() => {
    if (data.detail && !PostPanel) {
      void import('$lib/components/PostPanel.svelte').then((m) => (PostPanel = m.default));
    }
  });

  function closePanel() {
    void goto(hrefWith({ post: null }), { noScroll: true, keepFocus: true });
  }

  // "Crea contenuto" — same single user-briefed create modal as Content.
  let createOpen = $state(false);
  let createdFlash = $state<'' | 'photo' | 'video' | 'videoFallback' | 'team'>('');
  function onSingleCreated(r: { kind: 'single' | 'team'; contentType: string; videoFallback: boolean }) {
    createdFlash =
      r.kind === 'team' ? 'team' : r.videoFallback ? 'videoFallback' : r.contentType.includes('video') ? 'video' : 'photo';
  }
  const founderVideos = $derived(
    (data.founderVideos as { used: number; quota: number; remaining: number }) ?? { used: 0, quota: 0, remaining: 0 }
  );
  const usageFull = $derived((data.usage as { postsRemaining: number }).postsRemaining <= 0);

  // Delete confirmation (second click confirms) + email-me-approve spinner — mirrors Content.
  let confirmId = $state<string | null>(null);
  let emailing = $state(false);
  const emailEnhance = () => {
    emailing = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      emailing = false;
    };
  };

  // Status filter via ?status= (server-side, same set as Content's FILTERS) + the plan-row scope.
  const FILTERS = [
    { key: '', labelKey: 'all', cKey: 'all' },
    { key: 'pending_user', labelKey: 'pendingApproval', cKey: 'pending_user' },
    { key: 'approved', labelKey: 'approved', cKey: 'approved' },
    { key: 'scheduled', labelKey: 'scheduled', cKey: 'scheduled' },
    { key: 'published', labelKey: 'published', cKey: 'published' },
    { key: 'failed', labelKey: 'failed', cKey: 'failed' }
  ];
  const activeFilter = $derived(data.filter ?? '');
  const rowFilter = $derived((data.rowFilter ?? '') as string);
  const counts = $derived(data.counts as Record<string, number>);

  // Month-nav + today hrefs — always keep the current status/row filter attached.
  function calHref(ym?: string) {
    const p = new URLSearchParams();
    if (ym) p.set('m', ym);
    if (activeFilter) p.set('status', activeFilter);
    if (rowFilter) p.set('row', rowFilter);
    const q = p.toString();
    return `/app/${brand.slug}/calendar${q ? `?${q}` : ''}`;
  }
  // "Show all" (clears the plan-row scope) — keeps status + the month we're currently viewing.
  function clearRowHref() {
    const p = new URLSearchParams();
    if (activeFilter) p.set('status', activeFilter);
    if (!data.isCurrentMonth) p.set('m', `${data.year}-${pad(data.month)}`);
    const q = p.toString();
    return `/app/${brand.slug}/calendar${q ? `?${q}` : ''}`;
  }

  function onStatusChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    const params = new URLSearchParams();
    if (v) params.set('status', v);
    if (rowFilter) params.set('row', rowFilter);
    if (!data.isCurrentMonth) params.set('m', `${data.year}-${pad(data.month)}`);
    const q = params.toString();
    void goto(q ? `?${q}` : '?', { noScroll: true, keepFocus: true, replaceState: true });
  }

  // "Approve this week" as a single top button: only meaningful once the pending filter narrows
  // the list down to exactly the drafts awaiting approval, scoped further by the live search.
  const visiblePendingIds = $derived(
    filteredPosts.filter((p) => p.kind === 'social' && p.status === 'pending_user').map((p) => p.id)
  );

  // Deep-link into a fresh AI chat pre-loaded with a "rebalance my calendar" ask (chat/new forwards
  // ?message and the thread auto-sends it). Localised here, where the i18n store lives.
  const aiFixHref = $derived(
    `/app/${brand.slug}/chat/new?agent=publish&message=${encodeURIComponent($_('app.calendar.conflicts.aiPrompt'))}`
  );

  function evTitle(p: CalendarPost, blog: boolean): string {
    return `${blog ? $_('app.calendar.blogLabel') + ' · ' : ''}${p.isDraft ? $_('app.calendar.draft') + ' · ' : ''}${p.caption ?? ''}`;
  }

  // ── Multi-select (same kind only: all social XOR all blog) + shared bulk actions. ──
  type SelKind = 'social' | 'blog';
  let selectedIds = $state<string[]>([]);
  let selectedKind = $state<SelKind | null>(null);
  let downloading = $state(false);
  let downloadError = $state('');
  let confirmBulkDelete = $state(false);

  const selectedPosts = $derived(
    filteredPosts.filter((p) => selectedIds.includes(p.id) && p.kind === selectedKind)
  );
  const selectedPendingSocial = $derived(
    selectedPosts.filter((p) => p.kind === 'social' && p.status === 'pending_user')
  );
  const selectedWithMedia = $derived(
    selectedPosts.filter(
      (p) =>
        p.kind === 'social' &&
        (!!p.media_url || (Array.isArray(p.media_urls) && p.media_urls.length > 0))
    )
  );
  const selectedBlogPublishable = $derived(
    selectedPosts.filter((p) => p.kind === 'blog' && p.status !== 'published')
  );

  function isSelected(id: string) {
    return selectedIds.includes(id);
  }

  function clearSelection() {
    selectedIds = [];
    selectedKind = null;
    confirmBulkDelete = false;
    downloadError = '';
  }

  function toggleSelect(p: CalendarPost, e?: Event) {
    e?.preventDefault();
    e?.stopPropagation();
    confirmBulkDelete = false;
    downloadError = '';
    if (selectedKind && selectedKind !== p.kind) {
      // Switching type resets the previous selection — never mix social + blog.
      selectedIds = [p.id];
      selectedKind = p.kind;
      return;
    }
    if (selectedIds.includes(p.id)) {
      selectedIds = selectedIds.filter((x) => x !== p.id);
      if (!selectedIds.length) selectedKind = null;
    } else {
      selectedIds = [...selectedIds, p.id];
      selectedKind = p.kind;
    }
  }

  function selectVisibleOfKind(kind: SelKind) {
    selectedKind = kind;
    selectedIds = filteredPosts.filter((p) => p.kind === kind).map((p) => p.id);
    confirmBulkDelete = false;
  }

  async function downloadSelectedMedia() {
    if (!selectedIds.length || selectedKind !== 'social' || downloading) return;
    downloading = true;
    downloadError = '';
    try {
      const res = await fetch(`/app/${brand.slug}/posts/download-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      });
      if (!res.ok) {
        downloadError = (await res.text()) || $_('app.calendar.bulk.downloadFailed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        selectedIds.length === 1
          ? `anomalia-media-${selectedIds[0].slice(0, 8)}.zip`
          : `anomalia-media-${selectedIds.length}-posts.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      downloadError = $_('app.calendar.bulk.downloadFailed');
    } finally {
      downloading = false;
    }
  }

  // After a successful bulk form action, drop the selection so stale IDs don't linger.
  const afterBulk = () => {
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      clearSelection();
    };
  };
</script>

{#snippet evInner(p: CalendarPost, meta: { label: string; glyph: string; bg: string } | undefined, icon: { path: string; hex: string } | undefined, blog: boolean)}
  <span class="evthumb" style={p.media_url ? `background-image:url(${p.media_url})` : undefined}>
    {#if p.needs_attention || p.status === 'failed'}
      <span class="evwarn" class:bad={p.status === 'failed'} title={p.attention_reason ?? p.lastError ?? ''}>
        {p.status === 'failed' ? '!' : '⚠'}
      </span>
    {/if}
    {#if p.media_url}
      <span class="evplat" class:blog style={`background:${blog ? '#5b6470' : (meta?.bg ?? '#7c5cff')}`}>
        {#if blog}
          <span class="blog-label">BLOG</span>
        {:else if icon}
          <svg viewBox="0 0 24 24" fill="#fff"><path d={icon.path} /></svg>
        {:else}
          {meta?.glyph ?? '?'}
        {/if}
      </span>
      {#if !blog && p.media_url}
      {/if}
    {:else}
      <span class="evph" style={`background:${blog ? '#5b6470' : (meta?.bg ?? '#7c5cff')}`}>
        {#if blog}
          <span class="blog-label">BLOG</span>
        {:else if icon}
          <svg viewBox="0 0 24 24" fill="#fff"><path d={icon.path} /></svg>
        {:else}
          {meta?.glyph ?? (p.platform ?? '?').slice(0, 2).toUpperCase()}
        {/if}
      </span>
    {/if}
  </span>
  <span class="evbody">
    <span class="evtime">{p.time}</span>
    <span class="evcap">{p.caption ?? ''}</span>
  </span>
{/snippet}

{#snippet clRowBody(p: CalendarPost, meta: { label: string; glyph: string; bg: string } | undefined, icon: { path: string; hex: string } | undefined, blog: boolean)}
  <span class="cl-thumb" style={p.media_url ? `background-image:url(${p.media_url})` : undefined}>
    {#if !p.media_url}
      <span class="cl-thumb-ph" style={`background:${blog ? '#5b6470' : (meta?.bg ?? '#999')}`}>
        {#if blog}
          <span class="blog-label">BLOG</span>
        {:else if icon}
          <svg viewBox="0 0 24 24" fill="#fff"><path d={icon.path} /></svg>
        {:else}
          {meta?.glyph ?? (p.platform ?? '?').slice(0, 2)}
        {/if}
      </span>
    {:else if !blog && p.media_url}
    {/if}
  </span>
  <span class="cl-when">{p.whenLabel}</span>
  <span class="cl-plat">
    {#if blog}
      <span class="cl-badge blog" style="background:#5b6470"><span class="blog-label">BLOG</span></span>
    {:else if icon}
      <svg viewBox="0 0 24 24" fill={`#${icon.hex}`}><path d={icon.path} /></svg>
    {:else}
      <span class="cl-badge" style={`background:${meta?.bg ?? '#999'}`}>{meta?.glyph ?? (p.platform ?? '?').slice(0, 2)}</span>
    {/if}
    <span class="cl-pname">{blog ? $_('app.calendar.blogLabel') : (meta?.label ?? p.platform)}</span>
  </span>
  <span class="cl-cap">
    {#if p.needs_attention}<span class="cl-attn" title={p.attention_reason ?? ''}>⚠</span>{/if}{p.caption ?? ''}
  </span>
  <span class="cl-status">
    <span
      class="state"
      class:ok={!p.isDraft && (p.status === 'scheduled' || p.status === 'approved' || p.status === 'published')}
      class:bad={p.status === 'failed'}
    >
      <span class="d"></span>{p.isDraft
        ? $_('app.calendar.status.pendingApproval')
        : STATUS_KEY[p.status]
          ? $_('app.calendar.status.' + STATUS_KEY[p.status])
          : p.status}
    </span>
    {#if p.status === 'failed' && p.lastError}
      <span class="cl-err" title={p.lastError}>!</span>
    {/if}
  </span>
{/snippet}

<div class="cal-page" class:selecting={selectedIds.length > 0}>
  <div class="cal-chrome">
    <PageHead title={$_('app.calendar.title')}>
      {#snippet actions()}
        <a class="cal-plan-link" href={`/app/${brand.slug}/gtm`}>{$_('app.calendar.linkStrategy')}</a>
        <a class="cal-plan-link" href={`/app/${brand.slug}/plan`}>{$_('app.calendar.linkPlan')}</a>
        {#if counts.pending_user}
          <form method="POST" action="?/emailApprove" use:enhance={emailEnhance}>
            <button class="approve-all ghost" type="submit" disabled={emailing} aria-busy={emailing}>
              {#if emailing}<span class="spin"></span> {$_('app.approvals.emailSending')}{:else}✉️ {$_('app.approvals.emailMe')}{/if}
            </button>
          </form>
        {/if}
        <a class="cal-plan-link" href={`/app/${brand.slug}/manual-posting`}>{$_('app.hub.publish.manualPosting')}</a>
        <button class="create-single" type="button" onclick={() => (createOpen = true)} disabled={usageFull}>
          ＋ {$_('app.content.single.button')}
        </button>
      {/snippet}
    </PageHead>

    <CreateContentModal
      bind:open={createOpen}
      brandSlug={brand.slug}
      platforms={data.targetPlatforms ?? []}
      {founderVideos}
      onDone={onSingleCreated}
    />

    {#if createdFlash}
      <div class="flash ok">
        {createdFlash === 'team'
          ? $_('app.content.single.requestSent')
          : createdFlash === 'video'
            ? $_('app.content.single.createdVideo')
            : createdFlash === 'videoFallback'
              ? $_('app.content.single.createdVideoFallback')
              : $_('app.content.single.createdPhoto')}
      </div>
    {/if}

    {#if form?.noAccount}
      <a class="flash bad noacct" href={`/app/${brand.slug}/settings`}>
        {$_('app.approvals.noAccountBannerPre')} <b>{$_('app.approvals.noAccountBannerLink')}</b>
      </a>
    {/if}
    {#if form?.emailed}<div class="flash ok">{$_('app.approvals.emailedSent', { values: { to: form.to } })}</div>{/if}
    {#if form?.error}
      <div class="flash bad">{form.error}</div>
    {:else if form?.deletedSelected}
      <div class="flash ok">{$_('app.calendar.bulk.deletedSocial', { values: { n: form.deletedSelected } })}</div>
    {:else if form?.deletedSelectedArticles}
      <div class="flash ok">{$_('app.calendar.bulk.deletedBlog', { values: { n: form.deletedSelectedArticles } })}</div>
    {:else if form?.publishedSelected !== undefined}
      <div class="flash ok">{$_('app.calendar.bulk.publishedBlog', { values: { n: form.publishedSelected } })}</div>
    {:else if form?.deleted}
      <div class="flash ok">{form.wasScheduled ? $_('app.content.deletedScheduled') : $_('app.content.deleted')}</div>
    {/if}
    {#if downloadError}
      <div class="flash bad">{downloadError}</div>
    {/if}

    {#if data.conflictCount > 0}
      <div class="conflict-banner" role="alert">
        <span class="cb-txt">{$_('app.calendar.conflicts.banner', { values: { count: data.conflictCount } })}</span>
        <a class="cb-ai" href={aiFixHref}>{$_('app.calendar.conflicts.fixWithAi')}</a>
      </div>
    {/if}

    {#if rowFilter}
      <div class="rowfilter">
        <span>{$_('app.content.rowFiltered')}</span>
        <a href={clearRowHref()}>{$_('app.content.showAll')}</a>
      </div>
    {/if}

    <div class="cal-toolbar">
      <a class="navbtn" href={calHref(data.prevYM)} aria-label={$_('app.calendar.prevMonth')}>‹</a>
      <div class="mlabel">{data.monthLabel}</div>
      <a class="navbtn" href={calHref(data.nextYM)} aria-label={$_('app.calendar.nextMonth')}>›</a>
      {#if !data.isCurrentMonth}
        <a class="today-btn" href={calHref()}>{$_('app.calendar.today')}</a>
      {/if}

      <div class="cal-filters">
        <label class="toolbar-field status-field">
          <span class="sr-only">{$_('app.content.filter.statusLabel')}</span>
          <select value={activeFilter} onchange={onStatusChange}>
            {#each FILTERS as f (f.key)}
              <option value={f.key}>{$_('app.content.filter.' + f.labelKey)} ({counts[f.cKey] ?? 0})</option>
            {/each}
          </select>
        </label>
        <label class="cal-search">
          <span class="sr-only">{$_('app.content.searchPlaceholder')}</span>
          <input type="search" bind:value={searchQuery} placeholder={$_('app.content.searchPlaceholder')} autocomplete="off" />
        </label>
      </div>

      <div class="cal-tools">
        <div class="vtoggle">
          <a href={hrefWith({ view: null })} class:on={view === 'month'} data-sveltekit-noscroll
            >{$_('app.calendar.viewMonth')}</a
          >
          <a href={hrefWith({ view: 'list' })} class:on={view === 'list'} data-sveltekit-noscroll
            >{$_('app.calendar.viewList')}</a
          >
        </div>
      </div>
    </div>
  </div>

  {#if view === 'month'}
    <div class="cal-scroll">
      <div class="cal month">
        <div class="cal-grid head">
          {#each WEEKDAY_KEYS as w (w)}<div class="dowh">{$_('app.calendar.weekday.' + w)}</div>{/each}
        </div>
        <div class="cal-grid body">
          {#each grid as cell (cell.key)}
            <div class="cell" class:out={!cell.inMonth} class:today={cell.isToday}>
              <span class="dnum">{cell.dayNum}</span>
              <div class="cell-posts">
                {#each cell.posts.slice(0, MAX_CELL_POSTS) as p (p.id)}
                  {@const meta = platMeta(p.platform)}
                  {@const icon = platIcon(p.platform)}
                  {@const blog = p.kind === 'blog'}
                  {@const on = isSelected(p.id)}
                  {@const lockedOut = selectedKind !== null && selectedKind !== p.kind}
                  <div class="ev-wrap" class:on class:locked={lockedOut}>
                    <button
                      type="button"
                      class="ev-check"
                      class:on
                      disabled={lockedOut}
                      aria-pressed={on}
                      aria-label={$_('app.calendar.bulk.selectOne')}
                      title={lockedOut ? $_('app.calendar.bulk.sameTypeOnly') : $_('app.calendar.bulk.selectOne')}
                      onclick={(e) => toggleSelect(p, e)}
                    >
                      {#if on}✓{/if}
                    </button>
                    {#if blog}
                      <a class="ev" class:draft={p.isDraft} class:on href={`/app/${brand.slug}/site/edit/${p.id}`} title={evTitle(p, blog)}>
                        {@render evInner(p, meta, icon, blog)}
                      </a>
                    {:else}
                      <a
                        class="ev"
                        class:failed={p.status === 'failed'}
                        class:draft={p.isDraft}
                        class:on
                        href={postHref(p.id)}
                        title={evTitle(p, blog)}
                      >
                        {@render evInner(p, meta, icon, blog)}
                      </a>
                    {/if}
                  </div>
                {/each}
                {#if cell.posts.length > MAX_CELL_POSTS}
                  <span class="evmore">{$_('app.calendar.more', { values: { count: cell.posts.length - MAX_CELL_POSTS } })}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="cal-chrome">
      <div class="legend">
        <span class="lg"><span class="sw solid"></span>{$_('app.calendar.legendScheduled')}</span>
        <span class="lg"><span class="sw dashed"></span>{$_('app.calendar.legendDraft')}</span>
        <span class="lg">
          <span class="blog-chip"><span class="blog-label">BLOG</span></span>
          {$_('app.calendar.legendBlog')}
        </span>
      </div>
    </div>
  {:else}
    <div class="cal-chrome">
      {#if activeFilter === 'pending_user' && visiblePendingIds.length > 0}
        <div class="list-actions">
          <form method="POST" action="?/approveWeek" use:enhance>
            <input type="hidden" name="ids" value={visiblePendingIds.join(',')} />
            <button class="approve-all" type="submit">✓ {$_('app.content.approveWeek')}</button>
          </form>
        </div>
      {/if}

      <div class="cal-list">
        {#if filteredPosts.length}
          {#each filteredPosts as p (p.id)}
            {@const meta = platMeta(p.platform)}
            {@const icon = platIcon(p.platform)}
            {@const blog = p.kind === 'blog'}
            {@const on = isSelected(p.id)}
            {@const lockedOut = selectedKind !== null && selectedKind !== p.kind}
            {#if blog}
              <div class="cl-row" class:today={p.dayKey === data.todayKey} class:on class:locked={lockedOut}>
                <button
                  type="button"
                  class="cl-check"
                  class:on
                  disabled={lockedOut}
                  aria-pressed={on}
                  aria-label={$_('app.calendar.bulk.selectOne')}
                  title={lockedOut ? $_('app.calendar.bulk.sameTypeOnly') : $_('app.calendar.bulk.selectOne')}
                  onclick={(e) => toggleSelect(p, e)}
                >
                  {#if on}✓{/if}
                </button>
                <a class="cl-main" href={`/app/${brand.slug}/site/edit/${p.id}`}>
                  {@render clRowBody(p, meta, icon, blog)}
                </a>
                <span class="cl-actions"></span>
              </div>
            {:else}
              {@const targets = (p.platforms?.length ? p.platforms : [p.platform]).filter(Boolean)}
              {@const overLimit = captionViolations(p.caption, targets, p.editorPost?.platform_captions)}
              <div
                class="cl-row"
                class:today={p.dayKey === data.todayKey}
                class:on
                class:locked={lockedOut}
                role="link"
                tabindex="0"
                onclick={(e) => {
                  if ((e.target as HTMLElement).closest('form, button, a')) return;
                  void goto(postHref(p.id));
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void goto(postHref(p.id));
                  }
                }}
              >
                <button
                  type="button"
                  class="cl-check"
                  class:on
                  disabled={lockedOut}
                  aria-pressed={on}
                  aria-label={$_('app.calendar.bulk.selectOne')}
                  title={lockedOut ? $_('app.calendar.bulk.sameTypeOnly') : $_('app.calendar.bulk.selectOne')}
                  onclick={(e) => toggleSelect(p, e)}
                >
                  {#if on}✓{/if}
                </button>
                {@render clRowBody(p, meta, icon, blog)}
                <span class="cl-actions">
                  {#if p.status === 'pending_user'}
                    {#if overLimit.length}
                      <button class="mini approve" type="button" disabled title={$_('app.content.overLimit.hint')}>{$_('app.content.approve')}</button>
                    {:else}
                      <form method="POST" action="?/approve" use:enhance>
                        <input type="hidden" name="id" value={p.id} />
                        <button class="mini approve" type="submit">{$_('app.content.approve')}</button>
                      </form>
                    {/if}
                  {:else if p.status === 'failed'}
                    <a class="mini approve" href={`/app/${brand.slug}/posts/${p.id}/edit`}>{$_('app.content.editRepublish')}</a>
                    <form method="POST" action="?/repost" use:enhance>
                      <input type="hidden" name="id" value={p.id} />
                      <button class="mini" type="submit">{$_('app.content.retry')}</button>
                    </form>
                  {/if}
                  <a class="mini edit" href={`/app/${brand.slug}/posts/${p.id}/edit`}>{$_('app.content.edit')}</a>
                  {#if confirmId === p.id}
                    <form
                      method="POST"
                      action="?/deletePost"
                      use:enhance={() =>
                        async ({ update }) => {
                          confirmId = null;
                          await update();
                        }}
                    >
                      <input type="hidden" name="id" value={p.id} />
                      <button class="mini danger" type="submit">{$_('app.content.confirm')}</button>
                    </form>
                  {:else}
                    <button class="mini danger-ghost" type="button" onclick={() => (confirmId = p.id)}>{$_('app.content.delete')}</button>
                  {/if}
                </span>
              </div>
            {/if}
          {/each}
        {:else if searchQuery.trim()}
          <div class="cl-empty">{$_('app.content.emptySearch')}</div>
        {:else}
          <div class="cl-empty">{$_('app.calendar.emptyList')}</div>
        {/if}
      </div>
    </div>
  {/if}

  {#if selectedIds.length && selectedKind}
    <div class="bulk-bar" role="toolbar" aria-label={$_('app.calendar.bulk.toolbar')}>
      <div class="bulk-info">
        <span class="bulk-count">
          {$_('app.calendar.bulk.selected', {
            values: {
              n: selectedIds.length,
              kind: selectedKind === 'blog' ? $_('app.calendar.bulk.kindBlog') : $_('app.calendar.bulk.kindSocial')
            }
          })}
        </span>
        <button type="button" class="bulk-link" onclick={() => selectVisibleOfKind(selectedKind!)}>
          {$_('app.calendar.bulk.selectAllVisible')}
        </button>
        <button type="button" class="bulk-link" onclick={clearSelection}>{$_('app.calendar.bulk.clear')}</button>
      </div>
      <div class="bulk-actions">
        {#if selectedKind === 'social'}
          <button
            type="button"
            class="bulk-btn"
            disabled={!selectedWithMedia.length || downloading}
            aria-busy={downloading}
            onclick={downloadSelectedMedia}
          >
            {#if downloading}
              <span class="spin"></span>
              {$_('app.calendar.bulk.downloading')}
            {:else}
              ⬇︎ {$_('app.calendar.bulk.downloadMedia')}
            {/if}
          </button>
          {#if selectedPendingSocial.length}
            <form method="POST" action="?/approveWeek" use:enhance={afterBulk}>
              <input type="hidden" name="ids" value={selectedPendingSocial.map((p) => p.id).join(',')} />
              <button class="bulk-btn primary" type="submit">
                ✓ {$_('app.calendar.bulk.approve', { values: { n: selectedPendingSocial.length } })}
              </button>
            </form>
          {/if}
          {#if confirmBulkDelete}
            <form method="POST" action="?/deleteSelected" use:enhance={afterBulk}>
              <input type="hidden" name="ids" value={selectedIds.join(',')} />
              <button class="bulk-btn danger" type="submit">
                {$_('app.calendar.bulk.confirmDelete', { values: { n: selectedIds.length } })}
              </button>
            </form>
            <button type="button" class="bulk-link" onclick={() => (confirmBulkDelete = false)}>
              {$_('app.calendar.bulk.cancel')}
            </button>
          {:else}
            <button type="button" class="bulk-btn danger-ghost" onclick={() => (confirmBulkDelete = true)}>
              {$_('app.content.delete')}
            </button>
          {/if}
        {:else}
          {#if selectedBlogPublishable.length}
            <form method="POST" action="?/publishSelectedArticles" use:enhance={afterBulk}>
              <input type="hidden" name="ids" value={selectedBlogPublishable.map((p) => p.id).join(',')} />
              <button class="bulk-btn primary" type="submit">
                {$_('app.calendar.bulk.publishBlog', { values: { n: selectedBlogPublishable.length } })}
              </button>
            </form>
          {/if}
          {#if confirmBulkDelete}
            <form method="POST" action="?/deleteSelectedArticles" use:enhance={afterBulk}>
              <input type="hidden" name="ids" value={selectedIds.join(',')} />
              <button class="bulk-btn danger" type="submit">
                {$_('app.calendar.bulk.confirmDelete', { values: { n: selectedIds.length } })}
              </button>
            </form>
            <button type="button" class="bulk-link" onclick={() => (confirmBulkDelete = false)}>
              {$_('app.calendar.bulk.cancel')}
            </button>
          {:else}
            <button type="button" class="bulk-btn danger-ghost" onclick={() => (confirmBulkDelete = true)}>
              {$_('app.content.delete')}
            </button>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if PostPanel && data.detail && data.selectedId}
  {#key data.selectedId}
    <PostPanel
      id={data.selectedId}
      detail={data.detail}
      timezone={data.timezone}
      fullHref={fullPostHref}
      {form}
      onclose={closePanel}
    />
  {/key}
{/if}

<style>
  .cal-page {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100%;
  }
  .cal-chrome {
    padding: 16px var(--content-pad-x, 20px) 12px;
    box-sizing: border-box;
  }

  .conflict-banner { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 16px;
    padding: 12px 16px; border-radius: 12px; border: 1px solid color-mix(in srgb, #e6a100 55%, var(--line));
    background: color-mix(in srgb, #e6a100 10%, var(--paper)); }
  .conflict-banner .cb-txt { font-size: 13.5px; font-weight: 600; color: var(--ink); flex: 1 1 auto; }
  .conflict-banner .cb-ai { flex: 0 0 auto; font-size: 13px; font-weight: 600; text-decoration: none;
    color: #fff; background: var(--accent); border-radius: 980px; padding: 8px 16px; white-space: nowrap; }
  .conflict-banner .cb-ai:hover { filter: brightness(1.06); }

  .cal-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .navbtn { width: 32px; height: 32px; border-radius: 9px; border: 1px solid var(--line); display: flex;
    align-items: center; justify-content: center; text-decoration: none; color: var(--ink); font-size: 18px; line-height: 1; }
  .navbtn:hover { background: var(--paper-2); }
  .mlabel { font-size: 16px; font-weight: 600; min-width: 9.5ch; text-align: center; }
  .today-btn { margin-left: 2px; font-size: 13px; font-weight: 600; color: var(--accent); text-decoration: none;
    border: 1px solid var(--accent); border-radius: 980px; padding: 6px 14px; }

  /* Month nav · filters · view toggle — one row */
  .cal-filters {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
    margin-left: 8px;
  }
  .toolbar-field { display: flex; min-width: 0; }
  .status-field select,
  .cal-search input {
    font: inherit; font-size: 13px; padding: 7px 11px; border-radius: 10px; height: 34px;
    border: 1px solid var(--line); background: var(--paper); color: var(--ink); box-sizing: border-box;
  }
  .status-field select { min-width: 150px; max-width: 220px; cursor: pointer; }
  .status-field select:focus,
  .cal-search input:focus { outline: none; border-color: var(--accent); }
  .cal-search { flex: 1 1 140px; max-width: 240px; min-width: 120px; display: flex; }
  .cal-search input { width: 100%; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

  .cal-tools { margin-left: auto; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .vtoggle { display: inline-flex; border: 1px solid var(--line-2); border-radius: 10px; overflow: hidden; }
  .vtoggle a { padding: 7px 14px; font-size: 13px; font-weight: 600; background: var(--paper);
    color: var(--ink-soft); border: none; cursor: pointer; font-family: inherit;
    text-decoration: none; }
  .vtoggle a.on { background: rgba(var(--accent-rgb), 0.1); color: var(--accent); }

  /* Text badge replacing the 📝 blog emoji everywhere a blog article shows up. */
  .blog-label { font-size: 9px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; line-height: 1; }
  .blog-chip { display: inline-flex; align-items: center; justify-content: center; background: #5b6470;
    color: #fff; border-radius: 4px; padding: 2px 6px; }

  /* Lista view — chronological rows with thumb/when/platform/caption/status + inline actions. */
  .list-actions { display: flex; justify-content: flex-end; margin-bottom: 10px; }
  .cal-list { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--paper); }
  .cl-row { display: grid; grid-template-columns: 28px 52px 190px 160px minmax(0, 1fr) 150px auto; gap: 14px; align-items: center;
    width: 100%; text-align: left; font: inherit; padding: 10px 16px; border: none; border-top: 1px solid var(--line);
    background: none; cursor: pointer; text-decoration: none; color: inherit; }
  .cl-row:first-child { border-top: none; }
  .cl-row:hover { background: var(--paper-2); }
  .cl-row.today { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .cl-row.on { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .cl-row.locked { opacity: 0.55; }
  .cl-main {
    display: contents;
    text-decoration: none;
    color: inherit;
  }
  .cl-check {
    width: 22px; height: 22px; border-radius: 7px; border: 1.5px solid var(--line-2, #d2d2d7);
    background: var(--paper); color: #fff; font-size: 12px; font-weight: 800; line-height: 1;
    display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;
    flex: 0 0 auto;
  }
  .cl-check:hover:not(:disabled) { border-color: var(--accent); }
  .cl-check.on { background: var(--accent); border-color: var(--accent); }
  .cl-check:disabled { cursor: not-allowed; opacity: 0.5; }
  .cl-thumb {
    position: relative;
    width: 44px; height: 44px; border-radius: 10px; flex-shrink: 0;
    background: var(--paper-2) center / cover no-repeat; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  .cl-thumb-ph {
    width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 11px; font-weight: 700;
  }
  .cl-thumb-ph svg { width: 18px; height: 18px; }
  .cl-when { font-size: 13px; font-weight: 600; color: var(--ink); text-transform: capitalize; }
  .cl-plat { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; min-width: 0; }
  .cl-plat svg { width: 15px; height: 15px; flex: 0 0 auto; }
  .cl-badge { width: 16px; height: 16px; border-radius: 5px; color: #fff; font-size: 8px; font-weight: 700;
    display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .cl-badge.blog { width: auto; padding: 0 5px; border-radius: 4px; }
  .cl-pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .cl-cap { min-width: 0; font-size: 13px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cl-attn { margin-right: 5px; color: #a3700a; font-size: 11px; }
  .cl-status { justify-self: end; display: inline-flex; align-items: center; gap: 8px; }
  .cl-status .state { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--ink-faint); }
  .cl-status .state .d { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-faint); }
  .cl-status .state.ok { color: var(--accent); } .cl-status .state.ok .d { background: var(--accent); }
  .cl-status .state.bad { color: #c0392b; } .cl-status .state.bad .d { background: #c0392b; }
  .cl-err { width: 16px; height: 16px; border-radius: 50%; background: #c0392b; color: #fff; font-size: 10px;
    font-weight: 800; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .cl-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-self: end; cursor: default; }
  .cl-empty { padding: 40px 22px; text-align: center; color: var(--ink-faint); font-size: 14px; }
  @container workbench (max-width: 900px) {
    .cl-row { grid-template-columns: 28px 44px 1fr auto; }
    .cl-plat, .cl-cap, .cl-status { display: none; }
  }

  /* Full-bleed month grid — no max-width, no side padding, no card chrome. */
  .cal-scroll {
    width: 100%;
    overflow-x: auto;
    flex: 1 1 auto;
  }
  .cal.month {
    min-width: 860px;
    width: 100%;
    border: none;
    border-radius: 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    background: var(--paper);
  }
  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
  .cal-grid.head .dowh {
    padding: 10px 12px;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--ink-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--line);
    border-right: 1px solid var(--line);
  }
  .cal-grid.head .dowh:nth-child(7) { border-right: none; }

  .cal.month .cell {
    min-height: 188px;
    min-width: 0;
    padding: 8px;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cal.month .cell:nth-child(7n) { border-right: none; }
  .cell-posts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    flex: 1 1 auto;
  }

  .cell .dnum { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); margin-bottom: 0; align-self: flex-start;
    width: 23px; height: 23px; display: flex; align-items: center; justify-content: center; }
  .cell.out { background: var(--paper-2); }
  .cell.out .dnum { color: var(--ink-faint); opacity: 0.5; }
  .cell.today { background: color-mix(in srgb, var(--accent) 6%, transparent); }
  .cell.today .dnum { background: var(--accent); color: #fff; border-radius: 50%; }
  .evmore { font-size: 10.5px; font-weight: 600; color: var(--ink-faint); padding-left: 2px; }

  /* Post preview cards — thumb + time + caption. */
  .ev {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
    text-decoration: none;
    font-family: inherit;
    padding: 0;
    overflow: hidden;
    background: var(--paper);
    display: flex;
    flex-direction: column;
    gap: 0;
    color: var(--ink);
  }
  .ev:hover { border-color: var(--line-2, var(--line)); filter: brightness(0.99); }
  .ev.failed { opacity: 0.62; }
  .ev.draft { opacity: 0.72; outline: 1.5px dashed color-mix(in srgb, var(--ink) 35%, transparent); outline-offset: -3px; }
  .ev.draft:hover { opacity: 0.88; }
  .ev.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }

  .ev-wrap {
    position: relative;
    width: 100%;
    min-width: 0;
  }
  .ev-wrap.locked { opacity: 0.5; }
  .ev-check {
    position: absolute;
    top: 5px;
    left: 5px;
    z-index: 2;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1.5px solid rgba(255, 255, 255, 0.85);
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    font-size: 11px;
    font-weight: 800;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .ev-wrap:hover .ev-check,
  .cal-page.selecting .ev-check:not(:disabled),
  .ev-check.on { opacity: 1; }
  .ev-check.on { background: var(--accent); border-color: var(--accent); }
  .ev-check:disabled { cursor: not-allowed; opacity: 0.35; }

  .evthumb {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    max-height: 88px;
    background: var(--paper-2) center / cover no-repeat;
  }
  .evph {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
  }
  .evph svg { width: 22px; height: 22px; }
  .evplat {
    position: absolute;
    left: 5px;
    bottom: 5px;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 8px;
    font-weight: 700;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  }
  .evplat.blog { width: auto; height: 16px; padding: 0 5px; border-radius: 4px; }
  .evplat svg { width: 11px; height: 11px; }
  .evwarn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: #a3700a;
    color: #fff;
    font-size: 9px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .evwarn.bad { background: #c0392b; }

  .evbody {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 5px 7px 6px;
    min-width: 0;
    overflow: hidden;
  }
  .evtime {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--ink-soft);
    letter-spacing: 0.01em;
  }
  .evcap {
    min-width: 0;
    font-size: 11px;
    font-weight: 500;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }

  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin: 4px 0 8px; font-size: 12.5px; color: var(--ink-soft); }
  .legend .lg { display: inline-flex; align-items: center; gap: 7px; }
  .legend .sw { width: 16px; height: 12px; border-radius: 3px; flex: 0 0 auto; }
  .legend .sw.solid { background: var(--ink-soft); }
  .legend .sw.dashed { background: color-mix(in srgb, var(--ink-soft) 22%, transparent); border: 1.5px dashed var(--ink-soft); }

  /* ── Flash + row-filter banners (mirror Content) ─────────────────────────────────────────── */
  .flash { border-radius: 14px; padding: 12px 18px; font-size: 13.5px; font-weight: 500; margin-bottom: 16px; }
  .flash.ok { background: rgba(var(--accent-rgb), 0.08); color: var(--accent); }
  .flash.bad { background: #fde2e0; color: #c0392b; }
  .flash.bad.noacct { display: block; text-decoration: none; background: #fff3d6; color: #8a6d12; }
  .rowfilter { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding: 9px 14px;
    border-radius: 12px; font-size: 13px; background: rgba(var(--accent-rgb), 0.07);
    border: 1px solid rgba(var(--accent-rgb), 0.2); color: var(--ink-soft); }
  .rowfilter a { margin-left: auto; color: var(--accent); font-weight: 600; text-decoration: none; }
  .rowfilter a:hover { text-decoration: underline; }

  /* ── Buttons (mirror Content's mini/approve-all/create-single) ──────────────────────────── */
  .mini { font-size: 12px; font-weight: 600; border-radius: 8px; padding: 6px 12px; cursor: pointer;
    border: 1px solid transparent; line-height: 1; text-decoration: none; display: inline-flex; align-items: center; }
  .mini:disabled { opacity: 0.55; cursor: default; }
  .mini.approve { background: var(--accent); color: #fff; border: 1px solid var(--accent); }
  .mini.approve:hover { filter: brightness(0.95); }
  .mini.edit { background: var(--paper); color: var(--ink-soft); border: 1px solid var(--line-2); }
  .mini.edit:hover { color: var(--ink); border-color: var(--ink-faint); }
  .mini.danger-ghost { background: var(--paper); color: var(--ink-soft); border: 1px solid var(--line-2); }
  .mini.danger-ghost:hover { background: #fde2e0; color: #c0392b; border-color: #f3b6b0; }
  .mini.danger { background: #c0392b; color: #fff; }
  .mini.danger:hover { filter: brightness(0.95); }
  form { margin: 0; }
  .approve-all { font-size: 13px; font-weight: 600; border-radius: 10px; padding: 9px 16px; cursor: pointer;
    border: 1px solid transparent; background: var(--accent); color: #fff; }
  .approve-all.ghost { background: var(--paper); border: 1px solid var(--line-2); color: var(--ink-soft); }
  .approve-all.ghost:hover { background: var(--paper-2); color: var(--ink); }
  .approve-all[disabled] { opacity: 0.6; cursor: default; }
  .create-single { font-size: 13px; font-weight: 600; border-radius: 10px; padding: 9px 16px; cursor: pointer;
    border: 1px solid transparent; background: var(--accent); color: #fff; }
  .create-single:hover { opacity: 0.88; }
  .create-single[disabled] { opacity: 0.5; cursor: default; }
  .cal-plan-link {
    font-size: 13px; font-weight: 500; color: var(--ink-soft); text-decoration: none;
    padding: 9px 4px; white-space: nowrap;
  }
  .cal-plan-link:hover { color: var(--ink); }
  .spin { width: 13px; height: 13px; border-radius: 50%; flex: 0 0 auto; display: inline-block;
    border: 2px solid rgba(var(--accent-rgb), 0.25); border-top-color: var(--accent);
    animation: cal-spin 0.7s linear infinite; }
  @keyframes cal-spin { to { transform: rotate(360deg); } }

  /* Sticky multi-select action bar */
  .bulk-bar {
    position: sticky;
    bottom: 12px;
    z-index: 20;
    margin: 0 var(--content-pad-x, 20px) 16px;
    padding: 12px 16px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    backdrop-filter: blur(10px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 18px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
  }
  .bulk-info { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; flex: 1 1 auto; }
  .bulk-count { font-size: 13.5px; font-weight: 700; color: var(--ink); }
  .bulk-link {
    border: none; background: none; padding: 0; cursor: pointer; font: inherit;
    font-size: 12.5px; font-weight: 600; color: var(--accent);
  }
  .bulk-link:hover { text-decoration: underline; }
  .bulk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .bulk-btn {
    font: inherit; font-size: 13px; font-weight: 600; border-radius: 10px; padding: 8px 14px;
    cursor: pointer; border: 1px solid var(--line-2); background: var(--paper); color: var(--ink);
    display: inline-flex; align-items: center; gap: 7px;
  }
  .bulk-btn:hover:not(:disabled) { background: var(--paper-2); }
  .bulk-btn:disabled { opacity: 0.55; cursor: default; }
  .bulk-btn.primary { background: var(--accent); border-color: transparent; color: #fff; }
  .bulk-btn.primary:hover:not(:disabled) { filter: brightness(1.05); }
  .bulk-btn.danger { background: #c0392b; border-color: transparent; color: #fff; }
  .bulk-btn.danger-ghost { color: #c0392b; border-color: color-mix(in srgb, #c0392b 40%, var(--line)); }

  @container workbench (max-width: 640px) {
    .cal.month .cell { min-height: 160px; }
    .evthumb { max-height: 72px; }
    .cal-filters { flex: 1 1 100%; margin-left: 0; order: 3; }
    .cal-tools { margin-left: 0; }
    .status-field select,
    .cal-search { max-width: none; flex: 1 1 auto; }
    .bulk-bar { margin-left: 12px; margin-right: 12px; }
  }
</style>
