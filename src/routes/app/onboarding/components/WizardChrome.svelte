<script lang="ts">
  import type { Snippet } from 'svelte';
  import { _ } from 'svelte-i18n';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let {
    step = 1,
    children
  }: {
    step?: number;
    children?: Snippet;
  } = $props();

  // 'analyzing' shares the website step so the indicator doesn't jump mid-analysis.
  const TIMELINE_STEPS = [
    'onboarding.timeline.website',
    'onboarding.timeline.people',
    'onboarding.timeline.competitors',
    'onboarding.timeline.strategy',
    'onboarding.timeline.plan',
    'onboarding.timeline.preview'
  ];
</script>

<div class="ob-shell">
  <aside class="ob-sidebar">
    <a class="ob-logo" href="/app" aria-label="Anomalia"><BrandMark size={40} /></a>
    <ol class="ob-timeline">
      {#each TIMELINE_STEPS as label, i (label)}
        {@const n = i + 1}
        <li class:done={n < step} class:active={n === step}>
          <span class="ot-dot">{#if n < step}✓{/if}</span>
          <span class="ot-label">{$_(label)}</span>
        </li>
      {/each}
    </ol>
  </aside>

  <nav class="ob-navbar">
    <a class="ob-logo" href="/app" aria-label="Anomalia"><BrandMark size={32} /></a>
  </nav>

  <div class="ob-main">
    <main class="wrap">{@render children?.()}</main>
  </div>
</div>

<style>
  .ob-shell { height: 100dvh; display: flex; flex-direction: column; background: var(--paper, #fff); }
  @media (min-width: 861px) { .ob-shell { flex-direction: row; } }

  .ob-logo { display: inline-flex; cursor: pointer; transition: opacity 0.15s, transform 0.15s; }
  .ob-logo:hover { opacity: 0.8; }
  .ob-logo:active { transform: scale(0.94); }
  .ob-logo :global(.brandmark path) { fill: var(--ink, #1d1d1f); }

  .ob-sidebar { display: none; }
  @media (min-width: 861px) {
    .ob-sidebar {
      display: flex; flex-direction: column; gap: 40px;
      flex: 0 0 240px; width: 240px;
      padding: 28px 24px;
      border-right: 1px solid var(--line, #e3e3e6);
      background: var(--paper-2, #f9f9f9);
    }
  }

  .ob-navbar { display: flex; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--line, #e3e3e6); }
  @media (min-width: 861px) { .ob-navbar { display: none; } }

  /* Sotto 861px la barra orizzontale nell'head prende il posto di questa timeline. */
  .ob-timeline { display: flex; flex-direction: column; list-style: none; padding: 0; margin: 0; }
  .ob-timeline li { position: relative; display: flex; align-items: flex-start; gap: 12px; padding-bottom: 22px; }
  .ob-timeline li:last-child { padding-bottom: 0; }
  .ob-timeline li::before { content: ''; position: absolute; left: 10px; top: 22px; bottom: 0; width: 2px; background: var(--line, #e3e3e6); }
  .ob-timeline li:last-child::before { display: none; }
  .ob-timeline li.done::before { background: var(--accent, #7c5cff); }
  .ot-dot { width: 22px; height: 22px; flex: 0 0 22px; border-radius: 50%; border: 2px solid var(--line-2, #d2d2d7);
    display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--ink-faint, #86868b); background: var(--paper, #fff); z-index: 1; }
  .ob-timeline li.active .ot-dot { border-color: var(--accent, #7c5cff); color: var(--accent, #7c5cff); box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.15); }
  .ob-timeline li.done .ot-dot { background: var(--accent, #7c5cff); color: #fff; border-color: var(--accent, #7c5cff); }
  .ot-label { font-size: 13.5px; font-weight: 600; line-height: 1.25; padding-top: 2px; color: var(--ink-faint, #86868b); }
  .ob-timeline li.active .ot-label, .ob-timeline li.done .ot-label { color: var(--ink, #1d1d1f); }

  .ob-main { flex: 1; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; background: var(--paper, #fff); }
  .wrap { width: 100%; max-width: 820px; margin: 0; padding: 48px clamp(24px, 5vw, 64px) 96px; }

  @media (max-width: 860px) {
    .wrap { padding: 28px 22px 96px; }
  }
</style>
