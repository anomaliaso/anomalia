<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { _, locale } from 'svelte-i18n';
  import { localePath, type Locale } from '$lib/i18n/locale';
  import { cn } from '$lib/utils';
  import { toc } from '$lib/stores/toc';
  import { onMount } from 'svelte';
  import { siShopify, siWebflow, siWix, type SimpleIcon } from 'simple-icons';
  import LangToggle from '$lib/components/LangToggle.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import DocsSearch, { type DocsSearchItem } from '$lib/components/docs/DocsSearch.svelte';
  import DocsPager from '$lib/components/docs/DocsPager.svelte';
  import '$lib/styles/tailwind.css';

  let { children } = $props();

  onMount(() => {
    const prev = document.body.style.background;
    document.body.style.background = 'var(--paper)';
    return () => { document.body.style.background = prev; };
  });
  const lp = $derived((p: string) => localePath(p, (($locale as Locale) ?? 'en')));

  let sidebarOpen = $state(false);
  let searchOpen = $state(false);
  let pageMenuOpen = $state(false);

  type NavItem = { title: string; href: string; icon: string; siIcon?: SimpleIcon };
  type NavGroup = { label: string; items: NavItem[] };

  const DOCS_NAV: NavGroup[] = $derived([
    { label: $_('docs.layout.s0'), items: [
      { title: $_('docs.layout.s1'), href: '/docs', icon: 'book' },
      { title: $_('docs.layout.s2'), href: '/docs/getting-started', icon: 'zap' },
      { title: $_('docs.layout.s59'), href: '/docs/credits', icon: 'coins' },
    ]},
    { label: $_('docs.layout.s3'), items: [
      { title: $_('docs.layout.s4'), href: '/docs/brands', icon: 'layers' },
      { title: $_('docs.layout.s5'), href: '/docs/team-invites', icon: 'users' },
    ]},
    { label: $_('docs.layout.s6'), items: [
      { title: $_('docs.layout.s7'), href: '/docs/editorial-plan', icon: 'calendar' },
      { title: $_('docs.layout.s8'), href: '/docs/studio', icon: 'palette' },
      { title: $_('docs.layout.s9'), href: '/docs/post-history', icon: 'clock' },
      { title: $_('docs.layout.s10'), href: '/docs/thematic-calendar', icon: 'calendar' },
    ]},
    { label: $_('docs.layout.s11'), items: [
      { title: $_('docs.layout.s12'), href: '/docs/research', icon: 'target' },
      { title: $_('docs.layout.s13'), href: '/docs/gtm-strategy', icon: 'trending-up' },
      { title: $_('docs.layout.s14'), href: '/docs/brand-memory', icon: 'database' },
      { title: $_('docs.layout.s15'), href: '/docs/weekly-recap', icon: 'mail' },
    ]},
    { label: $_('docs.layout.s16'), items: [
      { title: $_('docs.layout.s17'), href: '/docs/geo-audit', icon: 'globe' },
      { title: $_('docs.layout.s18'), href: '/docs/seo-advisor', icon: 'search' },
      { title: $_('docs.layout.s19'), href: '/docs/content-library', icon: 'book-open' },
      { title: $_('docs.layout.s20'), href: '/docs/radar', icon: 'radio' },
    ]},
    { label: $_('docs.layout.s21'), items: [
      { title: $_('docs.layout.s22'), href: '/docs/blog-hosting', icon: 'globe' },
      { title: $_('docs.layout.s23'), href: '/docs/shopify', icon: 'shopping-bag', siIcon: siShopify },
      { title: $_('docs.layout.s24'), href: '/docs/webflow', icon: 'layout', siIcon: siWebflow },
      { title: $_('docs.layout.s25'), href: '/docs/wix', icon: 'layout', siIcon: siWix },
    ]},
    { label: $_('docs.layout.s26'), items: [
      { title: $_('docs.layout.s27'), href: '/docs/cli', icon: 'terminal' },
      { title: $_('docs.layout.s60'), href: '/docs/mcp', icon: 'plug' },
      { title: $_('docs.layout.s28'), href: '/docs/agents', icon: 'bot' },
    ]},
  ]);

  const API_NAV: NavGroup[] = $derived([
    { label: $_('docs.layout.s29'), items: [
      { title: $_('docs.layout.s30'), href: '/docs/api', icon: 'code' },
    ]},
    { label: $_('docs.layout.s31'), items: [
      { title: $_('docs.layout.s32'), href: '/docs/api/brands', icon: 'layers' },
      { title: $_('docs.layout.s33'), href: '/docs/api/posts', icon: 'file-text' },
      { title: $_('docs.layout.s34'), href: '/docs/api/editorial-plan', icon: 'calendar' },
      { title: $_('docs.layout.s35'), href: '/docs/api/studio', icon: 'palette' },
      { title: $_('docs.layout.s36'), href: '/docs/api/strategy', icon: 'target' },
      { title: $_('docs.layout.s37'), href: '/docs/api/analytics', icon: 'bar-chart' },
      { title: $_('docs.layout.s38'), href: '/docs/api/products', icon: 'package' },
      { title: $_('docs.layout.s39'), href: '/docs/api/articles', icon: 'file-text' },
    ]},
  ]);

  const isApiPage = $derived($page.url.pathname.includes('/docs/api'));
  const NAV = $derived(isApiPage ? API_NAV : DOCS_NAV);

  const currentNavHref = $derived.by(() => {
    const path = $page.url.pathname.replace(/\/$/, '') || '/';
    const match = NAV.flatMap((g) => g.items)
      .map((item) => ({ item, normalised: lp(item.href).replace(/\/$/, '') }))
      .filter(({ normalised }) => path === normalised || path.startsWith(normalised + '/'))
      .sort((a, b) => b.normalised.length - a.normalised.length)[0];
    return match?.item.href ?? (isApiPage ? '/docs/api' : '/docs');
  });

  const currentNavTitle = $derived.by(() => {
    for (const group of NAV) {
      const item = group.items.find((i) => i.href === currentNavHref);
      if (item) return item.title;
    }
    return $_('docs.layout.s55');
  });

  const pager = $derived.by(() => {
    const flat = NAV.flatMap((g) => g.items);
    const idx = flat.findIndex((item) => item.href === currentNavHref);
    if (idx < 0) return { prev: null, next: null };
    const toLink = (item: NavItem | undefined) =>
      item ? { title: item.title, href: lp(item.href) } : null;
    return {
      prev: toLink(flat[idx - 1]),
      next: toLink(flat[idx + 1])
    };
  });

  const searchItems = $derived.by((): DocsSearchItem[] => {
    const out: DocsSearchItem[] = [];
    for (const group of [...DOCS_NAV, ...API_NAV]) {
      for (const item of group.items) {
        out.push({ title: item.title, href: lp(item.href), group: group.label });
      }
    }
    return out;
  });

  const breadcrumbJsonLd = $derived.by(() => {
    const path = $page.url.pathname.replace(/^\/(en|it|es|fr)(?=\/|$)/, '') || '/';
    const origin = $page.url.origin;
    const currentLang = (($locale as Locale) ?? 'en');
    const langPrefix = currentLang === 'en' ? '' : `/${currentLang}`;
    const parts = path.split('/').filter(Boolean);
    const items: { name: string; item: string }[] = [
      { name: 'Anomalia', item: `${origin}${langPrefix || '/'}` }
    ];
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      const title =
        searchItems.find((s) => s.href === lp(acc) || s.href.endsWith(acc))?.title ??
        part.replace(/-/g, ' ');
      items.push({
        name: title,
        item: `${origin}${langPrefix}${acc}`
      });
    }
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        item: it.item
      }))
    });
  });

  function isActive(href: string, currentPath: string) {
    const normalised = lp(href);
    const path = currentPath.replace(/\/$/, '') || '/';
    const target = normalised.replace(/\/$/, '') || '/';
    if (href === '/docs' || href === '/docs/api') {
      return path === target;
    }
    return path === target || path.startsWith(target + '/');
  }

  function onMobilePageChange(href: string) {
    pageMenuOpen = false;
    if (href !== currentNavHref) goto(lp(href));
  }

  $effect(() => {
    // Close the mobile page menu on navigation
    $page.url.pathname;
    pageMenuOpen = false;
  });

  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchOpen = true;
      }
      if (e.key === 'Escape') pageMenuOpen = false;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<svelte:head>
  <meta name="robots" content="index, follow" />
  <!-- Every docs page has a plain-markdown twin at the same URL + ".md" — how agents find it. -->
  <link rel="alternate" type="text/markdown" href={$page.url.pathname.replace(/\/$/, '') + '.md'} />
  {@html `<script type="application/ld+json">${breadcrumbJsonLd}</script>`}
