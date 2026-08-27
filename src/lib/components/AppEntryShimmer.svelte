<script lang="ts">
  import WorkbenchPageShimmer from '$lib/components/WorkbenchPageShimmer.svelte';
</script>

<!--
  Full-viewport stand-in for the app shell while a navigation INTO /app is still
  loading. Mirrors the brand-layout optimistic shimmer so marketing → /app feels
  like an instant route change instead of a stuck homepage + progress bar.
-->
<div class="app-entry" aria-busy="true" aria-live="polite">
  <aside class="app-entry-rail" aria-hidden="true">
    <div class="app-entry-block app-entry-logo"></div>
    <div class="app-entry-nav">
      {#each [1, 2, 3, 4, 5, 6] as _}
        <div class="app-entry-block app-entry-item"></div>
      {/each}
    </div>
  </aside>
  <div class="app-entry-main">
    <div class="app-entry-top" aria-hidden="true">
      <div class="app-entry-block app-entry-title"></div>
    </div>
    <div class="app-entry-body">
      <WorkbenchPageShimmer variant="overview" />
    </div>
  </div>
</div>

<style>
  .app-entry {
    position: fixed;
    inset: 0;
    z-index: 9998;
    display: flex;
    background: var(--paper-2, #f9f9f9);
    color: var(--ink, #111);
  }

  .app-entry-rail {
    display: none;
    width: min(16rem, 28vw);
    flex-shrink: 0;
    padding: 14px 12px;
    border-right: 1px solid var(--line, #e8e8e8);
    background: var(--sidebar-bg, var(--paper, #fff));
    box-sizing: border-box;
  }

  .app-entry-nav {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 18px;
  }

  .app-entry-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .app-entry-top {
    height: 52px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 0 20px;
    border-bottom: 1px solid var(--line, #e8e8e8);
    background: var(--paper, #fff);
  }

  .app-entry-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    width: 100%;
    max-width: var(--content-max, 960px);
    margin-inline: auto;
    padding: var(--content-pad-top, 20px) var(--content-pad-x, 20px)
      var(--content-pad-bottom, 64px);
    box-sizing: border-box;
  }

  .app-entry-block {
    background: color-mix(in srgb, var(--ink, #111) 7%, transparent);
    border-radius: 8px;
    animation: app-entry-pulse 1.2s ease-in-out infinite;
  }

  .app-entry-logo {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }

  .app-entry-item {
    height: 28px;
    width: 100%;
    border-radius: 8px;
  }

  .app-entry-item:nth-child(2) {
    width: 78%;
  }
  .app-entry-item:nth-child(3) {
    width: 88%;
  }
  .app-entry-item:nth-child(5) {
    width: 70%;
  }

  .app-entry-title {
    width: min(180px, 40%);
    height: 14px;
  }

  @keyframes app-entry-pulse {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 1;
    }
  }

  @media (min-width: 1024px) {
    .app-entry-rail {
      display: block;
    }
  }
</style>
