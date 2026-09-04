<script lang="ts">
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import DashboardSidebar, { type NavGroup } from '$lib/components/DashboardSidebar.svelte';
  import SettingsSidebar from '$lib/components/SettingsSidebar.svelte';
  import PageRailDrawer from '$lib/components/PageRailDrawer.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import House from '@lucide/svelte/icons/house';
  import Images from '@lucide/svelte/icons/images';
  import Target from '@lucide/svelte/icons/target';
  import CalendarDays from '@lucide/svelte/icons/calendar-days';
  import BarChart3 from '@lucide/svelte/icons/chart-column';
  import Radio from '@lucide/svelte/icons/radio';
  import Search from '@lucide/svelte/icons/search';
  import Newspaper from '@lucide/svelte/icons/newspaper';
  import Bot from '@lucide/svelte/icons/bot';
  import { setCredits, refreshCredits } from '$lib/stores/credits';
  import WarningCenter from '$lib/components/WarningCenter.svelte';
  import WorkbenchPageShimmer from '$lib/components/WorkbenchPageShimmer.svelte';
  import PlanSidePanel from '$lib/components/PlanSidePanel.svelte';
  import PageTopBar from '$lib/components/PageTopBar.svelte';
  import { IsMobile, SHELL_MOBILE_BREAKPOINT } from '$lib/hooks/is-mobile.svelte';
  import { closePlanPanel } from '$lib/stores/plan-panel';
  import { NAV_TEAM_SPACES, workbenchPageHref, type NavTeamItem } from '$lib/workbench-paths';
  import {
    SHELL_LAYOUT,
    readSidebarPanePx,
    writeSidebarPanePx,
  } from '$lib/shell-prefs';
  import { warningCenterOpen, warningCounts, type AppWarning } from '$lib/warnings';
  import { browser } from '$app/environment';
  import { beforeNavigate } from '$app/navigation';
  import { navigating } from '$app/state';
  import { onDestroy } from 'svelte';
  import { brandChannel } from '$lib/realtime/brand-channel.svelte';
  import { get } from 'svelte/store';
  import { appBrandSlug, shellShimmerFor } from '$lib/shell-nav';
  import { hasAds, hasWebHub } from '$lib/plans';
  let { data, children } = $props();

  const base = $derived(`/app/${data.brand.slug}`);
  const isMobile = new IsMobile(SHELL_MOBILE_BREAKPOINT);
  // Web hub + Radar/Leads sono gratis (piano Go). Ads resta solo Pro.
  const webHubEnabled = $derived(hasWebHub(data.brand?.plan));
  const adsEnabled = $derived(hasAds(data.brand?.plan));
  const path = $derived($page.url.pathname);
  const isPostDash = $derived(/\/posts\/[^/]+\/[^/]+\/?$/.test(path));
  const isArticleEdit = $derived(path.includes('/site/edit'));
  const isFullWidth = $derived(
    path.includes('/success') || path.endsWith('/activate') || isPostDash || isArticleEdit
  );
  const isSettings = $derived(path.includes('/settings'));
  const isBrandRoot = $derived(path === base || path === `${base}/`);
  const isPlanPage = $derived(/\/plans\/[^/]+\/?$/.test(path));
  const isCalendar = $derived(/\/calendar\/?$/.test(path));
  const isLeads = $derived(/\/leads\/?$/.test(path));
  const isMediaWorkbench = $derived(
    /\/(media-generator|ugc-creator|motion-video)\/?$/.test(path)
  );
  // Navigazione ottimistica: shimmer al clic, non alla fine della load. Include i cambi di
  // brand — col solo `base` la pagina del brand vecchio resterebbe visibile per tutta la load.
  const navToPath = $derived(navigating.to?.url.pathname ?? null);
  const brandSwitchPending = $derived.by(() => {
    const toBrand = appBrandSlug(navToPath);
    return !!toBrand && toBrand !== data.brand.slug;
  });
  // Quale scheletro, e se disegnarlo: la regola sta in `$lib/shell-nav`, sotto test.
  const shimmer = $derived(
    shellShimmerFor({
      from: navigating.from?.url.pathname,
      to: navToPath,
      fromSearch: navigating.from?.url.search ?? '',
      toSearch: navigating.to?.url.search ?? '',
      brandSlug: data.brand.slug
    })
  );
  const shellNavigating = $derived(shimmer !== null);
  const shimmerVariant = $derived(shimmer ?? 'page');
  const navToFlush = $derived(shimmerVariant === 'calendar' || shimmerVariant === 'media');

  const showPageTopBar = $derived(true);

  $effect(() => {
    if (isFullWidth || isSettings || isPlanPage) closePlanPanel();
  });

  // Badge/avvisi/quota arrivano in differita (`data.deferred`). Si TIENE il valore precedente
  // mentre la promessa nuova è pendente, o a ogni clic lampeggia uno scheletro.
  type Extras = {
    pendingCount: number;
    leadsPendingCount: number;
    socialAccountCount: number;
    credits: { used: number; quota: number; remaining: number; percent: number; periodEnd: string };
    userName: string;
    userEmail: string | null;
    userAvatarUrl: string | null;
    userId: string;
    strategySetup: { gtm: boolean; plan: boolean; ops: boolean };
    studioPct: number;
    editorialPlanWeeks: { index: number; theme?: string }[];
    warnings: AppWarning[];
    radarEnabled: boolean;
    hasGeoAudit: boolean;
    gscConnected?: boolean;
  };
  let extras = $state<Extras | null>(null);
  $effect(() => {
    // Solo la promessa della navigazione CORRENTE può scrivere: una vecchia e lenta
    // sovrascriverebbe i badge freschi (e dopo un cambio brand punterebbe al brand di prima).
    const p = data.deferred;
    p.then((v) => {
      if (p === data.deferred) {
        extras = v;
        if (v?.credits) setCredits(v.credits);
      }
    }).catch(() => {});
  });

  function resetBrandClientState() {
    extras = null;
    setCredits(null);
    closePlanPanel();
  }

  // Si butta lo stato del brand appena parte il cambio, PRIMA che arrivino i dati nuovi, o
  // thread/overview/crediti lampeggiano con quelli del brand vecchio.
  beforeNavigate(({ from, to }) => {
    if (!from || !to) return;
    const fromBrand = appBrandSlug(from.url.pathname);
    const toBrand = appBrandSlug(to.url.pathname);
    if (fromBrand && toBrand && fromBrand !== toBrand) resetBrandClientState();
  });

  // Un canale Realtime privato per tutta la shell: la presence in topbar. `extras` è un
  // oggetto nuovo a ogni navigazione, quindi questo effect
  // rigira di continuo: connect() è idempotente per brand e chiude il socket solo quando il
  // brand cambia davvero. Un cleanup restituito da qui riconnetterebbe a ogni cambio pagina.
  $effect(() => {
    const brandId = data.brandId;
    const me = extras;
    if (!browser || !brandId || !me?.userId) return;
    void brandChannel.connect(brandId, data.brand.slug, {
      userId: me.userId,
      name: me.userName,
      avatar: me.userAvatarUrl
    });
  });

  // Uscendo dalla shell si molla la presence, o i compagni vedono un fantasma finché il socket
  // non scade da solo.
  onDestroy(() => brandChannel.disconnect());

  $effect(() => {
    brandChannel.setLocation(path, null);
  });

  // Poll dei crediti per intercettare il lavoro in sottofondo (autopilot, cron radar).
  $effect(() => {
    const slug = data.brand?.slug;
    if (!slug) return;
    let active = true;
    const tick = () => {
      if (active && document.visibilityState === 'visible') refreshCredits(slug);
    };
    const id = setInterval(tick, 45000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  });

  const adsOn = $derived(!!data.flags?.ads);

  function isSubActive(href: string) {
    return path === href || path.startsWith(`${href}/`);
  }
  const initials = $derived((data.brand.name ?? '?').slice(0, 2).toUpperCase());
  const userInitials = $derived(
    (extras?.userName ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w: string) => w[0])
      .join('')
      .toUpperCase() || '?'
  );

  // La STRUTTURA (path + chiavi) vive in workbench-paths.ts, pura e testata: qui si aggiunge
  // solo ciò che quel modulo non può sapere — href col piano del brand, attivo, badge, etichette.
  function navTeamItem(t: NavTeamItem, icon?: any) {
    const segment = t.path.replace(/^\//, '');
    return {
      href: segment ? workbenchPageHref(data.brand.slug, segment, webHubEnabled, adsEnabled) : base,
      label: $_(t.labelKey),
      icon,
      // La home non ha segmento, e `isSubActive(base)` sarebbe vero su OGNI pagina del brand:
      // per lei conta solo l'uguaglianza esatta, il resto lo dicono gli `also`.
      active:
        (segment ? isSubActive(`${base}${t.path}`) : path === base) ||
        (t.also ?? []).some((p) => isSubActive(`${base}${p}`)),
      key: t.path || 'home',
      badge:
        t.badge === 'content'
          ? (extras?.pendingCount ?? 0)
          : t.badge === 'leads'
            ? (extras?.leadsPendingCount ?? 0)
            : undefined
    };
  }
  const SPACE_ICONS = [House, Images, Target, CalendarDays, Search, Newspaper, Radio, Bot, BarChart3];
  // Una sola sezione, senza intestazione: sei voci non hanno bisogno di essere raggruppate, e
  // «Impostazioni» non e' una riga — e' l'ingranaggio in fondo alla barra, che ha gia' il suo
  // nome accessibile (`aria-label` + `title` in DashboardSidebar).
  function teamSidebarGroups(): NavGroup[] {
    return [{ items: NAV_TEAM_SPACES.map((t, i) => navTeamItem(t, SPACE_ICONS[i])) }];
  }

  const sidebarGroups = $derived(teamSidebarGroups());

  const SIDEBAR_W_MIN = SHELL_LAYOUT.SIDEBAR_W_MIN;
  const SIDEBAR_W_MAX = SHELL_LAYOUT.SIDEBAR_W_MAX;
  let sidebarPanePx = $state(browser ? readSidebarPanePx() : SHELL_LAYOUT.SIDEBAR_W_DEFAULT);
  let resizingSidebar = $state(false);

  function clampSidebarW(px: number) {
    return Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, Math.round(px)));
  }

  function onSidebarResizeStart(e: PointerEvent) {
    e.preventDefault();
    resizingSidebar = true;
    const startX = e.clientX;
    const startW = sidebarPanePx;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      sidebarPanePx = clampSidebarW(startW + (ev.clientX - startX));
    };
    const onUp = (ev: PointerEvent) => {
      resizingSidebar = false;
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      writeSidebarPanePx(sidebarPanePx);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }
</script>

