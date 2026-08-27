<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { cn } from '$lib/utils.js';
  // Il menu utente è PORTALATO da bits-ui e si smonta alla selezione: per le voci che portano
  // ai settings si chiama l'API del modal invece di affidarsi al click dell'<a>.
  import { onModalLinkClick } from '$lib/components/PageModal.svelte';
  import { locale, _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { goto, invalidateAll, beforeNavigate } from '$app/navigation';
  import { navigating } from '$app/state';
  import { SUPPORTED, localePath, type Locale } from '$lib/i18n/locale';
  import { credits as creditsStore } from '$lib/stores/credits';
  import { isPaidPlan } from '$lib/plans';
  import {
    Settings,
    Trash2,
    MoreHorizontal,
    Pencil,
    Check,
    Sun,
    Moon,
    LogOut,
    UserPlus,
    LayoutGrid,
    Key,
    ArrowUpRight,
    Search,
    Sparkles,
    Plus,
    Bell,
  } from '@lucide/svelte';
  import { paletteOpen } from '$lib/shortcuts';
  import {
    brandWarnings,
    seenWarningIds,
    unseenWarnings,
    warningCenterOpen,
    warningCounts
  } from '$lib/warnings';
  // Il componente non è più montato qui: resta l'import del tipo, dove SwitcherBrand è definito.
  import { type SwitcherBrand } from '$lib/components/BrandProjectSwitcher.svelte';
  import AgentAvatarStack from '$lib/components/AgentAvatarStack.svelte';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import { hoverFaceFor, restingFaceFor } from '$lib/agent-avatars';
  import { threadIdentity } from '$lib/thread-identity';
  import { chatOpen, chatThreadId, chatThreads, refreshThreads, deleteThread, renameThread, openChatComposer, unreadThreadIds, unreadCount } from '$lib/stores/chat';
  import { busyThreadIds } from '$lib/stores/chat-session';

  import { useSidebar } from '$lib/components/ui/sidebar/context.svelte.js';
  import { materialPress } from '$lib/actions/material-press.js';

  export interface NavItem {
    href: string;
    label: string;
    /** Optional: the template already renders icon-less rows (`{#if item.icon}`). */
    icon?: any;
    active?: boolean;
    step?: number;
    badge?: number;
    pct?: number;
    tourKey?: string;
    todo?: boolean;
    key?: string;
    /** Shows an affordance that this row navigates to another page (not a submenu). */
    linkOut?: boolean;
    /** La lettera di `g <lettera>` che apre questa pagina. Viene dal registro delle scorciatoie
     *  ($lib/shortcuts), mai scritta a mano: se la lettera cambia là, la riga la segue. */
  }
  export interface NavGroup {
    label?: string;
    section?: boolean;
    groupIcon?: any;
    /** La pagina che il clic sull'intestazione apre (la landing del hub). Manca → la prima figlia. */
    href?: string;
    /** Shown on the section row itself — è l'unica riga visibile. */
    badge?: number;
    pct?: number;
    todo?: boolean;
    tourKey?: string;
    /** Hub landing active even when Overview is omitted from children. */
    active?: boolean;
    items: NavItem[];
  }

  export type ChecklistProps = {
    active: boolean;
    studioPct: number;
    hasStrategy: boolean;
    hasEditorialPlan: boolean;
    blogEnabled: boolean;
    radarEnabled: boolean;
    hasGeoAudit: boolean;
    gscConnected?: boolean;
  };

  let {
    brandName = 'Brand',
    brandWebsite = '',
    brandInitials = 'BR',
    logoUrl = '',
    brandHref = '/app',
    navGroups = [] as NavGroup[],
    settingsHref = '/app/settings',
    settingsLabel = 'Settings',
    userName = 'User',
    userEmail = '',
    userInitials = 'U',
    userAvatarUrl = '',
    userStatus = '',
    brandPlan = '',
    signOutLabel = 'Sign out',
    signOutAction = '/auth/signout',
    demo = false,
    onNavClick = undefined as ((item: NavItem) => void) | undefined,
    brandSlug = '',
    forceOpenMobile = false,
    checklist = null as ChecklistProps | null,
    switcherBrands = [] as SwitcherBrand[],
    teamFirst = false,
  }: {
    brandName?: string;
    brandWebsite?: string;
    brandInitials?: string;
    logoUrl?: string;
    brandHref?: string;
    navGroups?: NavGroup[];
    settingsHref?: string;
    settingsLabel?: string;
    userName?: string;
    userEmail?: string;
    userInitials?: string;
    userAvatarUrl?: string;
    userStatus?: string;
    brandPlan?: string;
    signOutLabel?: string;
    signOutAction?: string;
    demo?: boolean;
    onNavClick?: ((item: NavItem) => void) | undefined;
    brandSlug?: string;
    /** When true on mobile, keep the sidebar sheet open (master map home). */
    forceOpenMobile?: boolean;
    checklist?: ChecklistProps | null;
    switcherBrands?: SwitcherBrand[];
    /** Nav "La squadra" (FEATURE_NAV_TEAM): thread PRIMA dei gruppi, con le intestazioni di
     *  sezione. false = ordine di oggi, byte-identico. */
    teamFirst?: boolean;
  } = $props();

  const credits = $derived($creditsStore);
  /** L'identità nel menu porta al profilo (sezione modale di /settings). */
  const profileHref = $derived(`${settingsHref}/profile`);
  const creditsResetDate = $derived(
    credits
      ? new Date(credits.periodEnd).toLocaleDateString(
          $locale === 'it' ? 'it-IT' : $locale === 'es' ? 'es-ES' : $locale === 'fr' ? 'fr-FR' : 'en-US',
          { day: 'numeric', month: 'short' }
        )
      : ''
  );
  const sidebar = useSidebar();
  /** Full-page map instead of the closed/open Sheet dance (matches SettingsSidebar). */
  const asMobileMap = $derived(sidebar.isMobile && forceOpenMobile);
  /** Overlay drawer (~85vw): slightly larger type/hit areas than desktop — keep proportional. */
  const mobile = $derived(sidebar.isMobile);
  const iconClass = $derived(mobile ? 'size-4 shrink-0' : 'size-3.5 shrink-0');
  const labelClass = $derived(
    mobile ? 'truncate text-[14.5px] font-medium leading-tight' : 'truncate text-[13px]'
  );
  // Mobile rows need a comfortable tap target without looking oversized next to desktop.
  const menuBtnMobileClass = $derived(
    mobile
      ? 'h-auto! min-h-10! gap-2! rounded-lg! px-2.5! py-2! text-[14.5px]! leading-tight! [&_svg]:size-4! touch-manipulation'
      : ''
  );
  // Riga di nav SELEZIONATA: pastiglia in velo d'accento + etichetta in `--accent-ink` (5,3:1 in
  // chiaro, 10,5:1 in scuro). L'etichetta in `--accent` da sola stava a 2,58:1 su carta, sotto AA.
  // Utility e NON regola nel blocco di stile: tailwind.css importa Tailwind con `important`, e per
  // le dichiarazioni !important l'ordine dei layer si inverte — un CSS di componente perderebbe
  // contro `data-[active=true]:bg-transparent` della base. Qui twMerge cancella la classe base.
  const navOnClass =
    'font-semibold data-[active=true]:bg-[color:var(--nav-on)] data-[active=true]:hover:bg-[color:var(--nav-on-hover)] active:bg-[var(--paper)]';
  /** Vertical spacing between sidebar nav rows. */
  const navMenuGapClass = $derived(mobile ? 'gap-1.5' : 'gap-2');
  // Righe chat a due piani, stile lista messaggi: l'altezza la fa il contenuto, non il MenuButton.
  // Il MenuButton forza OGNI svg discendente a 16px ([&_svg]:size-4): l'avatar va esentato con w/h
  // auto (l'SVG torna ai propri width/height = size), o resta un francobollo.
  const threadRowClass = $derived(
    cn(
      'h-auto! min-h-0! items-center! gap-2.5! rounded-xl! px-2!',
      '[&_svg.agent-avatar]:w-auto! [&_svg.agent-avatar]:h-auto!',
      // Utility e non regola di stile, stessa trappola di navOnClass: con Tailwind importato
      // `important` un !important non-layered perde contro il layer utilities, e
      // `data-[active=true]:bg-transparent` della base vinceva sempre.
      'data-[active=true]:bg-[color:var(--thread-on)]',
      // Hover sulla riga già aperta: un gradino più scuro. Variante impilata = specificità più
      // alta di `hover:` da solo.
      'data-[active=true]:hover:bg-[color:var(--thread-on-hover)]',
      mobile ? 'px-2.5! py-2.5! touch-manipulation' : 'py-2!'
    )
  );
  const overviewHref = $derived(brandSlug ? `/app/${brandSlug}` : '');
  const activateHref = $derived(brandSlug ? `/app/${brandSlug}/activate` : '');
  const showUpgrade = $derived(!!brandSlug && !isPaidPlan(brandPlan));
  const overviewActive = $derived(
    !!overviewHref &&
      ($page.url.pathname === overviewHref || $page.url.pathname === `${overviewHref}/`)
  );
  /** Path of in-flight navigation — highlights the destination row immediately. */
  const pendingPath = $derived(navigating.to?.url.pathname ?? null);
  /** Exact for brand-root Overview (`/app/{slug}`); prefix for nested hub routes. */
  function isNavPending(href: string, exact = false) {
    if (!pendingPath || !href) return false;
    if (exact) return pendingPath === href || pendingPath === `${href}/`;
    return pendingPath === href || pendingPath.startsWith(`${href}/`);
  }

  let theme = $state<'light' | 'dark'>('light');
  $effect(() => {
    if (typeof window === 'undefined') return;
    const read = () =>
      (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light';
    theme = read();
    const obs = new MutationObserver(() => (theme = read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  });

  /** Iniziali di ripiego per i brand senza logo nel menu (il brand corrente ha già `brandInitials`). */
  function initialsOf(name: string) {
    return (
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('') || 'BR'
    );
  }

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    theme = next;
  }

  const currentLocale = $derived(($locale ?? 'en') as Locale);
  async function chooseLocale(l: Locale) {
    if (l === currentLocale) return;
    document.cookie = `locale=${l};path=/;max-age=31536000;samesite=lax`;
    locale.set(l);
    if (typeof document !== 'undefined') document.documentElement.lang = l;
    fetch('/api/v1/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: l }),
    }).catch(() => {});
    if ($page.route.id?.startsWith('/[[lang=locale]]')) {
      const basePath =
        $page.url.pathname.replace(new RegExp(`^\\/(${SUPPORTED.join('|')})(?=/|$)`), '') || '/';
      await goto(localePath(basePath, l) + $page.url.search + $page.url.hash);
    } else {
      await invalidateAll();
    }
  }

  // Close the mobile sheet as soon as navigation starts — not after the new page
  // finishes loading — so the drawer doesn't sit over the loading screen.
  beforeNavigate(() => {
    if (sidebar.isMobile && sidebar.openMobile && !forceOpenMobile) sidebar.setOpenMobile(false);
  });

  // UN solo menu condiviso, tirato fuori dall'{#each} e portalato su <body>: una
  // <DropdownMenu.Root> per thread montava N istanze pesanti a ogni re-render del Sheet mobile,
  // ~1,5s di UI ferma.
  type Thread = { id: string; title: string };
  let menuAnchor = $state<{ thread: Thread; right: number; top: number } | null>(null);
  let renamingId = $state<string | null>(null);
  let renameValue = $state('');
  let hoveredThreadId = $state<string | null>(null);
  // Le sezioni sono voci dirette, non richiudibili: ogni pagina del brand si apre in una modal
  // sopra la pagina viva (PageModal), quindi un clic sbagliato costa un Esc. Niente nemmeno il
  // pannello dei figli sull'hover: era il terzo modo di arrivare alle stesse sottopagine.

  // Thread caricati subito, e azzerati solo quando il brand cambia davvero: azzerarli al primo
  // mount cancellerebbe un thread deep-linked prima che ChatColumn si allinei all'URL.
  let threadsBrandSlug = $state<string | null>(null);
  $effect(() => {
    const slug = brandSlug || null;
    if (threadsBrandSlug !== null && threadsBrandSlug !== slug) {
      chatThreads.set([]);
      chatThreadId.set(null);
    }
    threadsBrandSlug = slug;
    if (slug) refreshThreads(slug);
  });

  function openThread(threadId: string) {
    chatThreadId.set(threadId);
    if (sidebar.isMobile && sidebar.openMobile) {
      sidebar.setOpenMobile(false);
    }
    void goto(`/app/${brandSlug}/chat/${threadId}`, { noScroll: true, keepFocus: true });
  }

  async function handleDeleteThread(e: Event, threadId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!brandSlug) return;
    menuAnchor = null;
    await deleteThread(brandSlug, threadId);
  }

  function startRename(thread: { id: string; title: string }) {
    renamingId = thread.id;
    renameValue = thread.title;
    menuAnchor = null;
  }

  async function confirmRename() {
    if (renamingId && renameValue.trim() && brandSlug) {
      await renameThread(brandSlug, renamingId, renameValue.trim());
    }
    renamingId = null;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmRename();
    } else if (e.key === 'Escape') {
      renamingId = null;
    }
  }

  function openThreadMenu(e: Event, thread: Thread) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    // Angolo alto-destro del menu sotto l'angolo basso-destro del bottone. Coordinate relative
    // alla viewport, usate con position: fixed su un portal a <body>: esce dallo stacking
    // context del Sheet su mobile.
    menuAnchor = { thread, right: window.innerWidth - rect.right, top: rect.bottom + 4 };
  }

  function closeThreadMenu() {
    menuAnchor = null;
  }

  // Portal action: sposta il menu condiviso su <body> così dipinge sopra il Sheet mobile
  // qualunque transform/filter ci sia nella shell.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.parentNode?.removeChild(node);
      }
    };
  }

  // Niente sezioni per data: il "quando" sta su ogni riga. L'identità (nome + volto) la risolve
  // threadIdentity, la stessa del topbar. La ricerca sopra la lista apre la palette, non filtra.

  const DAY_MS = 86400000;
  /** L'orario a fasce: oggi → l'ora; ieri → "Ieri"; entro la settimana → il giorno; prima → la
   * data. Tutto via Intl con la lingua dell'app, così non servono cataloghi di formati. */
  function threadTimeLabel(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const loc = $locale ?? 'en';
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (day >= startToday) return d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
    if (day >= startToday - DAY_MS) return $_('chat.groupYesterday');
    if (day >= startToday - 6 * DAY_MS) return d.toLocaleDateString(loc, { weekday: 'long' });
    return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' });
  }

  /** Righe già risolte (identità + volto). Il filtro è la palette, non più questa lista. */
  const threadRows = $derived.by(() => {
    const t = $_;
    return $chatThreads.map((thread) => ({
      thread,
      who: threadIdentity(thread, (k) => t(k))
    }));
  });

  // La campanella: STESSA lista e stesso conteggio del pannello (li pubblica WarningCenter).
  // Il badge conta le NON VISTE: un totale che non cala mai non segnala niente. `seenWarningIds`
  // a null = segnalibro non ancora letto → non si dice nulla, invece di mostrare il totale per un
  // fotogramma e poi correggersi.
  const unseen = $derived(
    $seenWarningIds === null ? [] : unseenWarnings($brandWarnings, $seenWarningIds)
  );
  const warnCounts = $derived(warningCounts(unseen));
  const warnTop = $derived(
    warnCounts.error
      ? 'error'
      : warnCounts.warning
        ? 'warning'
        : warnCounts.suggestion
          ? 'suggestion'
          : null
  );
