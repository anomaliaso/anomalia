<script lang="ts">
  let {
    variant = 'page'
  }: {
    /** overview = composer + cards; home = the Overview workbench BELOW the real composer;
     *  chat = transcript + dock; calendar = month grid; media = masonry generator; page = generic hub */
    variant?: 'page' | 'overview' | 'home' | 'chat' | 'calendar' | 'media';
  } = $props();

  /** Sparse post-card placement so the skeleton feels like a real month, not a filled grid. */
  const CAL_CELLS = [
    { posts: 1 },
    { posts: 0 },
    { posts: 2 },
    { posts: 0 },
    { posts: 1 },
    { posts: 0 },
    { posts: 1 },
    { posts: 0 },
    { posts: 1 },
    { posts: 2 },
    { posts: 0 },
    { posts: 1 },
    { posts: 0 },
    { posts: 0 },
    { posts: 2 },
    { posts: 0 },
    { posts: 1 },
    { posts: 0 },
    { posts: 1 },
    { posts: 2 },
    { posts: 0 },
    { posts: 0 },
    { posts: 1 },
    { posts: 0 },
    { posts: 2 },
    { posts: 0 },
    { posts: 1 },
    { posts: 0 },
    { posts: 1 },
    { posts: 0 },
    { posts: 0 },
    { posts: 2 },
    { posts: 0 },
    { posts: 1 },
    { posts: 0 }
  ] as const;

  /** Masonry tile shapes mirroring media-generator aspect mix (portrait / square / landscape). */
  const MEDIA_TILES = [
    'tall',
    'square',
    'tall',
    'wide',
    'tall',
    'square',
    'tall',
    'tall',
    'square',
    'wide',
    'tall',
    'square'
  ] as const;
</script>

<div
  class="wb-shimmer"
  class:is-chat={variant === 'chat'}
  class:is-overview={variant === 'overview'}
  class:is-home={variant === 'home'}
  class:is-calendar={variant === 'calendar'}
  class:is-media={variant === 'media'}
  aria-busy="true"
  aria-live="polite"
