<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import PageHead from '$lib/components/PageHead.svelte';
  import { Search, ExternalLink, Shuffle } from '@lucide/svelte';
  import type { LibraryAd } from './+page.server';
  import type { RemixBrief } from '$lib/server/ads-remix';
  import UpgradeLink from '$lib/components/UpgradeLink.svelte';
  import { X } from '@lucide/svelte';

  let { data, form } = $props();
  const brand = $derived(data.brand);
  const competitors = $derived(data.competitors as string[]);
  const ads = $derived(data.ads as LibraryAd[]);
  const briefs = $derived((data.briefs ?? []) as RemixBrief[]);
  const canRemix = $derived(!!data.canRemix);
  const query = $derived(data.query);

  let mode = $state<'company' | 'query'>(data.query.mode);
  let q = $state(data.query.q);
  let status = $state<'ACTIVE' | 'ALL'>(data.query.status);
  let media = $state<'ALL' | 'VIDEO' | 'IMAGE'>(data.query.media);
  let searching = $state(false);
  let remixing = $state(false);
  let selected = $state<Record<string, boolean>>({});
  let reviewAd = $state<LibraryAd | null>(null);

  $effect(() => {
    mode = data.query.mode;
    q = data.query.q;
    status = data.query.status;
    media = data.query.media;
  });

  // Drop selections when the result set changes.
  const adsKey = $derived(ads.map((a) => a.id).join(','));
  $effect(() => {
    void adsKey;
    selected = {};
  });

  const selectedAds = $derived(ads.filter((a) => selected[a.id]));
  const selectedCount = $derived(selectedAds.length);
  const showStickyRemix = $derived(canRemix && selectedCount > 0);

  function hrefFor(next: { q?: string; mode?: string; status?: string; media?: string }) {
    const sp = new URLSearchParams();
    const qq = (next.q ?? q).trim();
    if (qq) sp.set('q', qq);
    sp.set('mode', next.mode ?? mode);
    sp.set('status', next.status ?? status);
    sp.set('media', next.media ?? media);
    const qs = sp.toString();
    return `/app/${brand.slug}/ads/library${qs ? `?${qs}` : ''}`;
  }

  async function runSearch(e?: Event) {
    e?.preventDefault();
    searching = true;
    try {
      await goto(hrefFor({}), { invalidateAll: true, keepFocus: true, noScroll: true });
    } finally {
      searching = false;
    }
  }

  async function pickCompetitor(name: string) {
    mode = 'company';
    q = name;
    searching = true;
    try {
      await goto(hrefFor({ q: name, mode: 'company' }), {
        invalidateAll: true,
        keepFocus: true,
        noScroll: true
      });
    } finally {
      searching = false;
    }
  }

  function toggle(id: string) {
    selected = { ...selected, [id]: !selected[id] };
  }

  function selectAll() {
    const next: Record<string, boolean> = {};
    for (const a of ads.slice(0, 12)) next[a.id] = true;
    selected = next;
  }

  function clearSelection() {
    selected = {};
  }

  function remixPayload() {
    return JSON.stringify(
      selectedAds.map((a) => ({
        id: a.id,
        pageName: a.pageName,
        body: a.body,
        title: a.title,
        ctaText: a.ctaText,
        linkUrl: a.linkUrl,
        isActive: a.isActive,
        startDate: a.startDate,
        platforms: a.platforms,
        mediaType: a.mediaType,
        imageUrl: a.imageUrl,
        videoUrl: a.videoUrl,
        libraryUrl: a.libraryUrl
      }))
    );
  }

  // Quale brief sta partendo: il bottone si spegne solo su quella card.
  let producingId = $state<string | null>(null);

  function produceEnhance(id: string) {
    producingId = id;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      producingId = null;
      await invalidateAll();
    };
  }

  function remixEnhance() {
    remixing = true;
    return async ({
      result,
      update
    }: {
      result: { type: string };
      update: () => Promise<void>;
    }) => {
      await update();
      remixing = false;
      if (result.type === 'success') selected = {};
      await invalidateAll();
    };
  }
</script>

<PageHead
  title={$_('app.ads.library.title')}
  subtitle={$_('app.ads.library.subtitle', { values: { brand: brand.name } })}
/>

