<script lang="ts">
  import PlatformGlyph from './PlatformGlyph.svelte';
  import { getPlatform } from './platform-meta';
  import { isVideoUrl } from '$lib/content-formats';
  import VideoScoreRing from './VideoScoreRing.svelte';
  import type { VideoScoreBadge } from '$lib/video-score';

  let { post, compact = false }: {
    post: {
      platform: string;
      caption: string;
      status: string;
      thumbnail?: string;
      pillar?: string;
      angle?: string;
      videoScore?: VideoScoreBadge | null;
      /**
       * 'rendering' while a clip is being produced out-of-band. The thumbnail is the cover
       * standing in for it, so without this the card looks like a finished photo post and the
       * user has no way to know a video is on its way.
       */
      videoRenderStatus?: string | null;
    };
    compact?: boolean;
  } = $props();

  const STATUS_MAP: Record<string, { cls: string; label: string }> = {
    pending_user: { cls: 'warn', label: 'Pending' },
    approved: { cls: 'ok', label: 'Approved' },
    scheduled: { cls: 'ok', label: 'Scheduled' },
    published: { cls: 'ok', label: 'Published' },
    failed: { cls: 'bad', label: 'Failed' },
    draft: { cls: 'muted', label: 'Draft' },
    pending: { cls: 'warn', label: 'Pending' },
  };
  const st = $derived(STATUS_MAP[post.status] ?? { cls: 'muted', label: post.status });

  // A clip's media_url is an mp4 riding the same `thumbnail` prop as an image — and a video URL
  // in `background-image` renders NOTHING, a blank card. Same detection the publisher uses.
  const isVideo = $derived(isVideoUrl(post.thumbnail));
  const isRendering = $derived(post.videoRenderStatus === 'rendering');
  const renderFailed = $derived(post.videoRenderStatus === 'failed');

  const PILLAR_COLORS = ['#7c5cff', '#1f8a4c', '#c2410c', '#0a66c2', '#b91c1c', '#0f766e', '#a16207'];
  function pillarColor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    return PILLAR_COLORS[Math.abs(h) % PILLAR_COLORS.length];
  }
</script>

<div class="post-card" class:compact>
  <div
    class="post-media"
    class:placeholder={!post.thumbnail}
    style={post.thumbnail && !isVideo ? `background-image:url(${post.thumbnail})` : ''}
  >
    {#if isVideo}
      <!-- Deliberately NO controls and NO autoplay: this card is often wrapped in an <a> (chat
           previews, calendar), where control clicks would fire the link instead — and a grid of
           autoplaying clips janks the page. preload=metadata paints the first frame, the badge
           says "video", and playback happens in PostEditor where the post is actually reviewed. -->
      <video class="post-video" src={post.thumbnail} muted playsinline preload="metadata"></video>
      <span class="video-badge" aria-label="Video">▶</span>
      <VideoScoreRing url={post.thumbnail} badge={post.videoScore} size={compact ? 24 : 28} />
    {:else if post.thumbnail && post.videoScore}
      <VideoScoreRing url={post.thumbnail} badge={post.videoScore} size={compact ? 24 : 28} />
    {:else if !post.thumbnail}
      <span class="ph-icon">{getPlatform(post.platform).short[0]}</span>
    {/if}
    {#if isRendering}
      <!-- Sits over the cover rather than replacing it: the frame IS the post's media right now,
           and hiding it would make a working card look broken. -->
      <span class="render-chip" aria-live="polite">
        <span class="spin"></span>Video in arrivo
      </span>
    {:else if renderFailed}
      <span class="render-chip failed">Video non riuscito</span>
    {/if}
  </div>
  <div class="post-info">
    <div class="post-plat">
      <PlatformGlyph platform={post.platform} />
      <span class="plat-name">{getPlatform(post.platform).label}</span>
    </div>
    {#if post.pillar || post.angle}
      <div class="post-badges">
        {#if post.pillar}
          <span class="cbadge"><span class="dot" style={`background:${pillarColor(post.pillar)}`}></span>{post.pillar}</span>
        {/if}
        {#if post.angle}
          <span class="cbadge angle">{post.angle}</span>
        {/if}
      </div>
    {/if}
    <div class="post-cap">{post.caption}</div>
    <div class="post-footer">
      <span class="state" class:ok={st.cls === 'ok'} class:warn={st.cls === 'warn'} class:bad={st.cls === 'bad'} class:muted={st.cls === 'muted'}>
        <span class="d"></span>{st.label}
      </span>
    </div>
  </div>
</div>

<style>
  .post-card { border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
    background: var(--paper); transition: box-shadow 0.15s, transform 0.15s; }
  .post-card:hover { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08); transform: translateY(-2px); }

  .post-media { width: 100%; aspect-ratio: 1; background-color: var(--paper-2);
    background-size: cover; background-position: center; position: relative; }
  .post-media.placeholder { display: flex; align-items: center; justify-content: center; }
  /* The card slot is square/16:10 but clips are 9:16 — cover-crop like the image path does,
     so a vertical video fills the tile instead of letterboxing it. */
  .post-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
    background: var(--paper-2); display: block; }
  .video-badge { position: absolute; right: 8px; bottom: 8px; display: flex; align-items: center;
    justify-content: center; width: 26px; height: 26px; border-radius: 50%; font-size: 11px;
    background: rgba(0,0,0,.62); color: #fff; padding-left: 2px; }
  .ph-icon { font-size: 32px; font-weight: 700; color: var(--ink-faint); }

  .render-chip { position: absolute; left: 8px; bottom: 8px; display: inline-flex; align-items: center;
    gap: 6px; padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 600;
    background: rgba(0,0,0,.66); color: #fff; backdrop-filter: blur(4px); }
  .render-chip.failed { background: rgba(192,57,43,.85); }
  .spin { width: 9px; height: 9px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35);
    border-top-color: #fff; animation: chip-spin .7s linear infinite; }
  @keyframes chip-spin { to { transform: rotate(360deg); } }
  /* Respect a user who asked the OS for less motion — the chip still reads without spinning. */
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }

  .post-info { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
  .post-plat { display: flex; align-items: center; gap: 6px; }
  .plat-name { font-size: 11px; font-weight: 700; color: var(--ink-faint); letter-spacing: .03em; }

  .post-badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .cbadge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600;
    padding: 2px 9px; border-radius: 999px; background: var(--paper-2); color: var(--ink-soft);
    max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.6; }
  .cbadge .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
  .cbadge.angle { border: 1px solid var(--line); }

  .post-cap { font-size: 13px; line-height: 1.5; color: var(--ink-soft);
    display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3;
    -webkit-box-orient: vertical; overflow: hidden; }

  .post-footer { display: flex; align-items: center; gap: 8px; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--line); }
  .state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; }
  .state .d { width: 7px; height: 7px; border-radius: 50%; }
  .state.ok { color: var(--accent); } .state.ok .d { background: var(--accent); }
  .state.warn { color: #a3700a; } .state.warn .d { background: #c98a16; }
  .state.bad { color: #c0392b; } .state.bad .d { background: #c0392b; }
  .state.muted { color: var(--ink-faint, #86868b); } .state.muted .d { background: var(--ink-faint, #86868b); }

  .compact .post-media { aspect-ratio: 16 / 10; }
  .compact .post-info { padding: 10px 12px; gap: 6px; }
</style>
