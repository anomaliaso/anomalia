<script lang="ts">
  import { siInstagram, siTiktok, siFacebook, siX, siThreads, siYoutube } from 'simple-icons';
  import {
    Heart,
    MessageCircle,
    Send,
    Bookmark,
    ThumbsUp,
    Share2,
    Repeat2,
    BarChart3,
    Globe,
    MoreHorizontal
  } from '@lucide/svelte';
  import { _ } from 'svelte-i18n';

  type PostLike = {
    platform: string | null;
    platforms?: string[] | null;
    caption: string | null;
    media_url: string | null;
    media_urls?: string[] | null;
    content_type?: string | null;
    title?: string | null;
  };

  let {
    post,
    brandName,
    brandAvatar = null as string | null
  }: {
    post: PostLike;
    brandName: string;
    brandAvatar?: string | null;
  } = $props();

  // LinkedIn is absent from simple-icons (trademark) — keep a local path matching the official mark.
  const LINKEDIN_ICON = { path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z', hex: '0A66C2' };

  const MOCK_PLATFORMS = [
    { id: 'instagram', label: 'Instagram', icon: siInstagram },
    { id: 'facebook', label: 'Facebook', icon: siFacebook },
    { id: 'linkedin', label: 'LinkedIn', icon: LINKEDIN_ICON },
    { id: 'x', label: 'X', icon: siX },
    { id: 'tiktok', label: 'TikTok', icon: siTiktok },
    { id: 'youtube', label: 'YouTube', icon: siYoutube },
    { id: 'threads', label: 'Threads', icon: siThreads }
  ] as const;

  const targets = $derived(
    Array.from(
      new Set(
        (post.platforms?.length ? post.platforms : post.platform ? [post.platform] : ['instagram']).map(
          (p) => p.toLowerCase()
        )
      )
    )
  );

  const available = $derived(
    MOCK_PLATFORMS.filter((p) => targets.includes(p.id)).length
      ? MOCK_PLATFORMS.filter((p) => targets.includes(p.id))
      : MOCK_PLATFORMS.filter((p) => p.id === 'instagram')
  );

  let active = $state('');
  $effect(() => {
    if (!active || !available.some((p) => p.id === active)) {
      active = available[0]?.id ?? 'instagram';
    }
  });

  const slides = $derived(
    Array.isArray(post.media_urls) && post.media_urls.length > 1
      ? post.media_urls
      : post.media_url
        ? [post.media_url]
        : []
  );
  let slide = $state(0);
  $effect(() => {
    void slides;
    slide = 0;
  });

  const media = $derived(slides[slide] ?? null);
  const isVideo = $derived(
    !!media && (post.content_type?.includes('video') || /\.(mp4|webm|mov)(\?|$)/i.test(media))
  );
  const caption = $derived(post.caption?.trim() || '');
  const initials = $derived(
    brandName
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
</script>

<div class="mock">
  <div class="tabs" role="tablist" aria-label={$_('app.post.preview.platforms')}>
    {#each available as p (p.id)}
      <button
        type="button"
        role="tab"
        class="tab"
        class:on={active === p.id}
        aria-selected={active === p.id}
        onclick={() => (active = p.id)}
      >
        <svg viewBox="0 0 24 24" fill={`#${p.icon.hex}`} aria-hidden="true"><path d={p.icon.path} /></svg>
        {p.label}
      </button>
    {/each}
  </div>

  <div class="stage">
    {#if active === 'instagram'}
      <div class="phone ig">
        <div class="ig-top">
          <div class="ig-user">
            {#if brandAvatar}
              <img class="av" src={brandAvatar} alt="" />
            {:else}
              <span class="av ph">{initials}</span>
            {/if}
            <div>
              <div class="name">{brandName}</div>
              <div class="sub">{$_('app.post.preview.sponsored')}</div>
            </div>
          </div>
          <MoreHorizontal class="ig-more" size={20} strokeWidth={2} aria-hidden="true" />
        </div>
        <div class="media">
          {#if isVideo && media}
            <video src={media} controls playsinline preload="metadata"></video>
          {:else if media}
            <img src={media} alt="" />
          {:else}
            <div class="empty">{$_('app.post.preview.noMedia')}</div>
          {/if}
          {#if slides.length > 1}
            <div class="dots-row">
              {#each slides as _, i (i)}
                <button type="button" class="dot" class:on={i === slide} onclick={() => (slide = i)} aria-label={`Slide ${i + 1}`}></button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="ig-actions">
          <Heart size={24} strokeWidth={1.75} aria-hidden="true" />
          <MessageCircle size={24} strokeWidth={1.75} aria-hidden="true" />
          <Send size={22} strokeWidth={1.75} aria-hidden="true" />
          <span class="sp"></span>
          <Bookmark size={24} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div class="ig-cap">
          <strong>{brandName}</strong>
          {caption || $_('app.post.preview.noCaption')}
        </div>
      </div>
    {:else if active === 'facebook'}
      <div class="feed fb">
        <div class="fb-head">
          {#if brandAvatar}<img class="av" src={brandAvatar} alt="" />{:else}<span class="av ph">{initials}</span>{/if}
          <div>
            <div class="name">{brandName}</div>
            <div class="sub fb-meta">{$_('app.post.preview.justNow')} · <Globe size={11} strokeWidth={2} aria-hidden="true" /></div>
          </div>
        </div>
        {#if caption}<p class="fb-text">{caption}</p>{/if}
        <div class="media wide">
          {#if isVideo && media}
            <video src={media} controls playsinline preload="metadata"></video>
          {:else if media}
            <img src={media} alt="" />
          {:else}
            <div class="empty">{$_('app.post.preview.noMedia')}</div>
          {/if}
        </div>
        <div class="fb-bar">
          <span class="fb-act"><ThumbsUp size={16} strokeWidth={2} aria-hidden="true" /> Like</span>
          <span class="fb-act"><MessageCircle size={16} strokeWidth={2} aria-hidden="true" /> Comment</span>
          <span class="fb-act"><Share2 size={16} strokeWidth={2} aria-hidden="true" /> Share</span>
        </div>
      </div>
    {:else if active === 'linkedin'}
      <div class="feed li">
        <div class="fb-head">
          {#if brandAvatar}<img class="av" src={brandAvatar} alt="" />{:else}<span class="av ph">{initials}</span>{/if}
          <div>
            <div class="name">{brandName}</div>
            <div class="sub">{$_('app.post.preview.followers')}</div>
          </div>
        </div>
        {#if caption}<p class="fb-text">{caption}</p>{/if}
        <div class="media wide">
          {#if isVideo && media}
            <video src={media} controls playsinline preload="metadata"></video>
          {:else if media}
            <img src={media} alt="" />
          {:else}
            <div class="empty">{$_('app.post.preview.noMedia')}</div>
          {/if}
        </div>
        <div class="fb-bar muted">
          <span class="fb-act"><ThumbsUp size={15} strokeWidth={2} aria-hidden="true" /> Like</span>
          <span class="fb-act"><MessageCircle size={15} strokeWidth={2} aria-hidden="true" /> Comment</span>
          <span class="fb-act"><Repeat2 size={15} strokeWidth={2} aria-hidden="true" /> Repost</span>
          <span class="fb-act"><Send size={15} strokeWidth={2} aria-hidden="true" /> Send</span>
        </div>
      </div>
    {:else if active === 'x'}
      <div class="feed x">
        <div class="x-row">
          {#if brandAvatar}<img class="av sm" src={brandAvatar} alt="" />{:else}<span class="av sm ph">{initials}</span>{/if}
          <div class="x-body">
            <div class="x-meta"><strong>{brandName}</strong> <span class="handle">@{brandName.replace(/\s+/g, '').toLowerCase().slice(0, 14)}</span> · 2h</div>
            {#if caption}<p class="x-text">{caption}</p>{/if}
            {#if media}
              <div class="media x-media">
                {#if isVideo}
                  <video src={media} controls playsinline preload="metadata"></video>
                {:else}
                  <img src={media} alt="" />
                {/if}
              </div>
            {/if}
            <div class="x-bar">
              <MessageCircle size={16} strokeWidth={1.75} aria-hidden="true" />
              <Repeat2 size={16} strokeWidth={1.75} aria-hidden="true" />
              <Heart size={16} strokeWidth={1.75} aria-hidden="true" />
              <BarChart3 size={16} strokeWidth={1.75} aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
    {:else if active === 'tiktok' || active === 'youtube'}
      <div class="phone tt">
        <div class="media fill">
          {#if isVideo && media}
            <video src={media} controls playsinline preload="metadata"></video>
          {:else if media}
            <img src={media} alt="" />
          {:else}
            <div class="empty dark">{$_('app.post.preview.noMedia')}</div>
          {/if}
        </div>
        <div class="tt-side">
          <span class="tt-av">{#if brandAvatar}<img src={brandAvatar} alt="" />{:else}{initials}{/if}</span>
          <Heart size={28} strokeWidth={2} aria-hidden="true" />
          <MessageCircle size={28} strokeWidth={2} aria-hidden="true" />
          <Bookmark size={26} strokeWidth={2} aria-hidden="true" />
          <Share2 size={26} strokeWidth={2} aria-hidden="true" />
        </div>
        <div class="tt-cap">
          <strong>@{brandName.replace(/\s+/g, '').toLowerCase().slice(0, 16)}</strong>
          <p>{caption || $_('app.post.preview.noCaption')}</p>
        </div>
      </div>
    {:else}
      <!-- threads fallback -->
      <div class="feed x">
        <div class="x-row">
          {#if brandAvatar}<img class="av sm" src={brandAvatar} alt="" />{:else}<span class="av sm ph">{initials}</span>{/if}
          <div class="x-body">
            <div class="x-meta"><strong>{brandName}</strong></div>
            {#if caption}<p class="x-text">{caption}</p>{/if}
            {#if media}
              <div class="media x-media">
                {#if isVideo}
                  <video src={media} controls playsinline preload="metadata"></video>
                {:else}
                  <img src={media} alt="" />
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .mock { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 480px; margin: 0 auto; }
  .tabs { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
  .tab {
    display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 12px; font-weight: 600;
    padding: 7px 11px; border-radius: 999px; border: 1px solid var(--line, #e3e3e6);
    background: var(--paper, #fff); color: var(--ink-soft, #6e6e73); cursor: pointer;
  }
  .tab svg { width: 14px; height: 14px; }
  .tab.on { color: var(--ink, #1d1d1f); border-color: var(--ink, #1d1d1f); background: var(--paper-2, #f5f5f7); }
  .stage { display: flex; justify-content: center; padding: 8px 0 24px; }

  .phone {
    width: min(340px, 100%); border-radius: 28px; overflow: hidden;
    border: 1px solid var(--line, #e3e3e6); background: #fff; box-shadow: 0 18px 50px -28px rgba(0,0,0,0.35);
  }
  .ig-top, .fb-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
  .ig-top { justify-content: space-between; }
  .ig-user { display: flex; align-items: center; gap: 10px; }
  .av {
    width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex: 0 0 auto;
    background: var(--paper-2, #f5f5f7);
  }
  .av.sm { width: 40px; height: 40px; }
  .av.ph {
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; color: var(--ink-soft);
  }
  .name { font-size: 13px; font-weight: 700; color: #111; }
  .sub { font-size: 11px; color: #8e8e8e; }
  .fb-meta { display: inline-flex; align-items: center; gap: 4px; }
  .fb-meta :global(svg) { flex: none; }
  :global(.ig-more) { color: #111; flex: none; }

  .media { position: relative; background: #f0f0f0; aspect-ratio: 4 / 5; }
  .media.wide { aspect-ratio: 16 / 10; }
  .media.fill { aspect-ratio: 9 / 16; background: #111; }
  .media img, .media video { width: 100%; height: 100%; object-fit: cover; display: block; background: #111; }
  .empty {
    height: 100%; display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 600; color: var(--ink-faint, #86868b);
  }
  .empty.dark { color: rgba(255,255,255,0.55); }
  .dots-row {
    position: absolute; left: 0; right: 0; bottom: 10px;
    display: flex; justify-content: center; gap: 5px;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; border: none; padding: 0; background: rgba(255,255,255,0.45); cursor: pointer; }
  .dot.on { background: #fff; }

  .ig-actions {
    display: flex; align-items: center; gap: 14px; padding: 10px 14px 4px; color: #111;
  }
  .ig-actions :global(svg) { flex: none; display: block; }
  .ig-actions .sp { flex: 1; }
  .ig-cap { padding: 4px 14px 16px; font-size: 13px; line-height: 1.45; color: #111; white-space: pre-wrap; word-break: break-word; }
  .ig-cap strong { margin-right: 6px; }

  .feed {
    width: min(420px, 100%); border-radius: 14px; overflow: hidden;
    border: 1px solid var(--line, #e3e3e6); background: #fff;
    box-shadow: 0 18px 50px -28px rgba(0,0,0,0.3);
  }
  .fb-text, .x-text { margin: 0; padding: 0 14px 12px; font-size: 14px; line-height: 1.45; color: #111; white-space: pre-wrap; word-break: break-word; }
  .fb-bar {
    display: flex; justify-content: space-around; padding: 10px 8px;
    border-top: 1px solid #eee; font-size: 12px; font-weight: 600; color: #65676b;
  }
  .fb-act { display: inline-flex; align-items: center; gap: 6px; }
  .fb-act :global(svg) { flex: none; }
  .fb-bar.muted { color: #666; }
  .li .name { font-size: 14px; }

  .x-row { display: flex; gap: 12px; padding: 14px; }
  .x-body { flex: 1; min-width: 0; }
  .x-meta { font-size: 13px; margin-bottom: 4px; }
  .handle { color: #71767b; font-weight: 400; }
  .x-text { padding: 0 0 10px; }
  .x-media { border-radius: 16px; overflow: hidden; margin-bottom: 8px; aspect-ratio: 16 / 10; }
  .x-bar {
    display: flex; align-items: center; gap: 28px; color: #536471; padding-top: 4px;
  }
  .x-bar :global(svg) { flex: none; display: block; }

  .tt { position: relative; background: #000; color: #fff; }
  .tt-side {
    position: absolute; right: 10px; bottom: 90px; display: flex; flex-direction: column;
    align-items: center; gap: 16px; z-index: 2; color: #fff;
  }
  .tt-side :global(svg) { flex: none; display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45)); }
  .tt-av {
    width: 42px; height: 42px; border-radius: 50%; border: 2px solid #fff; overflow: hidden;
    display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700;
    background: #333;
  }
  .tt-av img { width: 100%; height: 100%; object-fit: cover; }
  .tt-cap {
    position: absolute; left: 12px; right: 56px; bottom: 16px; z-index: 2;
    font-size: 13px; line-height: 1.4; text-shadow: 0 1px 3px rgba(0,0,0,0.6);
  }
  .tt-cap p { margin: 6px 0 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

  :root[data-theme='dark'] .phone,
  :root[data-theme='dark'] .feed { background: #1a1a1c; border-color: rgba(255,255,255,0.08); }
  :root[data-theme='dark'] .name,
  :root[data-theme='dark'] .ig-cap,
  :root[data-theme='dark'] .fb-text,
  :root[data-theme='dark'] .x-text { color: #f5f5f7; }
  :root[data-theme='dark'] .ig-actions,
  :root[data-theme='dark'] :global(.ig-more) { color: #f5f5f7; }
  :root[data-theme='dark'] .fb-bar { border-top-color: rgba(255,255,255,0.08); color: #a1a1a6; }
  :root[data-theme='dark'] .x-bar { color: #8b98a5; }
</style>
