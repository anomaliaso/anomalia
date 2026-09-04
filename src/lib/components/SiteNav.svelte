<script lang="ts">
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { beforeNavigate } from '$app/navigation';
  import { siGithub } from 'simple-icons';
  import LangToggle from '$lib/components/LangToggle.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';

  const GITHUB_CLI_URL = 'https://github.com/anomaliaso/anomalia';

  let {
    cta = 'Start',
    ctaHref = '/app',
    ctaExternal = false,
    ctaAria,
    current = ''
  }: {
    cta?: string;
    ctaHref?: string;
    ctaExternal?: boolean;
    /** Accessible name when visible CTA is short (keeps SEO happy without a wide nav button). */
    ctaAria?: string;
    current?: '' | 'pricing' | 'insights' | 'compare';
  } = $props();

  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));
  const ctaLabel = $derived(cta);
  const ctaAccessible = $derived(
    ctaAria ??
      (ctaHref === '/login' ||
        ctaHref.endsWith('/login') ||
        ctaHref === '/app' ||
        ctaHref.startsWith('/app') ||
        ctaHref === '/start' ||
        ctaHref.startsWith('/start')
        ? $_('landing.cta.getStartedAria')
        : cta)
  );

  let navOpen = $state(false);
  let productOpen = $state(false);
  let menuDialog = $state<HTMLDialogElement>();
  let productDropdown = $state<HTMLDivElement>();
  let theme = $state<'light' | 'dark'>('light');

  function toggleMenu() {
    if (navOpen) {
      menuDialog?.close();
      navOpen = false;
    } else {
      menuDialog?.show();
      navOpen = true;
    }
  }

  function closeMenu() {
    menuDialog?.close();
    navOpen = false;
  }

  beforeNavigate(() => {
    if (navOpen) closeMenu();
    productOpen = false;
  });

  // The root layout owns applying data-theme + cross-tab sync; here we only mirror the current
  // value (for the sun/moon icon) and react to the live attribute so the icon stays correct
  // even when another tab flips the theme.
  $effect(() => {
    if (typeof window === 'undefined') return;
    const read = () =>
      (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light';
    theme = read();
    const obs = new MutationObserver(() => (theme = read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  });

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    theme = next;
  }

  function toggleProduct() {
    productOpen = !productOpen;
  }

  function closeProduct() {
    productOpen = false;
  }

  $effect(() => {
    if (!productOpen) return;
    function handleClick(e: MouseEvent) {
      if (productDropdown && !productDropdown.contains(e.target as Node)) {
        productOpen = false;
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  });
</script>

{#snippet githubLink()}
  <a
    class="nav-github"
    href={GITHUB_CLI_URL}
    target="_blank"
    rel="noopener noreferrer"
    aria-label="GitHub"
  >
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={siGithub.path} />
    </svg>
  </a>
{/snippet}

<header class="nav">
  <div class="nav-wrap">
    <!-- Left: brand -->
    <div class="nav-left">
      <a href={lp('/')} class="brand" aria-label={$_('landing.nav.brandAria')}>
        <BrandMark size={28} tone="negative" />
        <span class="logo logo-text" aria-hidden="true">Anomalia</span>
      </a>
    </div>

    <!-- Center: nav links (always centered) -->
    <nav class="nav-center">
      <div class="nav-dropdown" bind:this={productDropdown}>
        <button class="nav-link nav-dropdown-trigger" type="button" onclick={toggleProduct} aria-expanded={productOpen} aria-haspopup="true">
          {$_('landing.nav.product')}
          <svg class="nav-dropdown-chevron" class:is-open={productOpen} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {#if productOpen}
          <div class="nav-dropdown-menu" role="menu">
            <a href={lp('/autoposts')} class="nav-dropdown-item" role="menuitem" onclick={closeProduct}>{$_('landing.nav.autoPosts')}</a>
            <a href={lp('/autoblog')} class="nav-dropdown-item" role="menuitem" onclick={closeProduct}>{$_('landing.nav.autoBlog')}</a>
            <a href={lp('/leads-finder')} class="nav-dropdown-item" role="menuitem" onclick={closeProduct}>{$_('landing.nav.leadsFinder')}</a>
            <a href={lp('/news-radar')} class="nav-dropdown-item" role="menuitem" onclick={closeProduct}>{$_('landing.nav.newsRadar')}</a>
            <a href={lp('/ai-seo-agent')} class="nav-dropdown-item" role="menuitem" onclick={closeProduct}>{$_('landing.nav.seoAgent')}</a>
            <a href={lp('/agents')} class="nav-dropdown-item" role="menuitem" onclick={closeProduct}>{$_('landing.nav.agentLibrary')}</a>
          </div>
        {/if}
      </div>
      <a href={lp('/pricing')} class="nav-link" class:is-current={current === 'pricing'} aria-current={current === 'pricing' ? 'page' : undefined}>{$_('landing.nav.pricing')}</a>
      <a href="https://blog.anomalia.so" class="nav-link">Blog</a>
      <a href={lp('/docs')} class="nav-link">Docs</a>
    </nav>

    <!-- Right: GitHub + CTA + burger. Theme, language and sign-in live in the drawer. -->
    <div class="nav-right">
      {@render githubLink()}
      <a
        href={ctaHref}
        class="nav-cta"
        aria-label={ctaAccessible}
        target={ctaExternal ? '_blank' : undefined}
        rel={ctaExternal ? 'noopener' : undefined}
      >{ctaLabel}</a>
      <button class="nav-burger" class:is-open={navOpen} type="button" onclick={toggleMenu} aria-label={$_('app.nav.openMenu')} aria-expanded={navOpen}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <line class="b-top" x1="3" y1="6" x2="21" y2="6" />
          <line class="b-mid" x1="3" y1="12" x2="21" y2="12" />
          <line class="b-bot" x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
    </div>
  </div>

  <dialog class="nav-dialog" bind:this={menuDialog} onclose={() => (navOpen = false)}>
    <button class="nav-dialog-scrim" type="button" tabindex="-1" aria-hidden="true" onclick={closeMenu}></button>
    <nav class="nav-dialog-links">
      <!-- Same grouping the desktop bar uses: the five product pages sit under the
           "Product" dropdown there, so they get a labelled group here. -->
      <p class="nav-dialog-label">{$_('landing.nav.product')}</p>
      <a href={lp('/autoposts')} class="nav-dialog-link" onclick={closeMenu}>{$_('landing.nav.autoPosts')}</a>
      <a href={lp('/autoblog')} class="nav-dialog-link" onclick={closeMenu}>{$_('landing.nav.autoBlog')}</a>
      <a href={lp('/leads-finder')} class="nav-dialog-link" onclick={closeMenu}>{$_('landing.nav.leadsFinder')}</a>
      <a href={lp('/news-radar')} class="nav-dialog-link" onclick={closeMenu}>{$_('landing.nav.newsRadar')}</a>
      <a href={lp('/ai-seo-agent')} class="nav-dialog-link" onclick={closeMenu}>{$_('landing.nav.seoAgent')}</a>
      <a href={lp('/agents')} class="nav-dialog-link" onclick={closeMenu}>{$_('landing.nav.agentLibrary')}</a>
      <hr class="nav-dialog-sep" />
      <a href={lp('/pricing')} class="nav-dialog-link" class:is-current={current === 'pricing'} onclick={closeMenu}>{$_('landing.nav.pricing')}</a>
      <a href="https://blog.anomalia.so" class="nav-dialog-link" onclick={closeMenu}>Blog</a>
      <a href={lp('/docs')} class="nav-dialog-link" onclick={closeMenu}>Docs</a>
      <hr class="nav-dialog-sep" />
      <a href={lp('/login')} class="nav-dialog-link" onclick={closeMenu}>{$_('login.signin.title')}</a>
    </nav>
    <div class="nav-dialog-footer">
      <div class="nav-dialog-theme">
        {@render githubLink()}
        <button class="theme-toggle" type="button" onclick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {#if theme === 'dark'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          {/if}
        </button>
        <LangToggle />
      </div>
    </div>
  </dialog>
</header>

<style>
  .is-current { opacity: 0.5; pointer-events: none; }
  .theme-toggle,
  .nav-github {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; border-radius: 8px;
    background: none; border: 0; cursor: pointer;
    color: var(--ink-soft); transition: color .15s, background .15s;
  }
  .theme-toggle:hover,
  .nav-github:hover { color: var(--ink); background: var(--paper-2); }
  .theme-toggle svg,
  .nav-github svg { width: 18px; height: 18px; }

  .nav-dropdown { position: relative; }
  .nav-dropdown-trigger {
    display: inline-flex; align-items: center; gap: 4px;
    background: none; border: 0; cursor: pointer; font-family: inherit;
  }
  .nav-dropdown-chevron {
    width: 14px; height: 14px; transition: transform .2s;
  }
  .nav-dropdown-chevron.is-open { transform: rotate(180deg); }
  .nav-dropdown-menu {
    position: absolute; top: calc(100% + 6px); left: 50%;
    transform: translateX(-50%);
    min-width: 180px; padding: 6px;
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.08);
    z-index: 200;
    animation: dropdownFade .15s ease both;
  }
  .nav-dropdown-item {
    display: block; padding: 8px 12px;
    font-size: 14px; font-weight: 500; color: var(--ink-soft);
    text-decoration: none; border-radius: 8px;
    transition: color .15s, background .15s;
  }
  .nav-dropdown-item:hover { color: var(--ink); background: rgba(var(--accent-rgb), 0.06); }

  @keyframes dropdownFade {
    from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  :global(:root[data-theme="dark"]) .nav-dropdown-menu {
    background: var(--paper-2); border-color: var(--line);
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  }
  :global(:root[data-theme="dark"]) .nav-dropdown-item { color: var(--ink-soft); }
  :global(:root[data-theme="dark"]) .nav-dropdown-item:hover { color: var(--ink); }
</style>
