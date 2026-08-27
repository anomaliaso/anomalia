<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from 'svelte-i18n';
  import { BOOKING_URL } from '$lib/links';

  // Floating bottom-right "talk to Marco" widget: a circular, looping clip of Marco with a
  // label pill that slides out on hover/focus. Tapping it books a call via Marco's Calendly
  // page. href is overridable, but defaults to that booking link.
  let { href = BOOKING_URL }: { href?: string } = $props();

  // External links open in a new tab so we don't drop the user out of the app/landing flow.
  const external = $derived(/^https?:\/\//.test(href));

  let vid = $state<HTMLVideoElement>();
  onMount(() => {
    // Autoplay only works muted, and the `muted` attribute isn't reliably reflected to the
    // property — set it explicitly, then kick off playback (ignored if the browser blocks it).
    // Playback (and thus the video download — preload="none") starts only after the window
    // `load` event so the clip never competes with LCP-critical resources; the poster shows
    // until then.
    const start = () => {
      if (vid) {
        vid.muted = true;
        vid.play().catch(() => {});
      }
    };
    if (document.readyState === 'complete') {
      start();
      return;
    }
    window.addEventListener('load', start, { once: true });
    return () => window.removeEventListener('load', start);
  });
</script>

<a
  class="marco"
  {href}
  target={external ? '_blank' : undefined}
  rel={external ? 'noopener noreferrer' : undefined}
  aria-label={$_('marco.cta')}
>
  <span class="marco-label">{$_('marco.cta')}</span>
  <span class="marco-circle">
    <span class="marco-ring" aria-hidden="true"></span>
    <span class="marco-clip">
      <video
        bind:this={vid}
        src="/marco.mp4"
        poster="/marco-poster.webp"
        muted
        loop
        playsinline
        preload="none"
      ></video>
    </span>
  </span>
</a>

<style>
  .marco {
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
  }

  /* Label pill — collapsed by default, revealed on hover/keyboard focus of the link. */
  .marco-label {
    background: var(--ink, #1d1d1f);
    color: #fff;
    font-family: var(--sans, system-ui, sans-serif);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    max-width: 0;
    padding: 10px 0;
    opacity: 0;
    transform: translateX(8px);
    overflow: hidden;
    pointer-events: none;
    transition:
      max-width 0.4s var(--ease, cubic-bezier(0.22, 1, 0.36, 1)),
      padding 0.4s var(--ease, cubic-bezier(0.22, 1, 0.36, 1)),
      opacity 0.3s ease,
      transform 0.4s var(--ease, cubic-bezier(0.22, 1, 0.36, 1));
  }
  .marco:hover .marco-label,
  .marco:focus-visible .marco-label {
    max-width: 280px;
    padding: 10px 16px;
    opacity: 1;
    transform: none;
  }

  /* The circle carries the drop-shadow + hover scale. The shadow lives HERE (not on the
     clipping box) so it survives — a clip would erase it. */
  .marco-circle {
    position: relative;
    width: 68px;
    height: 68px;
    flex: 0 0 auto;
    border-radius: 50%;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
    transition: transform 0.3s var(--ease, ease);
  }
  .marco:hover .marco-circle,
  .marco:focus-visible .marco-circle {
    transform: scale(1.06);
  }

  /* Circular video mask. WebKit/Safari won't clip a <video> with border-radius + overflow
     alone (it stays square) — forcing a compositing layer via translateZ(0) makes it clip
     crisply, which works in Chrome/Firefox too. */
  .marco-clip {
    position: absolute;
    z-index: 1;
    inset: 0;
    box-sizing: border-box;
    border-radius: 50%;
    overflow: hidden;
    border: 3px solid #fff;
    transform: translateZ(0);
    -webkit-transform: translateZ(0);
  }
  .marco-clip video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }

  /* Attention pulse expanding out from behind the circle. */
  .marco-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid var(--accent, #7c5cff);
    animation: marco-pulse 2.4s ease-out infinite;
    pointer-events: none;
  }
  @keyframes marco-pulse {
    0% { transform: scale(1); opacity: 0.65; }
    70% { transform: scale(1.4); opacity: 0; }
    100% { transform: scale(1.4); opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .marco-ring { animation: none; }
  }
  @media (max-width: 640px) {
    .marco { right: 16px; bottom: 16px; }
    .marco-circle { width: 58px; height: 58px; }
  }
</style>
