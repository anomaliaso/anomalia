<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';
  import {
    formatVideoScore,
    videoScoreTone,
    type VideoScoreBadge
  } from '$lib/video-score';

  let {
    badge,
    url = '',
    brandSlug = '',
    size = 28,
    corner = 'tr',
    onbadge
  }: {
    badge?: VideoScoreBadge | null;
    url?: string;
    brandSlug?: string;
    size?: number;
    corner?: 'tr' | 'tl' | 'br';
    onbadge?: (badge: VideoScoreBadge | null) => void;
  } = $props();

  const slug = $derived(brandSlug || $page.params.brand || '');
  let live = $state<VideoScoreBadge | null>(null);
  const shown = $derived(live ?? badge);
  const tone = $derived(videoScoreTone(shown));
  const r = 11.5;
  const circ = 2 * Math.PI * r;
  const pct = $derived(
    shown?.status === 'ready' && shown.overall != null ? Math.min(1, Math.max(0, shown.overall / 10)) : 0
  );
  const label = $derived(
    shown?.status === 'ready' && shown.overall != null
      ? formatVideoScore(size < 26 ? Math.round(shown.overall) : shown.overall)
      : ''
  );

  $effect(() => {
    const media = url.trim();
    const s = slug;
    if (!browser || !media || !s) return;
    // Parent already loaded badges and found none — don't poll 40× on every still.
    if (badge === null) return;
    live = badge ?? null;
    if (badge?.status === 'ready') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;

    const pull = async () => {
      if (stopped) return;
      try {
        const q = new URLSearchParams({ url: media });
        const res = await fetch(`/app/${s}/videos/scores?${q}`);
        const data = (await res.json().catch(() => ({}))) as { badge?: VideoScoreBadge | null };
        if (stopped) return;
        if (data.badge) live = data.badge;
        const st = data.badge?.status;
        if (st === 'pending' || st === 'running' || !data.badge) {
          if (tries++ < 40) timer = setTimeout(() => void pull(), 8000);
        }
      } catch {
        if (!stopped && tries++ < 8) timer = setTimeout(() => void pull(), 12000);
      }
    };
    void pull();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  });

  $effect(() => {
    onbadge?.(shown ?? null);
  });
</script>

{#if url.trim() && shown?.status !== 'failed' && (shown || badge !== null)}
  <span
    class="video-score-ring"
    class:tl={corner === 'tl'}
    class:tr={corner === 'tr'}
    class:br={corner === 'br'}
    data-tone={tone}
    style={`width:${size}px;height:${size}px`}
    title={shown?.status === 'ready' && shown.verdict
      ? `${formatVideoScore(shown.overall ?? 0)}/10 · ${$_(`app.videoReview.${shown.verdict}`)}${shown.judgment ? ` — ${shown.judgment}` : ''}`
      : $_('app.videoReview.scorePending')}
    aria-label={shown?.status === 'ready' && shown.verdict
      ? `${formatVideoScore(shown.overall ?? 0)}/10 ${$_(`app.videoReview.${shown.verdict}`)}`
      : $_('app.videoReview.scorePending')}
  >
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle class="track" cx="16" cy="16" r={r} />
      {#if pct > 0}
        <circle
          class="arc"
          cx="16"
          cy="16"
          r={r}
          stroke-dasharray={circ}
          stroke-dashoffset={circ * (1 - pct)}
          transform="rotate(-90 16 16)"
        />
      {/if}
    </svg>
    {#if label}
      <span class="n">{label}</span>
    {:else}
      <span class="n wait"></span>
    {/if}
  </span>
{/if}

<style>
  .video-score-ring {
    position: absolute;
    z-index: 3;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .video-score-ring.tr { top: 6px; right: 6px; }
  .video-score-ring.tl { top: 6px; left: 6px; }
  .video-score-ring.br { bottom: 6px; right: 6px; }
  .video-score-ring svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .track {
    fill: rgba(0, 0, 0, 0.62);
    stroke: rgba(255, 255, 255, 0.22);
    stroke-width: 2.4;
  }
  .arc {
    fill: none;
    stroke-width: 2.4;
    stroke-linecap: round;
  }
  .video-score-ring[data-tone='ship'] .arc { stroke: #3d9a5f; }
  .video-score-ring[data-tone='fix'] .arc { stroke: #d4a017; }
  .video-score-ring[data-tone='kill'] .arc { stroke: #e0564a; }
  .video-score-ring[data-tone='pending'] .arc { stroke: rgba(255, 255, 255, 0.35); }
  .n {
    position: relative;
    z-index: 1;
    font-size: 9px;
    font-weight: 800;
    color: #fff;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .n.wait {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.75);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
  }
</style>
