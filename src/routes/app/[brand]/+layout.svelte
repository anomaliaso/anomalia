<script lang="ts">
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import DashboardSidebar, { type NavGroup } from '$lib/components/DashboardSidebar.svelte';
  import SettingsSidebar from '$lib/components/SettingsSidebar.svelte';
  import PageModal from '$lib/components/PageModal.svelte';
  import PageRailDrawer from '$lib/components/PageRailDrawer.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import ChatReplyNotifications from '$lib/components/ChatReplyNotifications.svelte';
  import Send from '@lucide/svelte/icons/send';
  import Layers from '@lucide/svelte/icons/layers';
  import Globe from '@lucide/svelte/icons/globe';
  import Zap from '@lucide/svelte/icons/zap';
  import CalendarDays from '@lucide/svelte/icons/calendar-days';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Wrench from '@lucide/svelte/icons/wrench';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { setCredits, refreshCredits } from '$lib/stores/credits';
  import WarningCenter from '$lib/components/WarningCenter.svelte';
  import ChatColumn from '$lib/components/ChatColumn.svelte';
  import WorkbenchPageShimmer from '$lib/components/WorkbenchPageShimmer.svelte';
  import PlanSidePanel from '$lib/components/PlanSidePanel.svelte';
  import PageTopBar from '$lib/components/PageTopBar.svelte';
  import { clearPageMeta, setPageMeta } from '$lib/stores/page-meta';
  import { IsMobile, SHELL_MOBILE_BREAKPOINT } from '$lib/hooks/is-mobile.svelte';
  import { closePlanPanel } from '$lib/stores/plan-panel';
  import {
    HUB_TABS,
    NAV_TEAM_SPACES,
    NAV_TEAM_TOOLS,
    workbenchPageHref,
    type NavTeamItem,
    type WorkbenchPageHub
  } from '$lib/workbench-paths';
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
  import { chatThreadId, chatThreads, markThreadUnread, refreshThreads, unreadThreadIds } from '$lib/stores/chat';
  import { appBrandSlug, isThreadPath, shellShimmerFor } from '$lib/shell-nav';
  import { roomMemberKeys, threadIdentity, type ThreadIdentitySource } from '$lib/thread-identity';
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
  const showComposer = $derived(
    isBrandRoot &&
      !isFullWidth &&
      !isSettings &&
      !path.includes('/success') &&
      !path.includes('/proposal') &&
      !path.includes('/site/edit') &&
      !path.includes('/image-generator') &&
      !path.includes('/activate')
  );
  const isChatThread = $derived(isThreadPath(path));
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

  // Stessa fonte della sidebar ($chatThreads), così topbar e riga della lista mostrano PER
  // COSTRUZIONE lo stesso nome. Su deep link si ripiega su $page.data.thread, che non ha il
  // nome dei custom agent: si colma al primo refresh della lista.
  const activeThreadForMeta = $derived.by(() => {
    const tid = $chatThreadId;
    if (!tid) return null;
    const fromList = $chatThreads.find((t) => t.id === tid);
    if (fromList) return fromList;
    const fromPage = ($page.data as { thread?: ThreadIdentitySource & { id?: string } }).thread;
    return fromPage && fromPage.id === tid ? fromPage : null;
  });

  $effect(() => {
    if (isChatThread) {
      // Il topbar di una chat è l'AGENTE del thread e basta, come in una lista di messaggi.
      const t = activeThreadForMeta;
      if (t) {
        const who = threadIdentity(t, (k) => $_(k));
        // Una stanza (≥2 membri) non ha UN agente: nel topbar vanno tutti. Gli avatar sono già
        // risolti dal server (`roomAvatars`), qui non si ricalcola niente.
        const room = roomMemberKeys(t.room_agents).length >= 2 ? (t.agents ?? null) : null;
        setPageMeta({
          title: who.name,
          subtitle: null,
          avatar: { face: who.face, color: who.color },
          avatars: room?.length ? room : null
        });
      } else {
        clearPageMeta();
      }
      return;
    }
    if (showComposer) {
      // SOLO durante la navigazione verso quel thread: un chatThreadId rimasto in giro (tasto
      // indietro) non deve rubare il titolo alla Panoramica.
      const t = activeThreadForMeta;
      const goingToThread = !!t && !!navigating.to?.url.pathname?.endsWith(`/chat/${t.id}`);
      if (t && goingToThread) {
        const who = threadIdentity(t, (k) => $_(k));
        setPageMeta({ title: who.name, avatar: { face: who.face, color: who.color } });
        return;
      }
      // Niente titolo: la home È la chat, e il campo "A" sopra il prompt dice già a chi si scrive.
      clearPageMeta();
    }
  });
  $effect(() => {
    if (isFullWidth || isSettings || isPlanPage) closePlanPanel();
  });

  const isOnboarding = $derived(
    (data as { onboarding?: { status?: string } }).onboarding?.status === 'in_progress'
  );
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

  /** I chip sotto il prompt. I numeri vengono da `extras`, non da HomeOverview: sono gli stessi
   * conteggi, ma viaggiano già su ogni pagina per i badge della sidebar — zero query in più. */
  const homeChips = $derived.by(() => {
    const out: {
      key: string;
      count: number;
      label: string;
      href?: string;
      onclick?: () => void;
    }[] = [];
    const pending = extras?.pendingCount ?? 0;
    if (pending > 0)
      out.push({
        key: 'pending',
        count: pending,
        label: $_('app.home.chips.pending'),
        href: `${base}/workbench`
      });
    const leads = extras?.leadsPendingCount ?? 0;
    if (leads > 0)
      out.push({
        key: 'leads',
        count: leads,
        label: $_('app.home.chips.leads'),
        href: `${base}/leads`
      });
    // Il chip apre il pannello della campanella: un avviso si legge in un posto solo.
    const warn = warningCounts(extras?.warnings ?? []).total;
    if (warn > 0)
      out.push({
        key: 'warnings',
        count: warn,
        label: $_('app.home.chips.warnings'),
        onclick: () => warningCenterOpen.set(true)
      });
    return out;
  });

  function resetBrandClientState() {
    extras = null;
    chatThreadId.set(null);
    chatThreads.set([]);
    unreadThreadIds.set(new Map());
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

  // Un canale Realtime privato per tutta la shell: presence in topbar + il push che aggiorna
  // una chat aperta. `extras` è un oggetto nuovo a ogni navigazione, quindi questo effect
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

  // Il pallino "non letto": si accende solo sul thread che l'utente NON sta guardando. Quello
  // aperto lo segna letto ChatColumn.
  $effect(() => {
    if (!browser) return;
    return brandChannel.onThreadChanged((threadId, hasAssistantReply) => {
      if (!hasAssistantReply || threadId === get(chatThreadId)) return;
      markThreadUnread(threadId);
      void refreshThreads(data.brand.slug);
    });
  });

  // Uscendo dalla shell si molla la presence, o i compagni vedono un fantasma finché il socket
  // non scade da solo.
  onDestroy(() => brandChannel.disconnect());

  // Il thread si traccia a parte dal path: su desktop vive in uno store e non arriva mai nell'URL.
  $effect(() => {
    brandChannel.setLocation(path, $chatThreadId);
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
  // FEATURE_NAV_TEAM: 5 sezioni al posto dei macro-hub. OFF = nav legacy.
  const navTeam = $derived(!!data.flags?.navTeam);

  // Dove porta il clic su una sezione della sidebar: la pagina che si apre davvero ogni giorno,
  // non la panoramica del hub. Lo stato attivo si accende comunque da qualunque figlia.
  const HUB_DEST: Partial<Record<WorkbenchPageHub, string>> = {
    publish: '/calendar',
    web: '/site',
    automations: '/leads'
  };

  // I path restano in inglese: ci puntano i deep link di mail e cron.
  const macros = $derived([
    {
      href: `${base}/brand`,
      key: 'brand' as WorkbenchPageHub,
      icon: Layers,
      studio: true,
      also: [
        `${base}/brand`,
        `${base}/knowledge`,
        `${base}/voice`,
        `${base}/rubrics`
      ],
    },
    {
      href: `${base}/publish`,
      key: 'publish' as WorkbenchPageHub,
      icon: Send,
      badge: 'content' as const,
      also: [
        `${base}/publish`,
        `${base}/calendar`,
        `${base}/campaigns`,
        `${base}/analytics`,
        `${base}/competitors`,
        // Strategia e piano editoriale vivono sotto il Calendario: il hub Social resta aperto.
        `${base}/strategy`,
        `${base}/gtm`,
        `${base}/plan`,
      ],
    },
    {
      // Come Automations: la panoramica è libera, le sottopagine passano da /activate.
      href: `${base}/web`,
      key: 'web' as WorkbenchPageHub,
      icon: Globe,
      also: [`${base}/web`, `${base}/seo`, `${base}/seo-geo`, `${base}/geo`, `${base}/citations`, `${base}/keywords`, `${base}/backlinks`, `${base}/site`],
    },
    // Ads non è una voce di sidebar: le sue pagine restano raggiungibili dalla modal, dai link
    // degli agenti e da ⌘K. Qui sta solo ciò che si apre tutti i giorni.
    {
      href: `${base}/automations`,
      key: 'automations' as WorkbenchPageHub,
      icon: Zap,
      badge: 'leads' as const,
      also: [`${base}/automations`, `${base}/radar`, `${base}/leads`, `${base}/agents`],
    },
    {
      href: `${base}/designer`,
      key: 'designer' as WorkbenchPageHub,
      icon: Sparkles,
      also: [
        `${base}/designer`,
        `${base}/media-generator`,
        `${base}/ugc-creator`,
        `${base}/motion-video`,
        `${base}/media`,
      ],
    },
  ]);

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
      href: workbenchPageHref(data.brand.slug, segment, webHubEnabled, adsEnabled),
      label: $_(t.labelKey),
      icon,
      active: isSubActive(`${base}${t.path}`) || (t.also ?? []).some((p) => isSubActive(`${base}${p}`)),
      key: t.path,
      badge:
        t.badge === 'content'
          ? (extras?.pendingCount ?? 0)
          : t.badge === 'leads'
            ? (extras?.leadsPendingCount ?? 0)
            : undefined
    };
  }
  const SPACE_ICONS = [LayoutGrid, CalendarDays, FolderOpen, Globe];
  function teamSidebarGroups(): NavGroup[] {
    const tools = NAV_TEAM_TOOLS.filter((t) => adsOn || !t.adsOnly);
    return [
      {
        label: $_('app.nav2.spaces'),
        section: true,
        items: [
          ...NAV_TEAM_SPACES.map((t, i) => navTeamItem(t, SPACE_ICONS[i])),
        ]
      },
      {
        label: $_('app.nav2.tools'),
        groupIcon: Wrench,
        items: tools.map((t) => navTeamItem(t))
      },
      {
        items: [
          {
            href: `${base}/settings`,
            label: $_('app.nav.settings'),
            icon: SettingsIcon,
            active: isSubActive(`${base}/settings`) && !isSubActive(`${base}/settings/brand`),
            key: '/settings'
          }
        ]
      }
    ];
  }

  const sidebarGroups = $derived.by(() => {
    if (navTeam) return teamSidebarGroups();
    // Il tipo è quello del componente, non ricopiato a mano: la copia era andata alla deriva
    // (icon opzionale vs obbligatoria) e falliva solo all'assegnazione qui sotto.
    // `app.home.workbench.title` è la stessa chiave della pillola in topbar e del titolo della
    // modal: cambiarla là cambia tutte e tre insieme.
    const groups: NavGroup[] = [
      {
        items: [
          {
            href: `${base}/workbench`,
            label: $_('app.home.workbench.title'),
            icon: LayoutGrid,
            active: isSubActive(`${base}/workbench`),
            key: 'workbench'
          }
        ]
      }
    ];

    for (const m of macros) {
      // FEATURE_ADS spento: la scheda Ads non esiste (e la rotta risponde 404).
      const tabs = (HUB_TABS[m.key] ?? []).filter((t) => adsOn || t.key !== 'ads');
      const overviewPath = tabs.find((t) => t.key === 'overview')?.path;
      const hubLandingActive = overviewPath ? isSubActive(`${base}${overviewPath}`) : false;

      // La sezione è una VOCE, non un albero: il clic apre UNA pagina. Chi non è in HUB_DEST
      // resta sulla sua landing; Ads non ha overview e vale la prima scheda.
      const hubLandingPath = HUB_DEST[m.key] ?? overviewPath ?? tabs[0]?.path;
      const hubHref = hubLandingPath
        ? workbenchPageHref(data.brand.slug, hubLandingPath.replace(/^\//, ''), webHubEnabled, adsEnabled)
        : undefined;

      if (m.key === 'brand') {
        const studioPct = extras?.studioPct ?? 0;
        const identityHref = `${base}/settings/brand`;
        const brandActive = isSubActive(identityHref);
        groups.push({
          label: $_('app.hub.' + m.key + '.label'),
          groupIcon: m.icon,
          tourKey: m.key,
          active: brandActive,
          href: identityHref,
          pct: studioPct < 100 ? studioPct : undefined,
          items: [
            {
              href: identityHref,
              label: $_('app.hub.brand.label'),
              icon: m.icon,
              active: brandActive,
              key: 'brand',
              pct: studioPct < 100 ? studioPct : undefined,
              linkOut: true
            }
          ]
        });
        continue;
      }

      groups.push({
        label: $_('app.hub.' + m.key + '.label'),
        groupIcon: m.icon,
        tourKey: m.key,
        active: hubLandingActive,
        href: hubHref,
        badge:
          m.badge === 'content'
            ? (extras?.pendingCount ?? 0)
            : m.badge === 'leads'
              ? (extras?.leadsPendingCount ?? 0)
              : undefined,
        pct: 'studio' in m && m.studio ? (extras?.studioPct ?? 0) : undefined,
        items: tabs
          .filter((t) => t.key !== 'overview')
          .map((t) => {
          const segment = t.path.replace(/^\//, '');
          const href = workbenchPageHref(data.brand.slug, segment, webHubEnabled, adsEnabled);
          return {
            href,
            label: $_(`app.hub.${m.key}.${t.key}`),
            active:
              isSubActive(`${base}${t.path}`) ||
              (m.key === 'publish' &&
                t.key === 'calendar' &&
                (isSubActive(`${base}/gtm`) ||
                  isSubActive(`${base}/plan`) ||
                  isSubActive(`${base}/strategy`))),
            key: `${m.key}.${t.key}`,
            // I contatori vanno anche sulla figlia giusta, non solo sull'intestazione.
            badge:
              m.key === 'publish' && t.key === 'calendar'
                ? (extras?.pendingCount ?? 0)
                : m.key === 'automations' && t.key === 'leads'
                  ? (extras?.leadsPendingCount ?? 0)
                  : undefined,
            pct: undefined,
          };
        }),
      });
    }

    return groups;
  });


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
  <!-- Su mobile le impostazioni le naviga `PageRailDrawer` (lo stesso rail della modal), non
       questa sidebar: era l'unico posto del prodotto con un drawer suo. -->
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
    teamFirst={navTeam}
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
             ricalcolata dentro la topbar. Con la modal aperta resta visibile ed è giusto: la
             modal non cambia l'URL, quindi la pagina vera sotto è ancora la home. -->
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
                class:chat-flush={shimmerVariant === 'chat'}
                class:calendar-flush={navToFlush}
              >
                <WorkbenchPageShimmer variant={shimmerVariant} />
              </div>
            </div>
          {:else if showComposer}
            <div class="wb-frame">
              <div class="content-shell overview-stack">
                <div class="overview-composer">
                  <ChatColumn
                    brandSlug={data.brand.slug}
                    isOnboarding={isOnboarding}
                    webHubEnabled={webHubEnabled}
                    embedded
                  />
                  {#if homeChips.length}
                    <div class="overview-chips">
                      {#each homeChips as chip (chip.key)}
                        {#if chip.href}
                          <!-- Link vero: PageModal intercetta il clic e apre la modal senza
                               cambiare URL; su mobile naviga davvero. -->
                          <a class="overview-chip" href={chip.href}>
                            <span class="overview-chip-n">{chip.count}</span>
                            {chip.label}
                          </a>
                        {:else}
                          <button type="button" class="overview-chip" onclick={chip.onclick}>
                            <span class="overview-chip-n">{chip.count}</span>
                            {chip.label}
                          </button>
                        {/if}
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {:else}
            <div class="wb-frame">
              <div
                class="content-shell"
                class:chat-flush={isChatThread}
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

<!-- Modal delle pagine del brand (solo desktop): puro stato del client, l'URL non cambia mai.
     Ospita le +page.svelte VERE con preloadData. Atterrare davvero su una pagina (deep link,
     refresh, mobile) resta pagina piena. -->
<PageModal
  {base}
  desktop={!isMobile.current && !isFullWidth}
  navGroups={sidebarGroups}
/>

<PageRailDrawer {base} enabled={isMobile.current && !isFullWidth} navGroups={sidebarGroups} />

<!-- Montata una volta per tutto il brand, fuori dai rami settings/full-width: le scorciatoie
     devono valere ovunque. -->
<CommandPalette {base} brandSlug={data.brand.slug} navGroups={sidebarGroups} />

<ChatReplyNotifications brandSlug={data.brand.slug} />

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
  /* Il thread è l'eccezione: a filo, larghezza piena, così i clic ai lati scorrono. */
  .content-shell.chat-flush {
    max-width: none;
    padding-top: 0;
    padding-bottom: 0;
    padding-inline: 0;
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
  .content-shell :global(.chat-page) {
    flex: 1 1 auto;
    min-height: 0;
    height: auto;
  }
  .overview-stack {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-width: none;
    width: 100%;
    padding-inline: 0;
    padding-top: 0;
    padding-bottom: 0;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .content-shell.overview-stack {
    padding-top: 0;
  }
  .overview-composer {
    position: relative;
    isolation: isolate;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 100%;
    margin-inline: 0;
    padding-inline: var(--content-pad-x, 20px);
    padding-block: 0 28px;
    box-sizing: border-box;
  }
  .overview-composer :global(.chat-col) {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 720px;
    margin-inline: auto;
  }
  .overview-chips {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    width: 100%;
    max-width: 720px;
    margin: 14px auto 0;
  }
  .overview-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 12px 6px 7px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink-soft);
    font: inherit;
    font-size: 12.5px;
    font-weight: 550;
    line-height: 1;
    text-decoration: none;
    cursor: pointer;
    transition: color 0.15s var(--ease, ease), border-color 0.15s var(--ease, ease);
  }
  .overview-chip:hover {
    color: var(--ink);
    border-color: var(--ink-faint);
  }
  .overview-chip-n {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 14%, var(--paper-2));
    color: var(--accent);
    font-size: 11.5px;
    font-weight: 700;
  }
  .content-shell :global(.content),
  .content-shell :global(.cal-page),
  .content-shell :global(.camp-page),
  .content-shell :global(.radar-page),
  .content-shell :global(.lib-page),
  .content-shell :global(.site-page),
  .content-shell :global(.editor-page),
  .content-shell :global(.media-page),
  .content-shell :global(.knowledge-page),
  .content-shell :global(.settings-shell),
  .content-shell :global(.chat-page),
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
    .content-shell.overview-stack {
      padding-left: 0;
      padding-right: 0;
      padding-top: 0;
      padding-bottom: 16px;
    }
    .overview-composer {
      margin-inline: 0;
      padding-inline: 16px;
    }
  }
</style>