<div class="content" class:has-sticky={showStickyRemix}>
  <section class="panel search-panel">
    <div class="panel-head">
      <div class="t">
        {$_('app.ads.library.searchTitle')}
        <span class="sub-desktop">{$_('app.ads.library.searchSub')}</span>
      </div>
    </div>
    <p class="sub-mobile">{$_('app.ads.library.searchSub')}</p>

    <form class="search" onsubmit={runSearch}>
      <div class="modes" role="group" aria-label="Search mode">
        <button
          type="button"
          class="seg"
          class:on={mode === 'company'}
          onclick={() => (mode = 'company')}
        >
          {$_('app.ads.library.modeCompany')}
        </button>
        <button
          type="button"
          class="seg"
          class:on={mode === 'query'}
          onclick={() => (mode = 'query')}
        >
          {$_('app.ads.library.modeQuery')}
        </button>
      </div>

      <div class="row">
        <input
          type="search"
          enterkeyhint="search"
          bind:value={q}
          placeholder={mode === 'company'
            ? $_('app.ads.library.queryPhCompany')
            : $_('app.ads.library.queryPhQuery')}
          autocomplete="off"
        />
        <button class="btn primary search-btn" type="submit" disabled={searching || !q.trim()}>
          <Search class="size-3.5" strokeWidth={2} />
          <span class="btn-label">
            {searching ? $_('app.ads.library.searching') : $_('app.ads.library.search')}
          </span>
        </button>
      </div>

      <div class="filters">
        <label>
          <span>{$_('app.ads.library.status')}</span>
          <select bind:value={status}>
            <option value="ACTIVE">{$_('app.ads.library.statusActive')}</option>
            <option value="ALL">{$_('app.ads.library.statusAll')}</option>
          </select>
        </label>
        <label>
          <span>{$_('app.ads.library.media')}</span>
          <select bind:value={media}>
            <option value="ALL">{$_('app.ads.library.mediaAll')}</option>
            <option value="VIDEO">{$_('app.ads.library.mediaVideo')}</option>
            <option value="IMAGE">{$_('app.ads.library.mediaImage')}</option>
          </select>
        </label>
      </div>
    </form>

    {#if competitors.length}
      <div class="comps">
        <div class="comps-label">{$_('app.ads.library.competitors')}</div>
        <div class="comp-chips" role="list">
          {#each competitors as name}
            <button
              type="button"
              class="chip"
              class:on={mode === 'company' && q === name}
              disabled={searching}
              onclick={() => pickCompetitor(name)}
            >
              {name}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </section>

  {#if data.error}
    <div class="banner err">
      {$_('app.ads.library.error', { values: { msg: data.error } })}
    </div>
  {/if}
  {#if form?.error}
    <div class="banner err">
      {#if form.error === 'no_ads_selected'}
        {$_('app.ads.library.errors.no_ads_selected')}
      {:else if form.error === 'no_competitor_ads'}
        {$_('app.ads.library.errors.no_competitor_ads')}
      {:else if form.error === 'no_remix_briefs'}
        {$_('app.ads.library.errors.no_remix_briefs')}
      {:else if form.error === 'ads_not_on_plan'}
        {$_('app.ads.library.errors.ads_not_on_plan')}
      {:else if form.error === 'credits_exhausted'}
        {$_('app.ads.library.errors.credits_exhausted')} <UpgradeLink />
      {:else}
        {$_('app.ads.library.error', { values: { msg: form.error } })}
      {/if}
    </div>
  {/if}
  {#if form?.produced}
    <div class="banner ok">{$_('app.ads.library.producedOk')}</div>
  {/if}
  {#if form?.remixed}
    <div class="banner ok">
      {$_('app.ads.library.remixOk', { values: { n: form.count ?? 0 } })}
    </div>
  {/if}

  {#if query.q}
    <section class="panel results">
      <div class="panel-head results-head">
        <div class="t">
          {$_('app.ads.library.results', { values: { n: ads.length } })}
          <span class="query-chip">{query.q}</span>
        </div>
        {#if canRemix && ads.length}
          <div class="remix-actions desktop-only">
            {#if selectedCount}
              <button type="button" class="chip" onclick={clearSelection}>
                {$_('app.ads.library.clearSelection')}
              </button>
            {:else}
              <button type="button" class="chip" onclick={selectAll}>
                {$_('app.ads.library.selectAll')}
              </button>
            {/if}
            <form method="POST" action="?/remix" use:enhance={remixEnhance}>
              <input type="hidden" name="ads" value={remixPayload()} />
              <button
                class="btn primary remix-btn"
                type="submit"
                disabled={remixing || selectedCount === 0}
              >
                <Shuffle class="size-3.5" strokeWidth={2} />
                {remixing
                  ? $_('app.ads.library.remixing')
                  : $_('app.ads.library.remixSelected', { values: { n: selectedCount } })}
              </button>
            </form>
          </div>
        {/if}
      </div>

      {#if canRemix && ads.length}
        <div class="mobile-toolbar">
          <button type="button" class="chip" onclick={selectedCount ? clearSelection : selectAll}>
            {selectedCount
              ? $_('app.ads.library.clearSelection')
              : $_('app.ads.library.selectAll')}
          </button>
          <p class="remix-hint">{$_('app.ads.library.remixHint')}</p>
        </div>
        <p class="remix-hint desktop-only">{$_('app.ads.library.remixHint')}</p>
      {/if}

      {#if !ads.length && !data.error}
        <p class="empty">{$_('app.ads.library.noResults')}</p>
      {:else}
        <div class="grid">
          {#each ads as ad (ad.id)}
            <article class="card" class:picked={!!selected[ad.id]}>
              {#if canRemix}
                <label class="pick">
                  <input
                    type="checkbox"
                    checked={!!selected[ad.id]}
                    onchange={() => toggle(ad.id)}
                  />
                  <span>{$_('app.ads.library.select')}</span>
                </label>
              {/if}
              <div class="card-main">
                {#if ad.imageUrl || ad.videoUrl}
                  <a
                    class="thumb"
                    href={ad.libraryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    tabindex="-1"
                    aria-hidden="true"
                  >
                    {#if ad.imageUrl}
                      <img src={ad.imageUrl} alt="" loading="lazy" />
                    {:else}
                      <div class="thumb-fallback">video</div>
                    {/if}
                    {#if ad.mediaType === 'video' || ad.videoUrl}
                      <span class="badge media">video</span>
                    {/if}
                  </a>
                {/if}
                <div class="body">
                  <div class="meta">
                    <span class="page">{ad.pageName || '—'}</span>
                    {#if ad.isActive === true}
                      <span class="badge ok">{$_('app.ads.library.active')}</span>
                    {:else if ad.isActive === false}
                      <span class="badge muted">{$_('app.ads.library.inactive')}</span>
                    {/if}
                  </div>
                  {#if ad.platforms?.length}
                    <div class="plats">{ad.platforms.slice(0, 3).join(' · ')}</div>
                  {/if}
                  {#if ad.title}
                    <p class="title">{ad.title}</p>
                  {/if}
                  {#if ad.body}
                    <p class="copy">{ad.body}</p>
                  {/if}
                  {#if ad.ctaText}
                    <p class="cta"><span>{$_('app.ads.library.cta')}</span> {ad.ctaText}</p>
                  {/if}
                  <div class="foot">
                    {#if ad.startDate}
                      <span class="since"
                        >{$_('app.ads.library.since', { values: { date: ad.startDate } })}</span
                      >
                    {/if}
                    <a
                      class="open"
                      href={ad.libraryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {$_('app.ads.library.openLibrary')}
                      <ExternalLink class="size-3" strokeWidth={2} />
                    </a>
                    {#if ad.videoUrl}
                      <button
                        type="button"
                        class="open review"
                        onclick={() => (reviewAd = ad)}
                      >
                        {$_('app.videoReview.run')}
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <section class="panel empty-panel">
      <div class="empty-title">{$_('app.ads.library.emptyTitle')}</div>
      <p class="empty">{$_('app.ads.library.emptyBody')}</p>
    </section>
  {/if}

  <section class="panel briefs">
    <div class="panel-head">
      <div class="t">
        {$_('app.ads.library.briefsTitle')}
        <span class="sub-desktop">{$_('app.ads.library.briefsSub')}</span>
      </div>
    </div>
    <p class="sub-mobile briefs-sub">{$_('app.ads.library.briefsSub')}</p>
    {#if !briefs.length}
      <p class="empty">{$_('app.ads.library.briefsEmpty')}</p>
    {:else}
      <div class="brief-list">
        {#each briefs as b (b.id ?? b.sourceAdId + b.rank)}
          <article class="brief">
            <header>
              <span class="rank">#{b.rank}</span>
              <div class="brief-titles">
                <div class="hook">{b.hook}</div>
                <div class="headline">{b.headline}</div>
              </div>
              {#if b.sourceLibraryUrl}
                <a
                  class="src"
                  href={b.sourceLibraryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={b.sourcePageName ?? ''}
                >
                  {$_('app.ads.library.sourceAd')}
                  <ExternalLink class="size-3" strokeWidth={2} />
                </a>
              {/if}
            </header>
            {#if b.strategy}
              <p class="strategy">{b.strategy}</p>
            {/if}
            <div class="keep-change">
              {#if b.keep}
                <div><strong>{$_('app.ads.library.keep')}</strong> {b.keep}</div>
              {/if}
              {#if b.change}
                <div><strong>{$_('app.ads.library.change')}</strong> {b.change}</div>
              {/if}
            </div>
            {#if b.body}
              <p class="brief-body">{b.body}</p>
            {/if}
            <footer>
              {#if b.cta}<span class="pill">{b.cta}</span>{/if}
              {#if b.productName}<span class="pill">{b.productName}</span>{/if}
              {#if b.status === 'converted'}
                <span class="pill done">{$_('app.ads.library.produced')}</span>
              {:else if canRemix && b.id}
                <form
                  method="POST"
                  action="?/produce"
                  use:enhance={() => produceEnhance(b.id!)}
                  class="produce-form"
                >
                  <input type="hidden" name="briefId" value={b.id} />
                  <button type="submit" class="produce" disabled={producingId === b.id}>
                    {producingId === b.id
                      ? $_('app.ads.library.producing')
                      : $_('app.ads.library.produce')}
                  </button>
                </form>
                <span class="produce-note">{$_('app.ads.library.produceNote')}</span>
              {/if}
            </footer>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <p class="source-note">{$_('app.ads.library.sourceNote')}</p>
</div>

{#if reviewAd?.videoUrl}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="vr-modal" role="dialog" aria-modal="true" aria-label={$_('app.videoReview.title')} onclick={() => (reviewAd = null)}>
    <div class="vr-sheet" onclick={(e) => e.stopPropagation()}>
      <div class="vr-sheet-head">
        <strong>{reviewAd.pageName || $_('app.videoReview.title')}</strong>
        <button type="button" class="vr-close" onclick={() => (reviewAd = null)} aria-label="Close">
          <X size={18} strokeWidth={2.25} />
        </button>
      </div>
      <!-- svelte-ignore a11y_media_has_caption -->
      <video class="vr-player" src={reviewAd.videoUrl} controls playsinline preload="metadata"></video>
    </div>
  </div>
{/if}

{#if showStickyRemix}
  <div class="sticky-remix" role="region" aria-label="Remix">
    <div class="sticky-inner">
      <div class="sticky-meta">
        <strong>{selectedCount}</strong>
        <span>{$_('app.ads.library.select')}</span>
        <button type="button" class="linkish" onclick={clearSelection}>
          {$_('app.ads.library.clearSelection')}
        </button>
      </div>
      <form method="POST" action="?/remix" use:enhance={remixEnhance}>
        <input type="hidden" name="ads" value={remixPayload()} />
        <button class="btn primary remix-btn sticky-btn" type="submit" disabled={remixing}>
          <Shuffle class="size-3.5" strokeWidth={2} />
          {remixing
            ? $_('app.ads.library.remixing')
            : $_('app.ads.library.remixSelected', { values: { n: selectedCount } })}
        </button>
      </form>
    </div>
  </div>
{/if}

<style>
  .content {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 28px;
    min-width: 0;
  }
  .content.has-sticky {
    padding-bottom: 96px;
  }

  .panel-head .t {
    min-width: 0;
  }
  .panel-head .t span,
  .sub-mobile {
    display: block;
    color: var(--ink-faint, var(--muted));
    font-weight: 500;
    font-size: 0.82rem;
    line-height: 1.35;
    margin-top: 4px;
  }
  .query-chip {
    display: inline-block !important;
    margin-top: 6px !important;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 0.78rem !important;
    color: var(--muted) !important;
    font-weight: 550 !important;
  }
  .sub-mobile {
    display: none;
    margin: 0;
    padding: 0 16px 4px;
  }
  .briefs-sub {
    padding-bottom: 0;
  }

  .search {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 22px 10px;
  }
  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    background: color-mix(in oklab, var(--ink) 3%, var(--paper));
  }
  .seg {
    border: none;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    padding: 11px 12px;
    cursor: pointer;
    min-height: 44px;
  }
  .seg.on {
    background: var(--paper);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: stretch;
  }
  .row input {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 12px 14px;
    background: var(--bg, var(--paper));
    color: inherit;
    font: inherit;
    font-size: 16px; /* avoid iOS zoom */
    min-height: 44px;
  }
  .btn.primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    white-space: nowrap;
    border: none;
    border-radius: 12px;
    padding: 0 14px;
    background: var(--ink);
    color: var(--paper);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
  }
  .btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .search-btn {
    flex-shrink: 0;
  }
  .remix-btn {
    min-height: 40px;
  }
  .filters {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .filters label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 0.75rem;
    color: var(--muted);
    min-width: 0;
  }
  .filters select {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
    background: var(--bg, var(--paper));
    color: inherit;
    font: inherit;
    font-size: 16px;
    min-height: 44px;
  }
  .comps {
    padding: 10px 0 16px;
    border-top: 1px solid var(--line);
  }
  .comps-label {
    font-size: 0.78rem;
    color: var(--muted);
    margin: 0 22px 8px;
  }
  .comp-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 22px;
  }
  .chip {
    border: 1px solid var(--line);
    background: transparent;
    color: inherit;
    border-radius: 999px;
    padding: 8px 12px;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    min-height: 36px;
  }
  .chip.on {
    border-color: var(--ink);
    background: color-mix(in oklab, var(--ink) 8%, transparent);
  }
  .chip:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .empty-panel {
    padding: 24px 18px;
  }
  .empty-title {
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-bottom: 6px;
  }
  .empty {
    margin: 0;
    padding: 16px 18px;
    color: var(--muted);
    font-size: 0.92rem;
    line-height: 1.45;
  }
  .empty-panel .empty {
    padding: 0;
  }

  .remix-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .remix-hint {
    margin: 0;
    padding: 0 22px 8px;
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .mobile-toolbar {
    display: none;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    padding: 12px 22px 22px;
  }
  .card {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
    background: var(--paper);
    min-width: 0;
  }
  .card.picked {
    border-color: color-mix(in oklab, var(--ink) 45%, var(--line));
    background: color-mix(in oklab, var(--ink) 2.5%, var(--paper));
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    font-size: 0.82rem;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    user-select: none;
    min-height: 44px;
  }
  .pick input {
    width: 18px;
    height: 18px;
    accent-color: var(--ink);
  }
  .card-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .thumb {
    position: relative;
    aspect-ratio: 4 / 5;
    background: color-mix(in oklab, var(--ink) 6%, transparent);
    overflow: hidden;
    display: block;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb-fallback {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px 14px;
    flex: 1;
    min-width: 0;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .page {
    font-weight: 650;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .plats {
    font-size: 0.72rem;
    color: var(--muted);
    text-transform: capitalize;
  }
  .title {
    margin: 0;
    font-size: 0.86rem;
    font-weight: 600;
  }
  .copy {
    margin: 0;
    font-size: 0.84rem;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: color-mix(in oklab, var(--ink) 88%, transparent);
    line-height: 1.4;
  }
  .cta {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .cta span {
    font-weight: 600;
    color: inherit;
  }
  .foot {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 0.72rem;
    color: var(--muted);
    padding-top: 4px;
  }
  .since {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .open {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: inherit;
    text-decoration: none;
    flex-shrink: 0;
  }
  button.open {
    appearance: none;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  .badge {
    font-size: 0.68rem;
    font-weight: 650;
    border-radius: 999px;
    padding: 2px 7px;
    border: 1px solid var(--line);
  }
  .badge.ok {
    border-color: color-mix(in oklab, #1a7f4b 40%, var(--line));
    color: #1a7f4b;
  }
  .badge.muted {
    color: var(--muted);
  }
  .badge.media {
    position: absolute;
    left: 8px;
    bottom: 8px;
    background: color-mix(in oklab, var(--paper) 88%, transparent);
  }

  .banner.err,
  .banner.ok {
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .banner.err {
    border: 1px solid color-mix(in oklab, #b42318 35%, var(--line));
    background: color-mix(in oklab, #b42318 8%, var(--paper));
    color: #b42318;
  }
  .banner.ok {
    border: 1px solid color-mix(in oklab, #1a7f4b 35%, var(--line));
    background: color-mix(in oklab, #1a7f4b 8%, var(--paper));
    color: #1a7f4b;
  }

  .brief-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 22px 22px;
  }
  .brief {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .brief header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .rank {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    flex-shrink: 0;
  }
  .brief-titles {
    flex: 1;
    min-width: 0;
  }
  .hook {
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .headline {
    font-size: 0.9rem;
    color: color-mix(in oklab, var(--ink) 85%, transparent);
    overflow-wrap: anywhere;
  }
  .src {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--muted);
    text-decoration: none;
    white-space: nowrap;
    flex-shrink: 0;
    min-height: 32px;
  }
  .strategy,
  .brief-body {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .keep-change {
    display: grid;
    gap: 6px;
    font-size: 0.82rem;
    color: color-mix(in oklab, var(--ink) 88%, transparent);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .produce-form {
    display: contents;
  }
  .produce {
    border: 1px solid var(--line);
    background: var(--paper-2);
    color: inherit;
    border-radius: 999px;
    padding: 0.25rem 0.7rem;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .produce:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .produce-note {
    font-size: 0.72rem;
    opacity: 0.6;
  }
  .pill.done {
    opacity: 0.7;
  }
  .brief footer {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pill {
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.72rem;
  }
  .source-note {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    padding: 0 4px;
    line-height: 1.4;
  }

  .sticky-remix {
    display: none;
  }
  .desktop-only {
    display: flex;
  }

  @media (max-width: 720px) {
    .content {
      gap: 12px;
      padding-bottom: 20px;
    }
    .content.has-sticky {
      padding-bottom: 108px;
    }

    .sub-desktop {
      display: none !important;
    }
    .sub-mobile {
      display: block;
    }

    .search,
    .empty,
    .remix-hint,
    .brief-list,
    .grid {
      padding-left: 14px;
      padding-right: 14px;
    }
    .search {
      padding-top: 12px;
    }
    .comps-label,
    .comp-chips {
      padding-left: 14px;
      padding-right: 14px;
    }
    .comps-label {
      margin-left: 0;
      margin-right: 0;
    }

    .comp-chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding-bottom: 2px;
      mask-image: linear-gradient(to right, #000 85%, transparent);
    }
    .comp-chips::-webkit-scrollbar {
      display: none;
    }
    .comp-chips .chip {
      flex: 0 0 auto;
    }

    .row {
      flex-direction: column;
    }
    .search-btn {
      width: 100%;
    }

    .results-head {
      flex-direction: column;
      align-items: flex-start !important;
      gap: 8px;
    }
    .desktop-only {
      display: none !important;
    }
    .mobile-toolbar {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 0 14px 8px;
    }
    .mobile-toolbar .remix-hint {
      padding: 0;
    }

    .grid {
      grid-template-columns: 1fr;
      gap: 10px;
      padding-top: 8px;
      padding-bottom: 16px;
    }
    .card-main {
      flex-direction: row;
      align-items: stretch;
    }
    .thumb {
      width: 108px;
      flex-shrink: 0;
      aspect-ratio: 3 / 4;
      align-self: stretch;
    }
    .body {
      padding: 10px 12px 12px;
    }
    .copy {
      -webkit-line-clamp: 3;
    }
    .pick {
      padding: 10px 12px;
    }

    .brief {
      padding: 12px 14px;
    }
    .brief header {
      flex-wrap: wrap;
    }
    .src {
      margin-left: auto;
    }

    .sticky-remix {
      display: block;
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 40;
      padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
      background: color-mix(in oklab, var(--paper) 92%, transparent);
      border-top: 1px solid var(--line);
      backdrop-filter: blur(10px);
    }
    .sticky-inner {
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 720px;
      margin: 0 auto;
    }
    .sticky-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      min-width: 0;
      font-size: 0.85rem;
      color: var(--muted);
    }
    .sticky-meta strong {
      color: var(--ink);
      font-variant-numeric: tabular-nums;
    }
    .linkish {
      border: none;
      background: none;
      color: var(--ink);
      font: inherit;
      font-size: 0.8rem;
      text-decoration: underline;
      cursor: pointer;
      padding: 0;
      margin-left: 4px;
    }
    .sticky-btn {
      flex-shrink: 0;
      padding: 0 14px;
    }
  }

  @media (max-width: 380px) {
    .thumb {
      width: 92px;
    }
    .btn-label {
      font-size: 0.9rem;
    }
    .sticky-meta span:nth-child(2) {
      display: none;
    }
  }

  .vr-modal {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.55);
  }
  .vr-sheet {
    width: min(520px, 100%);
    max-height: min(92dvh, 900px);
    overflow: auto;
    background: var(--paper);
    color: var(--ink);
    border-radius: 16px;
    padding: 16px;
    display: grid;
    gap: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
  }
  .vr-sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .vr-close {
    appearance: none;
    border: 1px solid var(--line);
    background: transparent;
    border-radius: 8px;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: inherit;
  }
  .vr-player {
    width: 100%;
    max-height: 280px;
    border-radius: 12px;
    background: #111;
  }
</style>