<div class="page">
{#if isFullWidth && !brandSwitchPending}
  {@render children()}
{:else if isSettings && !brandSwitchPending}
<Sidebar.Provider
  locked
  style="--sidebar-width: 18.5rem; --sidebar-width-icon: 3.25rem;"
>
  <!-- Su mobile le impostazioni le naviga `PageRailDrawer`, non questa sidebar. -->
  {#if !isMobile.current}
    <SettingsSidebar
      brandName={data.brand.name}
      brandInitials={initials}
      logoUrl={data.logoUrl ?? ''}
      brandHref={base}
      settingsBase={`${base}/settings`}
    />
  {/if}

  <Sidebar.Inset class="bg-[var(--paper-2)] border-0">
    <div class="main">
      <PageTopBar visible={showPageTopBar} warnings={extras?.warnings ?? []} showDesktopCollapse={false} />
      <div class="wb-frame">
        <div class="content-shell">
          {#if shellNavigating && navToPath?.includes('/settings')}
            <WorkbenchPageShimmer variant="page" />
          {:else}
            {@render children()}
          {/if}
        </div>
      </div>
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
{:else}
<Sidebar.Provider
  class={resizingSidebar ? 'sidebar-resizing' : undefined}
  style={`--sidebar-width: ${sidebarPanePx}px; --sidebar-width-icon: 3.25rem;`}
>
  <DashboardSidebar
    brandName={data.brand.name}
    brandWebsite={data.brand.website ?? data.brand.slug}
    brandInitials={initials}
    logoUrl={data.logoUrl ?? ''}
    brandHref="/app"
    navGroups={sidebarGroups}
    settingsHref={`${base}/settings`}
    settingsLabel={$_('app.nav.settings')}
    userName={extras?.userName ?? ''}
    userEmail={extras?.userEmail ?? ''}
    userAvatarUrl={extras?.userAvatarUrl ?? ''}
    userInitials={userInitials}
    userStatus={data.brand.status}
    brandPlan={data.brand.plan ?? ''}
    signOutLabel={$_('app.account.signOut')}
    brandSlug={data.brand.slug}
    forceOpenMobile={false}
    checklist={{
      active: data.brand?.status === 'active' || data.brand?.status === 'trial',
      studioPct: extras?.studioPct ?? 0,
      hasStrategy: extras?.strategySetup?.gtm ?? false,
      hasEditorialPlan: extras?.strategySetup?.plan ?? false,
      blogEnabled: !!(data.brand?.blog_config as { enabled?: boolean } | null)?.enabled,
      radarEnabled: extras?.radarEnabled ?? false,
      hasGeoAudit: extras?.hasGeoAudit ?? false,
      gscConnected: extras?.gscConnected ?? true
    }}
    switcherBrands={data.switcherBrands ?? []}
  />
  {#if !isMobile.current}
    <div
      class="sidebar-split-handle"
      class:is-resizing={resizingSidebar}
      role="separator"
      aria-orientation="vertical"
      aria-label={$_('app.shell.resizeSidebar')}
      aria-valuenow={sidebarPanePx}
      aria-valuemin={SIDEBAR_W_MIN}
      aria-valuemax={SIDEBAR_W_MAX}
      tabindex="0"
      onpointerdown={onSidebarResizeStart}
    ></div>
  {/if}

    <Sidebar.Inset class="bg-[var(--paper-2)] border-0">
      <div class="main">
        <!-- `isBrandRoot` è la STESSA condizione che monta il composer, non una stringa
             ricalcolata dentro la topbar. -->
        <PageTopBar
          visible={showPageTopBar}
          warnings={extras?.warnings ?? []}
          showStatus={isBrandRoot}
        />
        {#key data.brandId}
          {#if shellNavigating}
            <div class="wb-frame">
              <div
                class="content-shell"
                class:calendar-flush={navToFlush}
              >
                <WorkbenchPageShimmer variant={shimmerVariant} />
              </div>
            </div>
          {:else}
            <div class="wb-frame">
              <div
                class="content-shell"
                class:calendar-flush={isCalendar || isMediaWorkbench}
                class:editor-wide={isArticleEdit}
                class:leads-flush={isLeads}
              >
                {@render children()}
              </div>
            </div>
          {/if}
        {/key}
      </div>
    </Sidebar.Inset>
</Sidebar.Provider>
<PlanSidePanel />
{/if}

<WarningCenter warnings={extras?.warnings ?? []} brandSlug={data.brand?.slug ?? ''} />

<PageRailDrawer {base} enabled={isMobile.current && !isFullWidth} />

<!-- Montata una volta per tutto il brand, fuori dai rami settings/full-width: le scorciatoie
     devono valere ovunque. -->
<CommandPalette {base} brandSlug={data.brand.slug} navGroups={sidebarGroups} />

</div>

<style>
  .page {
    background: var(--paper-2);
    min-height: 100dvh;
  }
  .sidebar-split-handle {
    display: none;
    position: fixed;
    top: 0;
    bottom: 0;
    left: var(--sidebar-width);
    width: 5px;
    margin-left: -2px;
    z-index: 30;
    cursor: col-resize;
    touch-action: none;
    background: transparent;
  }
  .sidebar-split-handle::after {
    content: '';
    position: absolute;
    inset: 0 -3px;
  }
  .sidebar-split-handle:hover,
  .sidebar-split-handle.is-resizing {
    background: color-mix(in srgb, var(--accent) 35%, var(--line));
  }
  @media (min-width: 1024px) {
    :global(.group\/sidebar-wrapper:not(:has([data-collapsible='icon']))) .sidebar-split-handle {
      display: block;
    }
  }
  :global(.group\/sidebar-wrapper.sidebar-resizing [data-slot='sidebar-gap']),
  :global(.group\/sidebar-wrapper.sidebar-resizing [data-slot='sidebar-container']) {
    transition: none !important;
  }
  /* Si dipinge solo il GUSCIO della sidebar: colorare ogni discendente [data-sidebar] rende
     ogni riga un chip opaco più scuro sul rail. */
  :global([data-slot="sidebar-gap"]) {
    background: var(--sidebar-bg, var(--paper-2)) !important;
    border: 0 !important;
    box-shadow: none !important;
    outline: none !important;
  }
  :global([data-sidebar='sidebar']),
  :global([data-slot='sidebar-inner']) {
    background: var(--sidebar-bg, var(--paper-2)) !important;
    border: 0 !important;
  }
  /* Il filo che stacca la sidebar dalla pagina, nel token dichiarato per la sua cornice
     (`--sidebar-line`, che è `--line` e si inverte da solo in scuro). Sta sul GUSCIO e non
     sull'inner, che qui sopra azzera il bordo; e sta qui e non sulla maniglia di resize, che
     esiste solo da desktop in su e sparisce col rail a icone — un bordo che c'è solo a volte
     non è un bordo. */
  :global([data-slot='sidebar-container']) {
    border-right: 1px solid var(--sidebar-line);
  }
  /* I riempimenti delle righe nav vivono sulle varianti di MenuButton (utility Tailwind in
     layer): da qui, fuori layer, non si sovrascrivono. Non provarci. */
  :global([data-slot="sidebar-container"]) {
    box-shadow: none !important;
    outline: none !important;
  }
  :global([data-slot="sidebar-inset"]) {
    border: 0 !important;
    box-shadow: none !important;
    min-width: 0 !important;
  }
  :global([data-mobile="true"][data-slot="sheet-content"]),
  :global([data-mobile="true"][data-sidebar="sidebar"]) {
    width: 85vw !important;
    max-width: 85vw !important;
    height: 100% !important;
    inset: 0 auto 0 0 !important;
    border-right: 1px solid var(--line) !important;
    box-shadow: 8px 0 32px -12px color-mix(in srgb, #000 28%, transparent) !important;
    outline: none !important;
  }
  :global([data-full-bleed="true"][data-slot="sheet-content"]) {
    inset: 0 !important;
    width: 100% !important;
    max-width: none !important;
    height: 100% !important;
    border: 0 !important;
    border-right-width: 0 !important;
    box-shadow: none !important;
    outline: none !important;
  }
  .main {
    height: 100dvh;
    margin: 0;
    border-radius: 0;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    overflow-y: auto;
    overflow-x: hidden;
    border: 0;
    min-width: 0;
    will-change: auto;
    contain: layout style;
  }
  .wb-frame {
    min-width: 0;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
    container-name: workbench;
  }
  .content-shell {
    width: 100%;
    max-width: var(--content-max, 960px);
    margin-inline: auto;
    padding: var(--content-pad-top, 32px) var(--content-pad-x, 20px) var(--content-pad-bottom, 64px);
    box-sizing: border-box;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .content-shell.calendar-flush {
    max-width: none;
    padding: 0;
  }
  .content-shell.leads-flush {
    max-width: none;
  }
  .content-shell.editor-wide {
    max-width: 1400px;
  }
  .content-shell :global(.editor-page),
  .content-shell :global(.media-page),
  .content-shell :global(.knowledge-page),
  .content-shell :global(.settings-shell),
  .content-shell :global(.home-wb),
  .content-shell :global(.lab),
  .content-shell :global(.mg-page),
  .content-shell :global(.wb-shimmer) {
    max-width: none !important;
    width: 100%;
    margin-inline: 0;
    padding: 0 !important;
    border-radius: 0 !important;
  }

  @media (max-width: 1023px) {
    .main {
      height: 100dvh;
      margin: 0;
      border-radius: 0;
    }
    .content-shell {
      max-width: none;
    }
  }
</style>