>
  {#if variant === 'overview'}
    <div class="wb-shimmer-hero">
      <div class="wb-shimmer-block wb-shimmer-avatar"></div>
      <div class="wb-shimmer-block wb-shimmer-title"></div>
      <div class="wb-shimmer-block wb-shimmer-sub"></div>
      <div class="wb-shimmer-block wb-shimmer-prompt"></div>
    </div>
    <div class="wb-shimmer-grid">
      {#each [1, 2, 3, 4] as _}
        <div class="wb-shimmer-card">
          <div class="wb-shimmer-block wb-shimmer-line w-40"></div>
          <div class="wb-shimmer-block wb-shimmer-line"></div>
          <div class="wb-shimmer-block wb-shimmer-line w-70"></div>
        </div>
      {/each}
    </div>
  {:else if variant === 'home'}
    <!-- Mirrors HomeWorkbench: control hero (copy + 3 gauges + review queue), then three
         sections. Same rhythm and roughly the same height, so nothing jumps when it lands. -->
    <div class="wb-shimmer-home-hero">
      <div class="wb-shimmer-block wb-shimmer-line w-40" style="height:10px"></div>
      <div class="wb-shimmer-block wb-shimmer-heading"></div>
      <div class="wb-shimmer-gauges">
        {#each [1, 2, 3] as _, i (i)}
          <div class="wb-shimmer-gauge">
            <div class="wb-shimmer-block wb-shimmer-ring"></div>
            <div class="wb-shimmer-block wb-shimmer-line w-70" style="height:10px"></div>
          </div>
        {/each}
      </div>
      <div class="wb-shimmer-block wb-shimmer-queue"></div>
    </div>

    <div class="wb-shimmer-section">
      <div class="wb-shimmer-block wb-shimmer-heading"></div>
      <div class="wb-shimmer-grid">
        {#each [1, 2] as _, i (i)}
          <div class="wb-shimmer-card">
            <div class="wb-shimmer-block wb-shimmer-line w-40"></div>
            <div class="wb-shimmer-block wb-shimmer-line"></div>
            <div class="wb-shimmer-block wb-shimmer-line w-70"></div>
          </div>
        {/each}
      </div>
    </div>

    <div class="wb-shimmer-section">
      <div class="wb-shimmer-block wb-shimmer-heading"></div>
      {#each [1, 2] as _, i (i)}
        <div class="wb-shimmer-card wb-shimmer-panel">
          <div class="wb-shimmer-block wb-shimmer-line w-45"></div>
          <div class="wb-shimmer-block wb-shimmer-line w-90"></div>
        </div>
      {/each}
    </div>

    <div class="wb-shimmer-section">
      <div class="wb-shimmer-block wb-shimmer-heading"></div>
      <div class="wb-shimmer-grid three">
        {#each [1, 2, 3] as _, i (i)}
          <div class="wb-shimmer-card">
            <div class="wb-shimmer-block wb-shimmer-line w-50"></div>
            <div class="wb-shimmer-block wb-shimmer-metric"></div>
          </div>
        {/each}
      </div>
    </div>
  {:else if variant === 'chat'}
    <div class="wb-shimmer-chat-msgs">
      <div class="wb-shimmer-bubble user">
        <div class="wb-shimmer-block wb-shimmer-line"></div>
      </div>
      <div class="wb-shimmer-bubble ai">
        <div class="wb-shimmer-block wb-shimmer-line"></div>
        <div class="wb-shimmer-block wb-shimmer-line w-80"></div>
        <div class="wb-shimmer-block wb-shimmer-line w-55"></div>
      </div>
      <div class="wb-shimmer-bubble user short">
        <div class="wb-shimmer-block wb-shimmer-line w-50"></div>
      </div>
      <div class="wb-shimmer-bubble ai">
        <div class="wb-shimmer-block wb-shimmer-line w-90"></div>
        <div class="wb-shimmer-block wb-shimmer-line w-65"></div>
      </div>
    </div>
    <div class="wb-shimmer-block wb-shimmer-prompt dock"></div>
  {:else if variant === 'calendar'}
    <div class="wb-shimmer-cal-chrome">
      <div class="wb-shimmer-block wb-shimmer-heading"></div>
      <div class="wb-shimmer-cal-toolbar">
        <div class="wb-shimmer-block wb-shimmer-nav"></div>
        <div class="wb-shimmer-block wb-shimmer-month"></div>
        <div class="wb-shimmer-block wb-shimmer-nav"></div>
        <div class="wb-shimmer-cal-tools">
          <div class="wb-shimmer-block wb-shimmer-chip"></div>
          <div class="wb-shimmer-block wb-shimmer-chip wide"></div>
        </div>
      </div>
    </div>
    <div class="wb-shimmer-cal">
      <div class="wb-shimmer-cal-head">
        {#each [1, 2, 3, 4, 5, 6, 7] as _}
          <div class="wb-shimmer-cal-dow">
            <div class="wb-shimmer-block wb-shimmer-dow"></div>
          </div>
        {/each}
      </div>
      <div class="wb-shimmer-cal-body">
        {#each CAL_CELLS as cell, i (i)}
          <div class="wb-shimmer-cal-cell" class:out={i < 2 || i > 32}>
            <div class="wb-shimmer-block wb-shimmer-daynum"></div>
            {#each Array(cell.posts) as _, pi (pi)}
              <div class="wb-shimmer-cal-post">
                <div class="wb-shimmer-block wb-shimmer-cal-thumb"></div>
                <div class="wb-shimmer-cal-meta">
                  <div class="wb-shimmer-block wb-shimmer-line w-40"></div>
                  <div class="wb-shimmer-block wb-shimmer-line w-80"></div>
                </div>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {:else if variant === 'media'}
    <div class="wb-shimmer-media">
      <div class="wb-shimmer-media-top">
        <div class="wb-shimmer-block wb-shimmer-heading"></div>
        <div class="wb-shimmer-block wb-shimmer-media-history"></div>
      </div>
      <div class="wb-shimmer-masonry" aria-hidden="true">
        {#each MEDIA_TILES as shape, i (i)}
          <div class="wb-shimmer-block wb-shimmer-media-tile" class:tall={shape === 'tall'} class:square={shape === 'square'} class:wide={shape === 'wide'}></div>
        {/each}
      </div>
      <div class="wb-shimmer-media-dock">
        <div class="wb-shimmer-block wb-shimmer-media-banner"></div>
        <div class="wb-shimmer-block wb-shimmer-media-composer"></div>
      </div>
    </div>
  {:else}
    <div class="wb-shimmer-block wb-shimmer-heading"></div>
    <div class="wb-shimmer-block wb-shimmer-line w-55"></div>
    <div class="wb-shimmer-toolbar">
      <div class="wb-shimmer-block wb-shimmer-chip"></div>
      <div class="wb-shimmer-block wb-shimmer-chip"></div>
      <div class="wb-shimmer-block wb-shimmer-chip"></div>
    </div>
    <div class="wb-shimmer-stack">
      {#each [1, 2, 3, 4, 5] as _}
        <div class="wb-shimmer-row">
          <div class="wb-shimmer-block wb-shimmer-thumb"></div>
          <div class="wb-shimmer-row-text">
            <div class="wb-shimmer-block wb-shimmer-line w-45"></div>
            <div class="wb-shimmer-block wb-shimmer-line w-70"></div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wb-shimmer {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    min-height: 60vh;
  }
  .wb-shimmer.is-chat {
    /* Match chat thread column + dock (`--chat-col` on .chat-page). */
    --chat-col: 880px;
    flex: 1;
    min-height: 0;
    height: 100%;
    padding: 16px 24px 22px;
    justify-content: space-between;
    box-sizing: border-box;
  }
  .wb-shimmer.is-overview {
    gap: 28px;
  }
  .wb-shimmer.is-home {
    gap: 0;
    min-height: 0;
  }
  /* HomeWorkbench spaces its sections 64px apart; match it or the page shifts on arrival. */
  .wb-shimmer-home-hero {
    display: grid;
    gap: 18px;
    margin: 0 0 64px;
    padding: 18px;
    border-radius: 18px;
    border: 1px solid var(--line);
    background: var(--paper);
  }
  .wb-shimmer-gauges {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .wb-shimmer-gauge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 8px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--paper-2) 70%, var(--paper));
  }
  .wb-shimmer-ring {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .wb-shimmer-queue {
    height: 148px;
    border-radius: 16px;
  }
  .wb-shimmer-section {
    margin: 0 0 64px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .wb-shimmer-section .wb-shimmer-heading {
    margin-bottom: 2px;
  }
  .wb-shimmer-panel {
    background: var(--paper);
    border-radius: 16px;
  }
  .wb-shimmer-metric {
    height: 26px;
    width: 60%;
  }
  .wb-shimmer.is-calendar {
    gap: 0;
    flex: 1;
    min-height: 0;
    height: 100%;
  }
  .wb-shimmer.is-media {
    gap: 0;
    flex: 1;
    min-height: 0;
    height: 100%;
  }

  .wb-shimmer-block {
    border-radius: 10px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--ink) 4%, var(--paper)) 0%,
      color-mix(in srgb, var(--ink) 9%, var(--paper)) 45%,
      color-mix(in srgb, var(--ink) 4%, var(--paper)) 100%
    );
    background-size: 200% 100%;
    animation: wb-shimmer 1.35s ease-in-out infinite;
  }

  .wb-shimmer-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 12px 0 8px;
  }
  .wb-shimmer-avatar {
    width: 72px;
    height: 72px;
    border-radius: 20px;
  }
  .wb-shimmer-title {
    width: min(220px, 55%);
    height: 1.85rem;
  }
  .wb-shimmer-sub {
    width: min(280px, 70%);
    height: 14px;
  }
  .wb-shimmer-prompt {
    width: 100%;
    max-width: none;
    height: 112px;
    border-radius: 16px;
    margin-top: 8px;
  }
  .wb-shimmer-prompt.dock {
    width: 100%;
    max-width: var(--chat-col);
    margin-inline: auto;
    height: 96px;
    border-radius: 18px;
    flex-shrink: 0;
  }

  .wb-shimmer-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .wb-shimmer-grid.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .wb-shimmer-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--paper-2) 65%, var(--paper));
  }

  .wb-shimmer-heading {
    width: min(280px, 42%);
    height: 1.85rem;
    margin-top: 0;
    border-radius: 8px;
  }
  .wb-shimmer-line {
    height: 12px;
    width: 100%;
  }
  .wb-shimmer-toolbar {
    display: flex;
    gap: 8px;
    margin: 4px 0 8px;
  }
  .wb-shimmer-chip {
    width: 72px;
    height: 28px;
    border-radius: 999px;
  }
  .wb-shimmer-chip.wide {
    width: 96px;
  }
  .wb-shimmer-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .wb-shimmer-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
  }
  .wb-shimmer-thumb {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    flex-shrink: 0;
  }
  .wb-shimmer-row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .wb-shimmer-chat-msgs {
    flex: 1;
    min-height: 0;
    width: 100%;
    max-width: var(--chat-col);
    margin-inline: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 8px 0;
    box-sizing: border-box;
  }
  .wb-shimmer-bubble {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 72%;
    padding: 14px 16px;
    border-radius: 16px;
    background: color-mix(in srgb, var(--ink) 3%, var(--paper));
    border: 1px solid var(--line);
  }
  .wb-shimmer-bubble.user {
    align-self: flex-end;
    max-width: 48%;
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
  }
  .wb-shimmer-bubble.user.short {
    max-width: 36%;
  }
  .wb-shimmer-bubble.ai {
    align-self: flex-start;
  }

  /* Calendar — mirrors cal-page: chrome + full-bleed 7-col month grid with post cards. */
  .wb-shimmer-cal-chrome {
    padding: 16px var(--content-pad-x, 20px) 12px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-sizing: border-box;
  }
  .wb-shimmer-cal-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .wb-shimmer-nav {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    flex-shrink: 0;
  }
  .wb-shimmer-month {
    width: 120px;
    height: 18px;
    border-radius: 6px;
  }
  .wb-shimmer-cal-tools {
    margin-left: auto;
    display: flex;
    gap: 10px;
  }
  .wb-shimmer-cal {
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    background: var(--paper);
    overflow: hidden;
  }
  .wb-shimmer-cal-head,
  .wb-shimmer-cal-body {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
  .wb-shimmer-cal-dow {
    padding: 12px;
    border-bottom: 1px solid var(--line);
    border-right: 1px solid var(--line);
    display: flex;
    justify-content: center;
  }
  .wb-shimmer-cal-dow:nth-child(7n) {
    border-right: none;
  }
  .wb-shimmer-dow {
    height: 10px;
    width: 42%;
    border-radius: 4px;
  }
  .wb-shimmer-cal-cell {
    min-height: 188px;
    padding: 8px;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-sizing: border-box;
  }
  .wb-shimmer-cal-cell:nth-child(7n) {
    border-right: none;
  }
  .wb-shimmer-cal-cell.out {
    background: var(--paper-2);
  }
  .wb-shimmer-daynum {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .wb-shimmer-cal-post {
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    background: var(--paper);
    display: flex;
    flex-direction: column;
  }
  .wb-shimmer-cal-thumb {
    width: 100%;
    aspect-ratio: 4 / 3;
    max-height: 72px;
    border-radius: 0;
  }
  .wb-shimmer-cal-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 5px 7px 6px;
  }
  .wb-shimmer-cal-meta .wb-shimmer-line {
    height: 8px;
  }

  .w-40 { width: 40% !important; }
  .w-45 { width: 45% !important; }
  .w-50 { width: 50% !important; }
  .w-55 { width: 55% !important; }
  .w-65 { width: 65% !important; }
  .w-70 { width: 70% !important; }
  .w-80 { width: 80% !important; }
  .w-90 { width: 90% !important; }

  /* Media generator — masonry grid + bottom composer dock */
  .wb-shimmer-media {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    height: 100%;
    width: 100%;
  }
  .wb-shimmer-media-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 4px 14px;
    flex-shrink: 0;
  }
  .wb-shimmer-media-history {
    width: 110px;
    height: 32px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .wb-shimmer-masonry {
    column-count: 5;
    column-gap: 12px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding-bottom: 180px;
  }
  .wb-shimmer-media-tile {
    display: block;
    width: 100%;
    break-inside: avoid;
    margin: 0 0 12px;
    border-radius: 14px;
  }
  .wb-shimmer-media-tile.tall {
    aspect-ratio: 4 / 5;
  }
  .wb-shimmer-media-tile.square {
    aspect-ratio: 1 / 1;
  }
  .wb-shimmer-media-tile.wide {
    aspect-ratio: 16 / 9;
  }
  .wb-shimmer-media-dock {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    width: min(820px, calc(100% - 24px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
    z-index: 2;
  }
  .wb-shimmer-media-banner {
    height: 52px;
    border-radius: 14px;
  }
  .wb-shimmer-media-composer {
    height: 108px;
    border-radius: 22px;
  }

  /* A shimmer that never stops reads as "broken" to anyone who needs reduced motion. */
  @media (prefers-reduced-motion: reduce) {
    .wb-shimmer-block {
      animation: none;
    }
  }

  @keyframes wb-shimmer {
    from { background-position: 200% 0; }
    to { background-position: -200% 0; }
  }

  @media (max-width: 1400px) {
    .wb-shimmer-masonry {
      column-count: 4;
    }
  }
  @media (max-width: 1100px) {
    .wb-shimmer-masonry {
      column-count: 3;
    }
  }
  @media (max-width: 780px) {
    .wb-shimmer-masonry {
      column-count: 2;
    }
  }
  @media (max-width: 640px) {
    .wb-shimmer-masonry {
      column-count: unset;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .wb-shimmer-media-tile {
      margin: 0;
    }
    .wb-shimmer-media-tile.wide {
      grid-column: 1 / -1;
    }
    .wb-shimmer-media-composer {
      height: 96px;
      border-radius: 18px;
    }
  }
  @media (max-width: 560px) {
    .wb-shimmer-grid,
    .wb-shimmer-grid.three {
      grid-template-columns: 1fr;
    }
    .wb-shimmer-cal-cell {
      min-height: 140px;
    }
  }
</style>