</svelte:head>

<!-- Top bar -->
<div class="fixed top-0 left-0 right-0 z-40 h-14 px-4 sm:px-6 bg-background/80 backdrop-blur-[20px] border-b border-border flex items-center justify-between gap-2 sm:gap-4">
  <div class="flex items-center gap-4 min-w-0">
    <a
      href={lp('/')}
      class="docs-brand flex items-center gap-2.5 no-underline text-foreground shrink-0"
      aria-label={$_('landing.nav.brandAria')}
    >
      <BrandMark size={40} />
      <span class="docs-brand-wordmark text-[15px] font-medium tracking-[-0.035em]">{$_('docs.layout.s42')}</span>
      <span class="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground bg-muted border border-border rounded-md px-1.5 py-0.5">{$_('docs.layout.s43')}</span>
    </a>
    <div class="w-px h-5 bg-border hidden sm:block"></div>
    <a href={lp('/')} class="hidden sm:inline text-[13px] text-muted-foreground no-underline hover:text-foreground transition-colors whitespace-nowrap">{$_('docs.layout.s44')}</a>
  </div>

  <div class="flex items-center gap-0.5 bg-muted border border-border rounded-lg p-[3px] shrink-0">
    <a
      href={lp('/docs')}
      class={cn(
        'text-[12px] sm:text-[12.5px] font-semibold py-[5px] px-2.5 sm:px-3.5 rounded-md no-underline transition-all',
        !isApiPage
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <span class="md:hidden">{$_('docs.layout.s53')}</span>
      <span class="hidden md:inline">{$_('docs.layout.s45')}</span>
    </a>
    <a
      href={lp('/docs/api')}
      class={cn(
        'text-[12px] sm:text-[12.5px] font-semibold py-[5px] px-2.5 sm:px-3.5 rounded-md no-underline transition-all',
        isApiPage
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <span class="md:hidden">{$_('docs.layout.s54')}</span>
      <span class="hidden md:inline">{$_('docs.layout.s46')}</span>
    </a>
  </div>

  <div class="flex items-center gap-2 sm:gap-3 shrink-0">
    <button
      type="button"
      class="flex items-center gap-2 bg-muted border border-border rounded-lg px-2.5 sm:px-3 py-1.5 min-w-0 sm:min-w-[200px] text-[13px] text-muted-foreground cursor-pointer hover:border-muted-foreground/50 transition-colors text-left"
      onclick={() => (searchOpen = true)}
      aria-label={$_('docs.layout.s47')}
    >
      <svg class="w-3.5 h-3.5 opacity-50 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <span class="truncate hidden sm:inline">{$_('docs.layout.s47')}</span>
      <kbd class="ml-auto text-[11px] bg-background border border-border rounded px-1.5 text-muted-foreground hidden sm:inline">⌘K</kbd>
    </button>
    <LangToggle />
  </div>
</div>

<!-- Mobile page picker -->
<div class="fixed top-14 left-0 right-0 z-30 h-11 lg:hidden border-b border-border bg-background/95 backdrop-blur-[20px]">
  <button
    type="button"
    class="flex h-full w-full items-center gap-2 px-4 text-left text-[13px] text-foreground cursor-pointer"
    aria-expanded={pageMenuOpen}
    aria-controls="docs-mobile-page-menu"
    aria-label={$_('docs.layout.s55')}
    onclick={() => (pageMenuOpen = !pageMenuOpen)}
  >
    <span class="min-w-0 flex-1 truncate font-medium">{currentNavTitle}</span>
    <svg
      class={cn('w-4 h-4 shrink-0 text-muted-foreground transition-transform', pageMenuOpen && 'rotate-180')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </button>

  {#if pageMenuOpen}
    <button
      class="fixed inset-0 top-[6.25rem] z-[-1] bg-black/20"
      type="button"
      aria-label={$_('docs.layout.s40')}
      onclick={() => (pageMenuOpen = false)}
    ></button>
    <div
      id="docs-mobile-page-menu"
      class="absolute left-0 right-0 top-full max-h-[min(70vh,28rem)] overflow-y-auto border-b border-border bg-background shadow-lg"
      role="listbox"
      aria-label={$_('docs.layout.s55')}
    >
      {#each NAV as group}
        <div class="px-2 py-2">
          <div class="px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {group.label}
          </div>
          {#each group.items as item}
            <button
              type="button"
              role="option"
              aria-selected={item.href === currentNavHref}
              class={cn(
                'flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors cursor-pointer',
                item.href === currentNavHref
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'
              )}
              onclick={() => onMobilePageChange(item.href)}
            >
              {item.title}
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

<DocsSearch bind:open={searchOpen} items={searchItems} />

<!-- Mobile scrim -->
{#if sidebarOpen}
  <button class="fixed inset-0 z-[19] bg-black/30" type="button" aria-label={$_('docs.layout.s40')} onclick={() => (sidebarOpen = false)}></button>
{/if}

<div class="flex min-h-screen pt-14 max-lg:pt-[6.25rem]">
  <!-- Sidebar -->
  <aside class={cn(
    'fixed top-14 left-0 bottom-0 w-[260px] overflow-y-auto bg-background border-r border-border py-5 z-20',
    'max-lg:-translate-x-full max-lg:transition-transform max-lg:duration-200',
    sidebarOpen && 'max-lg:translate-x-0'
  )}>
    {#each NAV as group}
      <div class="px-3 mb-5">
        <div class="text-[11px] font-bold tracking-[0.06em] uppercase text-muted-foreground px-2 pb-2">{group.label}</div>
        {#each group.items as item}
          <a
            href={lp(item.href)}
            class={cn(
              'flex items-center gap-2 py-[7px] px-2.5 rounded-lg text-sm no-underline transition-colors',
              isActive(item.href, $page.url.pathname)
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'
            )}
            onclick={() => (sidebarOpen = false)}
          >
            {#if item.siIcon}
              <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d={item.siIcon.path} /></svg>
            {/if}
            {item.title}
          </a>
        {/each}
      </div>
    {/each}

    <div class="mt-auto px-5 py-4 border-t border-border">
      <a href={lp('/docs/api')} class="flex items-center gap-2 text-[13px] text-muted-foreground no-underline hover:text-foreground transition-colors">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        {$_('docs.layout.s49')}
      </a>
    </div>
  </aside>

  <!-- Content -->
  <main class="docs-prose flex-1 ml-[260px] mr-[220px] max-w-[760px] py-12 px-12 pb-24 max-xl:mr-0 max-lg:ml-0 max-lg:px-5 max-lg:py-6 max-lg:pb-16">
    {@render children()}
    <DocsPager prev={pager.prev} next={pager.next} />
  </main>

  <!-- Right sidebar — On this page -->
  <nav class="fixed top-14 right-0 bottom-0 w-[220px] overflow-y-auto py-8 px-6 max-xl:hidden" aria-label={$_('docs.layout.s41')}>
    <div class="text-[11px] font-bold tracking-[0.06em] uppercase text-muted-foreground mb-3">{$_('docs.layout.s50')}</div>
    {#if $toc.length}
      {#each $toc as item}
        <a href={item.href} class="block py-1 text-[13px] text-muted-foreground no-underline border-l-2 border-transparent pl-2.5 hover:text-foreground transition-colors">{item.title}</a>
      {/each}
    {:else}
      <span class="text-[13px] text-muted-foreground/50">{$_('docs.layout.s51')}</span>
    {/if}
  </nav>
</div>

<style>
  /* BrandMark is a wide mark (viewBox ~2:1). Keep width dominant so it reads like the homepage nav. */
  .docs-brand :global(.brandmark) {
    width: 40px;
    height: 20px;
  }
  @media (max-width: 480px) {
    .docs-brand-wordmark {
      display: none;
    }
  }
</style>
