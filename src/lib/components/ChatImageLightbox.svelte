<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { X, ChevronLeft, ChevronRight } from '@lucide/svelte';
  import { isVideoUrl } from '$lib/content-formats';
  import { _ } from 'svelte-i18n';

  let {
    src,
    caption = '',
    calendarHref = '',
    extra,
    onclose
  }: {
    /** One media URL, or a carousel's slides. */
    src: string | string[];
    caption?: string;
    calendarHref?: string;
    extra?: Snippet;
    onclose: () => void;
  } = $props();

  const slides = $derived(Array.isArray(src) ? src.filter(Boolean) : [src]);
  let i = $state(0);
  const current = $derived(slides[Math.min(i, slides.length - 1)] ?? '');
  const isVideo = $derived(isVideoUrl(current));
  const hasSide = $derived(!!caption.trim() || !!calendarHref || !!extra);

  /** Mount on document.body so the dim fills the whole app (sidebar included). */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      }
    };
  }

  function step(d: number) {
    i = (i + d + slides.length) % slides.length;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    } else if (slides.length > 1 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    }
  }

  onMount(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  });
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="chat-lb"
  role="dialog"
  aria-modal="true"
  aria-label="Image preview"
  use:portal
  onclick={onclose}
>
  <div class="chat-lb-scrim" aria-hidden="true"></div>
  <button type="button" class="chat-lb-close" onclick={(e) => { e.stopPropagation(); onclose(); }} aria-label="Close">
    <X size={22} strokeWidth={2.25} />
  </button>

  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="chat-lb-stage" class:with-side={hasSide} onclick={(e) => e.stopPropagation()}>
    <div class="chat-lb-media">
      {#if isVideo}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="chat-lb-img" src={current} controls playsinline preload="metadata"></video>
      {:else}
        <img class="chat-lb-img" src={current} alt="" />
      {/if}

      {#if slides.length > 1}
        <button type="button" class="chat-lb-nav prev" onclick={() => step(-1)} aria-label="Previous slide">
          <ChevronLeft size={22} strokeWidth={2.25} />
        </button>
        <button type="button" class="chat-lb-nav next" onclick={() => step(1)} aria-label="Next slide">
          <ChevronRight size={22} strokeWidth={2.25} />
        </button>
        <span class="chat-lb-count">{i + 1}/{slides.length}</span>
      {/if}
    </div>

    {#if hasSide}
      <aside class="chat-lb-side">
        {#if caption.trim()}
          <p class="chat-lb-cap">{caption}</p>
        {/if}
        {#if calendarHref}
          <!-- Label already carries its own arrow ("← Calendario") — no icon. -->
          <a class="chat-lb-cta" href={calendarHref}>{$_('app.post.backCalendar')}</a>
        {/if}
        {#if extra}
          <div class="chat-lb-extra">
            {@render extra()}
          </div>
        {/if}
      </aside>
    {/if}
  </div>
</div>

<style>
  .chat-lb {
    position: fixed;
    inset: 0;
    z-index: 10050;
    display: flex;
    align-items: center;
    justify-content: center;
    padding:
      max(56px, calc(env(safe-area-inset-top, 0px) + 52px))
      max(16px, env(safe-area-inset-right, 0px))
      max(16px, env(safe-area-inset-bottom, 0px))
      max(16px, env(safe-area-inset-left, 0px));
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior: contain;
    touch-action: manipulation;
    cursor: zoom-out;
  }
  /* Full-viewport dim — separate layer so it always reads as an overlay. */
  .chat-lb-scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.82);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
  }
  /* Mobile: media on top, caption + actions underneath. */
  .chat-lb-stage {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: min(100%, 1100px);
    max-width: 100%;
    /* Real viewport cap (not %), so children can use height:100% + object-fit:contain. */
    max-height: min(90dvh, calc(100dvh - 5rem));
    min-height: 0;
    cursor: default;
  }
  .chat-lb-media {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    width: 100%;
    max-width: min(920px, 100%);
    /* Explicit box so the img/video can shrink into it instead of overflowing (and looking cropped). */
    height: min(85dvh, calc(100dvh - 7.5rem));
    max-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .chat-lb-img {
    display: block;
    /* Cap to the media box; keep aspect ratio (scale down, never crop). */
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    min-width: 0;
    min-height: 0;
    flex-shrink: 1;
    object-fit: contain;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
    background: #111;
    -webkit-user-drag: none;
    user-select: none;
  }
  /* Leave room for the caption strip under the media on small screens. */
  .chat-lb-stage.with-side .chat-lb-media {
    height: min(62dvh, calc(100dvh - 14rem));
  }
  .chat-lb-side {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(100%, 920px);
    max-height: 42vh;
    overflow-y: auto;
    color: #fff;
    flex: 0 0 auto;
    min-height: 0;
  }
  .chat-lb-cap {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    color: rgba(255, 255, 255, 0.88);
  }
  .chat-lb-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    align-self: flex-start;
    flex: 0 0 auto;
    padding: 9px 16px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.24);
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-size: 13px;
    font-weight: 650;
    text-decoration: none;
  }
  .chat-lb-cta:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  .chat-lb-extra {
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .chat-lb-nav,
  .chat-lb-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    background: rgba(20, 20, 20, 0.72);
    color: #fff;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
  }
  .chat-lb-close {
    position: absolute;
    top: max(12px, env(safe-area-inset-top, 0px));
    right: max(12px, env(safe-area-inset-right, 0px));
    z-index: 2;
  }
  .chat-lb-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
  }
  .chat-lb-nav.prev { left: 8px; }
  .chat-lb-nav.next { right: 8px; }
  .chat-lb-nav:hover,
  .chat-lb-close:hover,
  .chat-lb-close:active {
    background: rgba(40, 40, 40, 0.9);
  }
  .chat-lb-count {
    position: absolute;
    top: 10px;
    left: 12px;
    z-index: 2;
    font-family: var(--mono, monospace);
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    padding: 3px 9px;
    border-radius: 999px;
  }

  @media (min-width: 768px) {
    .chat-lb {
      padding: 64px 40px 40px;
    }
    .chat-lb-close {
      top: 18px;
      right: 18px;
      width: 40px;
      height: 40px;
    }
    /* Desktop: caption column beside the media. */
    .chat-lb-stage.with-side {
      flex-direction: row;
      align-items: center;
      gap: 24px;
      height: min(85dvh, calc(100dvh - 7.5rem));
      max-height: min(85dvh, calc(100dvh - 7.5rem));
    }
    .chat-lb-stage.with-side .chat-lb-media {
      flex: 1 1 auto;
      width: auto;
      max-width: min(920px, calc(100vw - 28rem));
      height: 100%;
    }
    .chat-lb-stage.with-side .chat-lb-side {
      width: min(340px, 32vw);
      max-height: 100%;
      justify-content: center;
    }
  }
</style>
