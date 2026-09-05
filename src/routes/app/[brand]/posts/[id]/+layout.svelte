<script lang="ts">
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';

  let { data, children } = $props();

  const brand = $derived(data.brand);
  const post = $derived(data.post);
  const base = $derived(`/app/${brand.slug}/posts/${post.id}`);
  const path = $derived($page.url.pathname.replace(/\/$/, ''));
  const returnHref = $derived(`/app/${brand.slug}/calendar`);

  const nav = $derived([
    { href: `${base}/preview`, key: 'preview', label: $_('app.post.nav.preview') },
    { href: `${base}/edit`, key: 'edit', label: $_('app.post.nav.edit') },
    { href: `${base}/details`, key: 'details', label: $_('app.post.nav.details') },
    { href: `${base}/analytics`, key: 'analytics', label: $_('app.post.nav.analytics') },
    { href: `${base}/campaign`, key: 'campaign', label: $_('app.post.nav.campaign') },
    // FEATURE_ADS off → no Boost tab (the route 404s too).
    ...(data.flags?.ads
      ? [{ href: `${base}/boost`, key: 'boost', label: $_('app.post.nav.boost') }]
      : [])
  ]);

  const activeKey = $derived(
    nav.find((n) => path === n.href || path.startsWith(n.href + '/'))?.key ?? 'preview'
  );

  const captionPreview = $derived((post.caption ?? '').trim().slice(0, 72));
  const statusLabel = $derived($_('app.calendar.status.' + ({
    scheduled: 'scheduled',
    approved: 'approved',
    pending_user: 'pendingApproval',
    published: 'published',
    failed: 'failed'
  }[post.status as string] ?? 'scheduled')));

  const hasMedia = $derived(
    !!post.media_url || (Array.isArray(post.media_urls) && post.media_urls.length > 0)
  );
  let downloading = $state(false);
  let downloadError = $state('');

  async function downloadMedia() {
    if (!hasMedia || downloading) return;
    downloading = true;
    downloadError = '';
    try {
      const res = await fetch(`/app/${brand.slug}/posts/download-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id })
      });
      if (!res.ok) {
        downloadError = (await res.text()) || $_('app.post.downloadFailed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `anomalia-media-${post.id.slice(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      downloadError = $_('app.post.downloadFailed');
    } finally {
      downloading = false;
    }
  }
</script>

<div class="post-page">
  <header class="chrome">
    <div class="topbar">
      <a class="back" href={returnHref} aria-label={$_('app.post.backCalendar')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span class="back-lbl">{$_('app.post.backShort')}</span>
      </a>

      <div class="titles">
        <div class="title-row">
          <h1 class="title">{$_('app.post.title')}</h1>
          <span class="st">{statusLabel}</span>
          <span class="plat">{(post.platform ?? 'post').toString()}</span>
        </div>
        <p class="sub">
          {captionPreview
            ? `${captionPreview}${(post.caption ?? '').length > 72 ? '…' : ''}`
            : $_('app.post.untitled')}
        </p>
      </div>

      <div class="actions">
        {#if hasMedia}
          <button
            type="button"
            class="dl"
            disabled={downloading}
            aria-busy={downloading}
            onclick={downloadMedia}
          >
            {#if downloading}… {:else}⬇︎{/if}
            <span class="dl-lbl">{$_('app.post.downloadMedia')}</span>
          </button>
        {/if}
      </div>
    </div>

    <nav class="tabs" aria-label={$_('app.post.navLabel')}>
      {#each nav as item (item.key)}
        <a class="tab" class:on={activeKey === item.key} href={item.href}>{item.label}</a>
      {/each}
    </nav>
  </header>

  {#if downloadError}
    <div class="dl-err" role="alert">{downloadError}</div>
  {/if}

  <main class="body">
    {@render children()}
  </main>
</div>

<style>
  .post-page {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--paper-2, #f5f5f7);
    color: var(--ink, #1d1d1f);
  }

  .chrome {
    position: sticky;
    top: 0;
    z-index: 30;
    flex: 0 0 auto;
    background: var(--paper, #fff);
    border-bottom: 1px solid var(--line, #e3e3e6);
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    min-height: 56px;
  }

  .back {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 36px;
    padding: 0 10px 0 6px;
    border-radius: 10px;
    border: 1px solid var(--line, #e3e3e6);
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
    text-decoration: none;
    font-size: 13px;
    font-weight: 650;
  }
  .back svg { width: 18px; height: 18px; }
  .back:hover { border-color: var(--line-2, #d2d2d7); background: var(--paper-2, #f5f5f7); }

  .titles { flex: 1 1 auto; min-width: 0; }
  .title-row {
    display: flex; align-items: center; gap: 8px; min-width: 0;
  }
  .title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
  }
  .sub {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: var(--ink-soft, #6e6e73);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .st, .plat {
    display: inline-flex;
    align-items: center;
    font-size: 10.5px;
    font-weight: 650;
    padding: 2px 7px;
    border-radius: 999px;
    border: 1px solid var(--line, #e3e3e6);
    background: var(--paper-2, #f5f5f7);
    color: var(--ink-soft, #6e6e73);
    white-space: nowrap;
  }
  .plat {
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
  .dl {
    display: inline-flex; align-items: center; gap: 6px;
    height: 36px; padding: 0 12px; cursor: pointer;
    font: inherit; font-size: 13px; font-weight: 600;
    color: var(--ink); border-radius: 10px;
    border: 1px solid var(--line, #e3e3e6); background: var(--paper, #fff);
  }
  .dl:hover:not(:disabled) { border-color: var(--line-2, #d2d2d7); }
  .dl:disabled { opacity: 0.6; cursor: default; }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 10px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    border-top: 1px solid var(--line, #e3e3e6);
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    height: 40px;
    padding: 0 12px;
    font-size: 13px;
    font-weight: 650;
    color: var(--ink-soft, #6e6e73);
    text-decoration: none;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  .tab:hover { color: var(--ink); }
  .tab.on {
    color: var(--ink);
    border-bottom-color: var(--ink);
  }

  .dl-err {
    margin: 10px 14px 0; padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 600;
    color: #c0392b; background: color-mix(in srgb, #c0392b 8%, var(--paper));
    border: 1px solid color-mix(in srgb, #c0392b 35%, var(--line));
  }

  .body {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    max-width: 1400px;
    margin-inline: auto;
    padding: 16px 14px 28px;
    box-sizing: border-box;
  }

  @media (max-width: 720px) {
    .topbar { padding: 8px 10px; gap: 8px; }
    .back-lbl { display: none; }
    .back { padding: 0; width: 36px; justify-content: center; }
    .dl-lbl { display: none; }
    .dl { width: 36px; padding: 0; justify-content: center; }
    .st, .plat { display: none; }
    .title { font-size: 14px; }
    .body { padding: 12px 10px 24px; }
  }
</style>