</script>

{#snippet navItem(item: NavItem)}
    {@const pending = isNavPending(item.href)}
    {@const active = pending || (item.active && !pendingPath)}
    <Sidebar.MenuItem>
      <Sidebar.MenuButton
        isActive={active}
        tooltipContent={item.label}
        size={mobile ? 'default' : 'sm'}
        class={cn(
          active ? navOnClass : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] active:bg-[var(--paper)]',
          !item.icon && (mobile ? 'text-sm h-auto min-h-10 py-2' : 'text-xs h-6 py-0.5'),
          menuBtnMobileClass
        )}
        style={active ? 'color: var(--accent-ink)' : undefined}
        data-tour-step={item.tourKey}
      >
        {#snippet child({ props })}
          <a
            href={item.href}
            {...props}
            onclick={(e: MouseEvent) => {
              if (onNavClick) {
                e.preventDefault();
                onNavClick(item);
              }
            }}
          >
            {#if item.icon}
              <item.icon class={iconClass} strokeWidth={1.7} />
            {/if}
            <span class={cn(labelClass, 'group-data-[collapsible=icon]:hidden')}>{item.label}</span>
            {#if item.linkOut}
              <!-- La freccia accanto all'ETICHETTA, non in fondo: in fondo occupava il binario
                   destro e spingeva il badge 24px più dentro, disallineando le pillole. -->
              <ArrowUpRight
                class={cn(
                  'shrink-0 text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden',
                  mobile ? 'size-4' : 'size-3.5',
                  (item.pct !== undefined && item.pct < 100) || item.badge || item.todo ? 'ml-1' : 'ml-auto'
                )}
                strokeWidth={1.8}
              />
            {/if}
            {#if item.pct !== undefined && item.pct < 100}
              <Badge variant="secondary" class={cn('ml-auto py-0 group-data-[collapsible=icon]:hidden', mobile ? 'text-[11px] px-1.5' : 'text-[10px] px-1.5')}>{item.pct}%</Badge>
            {/if}
            {#if item.badge}
              <!-- Stesso colore del badge dei non letti (.chat-unread-badge): un conteggio in
                   sidebar è un conteggio, da qualunque sezione arrivi. -->
              <Badge class={cn('ml-auto py-0 group-data-[collapsible=icon]:hidden', mobile ? 'text-[11px] px-1.5' : 'text-[10px] px-1.5')} style="background: var(--accent-solid, #7c5cff); color: #fff;">{item.badge}</Badge>
            {/if}
            {#if item.todo}
              <Badge class={cn('ml-auto py-0 uppercase tracking-wide group-data-[collapsible=icon]:hidden', mobile ? 'text-[10px] px-1.5' : 'text-[9px] px-1.5')} style="background: var(--accent-solid, #7c5cff); color: #fff;">{$_('app.nav.todo')}</Badge>
            {/if}
          </a>
        {/snippet}
      </Sidebar.MenuButton>
    </Sidebar.MenuItem>
{/snippet}

{#snippet navGroupsSection()}
    <Sidebar.Group class="p-0">
      {#each navGroups as group, gi}
        {#if !group.label}
          <Sidebar.Menu class={navMenuGapClass}>
            {#each group.items as item}
              {@render navItem(item)}
            {/each}
          </Sidebar.Menu>
        {:else if group.section}
          {#if mobile || sidebar.state !== 'collapsed'}
            <div class="px-1.5 {gi > 0 ? (mobile ? 'mt-2' : 'mt-2.5') : ''} mb-0.5">
              <span class={cn('font-medium text-muted-foreground/70 uppercase tracking-wider', mobile ? 'text-[10.5px]' : 'text-[9.5px]')}>{group.label}</span>
            </div>
          {/if}
          <Sidebar.Menu class={navMenuGapClass}>
            {#each group.items as item}
              {@render navItem(item)}
            {/each}
          </Sidebar.Menu>
        {:else}
          <!-- La sezione È una voce: il clic apre la landing del hub, nella modal (l'ancora
               normale la prende l'interceptor). Un solo ramo per collassata ed espansa. -->
          {@const hubKey = group.label ?? `hub-${gi}`}
          {@const only = group.items.length === 1 ? group.items[0] : undefined}
          <Sidebar.Menu class={cn(navMenuGapClass, gi > 0 && 'mt-2')}>
            {@render navItem({
              href: group.href ?? group.items[0]?.href ?? '',
              label: group.label ?? '',
              icon: only?.icon ?? group.groupIcon,
              // Badge e percentuali si consolidano QUI: l'intestazione è l'unica riga visibile, e
              // un conteggio che vivesse solo su una figlia nascosta non lo vedrebbe più nessuno.
              pct: group.pct ?? only?.pct,
              badge: group.badge ?? only?.badge,
              todo: group.todo ?? only?.todo,
              linkOut: only?.linkOut,
              tourKey: group.tourKey,
              // Attivo anche quando sei dentro una figlia, non solo sulla landing.
              active: !!group.active || group.items.some((i) => i.active),
              key: hubKey
            })}
          </Sidebar.Menu>
        {/if}
      {/each}
    </Sidebar.Group>
{/snippet}

{#snippet threadsSection(heading: boolean)}
    <!-- Chat threads section -->
    {#if brandSlug}
      {#if mobile || sidebar.state !== 'collapsed'}
        <!-- Niente riga di separazione: lo stacco lo fa lo spazio. Con la sidebar stretta la
             lista dei thread non c'è, e il filetto disegnava un tratto sopra il nulla. -->
        <Sidebar.Group class="mt-4 p-0">
          {#if heading}
            <!-- L'intestazione esiste solo nella nav nuova, dove la lista dei thread viene
                 prima degli Spazi. -->
            <div class="px-1.5 mb-0.5">
              <span class={cn('font-medium text-muted-foreground/70 uppercase tracking-wider', mobile ? 'text-[10.5px]' : 'text-[9.5px]')}>{$_('app.nav2.team')}</span>
            </div>
          {/if}
          <!-- La ricerca NON filtra questa lista: è l'ingresso a ⌘K, che cerca anche fra i thread.
               È l'UNICO ingresso visibile — il pill che stava in topbar è stato tolto. -->
          <button
            type="button"
            class="thread-search"
            class:mobile
            onclick={() => paletteOpen.set(true)}
            aria-label={$_('app.shell.cmdTitle')}
            aria-haspopup="dialog"
          >
            <Search class="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            <span class="thread-search-label">{$_('app.shell.cmdTitle')}</span>
            {#if !mobile}
              <kbd class="thread-search-kbd">⌘K</kbd>
            {/if}
          </button>
          <!-- Una riga alta per thread: avatar, nome + orario, anteprima. Niente sezioni per data
               e niente divisori — il "quando" sta sulla riga. -->
          <Sidebar.Menu class="thread-list gap-0.5">
            {#each threadRows as { thread, who } (thread.id)}
              {@const threadHref = `/app/${brandSlug}/chat/${thread.id}`}
              {@const threadPending = isNavPending(threadHref)}
              {@const threadOn = threadPending || ($chatThreadId === thread.id && !pendingPath)}
              {@const hovered = hoveredThreadId === thread.id}
              {@const menuOpenHere = menuAnchor?.thread.id === thread.id}
              <Sidebar.MenuItem
                onmouseenter={() => hoveredThreadId = thread.id}
                onmouseleave={() => hoveredThreadId = null}
              >
                <Sidebar.MenuButton
                  isActive={threadOn}
                  tooltipContent={who.name}
                  size="sm"
                  class={cn(
                    threadRowClass,
                    'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] active:bg-[var(--paper)]'
                  )}
                >
                  {#snippet child({ props })}
                    <a
                      href={threadHref}
                      {...props}
                      onclick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openThread(thread.id);
                      }}
                    >
                      {#if renamingId === thread.id}
                        <input
                          bind:value={renameValue}
                          onkeydown={handleRenameKeydown}
                          onblur={confirmRename}
                          class={cn(
                            'flex-1 bg-background border border-border rounded outline-none focus:border-primary min-w-0',
                            'px-1.5 py-0.5 text-xs'
                          )}
                          autofocus
                        />
                        <button
                          class="shrink-0 p-0.5 rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.06] active:bg-[var(--paper)] text-primary touch-manipulation"
                          onclick={(e) => { e.stopPropagation(); confirmRename(); }}
                        >
                          <Check class="size-3" />
                        </button>
                      {:else}
                        <!-- Il "sta scrivendo" vive sull'avatar come pallino verde. -->
                        <span
                          class="avatar-holder"
                          class:cluster={!!thread.agents && thread.agents.length > 1}
                        >
                        {#if thread.agents && thread.agents.length > 1}
                          <!-- Più agenti: le facce stanno DENTRO il quadrato dell'avatar singolo
                               (stessa `size` del ramo sotto), o nome e orario non starebbero allo
                               stesso millimetro su ogni riga. -->
                          <AgentAvatarStack
                            agents={thread.agents}
                            layout="cluster"
                            size={mobile ? 38 : 34}
                            {hovered}
                          />
                        {:else}
                          <!-- Identità fissa (roster/custom) = il SUO volto; thread semplice =
                               faccia derivata dall'id. Turno in corso = il loop di AgentAvatar,
                               che con reduced-motion resta fermo (parla il pallino). -->
                          <AgentAvatar
                            face={who.fixed
                              ? who.face
                              : hovered
                                ? hoverFaceFor(thread.id)
                                : restingFaceFor(thread.id)}
                            color={who.color}
                            size={mobile ? 38 : 34}
                            busy={$busyThreadIds.has(thread.id)}
                            cycle={$busyThreadIds.has(thread.id)}
                          />
                        {/if}
                        {#if $busyThreadIds.has(thread.id)}
                          <span class="presence-dot" title={$_('chat.generating')} aria-hidden="true"></span>
                        {/if}
                        </span>
                        <span class="thread-lines" class:mobile>
                          <span class="thread-top">
                            <span class="thread-name">{who.name}</span>
                            <span class="thread-meta">
                              <!-- Quanti messaggi da quando l'hai guardato: un numero e non un
                                   pallino, perché "tre risposte" e "una" non si aprono con la
                                   stessa fretta. Si spegne aprendo. -->
                              {#if $unreadThreadIds.has(thread.id)}
                                {@const n = unreadCount($unreadThreadIds, thread.id)}
                                <span
                                  class="chat-unread-badge"
                                  class:mobile
                                  role="img"
                                  aria-label={$_('chat.unreadCount', { values: { count: n } })}
                                  title={$_('chat.unreadCount', { values: { count: n } })}
                                >{n > 9 ? '9+' : n}</span>
                              {/if}
                              {#if mobile}
                                <span class="thread-time">{threadTimeLabel(thread.updated_at || thread.created_at)}</span>
                                <button
                                  class="rounded shrink-0 touch-manipulation p-1 -mr-0.5 active:bg-[var(--paper)]"
                                  aria-haspopup="menu"
                                  aria-expanded={menuOpenHere}
                                  aria-label={$_('chat.threadActions')}
                                  onclick={(e) => openThreadMenu(e, thread)}
                                >
                                  <MoreHorizontal class="size-3.5" />
                                </button>
                              {:else}
                                <!-- L'orario NON esce mai dal flusso: sostituirlo col bottone ⋯
                                     cambiava la larghezza della coda e la riga slittava all'hover.
                                     Qui l'orario tiene la geometria e il bottone si sovrappone. -->
                                <span class="relative inline-flex items-center shrink-0">
                                  <span
                                    class={cn('thread-time transition-opacity', (hovered || menuOpenHere) && 'opacity-0')}
                                    aria-hidden={hovered || menuOpenHere}
                                  >{threadTimeLabel(thread.updated_at || thread.created_at)}</span>
                                  {#if hovered || menuOpenHere}
                                    <button
                                      class="absolute inset-y-0 right-0 my-auto h-fit rounded p-0.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                                      aria-haspopup="menu"
                                      aria-expanded={menuOpenHere}
                                      aria-label={$_('chat.threadActions')}
                                      onclick={(e) => openThreadMenu(e, thread)}
                                    >
                                      <MoreHorizontal class="size-3" />
                                    </button>
                                  {/if}
                                </span>
                              {/if}
                            </span>
                          </span>
                          <!-- Riga 2: l'anteprima dell'ultimo messaggio. Il titolo del thread
                               (riassunto auto-generato) è solo il ripiego. -->
                          {#if thread.preview || thread.title}
                            <span class="thread-preview">{thread.preview || thread.title}</span>
                          {/if}
                        </span>
                      {/if}
                    </a>
                  {/snippet}
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
        </Sidebar.Group>
      {/if}
    {/if}
{/snippet}

{#snippet sidebarBody()}
  <!-- Il selettore del brand non sta più in cima: su 47 account, 45 hanno UN brand — la riga più
       preziosa della sidebar era spesa per un'azione che il 96% non fa mai. Dire SEMPRE su quale
       brand si lavora (qui l'AI pubblica su account veri) è passato alla riga utente in fondo. -->
  {#if brandSlug}
    <!-- La riga d'ingresso è un HEADER, non la prima voce della lista: stessa altezza della top
         bar delle pagine (`shell-top-header`, cioè `--shell-top-h`) e stesso filo, così i due
         bordi sono una riga sola che attraversa la finestra invece di due tratti sfalsati.
         Nessun padding orizzontale sul guscio — il filo va da lato a lato; il rientro se lo
         tiene la riga dentro, dove serve a incolonnare l'etichetta con la nav. -->
    <Sidebar.Header class="shell-top-header shell-top-divider justify-center gap-0 p-0">
      <Sidebar.Group class="w-full p-0 px-2.5 group-data-[collapsible=icon]:px-2">
        <!-- La rotta è la home del brand, ma quella home è la chat: da lì non si guarda un
             cruscotto, si mette al lavoro qualcuno — da cui l'etichetta "Assumi un agente".
             Chiave i18n NUOVA (`app.nav.hireAgent`) e non `app.nav.homeOverview` riscritta:
             quella resta il nome della PAGINA. -->
        <Sidebar.Menu class={navMenuGapClass}>
          <Sidebar.MenuItem>
            {@const overviewPending = isNavPending(overviewHref, true)}
            {@const overviewOn = overviewPending || (overviewActive && !pendingPath)}
            <Sidebar.MenuButton
              isActive={overviewOn}
              tooltipContent={$_('app.nav.hireAgent')}
              size={mobile ? 'default' : 'sm'}
              class={cn(
                overviewOn ? navOnClass : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] active:bg-[var(--paper)]',
                menuBtnMobileClass
              )}
              style={overviewOn ? 'color: var(--accent-ink)' : undefined}
            >
              {#snippet child({ props })}
                <a
                  href={overviewHref}
                  {...props}
                  onclick={() => {
                    // Overview = empty composer: don't create a thread until the first message.
                    openChatComposer();
                    if (sidebar.isMobile && sidebar.openMobile) {
                      sidebar.setOpenMobile(false);
                    }
                  }}
                >
                  <UserPlus class={iconClass} strokeWidth={1.7} />
                  <span class={cn(labelClass, 'group-data-[collapsible=icon]:hidden')}>{$_('app.nav.hireAgent')}</span>
                </a>
              {/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Group>
    </Sidebar.Header>
  {/if}

  <Sidebar.Content class="flex-1 gap-0 overflow-y-auto px-2.5 py-3 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-2.5 group-data-[collapsible=icon]:overflow-visible">
    <!-- La nav nuova (teamFirst) mette la lista dei thread prima degli Spazi; spenta, resta
         l'ordine di oggi. Stessi snippet in entrambi i rami: il flag decide solo la gerarchia. -->
    {#if teamFirst}
      {@render threadsSection(true)}
      {#if brandSlug}
        <Sidebar.Separator class="mx-0 my-3" />
      {/if}
      {@render navGroupsSection()}
    {:else}
      {@render navGroupsSection()}
      {@render threadsSection(false)}
    {/if}
  </Sidebar.Content>

  <Sidebar.Footer class="gap-2 border-t border-sidebar-border px-2.5 py-3 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-2.5">
    <!-- "Prossimi passi" tolto dalla sidebar: la squadra e l'onboarding in chat coprono la guida.
         Il componente esiste ancora — se torna, torna come card in chat, non qui. -->
    {#if showUpgrade}
      <a
        href={activateHref}
        class={cn(
          'sidebar-upgrade flex items-center no-underline transition-opacity hover:opacity-90 active:opacity-80 touch-manipulation',
          mobile ? 'gap-2 rounded-lg px-2.5 py-2.5' : 'gap-2 rounded-lg px-2.5 py-2',
          'group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0'
        )}
        style="background: var(--accent, #7c5cff); color: #fff;"
        aria-label={$_('app.nav.upgrade')}
        title={$_('app.nav.upgrade')}
      >
        <Sparkles class={cn('shrink-0', mobile ? 'size-4' : 'size-3.5')} strokeWidth={1.8} />
        <span
          class={cn(
            'font-semibold leading-tight group-data-[collapsible=icon]:hidden',
            mobile ? 'text-[14px]' : 'text-[12.5px]'
          )}>{$_('app.nav.upgrade')}</span
        >
      </a>
    {/if}
    <!-- Brand + ingranaggio sulla stessa riga: la voce Settings resta anche nel menu, ma
         l'ingranaggio è il bersaglio diretto e i settings si aprono come modal. -->
    <div
      class={cn(
        'flex w-full min-w-0 items-center group-data-[collapsible=icon]:flex-col',
        mobile ? 'gap-1' : 'gap-0.5 group-data-[collapsible=icon]:gap-1'
      )}
    >
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={cn(
          'um-trigger flex min-w-0 flex-1 items-center text-left transition-colors touch-manipulation',
          'border-0 bg-transparent shadow-none',
          'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
          'data-[state=open]:bg-black/[0.04] dark:data-[state=open]:bg-white/[0.06]',
          'group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
          mobile
            ? 'gap-2.5 rounded-lg px-2.5 py-2.5 min-h-11'
            : 'gap-2.5 rounded-lg px-2 py-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0'
        )}
        aria-label={`${brandName} — ${$_('app.account.menu')}`}
        title={sidebar.state === 'collapsed' && !mobile ? brandName : undefined}
      >
        <!-- Avatar del BRAND, non dell'utente: collassata è l'unica cosa visibile. -->
        <span
          class={cn(
            'um-brand-avatar flex shrink-0 items-center justify-center overflow-hidden rounded-lg',
            mobile ? 'size-8' : 'size-7'
          )}
        >
          {#if logoUrl}
            <img
              src={logoUrl}
              alt=""
              class="size-full object-cover"
              loading="lazy"
              onerror={(e) => e.currentTarget.remove()}
            />
          {:else}
            <span class={cn('font-bold', mobile ? 'text-[11px]' : 'text-[10px]')}>{brandInitials}</span>
          {/if}
        </span>
        <!-- Una riga sola: il footer risponde a "su quale brand sto lavorando". Chi è loggato lo
             dice l'identità DENTRO il menu. -->
        <span
          class={cn(
            'min-w-0 flex-1 truncate font-semibold leading-tight text-[var(--ink)] group-data-[collapsible=icon]:hidden',
            mobile ? 'text-[14px]' : 'text-[13px]'
          )}>{brandName}</span
        >
      </DropdownMenu.Trigger>

      <DropdownMenu.Content
        side={mobile || sidebar.state !== 'collapsed' ? 'top' : 'right'}
        align={mobile || sidebar.state !== 'collapsed' ? 'start' : 'end'}
        sideOffset={8}
        class="um-menu w-[min(17.5rem,calc(100vw-2rem))] p-0 overflow-hidden"
      >
        <!-- Brand PRIMA delle voci account: è il motivo per cui si apre questo menu.
             Niente cap a 5 + "tutti i brand": la lista scrolla (ponytail: una riga di CSS invece
             di un troncamento più una voce, e nessun brand resta nascosto). -->
        {#if switcherBrands.length}
          <div class="um-section">
            <div class="um-brands">
              {#each switcherBrands as b (b.id)}
                {@const on = b.slug === brandSlug}
                <DropdownMenu.Item class="um-item p-0">
                  <!-- Sempre la home del brand: un deep link cross-brand (post, thread, id) non
                       esiste nell'altro brand e finirebbe in 404. -->
                  <a
                    href={`/app/${b.slug}`}
                    class={cn('um-link um-brand-row', on && 'on')}
                    data-sveltekit-preload-data="hover"
                    aria-current={on ? 'true' : undefined}
                  >
                    <span class="um-brand-avatar um-brand-avatar-sm">
                      {#if b.logoUrl}
                        <img src={b.logoUrl} alt="" class="size-full object-cover" loading="lazy" />
                      {:else}
                        <span class="um-brand-initials">{initialsOf(b.name)}</span>
                      {/if}
                    </span>
                    <span class="um-brand-name">{b.name}</span>
                    {#if on}
                      <Check class="size-4 shrink-0 text-[var(--accent)]" strokeWidth={2.2} />
                    {/if}
                  </a>
                </DropdownMenu.Item>
              {/each}
            </div>
            <DropdownMenu.Item class="um-item p-0">
              <a href="/app/onboarding" class="um-link um-link-muted">
                <Plus class="size-4" strokeWidth={1.7} />
                <span>{$_('app.brands.add')}</span>
              </a>
            </DropdownMenu.Item>
          </div>
          <div class="um-divider"></div>
        {/if}

        <!-- Identita': UNA riga cliccabile verso il profilo, non un blocco decorativo. -->
        <div class="um-section">
          <DropdownMenu.Item class="um-item p-0">
            <a href={profileHref} class="um-link" onclick={(e) => onModalLinkClick(e, 'profile')}>
              <span class="um-avatar">
                {#if userAvatarUrl}
                  <img src={userAvatarUrl} alt="" class="size-full object-cover" loading="lazy" />
                {:else}
                  <span class="um-avatar-initials">{userInitials}</span>
                {/if}
              </span>
              <span class="um-identity-text">
                <span class="um-identity-name">{userName || 'User'}</span>
                {#if userEmail}
                  <span class="um-identity-email">{userEmail}</span>
                {/if}
              </span>
            </a>
          </DropdownMenu.Item>

          <!-- La data di reset è un title, non una riga: si legge una volta al mese, la barra
               ogni volta. -->
          {#if credits}
            <div class="um-credits" title={$_('app.credits.resets', { values: { date: creditsResetDate } })}>
              <span class="um-credits-used"
                >{credits.used.toLocaleString()}{$_('app.credits.of')}{credits.quota.toLocaleString()}</span
              >
              <div class="um-credits-bar">
                <div
                  class="um-credits-fill"
                  class:ok={credits.percent < 60}
                  class:warn={credits.percent >= 60 && credits.percent < 80}
                  class:bad={credits.percent >= 80}
                  style="width: {Math.min(100, credits.percent)}%"
                ></div>
              </div>
            </div>
          {/if}

          <!-- Azioni: voci normali, senza etichetta — le icone e i nomi si spiegano da soli. -->
          <DropdownMenu.Item class="um-item p-0">
            <a href={settingsHref} class="um-link" onclick={onModalLinkClick}>
              <Settings class="size-4" strokeWidth={1.7} />
              <span>{settingsLabel}</span>
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item class="um-item p-0">
            <a href={brandHref} class="um-link">
              <LayoutGrid class="size-4" strokeWidth={1.7} />
              <span>{$_('app.brands.title')}</span>
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item class="um-item p-0">
            <a href="/app/api-keys" class="um-link">
              <Key class="size-4" strokeWidth={1.7} />
              <span>API Keys</span>
            </a>
          </DropdownMenu.Item>
        </div>

        <!-- Preferenze in fondo, su UNA riga. Non sono DropdownMenu.Item di proposito: cambiare
             tema o lingua non deve chiudere il menu. -->
        <div class="um-divider"></div>
        <div class="um-section um-prefs">
          <button
            type="button"
            class="um-pref-btn"
            onclick={toggleTheme}
            aria-label={theme === 'dark' ? $_('app.account.lightMode') : $_('app.account.darkMode')}
            title={theme === 'dark' ? $_('app.account.lightMode') : $_('app.account.darkMode')}
          >
            {#if theme === 'dark'}
              <Sun class="size-4" strokeWidth={1.7} />
            {:else}
              <Moon class="size-4" strokeWidth={1.7} />
            {/if}
          </button>
          <div class="um-lang-switch">
            {#each SUPPORTED as l (l)}
              <button
                type="button"
                class={cn('um-lang-btn', currentLocale === l && 'on')}
                onclick={() => chooseLocale(l)}
              >
                {l.toUpperCase()}
              </button>
            {/each}
          </div>
        </div>

        <!-- Sign out -->
        <div class="um-divider"></div>
        <div class="um-section um-section-end">
          {#if demo}
            <DropdownMenu.Item class="um-item um-danger" onclick={() => {}}>
              <LogOut class="size-4" strokeWidth={1.7} />
              <span>{signOutLabel}</span>
            </DropdownMenu.Item>
          {:else}
            <form method="POST" action={signOutAction}>
              <DropdownMenu.Item class="um-item um-danger p-0">
                <button type="submit" class="um-link um-danger-link">
                  <LogOut class="size-4" strokeWidth={1.7} />
                  <span>{signOutLabel}</span>
                </button>
              </DropdownMenu.Item>
            </form>
          {/if}
        </div>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <!-- Il pannello (WarningCenter) è un drawer fisso montato nel layout: questo è solo
         l'interruttore. -->
    <button
      type="button"
      class={cn(
        'um-bell relative flex shrink-0 items-center justify-center text-sidebar-foreground/70 transition-colors',
        'border-0 bg-transparent shadow-none',
        'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-sidebar-foreground touch-manipulation',
        mobile ? 'size-9 rounded-lg' : 'size-8 rounded-lg',
        $warningCenterOpen && 'text-[var(--accent)]'
      )}
      onclick={() => warningCenterOpen.update((v) => !v)}
      aria-label={$_('warnings.title')}
      title={$_('warnings.title')}
      aria-expanded={$warningCenterOpen}
    >
      <Bell class={mobile ? 'size-4' : 'size-3.5'} strokeWidth={1.7} />
      {#if warnCounts.total > 0}
        <!-- ponytail: piazzamento in stile inline, non in CSS. `.um-bell-count` dichiara
             `position: absolute` ed è l'unica regola che tocchi `position` su questo nodo, ma nel
             browser la pillola resta in flusso: qui la cascata è contesa fra utility Tailwind e
             CSS di componente, e lo stile inline vince senza `!important`. -->
        <span
          class="um-bell-count sev-{warnTop}"
          class:mobile
          style="position:absolute;top:-1px;right:-1px"
        >{warnCounts.total}</span>
      {/if}
    </button>
    <a
      href={settingsHref}
      class={cn(
        'um-settings flex shrink-0 items-center justify-center text-sidebar-foreground/70 no-underline transition-colors',
        'border-0 bg-transparent shadow-none',
        'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-sidebar-foreground touch-manipulation',
        mobile ? 'size-9 rounded-lg' : 'size-8 rounded-lg',
        isNavPending(settingsHref) && 'text-[var(--accent)]'
      )}
      aria-label={settingsLabel}
      title={settingsLabel}
      onclick={onModalLinkClick}
    >
      <Settings class={mobile ? 'size-4' : 'size-3.5'} strokeWidth={1.7} />
    </a>
    </div>
  </Sidebar.Footer>

  {#if menuAnchor}
    {@const anchor = menuAnchor}
    <!-- UN'istanza sola qualunque sia il numero di thread, portalata su <body> per uscire dallo
         stacking context del Sheet mobile. -->
    <div use:portal>
      <!-- transparent backdrop catches click-outside -->
      <button
        type="button"
        class="fixed inset-0 z-[100] cursor-default bg-transparent"
        onclick={closeThreadMenu}
        aria-hidden="true"
        tabindex="-1"
      ></button>
      <div
        class="fixed z-[101] min-w-[120px] rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg"
        style="right: {anchor.right}px; top: {anchor.top}px;"
        role="menu"
      >
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent active:bg-accent touch-manipulation"
          role="menuitem"
          onclick={() => startRename(anchor.thread)}
        >
          <Pencil class="size-3.5" />
          <span>{$_('chat.rename')}</span>
        </button>
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-destructive hover:bg-accent active:bg-accent touch-manipulation"
          role="menuitem"
          onclick={(e) => handleDeleteThread(e, anchor.thread.id)}
        >
          <Trash2 class="size-3.5" />
          <span>{$_('chat.deleteThread')}</span>
        </button>
      </div>
    </div>
  {/if}
{/snippet}

{#if asMobileMap}
  <div class="dashboard-mobile-map" use:materialPress>
    {@render sidebarBody()}
  </div>
{:else}
  <Sidebar.Root collapsible="icon">
    {@render sidebarBody()}
    <Sidebar.Rail />
  </Sidebar.Root>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && menuAnchor) {
      e.stopPropagation();
      closeThreadMenu();
    }
  }}
/>

<style>
  .dashboard-mobile-map {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100dvh;
    background: var(--sidebar-bg, var(--paper-2, var(--sidebar, #f5f5f7)));
    color: var(--sidebar-foreground, var(--ink));
    padding: 12px 10px 28px;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
  }
  .dashboard-mobile-map :global([data-slot='sidebar-header']),
  .dashboard-mobile-map :global([data-slot='sidebar-footer']) {
    flex-shrink: 0;
  }
  .dashboard-mobile-map :global([data-slot='sidebar-content']) {
    flex: 1;
    min-height: 0;
  }
  /* Instant press wash on the full-page mobile map (hover never fires on touch). */
  .dashboard-mobile-map :global([data-sidebar='menu-button']:active:not([data-pending='true'])) {
    background: var(--paper) !important;
  }
  .dashboard-mobile-map :global([data-sidebar='menu-button'][data-pending='true']) {
    background: color-mix(in srgb, var(--accent, #c485fe) 12%, transparent) !important;
  }

  /* Fully global: menu buttons render in child components (e.g. tooltip/menu-button),
     so a partially-scoped selector only hit <a> nodes inlined in this file. */
  :global([data-collapsible="icon"] [data-sidebar="menu-button"]) {
    margin-inline: auto;
    justify-content: center;
    gap: 0;
  }

  /* I due valori della riga di nav selezionata (vedi navOnClass): token qui, consumati dalle
     utility sulla riga, perché un !important di componente non batte il layer utilities. Velo di
     ACCENTO e non di inchiostro: il grigio è quello dell'hover. */
  :global([data-slot='sidebar-content']) {
    --nav-on: color-mix(in srgb, var(--accent) 16%, transparent);
    --nav-on-hover: color-mix(in srgb, var(--accent) 24%, transparent);
  }

  /* Campo di ricerca: margini e imbottitura NON sono liberi, portano icona ed etichetta sugli
     stessi binari verticali delle voci di nav (icona a 18px dal bordo, testo a 42px, misurati). */
  .thread-search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px;
    padding: 0 8px;
    height: 30px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--ink) 5%, transparent);
    color: var(--ink-faint);
  }
  .thread-search.mobile {
    height: 38px;
    border-radius: 11px;
    /* Sul telefono le righe di nav hanno px-2.5: l'icona parte da 10, non da 8. */
    padding: 0 10px;
  }
  .thread-search {
    width: 100%;
    border: 0;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  .thread-search:hover {
    background: color-mix(in srgb, var(--ink) 9%, transparent);
    color: var(--ink);
  }
  .thread-search-label {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
  }
  .thread-search.mobile .thread-search-label {
    font-size: 14px;
  }
  .thread-search-kbd {
    flex-shrink: 0;
    font-family: inherit;
    font-size: 10.5px;
    line-height: 1;
    padding: 3px 4px;
    border: 1px solid var(--line);
    border-radius: 5px;
    color: var(--ink-faint);
  }

  /* Stessa pillola dei non letti sulle righe dei thread (.chat-unread-badge), così due numeri
     nella stessa sidebar si somigliano. Qui è ancorata all'angolo dell'icona (`position:
     absolute`): nulla intorno si sposta quando il numero passa da 9 a 10. */
  .um-bell-count {
    position: absolute;
    top: -1px;
    right: -1px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 9.5px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: #fff;
    background: var(--accent-solid, #7c5cff);
    box-shadow: 0 0 0 2px var(--sidebar, var(--paper));
    pointer-events: none;
  }
  /* Sul telefono il bottone è più grande: stessa pillola, un gradino più su — come
     .chat-unread-badge.mobile. */
  .um-bell-count.mobile {
    min-width: 17px;
    height: 17px;
    font-size: 10.5px;
  }
  .um-bell-count.sev-error {
    background: #ef4444;
  }
  .um-bell-count.sev-warning {
    background: #f59e0b;
  }
  .um-bell-count.sev-suggestion {
    background: #6366f1;
  }
  /* Riga selezionata: fondo pieno su tutta la riga (in una lista di conversazioni il selezionato
     si legge dal fondo). I due valori vivono come token qui e li consumano le utility su
     threadRowClass: una regola CSS di componente non vince sul layer utilities. */
  :global(.thread-list) {
    --thread-on: color-mix(in srgb, var(--ink) 12%, transparent);
    --thread-on-hover: color-mix(in srgb, var(--ink) 17%, transparent);
  }
  /* Secondo segnale, indipendente dal colore: il nome della conversazione aperta è in peso pieno. */
  :global(.thread-list [data-sidebar='menu-button'][data-active='true']) .thread-name {
    font-weight: 700;
  }
  /* L'anello del pallino imita il fondo su cui poggia: sulla riga selezionata è il wash, non la
     sidebar nuda, o il dot si ritaglia un buco chiaro. */
  :global(.thread-list [data-sidebar='menu-button'][data-active='true']) .presence-dot {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ink) 12%, var(--sidebar-bg, var(--paper-2, #f5f5f7)));
  }
  .thread-lines {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .thread-top {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .thread-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.3;
  }
  .thread-lines.mobile .thread-name {
    font-size: 14.5px;
  }
  .thread-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: 0 0 auto;
    color: var(--ink-soft);
  }
  .thread-time {
    font-size: 10.5px;
    color: var(--ink-faint);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .thread-lines.mobile .thread-time {
    font-size: 11.5px;
  }
  .thread-preview {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    font-weight: 400;
    color: var(--ink-soft);
    line-height: 1.35;
  }
  .thread-lines.mobile .thread-preview {
    font-size: 12.5px;
  }

  /* Larghezza minima fissa: '1' e '9+' occupano la stessa scatola, così la coda della riga
     (orario + ⋯) non slitta quando il numero cambia. */
  .chat-unread-badge {
    flex: 0 0 auto;
    min-width: 17px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* --accent-solid: il bianco sull'accento pieno stava a 2,58:1, e qui il testo è 10px. */
    background: var(--accent-solid, #7c5cff);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  /* Sul telefono la riga è più alta e ci passa sopra un dito: stessa pillola, un gradino più su. */
  .chat-unread-badge.mobile {
    min-width: 19px;
    height: 18px;
    font-size: 11px;
  }
  .avatar-holder {
    position: relative;
    display: inline-flex;
    flex: 0 0 auto;
  }
  /* ponytail: verde fisso stile presenza (WhatsApp/Discord), anello del colore della sidebar.
     FERMO di proposito: un pallino che pulsa su dieci conversazioni è rumore, non segnale. */
  .presence-dot {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 0 2px var(--sidebar-bg, var(--paper-2, #f5f5f7));
  }
  /* Con più agenti l'angolo in basso a destra è una palla da 16px, non da 34: il pallino di
     sempre le mangerebbe metà faccia. */
  .avatar-holder.cluster .presence-dot {
    right: -2px;
    bottom: -2px;
    width: 7px;
    height: 7px;
    box-shadow: 0 0 0 1.5px var(--sidebar-bg, var(--paper-2, #f5f5f7));
  }

  /* User account menu */
  :global(.um-trigger),
  :global(.um-settings) {
    appearance: none;
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
  }
  :global(.um-trigger:hover),
  :global(.um-trigger[data-state='open']),
  :global(.um-settings:hover) {
    background: color-mix(in srgb, var(--ink) 4%, transparent) !important;
  }
  :global(.um-menu[data-slot='dropdown-menu-content']) {
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
  .um-section {
    padding: 8px 8px 6px;
  }
  .um-section-end {
    padding-bottom: 8px;
  }
  .um-avatar {
    display: flex;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
  }
  .um-avatar-initials {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .um-identity-text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }
  .um-identity-name {
    font-size: 13px;
    font-weight: 650;
    line-height: 1.25;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .um-identity-email {
    font-size: 11px;
    line-height: 1.3;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .um-divider {
    height: 1px;
    background: var(--line);
    margin: 0;
  }
  .um-credits {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 4px 8px 8px;
  }
  .um-credits-used {
    flex: 0 0 auto;
    font-size: 11.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .um-credits-bar {
    height: 4px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 8%, transparent);
  }
  .um-credits-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.3s ease;
  }
  .um-credits-fill.ok { background: #16a34a; }
  .um-credits-fill.warn { background: #ca8a04; }
  .um-credits-fill.bad { background: #ef4444; }
  :global(.um-item) {
    gap: 9px;
    min-height: 34px;
    padding: 7px 8px;
    border-radius: 9px;
    font-size: 13px;
    cursor: pointer;
  }
  .um-link {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 9px;
    min-height: 34px;
    padding: 7px 8px;
    border-radius: 9px;
    color: inherit;
    text-decoration: none;
    background: none;
    border: none;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  /* Riga di contesto: avatar quadrato del brand (i loghi sono quadrati, il cerchio li tagliava). */
  .um-brand-avatar {
    background: var(--accent);
    color: #fff;
  }
  .um-brand-avatar-sm {
    width: 24px;
    height: 24px;
    border-radius: 7px;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .um-brand-initials {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1;
  }
  /* La lista scrolla invece di troncare: 7 brand è il massimo reale oggi, ~5 righe visibili. */
  .um-brands {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 13rem;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .um-brand-row.on {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .um-brand-name {
    min-width: 0;
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .um-link-muted {
    color: var(--ink-soft);
    font-size: 12.5px;
  }
  .um-link-muted:hover {
    color: var(--ink);
  }
  .um-prefs {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
  }
  .um-pref-btn {
    display: flex;
    width: 30px;
    height: 26px;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 8px;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    color: var(--ink-soft);
    cursor: pointer;
  }
  .um-pref-btn:hover {
    color: var(--ink);
  }
  .um-lang-switch {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .um-lang-btn {
    border: none;
    background: transparent;
    border-radius: 6px;
    padding: 4px 7px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .um-lang-btn.on {
    background: var(--paper);
    color: var(--ink);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
  .um-lang-btn:hover:not(.on) {
    color: var(--ink);
  }
  :global(.um-danger),
  .um-danger-link {
    color: #b42318;
  }
  :global([data-theme='dark'] .um-danger),
  :global([data-theme='dark']) .um-danger-link {
    color: #fca5a5;
  }
</style>
