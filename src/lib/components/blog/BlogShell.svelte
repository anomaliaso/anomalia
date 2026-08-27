<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { isDrawerOpen, getDrawerToc, drawerScrollTo, closeDrawer, openDrawer } from './blog-drawer.svelte';
  import BlogCookieBanner from './BlogCookieBanner.svelte';
  import BlogSearch from './BlogSearch.svelte';
  import { openBlogCookieSettings } from './blog-consent.svelte';

  let { brand, base = '', categories = [], children } = $props();

  let theme = $state<'light' | 'dark'>('light');
  $effect(() => {
    if (typeof window === 'undefined') return;
    const read = () => (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light';
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

  function handleDrawerLink(id: string) {
    closeDrawer();
    setTimeout(() => drawerScrollTo?.(id), 300);
  }

  const tocItems = $derived(getDrawerToc());
  const drawerVisible = $derived(isDrawerOpen());
  const isSidebar = $derived(brand.layout === 'sidebar');
</script>

<svelte:head>
  {#if brand.icon}
    <link rel="icon" href={brand.icon} />
    <link rel="apple-touch-icon" href={brand.icon} />
  {/if}
</svelte:head>

<div class="blog" style="--accent:{brand.accent}; --font:{brand.font};">
  <header class="site-head">
    <div class="nav-inner">
      <a class="brand" href={base || '/'}>
        {#if brand.icon}<img src={brand.icon} alt={brand.name} class="logo" />{/if}
        <span class="brand-name">{brand.name}</span>
      </a>
      <nav class="nav-links">
        {#if brand.showBlogLink}<a href={base || '/'}>Blog</a>{/if}
        {#each brand.navbarLinks as link}
          <a href={link.url.startsWith('http') ? link.url : `${base}${link.url}`}>{link.label}</a>
        {/each}
        <button class="theme-toggle" type="button" onclick={toggleTheme} aria-label={theme === 'dark' ? $_('blog.lightTheme') : $_('blog.darkTheme')}>
          {#if theme === 'dark'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          {/if}
        </button>
        <BlogSearch {base} />
      </nav>
      <button class="burger" aria-label={$_('blog.menu')} onclick={openDrawer}>
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>

  {#if drawerVisible}
    <div class="drawer-overlay" onclick={closeDrawer} role="presentation"></div>
    <div class="drawer" role="dialog" aria-label={$_('blog.menu')}>
      <div class="drawer-head">
        <a class="brand" href={base || '/'}>
          {#if brand.icon}<img src={brand.icon} alt={brand.name} class="logo" />{/if}
          <span class="brand-name">{brand.name}</span>
        </a>
        <button class="drawer-close" aria-label={$_('blog.close')} onclick={closeDrawer}>✕</button>
      </div>
      <div class="drawer-body">
        <nav class="drawer-nav">
          {#if brand.showBlogLink}<a href={base || '/'} onclick={closeDrawer}>Blog</a>{/if}
          {#each brand.navbarLinks as link}
            <a href={link.url.startsWith('http') ? link.url : `${base}${link.url}`} onclick={closeDrawer}>{link.label}</a>
          {/each}
          <button class="drawer-theme" type="button" onclick={toggleTheme}>
            {theme === 'dark' ? $_('blog.lightTheme') : $_('blog.darkTheme')}
          </button>
        </nav>
        {#if categories.length}
          <div class="drawer-cats">
            <p class="drawer-toc-title">{$_('blog.categories')}</p>
            <ul>
              {#each categories as cat (cat.id)}
                <li><a href="{base}/category/{cat.slug}" onclick={closeDrawer}>{cat.name}</a></li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if tocItems.length}
          <div class="drawer-toc">
            <p class="drawer-toc-title">{$_('blog.tableOfContents')}</p>
            <ul>
              {#each tocItems as item (item.id)}
                <li class="drawer-toc-{item.level === 3 ? 'sub' : 'top'}">
                  <a href="#{item.id}" onclick={(e) => { e.preventDefault(); handleDrawerLink(item.id); }}>{item.text}</a>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </div>
  {/if}
  {#if categories.length && !isSidebar}
    <nav class="cat-bar" aria-label={$_('blog.categories')}>
      {#each categories as cat (cat.id)}
        <a href="{base}/category/{cat.slug}">{cat.name}</a>
      {/each}
    </nav>
  {/if}

  {#if isSidebar}
    <div class="sidebar-layout">
      <aside class="sidebar">
        {#if categories.length}
          <div class="side-section">
            <p class="side-title">{$_('blog.categories')}</p>
            <ul>
              {#each categories as cat (cat.id)}
                <li><a href="{base}/category/{cat.slug}">{cat.name}</a></li>
              {/each}
            </ul>
          </div>
        {/if}
        <div class="side-section">
          <button class="drawer-theme" type="button" onclick={toggleTheme}>
            {theme === 'dark' ? $_('blog.lightTheme') : $_('blog.darkTheme')}
          </button>
        </div>
      </aside>
      <main class="site-main">{@render children()}</main>
    </div>
  {:else}
    <main class="site-main">{@render children()}</main>
  {/if}
  <footer class="site-foot">
    <div class="foot-inner">
      <div class="foot-main">
        <a class="foot-brand" href={base || '/'}>
          {#if brand.icon}<img src={brand.icon} alt={brand.name} class="foot-logo" />{/if}
          <span class="foot-name">{brand.name}</span>
        </a>
        {#if brand.description}<p class="foot-desc">{brand.description}</p>{/if}
        <p class="foot-copy">© {new Date().getFullYear()} {brand.name}</p>
        <a
          class="anomalia-badge"
          href={brand.referralCode
            ? `https://anomalia.so/?ref=${encodeURIComponent(brand.referralCode)}`
            : 'https://anomalia.so'}
          target="_blank"
          rel="noopener"
          aria-label={$_('blog.poweredByAria')}
        >
          <span class="anomalia-badge-mark" aria-hidden="true">0→1</span>
          <span class="anomalia-badge-text">
            <span class="anomalia-badge-kicker">{$_('blog.poweredBy')}</span>
            <span class="anomalia-badge-name">Anomalia</span>
          </span>
        </a>
      </div>
      <nav class="foot-legal">
        <a href={`${base}/privacy`}>{$_('blog.privacyCookie')}</a>
        <a href={`${base}/terms`}>{$_('blog.terms')}</a>
        <button type="button" onclick={openBlogCookieSettings}>{$_('blog.cookiePreferences')}</button>
      </nav>
    </div>
  </footer>

  <BlogCookieBanner {base} />
</div>

<style>
  :global(body) { margin: 0; }
  .blog {
    max-width: 1600px; margin: 0 auto; padding: 0 57px;
    font-family: var(--font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    color: #1a1a1a; line-height: 1.65;
  }
  /* Force the chosen font on ALL blog text incl. headings — beats any global app.css heading font
     (a bare `h2 {}` rule would otherwise win over inheritance). */
  .blog :global(h1), .blog :global(h2), .blog :global(h3),
  .blog :global(h4), .blog :global(p), .blog :global(a),
  .blog :global(li), .blog :global(time), .brand-name {
    font-family: var(--font, inherit);
  }
  .site-head {
    position: sticky;
    top: 0;
    z-index: 100;
    padding: 0 57px;
    margin: 0 -57px;
    background: var(--paper-2, #f9f9f9);
  }
  .nav-inner {
    max-width: 1600px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 64px;
  }
  .brand { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; padding-bottom: 4px; }
  .logo { height: 28px; width: auto; display: block; border-radius: 6px; }
  .brand-name { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
  .nav-links { display: flex; align-items: center; gap: 24px; }
  .nav-links a {
    font-size: 14px;
    font-weight: 500;
    color: #666;
    text-decoration: none;
    transition: color 0.15s;
  }
  .nav-links a:hover { color: var(--accent); }
  .theme-toggle {
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; padding: 0;
    background: none; border: none; border-radius: 8px; cursor: pointer;
    color: #666; transition: color 0.15s, background 0.15s;
  }
  .theme-toggle:hover { color: var(--accent); background: var(--paper-2, #f5f5f5); }
  .theme-toggle svg { width: 18px; height: 18px; }
  .drawer-theme {
    display: block; width: 100%; text-align: left; padding: 12px 16px;
    font-size: 16px; font-weight: 500; color: #1a1a1a;
    background: none; border: none; border-radius: 10px; cursor: pointer;
    transition: background 0.15s;
  }
  .drawer-theme:hover { background: var(--paper-2, #f5f5f5); }

  .burger { display: none; background: none; border: none; cursor: pointer; padding: 8px; flex-direction: column; gap: 5px; }
  .burger span { display: block; width: 22px; height: 2px; background: #1a1a1a; border-radius: 2px; transition: background 0.15s; }

  .drawer-overlay {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
  }
  .drawer {
    position: fixed; top: 0; right: 0; bottom: 0;
    z-index: 201;
    width: 320px; max-width: 85vw;
    background: var(--paper, #fff);
    box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
    display: flex; flex-direction: column;
    overflow-y: auto;
    animation: slideIn 0.25s ease-out;
  }
  @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
  .drawer-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px; border-bottom: 1px solid #ececec;
  }
  .drawer-close {
    background: none; border: none; font-size: 20px; color: #888; cursor: pointer;
    width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
    border-radius: 8px; transition: background 0.15s;
  }
  .drawer-close:hover { background: var(--paper-2, #f5f5f5); }
  .drawer-body { padding: 24px; flex: 1; display: flex; flex-direction: column; gap: 32px; }
  .drawer-nav { display: flex; flex-direction: column; gap: 4px; }
  .drawer-nav a {
    display: block; padding: 12px 16px; font-size: 16px; font-weight: 500;
    color: #1a1a1a; text-decoration: none; border-radius: 10px;
    transition: background 0.15s;
  }
  .drawer-nav a:hover { background: var(--paper-2, #f5f5f5); }
  .drawer-toc { display: flex; flex-direction: column; gap: 8px; }
  .drawer-toc-title {
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: #999; margin: 0 0 8px; padding: 0 16px;
  }
  .drawer-toc ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .drawer-toc-sub { padding-left: 16px; }
  .drawer-toc a {
    display: block; padding: 10px 16px; font-size: 15px; font-weight: 500;
    color: #666; text-decoration: none; border-radius: 10px;
    letter-spacing: 0.01em; transition: background 0.15s, color 0.15s;
  }
  .drawer-toc a:hover { background: var(--paper-2, #f5f5f5); color: var(--accent); }

  .site-main { min-height: 60vh; margin-top: 40px; }

  /* Category bar (below navbar, full width) */
  .cat-bar {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 10px 0; margin-top: 8px;
    border-bottom: 1px solid #ececec;
    overflow-x: auto; scrollbar-width: none;
  }
  .cat-bar::-webkit-scrollbar { display: none; }
  .cat-bar a {
    font-size: 13px; font-weight: 500; white-space: nowrap;
    padding: 6px 14px; border-radius: 999px;
    color: #666; text-decoration: none;
    background: #f5f5f5; transition: background 0.15s, color 0.15s;
  }
  .cat-bar a:hover { background: var(--accent); color: #fff; }

  /* Sidebar layout */
  .sidebar-layout { display: flex; gap: 48px; align-items: flex-start; }
  .sidebar {
    flex: 0 0 260px; position: sticky; top: 80px;
    max-height: calc(100vh - 80px); overflow-y: auto;
    padding: 0; margin: 0;
  }
  .side-section { margin-bottom: 28px; }
  .side-title {
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: #999; margin: 0 0 12px;
  }
  .sidebar ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  .sidebar a {
    display: block; padding: 8px 12px; font-size: 14px; font-weight: 500;
    color: #666; text-decoration: none; border-radius: 8px;
    transition: background 0.15s, color 0.15s;
  }
  .sidebar a:hover { background: #f5f5f5; color: var(--accent); }

  /* Drawer categories */
  .drawer-cats { display: flex; flex-direction: column; gap: 8px; }
  .drawer-cats ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .drawer-cats a {
    display: block; padding: 10px 16px; font-size: 15px; font-weight: 500;
    color: #666; text-decoration: none; border-radius: 10px;
    transition: background 0.15s, color 0.15s;
  }
  .drawer-cats a:hover { background: #f5f5f5; color: var(--accent); }
  .site-foot { margin: 64px 0 40px; padding-top: 32px; border-top: 1px solid #ececec; }
  .foot-inner { display: flex; flex-direction: row; justify-content: space-between; align-items: flex-start; gap: 32px; }
  .foot-main { display: flex; flex-direction: column; gap: 16px; }
  .foot-brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
  .foot-logo { height: 24px; width: auto; border-radius: 6px; display: block; }
  .foot-name { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
  .foot-desc { font-size: 14px; color: #666; margin: 0; max-width: 480px; line-height: 1.5; }
  .foot-legal { display: flex; flex-direction: column; gap: 10px; align-items: flex-end; text-align: right; flex: 0 0 auto; }
  .foot-legal a, .foot-legal button {
    font: inherit; font-size: 13px; color: #666; text-decoration: none;
    background: none; border: none; padding: 0; cursor: pointer;
  }
  .foot-legal a:hover, .foot-legal button:hover { color: var(--accent); }
  .foot-copy { font-size: 13px; color: #999; margin: 0; }
  .anomalia-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    padding: 7px 11px 7px 7px;
    border-radius: 999px;
    border: 1px solid #e8e8e8;
    background: #fff;
    color: #111;
    text-decoration: none;
    transition: border-color 0.15s ease, transform 0.15s ease;
  }
  .anomalia-badge:hover {
    border-color: #ccc;
    transform: translateY(-1px);
  }
  .anomalia-badge-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: #111;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: -0.05em;
    line-height: 1;
  }
  .anomalia-badge-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    line-height: 1.15;
  }
  .anomalia-badge-kicker {
    font-size: 10px;
    color: #888;
    letter-spacing: 0.01em;
  }
  .anomalia-badge-name {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  @media (max-width: 900px) {
    .nav-links { display: none; }
    .burger { display: flex; }
    .site-head { padding: 0 20px; margin: 0 -20px; }
    .blog { padding: 0 20px; }
    .foot-inner { flex-direction: column; gap: 24px; }
    .foot-legal { flex-direction: row; flex-wrap: wrap; align-items: center; text-align: left; gap: 16px; }
    .sidebar-layout { flex-direction: column; gap: 0; }
    .sidebar { display: none; }
    .cat-bar { margin: 8px -20px 0; padding: 10px 20px; }
  }
  /* Follow the app's resolved theme (data-theme), NOT the raw OS preference — otherwise a light-themed
     app on a dark-OS machine renders light blog text on the white `--paper` background. */
  :global(:root[data-theme="dark"]) .blog { color: #e8e8e8; }
  :global(:root[data-theme="dark"]) .nav-links a { color: #999; }
  :global(:root[data-theme="dark"]) .theme-toggle { color: #999; }
  :global(:root[data-theme="dark"]) .theme-toggle:hover { background: #222; }
  :global(:root[data-theme="dark"]) .drawer-theme { color: #e8e8e8; }
  :global(:root[data-theme="dark"]) .drawer-theme:hover { background: #222; }
  :global(:root[data-theme="dark"]) .burger span { background: #e8e8e8; }
  :global(:root[data-theme="dark"]) .drawer { background: #1a1a1a; }
  :global(:root[data-theme="dark"]) .drawer-head { border-color: #2a2a2a; }
  :global(:root[data-theme="dark"]) .drawer-close { color: #999; }
  :global(:root[data-theme="dark"]) .drawer-close:hover { background: #222; }
  :global(:root[data-theme="dark"]) .drawer-nav a { color: #e8e8e8; }
  :global(:root[data-theme="dark"]) .drawer-nav a:hover { background: #222; }
  :global(:root[data-theme="dark"]) .drawer-toc a { color: #999; }
  :global(:root[data-theme="dark"]) .drawer-toc a:hover { background: #222; color: var(--accent); }
  :global(:root[data-theme="dark"]) .site-foot { border-color: #2a2a2a; }
  :global(:root[data-theme="dark"]) .cat-bar { border-color: #2a2a2a; }
  :global(:root[data-theme="dark"]) .cat-bar a { background: #222; color: #999; }
  :global(:root[data-theme="dark"]) .cat-bar a:hover { background: var(--accent); color: #fff; }
  :global(:root[data-theme="dark"]) .sidebar a { color: #999; }
  :global(:root[data-theme="dark"]) .sidebar a:hover { background: #222; color: var(--accent); }
  :global(:root[data-theme="dark"]) .side-title { color: #777; }
  :global(:root[data-theme="dark"]) .drawer-cats a { color: #999; }
  :global(:root[data-theme="dark"]) .drawer-cats a:hover { background: #222; color: var(--accent); }
  :global(:root[data-theme="dark"]) .foot-desc { color: #999; }
  :global(:root[data-theme="dark"]) .foot-legal a, :global(:root[data-theme="dark"]) .foot-legal button { color: #999; }
  :global(:root[data-theme="dark"]) .foot-copy { color: #777; }
  :global(:root[data-theme="dark"]) .anomalia-badge {
    background: #161616;
    border-color: #2a2a2a;
    color: #f2f2f2;
  }
  :global(:root[data-theme="dark"]) .anomalia-badge-mark { background: #f2f2f2; color: #111; }
  :global(:root[data-theme="dark"]) .anomalia-badge-kicker { color: #888; }
</style>
