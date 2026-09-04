<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { navigating } from '$app/state';
  import CookieBanner from '$lib/components/CookieBanner.svelte';
  import AppEntryShimmer from '$lib/components/AppEntryShimmer.svelte';
  import {
    identifyUser,
    loadMetaPixel,
    loadSeline,
    setAnalyticsOptOut,
    setInternalViewer,
    trackBookingClicks
  } from '$lib/analytics';
  import { initConsentForRegion } from '$lib/consent';
  let { children, data } = $props();

  // Guard "chi sta guardando": il server ha già deciso (root +layout.server.ts), qui arriva solo il
  // booleano. Impostato SUBITO, fuori da un $effect: CookieBanner è un figlio e il suo onMount gira
  // prima degli effect di questo layout — se aspettassimo, PostHog sarebbe già stato schedulato.
  // L'effect serve solo a seguire il cambio di sessione (login/logout) durante la navigazione.
  setAnalyticsOptOut(data?.analyticsOptOut === true);
  $effect(() => {
    setAnalyticsOptOut(data?.analyticsOptOut === true);
  });

  // Stesso guard per Sentry: i giri di prova del founder in produzione non devono diventare
  // sessioni, transazioni o replay veri. Sentry è già partito quando arriviamo qui (hooks.client),
  // quindi il flag non impedisce l'init: scarta gli eventi in beforeSend* e impedisce che la
  // registrazione della sessione venga mai agganciata (che arriva alla prima interazione o dopo
  // 8–10s, quindi molto dopo questa riga). L'effect segue login/logout senza ricaricare la pagina.
  setInternalViewer(data?.internalViewer === true);
  $effect(() => {
    setInternalViewer(data?.internalViewer === true);
  });

  // Seline (page view, cookieless): prima stava come tag in app.html, dove partiva sempre. Chiamato
  // su ogni pagina come prima — blog compresi — ma ora passa dai guard di $lib/analytics.
  $effect(() => {
    loadSeline();
  });

  /** Non-brand /app shells that already own their own UI (don't cover with entry shimmer). */
  const APP_RESERVED = new Set(['onboarding', 'api-keys']);

  function appNavScope(pathname: string): string | null {
    if (pathname === '/app') return 'app-root';
    const m = pathname.match(/^\/app\/([^/]+)/);
    if (!m) return null;
    if (APP_RESERVED.has(m[1])) return m[1];
    return `brand:${m[1]}`;
  }

  // Optimistic entry into the app: show the destination shell immediately while loads /
  // redirect chains (/app → /app/[brand]) finish. Same-brand navigations keep using the
  // brand layout's WorkbenchPageShimmer instead.
  const showAppEntry = $derived.by(() => {
    const to = navigating.to?.url.pathname;
    if (!to) return false;
    const from = navigating.from?.url.pathname ?? $page.url.pathname;
    if (to.startsWith('/app')) {
      const fromScope = appNavScope(from);
      const toScope = appNavScope(to);
      if (fromScope && toScope && fromScope === toScope) return false;
      return true;
    }
    // Logged-in Start → /login always bounces to /app; cover that hop too.
    if ((to === '/login' || to.startsWith('/login/')) && data?.session) return true;
    return false;
  });

  // Global navigation feedback: without it, any server-load wait reads as "the click did
  // nothing". Shown only when a navigation outlives 150ms so instant navs never flash a bar.
  // Suppressed while the full app-entry shell is up (avoids double chrome).
  let navBar = $state(false);
  $effect(() => {
    if (!navigating.to || showAppEntry) { navBar = false; return; }
    const t = setTimeout(() => (navBar = true), 150);
    return () => { clearTimeout(t); navBar = false; };
  });

  // Public brand blogs (custom domain / default path / preview) are served on the BRAND's turf —
  // never load Anomalia's cookie banner or its (PostHog) analytics there. CookieBanner is what starts
  // anonymous analytics, so suppressing it keeps the brand's blog tracking-free by default.
  const isBlog = $derived(
    !!$page.route.id && (
      $page.route.id.startsWith('/_site') ||
      $page.route.id.startsWith('/blog/[site]') ||
      $page.route.id.startsWith('/blog-preview')
    )
  );

  // Stitch the anonymous session to the logged-in user so product events (onboarding, etc.) form a
  // per-user funnel. First-party, authenticated use only. Re-runs if the session changes client-side.
  $effect(() => {
    const user = data?.session?.user as { id?: string; email?: string } | undefined;
    if (user?.id) identifyUser(user.id, user.email ? { email: user.email } : undefined);
  });

  // Meta Pixel: on the app it loads immediately (unchanged behaviour, minus the app.html inline).
  // On brand blogs it must NOT fire here — the blog's own cookie banner loads it only on consent.
  $effect(() => { if (!isBlog) { loadMetaPixel(); trackBookingClicks(); } });

  // Cookie banner is region-gated: EEA/UK/CH visitors are asked for consent, everyone else gets
  // full analytics with no banner. Skipped on brand blogs (no Anomalia analytics there at all).
  $effect(() => { if (!isBlog) initConsentForRegion(data?.country); });

  // Resolve the colour theme for EVERY page (not just ones with the marketing nav): read the
  // saved choice or fall back to the OS preference, set data-theme, and keep it synced across
  // tabs via the `storage` event. The SiteNav toggle just writes localStorage; this applies it.
  $effect(() => {
    if (typeof window === 'undefined') return;
    const resolve = () => {
      const saved = localStorage.getItem('theme');
      const t = saved === 'light' || saved === 'dark'
        ? saved
        : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', t);
    };
    resolve();
    function onStorage(e: StorageEvent) { if (e.key === 'theme') resolve(); }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  });

  // Web MCP: espone al browser gli stessi strumenti che il server MCP espone a un client esterno,
  // generati dal registry. Un agente che gira nella pagina lavora sul brand aperto con la sessione
  // di chi sta guardando — nessuna chiave API, nessun nostro server nel mezzo.
  //
  // Il rilevamento sta QUI e non nel modulo: senza `document.modelContext` — cioè in ogni browser
  // che non abbia l'origin trial acceso o un polyfill montato — l'import non parte, e né zod né i
  // descrittori entrano nel bundle. Costo zero finché la specifica non c'è.
  //
  // Il segnale toglie tutto: cambiando brand si abortisce il precedente, o un agente vedrebbe gli
  // strumenti di due brand con lo stesso nome.
  $effect(() => {
    const scope = appNavScope($page.url.pathname);
    const token = (data?.session as { access_token?: string } | undefined)?.access_token;
    if (!scope?.startsWith('brand:') || !token) return;
    if (typeof document === 'undefined' || !('modelContext' in document)) return;

    const brand = scope.slice('brand:'.length);

    const abort = new AbortController();
    import('$lib/webmcp')
      .then(({ registerBrandWebMcp }) => registerBrandWebMcp(brand, token, abort.signal))
      .catch((error) => console.warn('web mcp registration failed', error));
    return () => abort.abort();
  });

  // Mark the app shell so marketing CSS (e.g. landing.css `section { padding: 110px }`)
  // does not leak onto /app routes after SPA navigation. Also mark while the optimistic
  // app-entry overlay is up (URL still points at marketing during the load).
  $effect(() => {
    if (typeof document === 'undefined') return;
    const path = $page.url.pathname;
    const isApp =
      showAppEntry ||
      path.startsWith('/app') ||
      path === '/start' ||
      path.startsWith('/start/');
    if (isApp) document.documentElement.setAttribute('data-shell', 'app');
    else document.documentElement.removeAttribute('data-shell');
  });
</script>

{#if navBar}
  <div class="nav-progress" aria-hidden="true"></div>
{/if}

{#if showAppEntry}
  <AppEntryShimmer />
{/if}

{@render children()}
{#if !isBlog}<CookieBanner />{/if}

<style>
  /* Indeterminate top progress bar: sprints to ~80% then crawls, so long loads still feel alive.
     Uses the theme accent when defined, falls back to a neutral that works in both themes. */
  .nav-progress {
    position: fixed;
    top: 0;
    left: 0;
    height: 3px;
    width: 100%;
    z-index: 9999;
    pointer-events: none;
    background: var(--accent, #6366f1);
    transform-origin: left;
    animation: nav-progress-grow 8s cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
  }
  /* Thicker on mobile so a tap → wait is obvious under a thumb. */
  @media (max-width: 1023px) {
    .nav-progress {
      height: 4px;
    }
  }
  @keyframes nav-progress-grow {
    0% { transform: scaleX(0); }
    10% { transform: scaleX(0.4); }
    30% { transform: scaleX(0.8); }
    100% { transform: scaleX(0.98); }
  }
</style>
