<script lang="ts">
  import { _ } from 'svelte-i18n';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { useSidebar } from '$lib/components/ui/sidebar/context.svelte.js';

  const sidebar = useSidebar();
</script>

<header class="mobile-nav">
  <button class="mobile-burger" class:is-open={sidebar.openMobile} type="button" onclick={() => sidebar.toggle()} aria-label={$_('app.nav.openMenu')} aria-expanded={sidebar.openMobile}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
      <line class="b-top" x1="3" y1="6" x2="21" y2="6" />
      <line class="b-mid" x1="3" y1="12" x2="21" y2="12" />
      <line class="b-bot" x1="3" y1="18" x2="21" y2="18" />
    </svg>
  </button>
  <a href="/app" class="mobile-brand" aria-label="Anomalia">
    <BrandMark size={44} />
  </a>
  <div class="mobile-spacer"></div>
</header>

<style>
  .mobile-nav {
    display: none;
  }
  @media (max-width: 768px) {
    .mobile-nav {
      display: grid; grid-template-columns: 1fr auto 1fr;
      align-items: center; padding: 0 12px;
      height: 56px; width: 100%;
      background: var(--paper);
      border-bottom: 1px solid var(--line);
      position: sticky; top: 0; z-index: 40;
    }
    .mobile-burger,
    .mobile-brand {
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition: background-color 0.12s ease, transform 0.12s ease;
    }
    .mobile-burger {
      display: inline-flex; align-items: center; justify-content: center;
      width: 44px; height: 44px; padding: 0;
      border: 0; border-radius: 12px; background: none; color: var(--ink); cursor: pointer;
      justify-self: start;
    }
    .mobile-burger:active {
      background: color-mix(in srgb, var(--ink) 8%, transparent);
      transform: scale(0.96);
    }
    .mobile-burger svg { width: 24px; height: 24px; transition: color .2s; }
    .mobile-burger svg line {
      transition: transform .3s cubic-bezier(0.22, 1, 0.36, 1), opacity .2s;
      transform-origin: center;
    }
    .mobile-burger.is-open .b-top { transform: translateY(6px) rotate(45deg); }
    .mobile-burger.is-open .b-mid { opacity: 0; }
    .mobile-burger.is-open .b-bot { transform: translateY(-6px) rotate(-45deg); }
    .mobile-brand {
      display: flex; align-items: center; justify-self: center;
      color: inherit; text-decoration: none;
      padding: 4px; border-radius: 10px;
    }
    .mobile-brand:active {
      background: color-mix(in srgb, var(--ink) 6%, transparent);
      transform: scale(0.97);
    }
    .mobile-spacer {
      justify-self: end;
      width: 44px;
    }
  }
</style>
