<script lang="ts">
  import { tick } from 'svelte';
  import { page } from '$app/stores';
  import { EllipsisVertical, LayoutGrid } from '@lucide/svelte';
  import * as Sidebar from '$lib/components/ui/sidebar/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { useSidebar } from '$lib/components/ui/sidebar/context.svelte.js';
  import { railDrawerOpen, railDrawerReady } from '$lib/stores/rail-drawer';
  import { pageMeta, pageTopActions } from '$lib/stores/page-meta';
  import type { AppWarning } from '$lib/warnings';
  // La campanella si è spostata in fondo alla sidebar: qui `warnings` resta solo perché il
  // layout del brand la passa ancora (non è questo lavoro a toccarlo), e non serve più a nulla.
  import { IsMobile, SHELL_MOBILE_BREAKPOINT } from '$lib/hooks/is-mobile.svelte';
  import PresenceStack from '$lib/components/PresenceStack.svelte';
  import AgentAvatar from '$lib/components/AgentAvatar.svelte';
  import AgentAvatarStack from '$lib/components/AgentAvatarStack.svelte';
  import { brandChannel } from '$lib/realtime/brand-channel.svelte';
  import { _, locale } from 'svelte-i18n';
  import { credits } from '$lib/stores/credits';
  import UpgradeLink from '$lib/components/UpgradeLink.svelte';

  let {
    visible = true,
    warnings = [] as AppWarning[],
    showSidebarTrigger = true,
    /** Desktop PanelLeft collapse control. Off when the sidebar is locked (e.g. settings). */
    showDesktopCollapse = true,
    showStatus = false
  }: {
    visible?: boolean;
    warnings?: AppWarning[];
    /** Collapse (desktop) / burger (mobile) control next to the title. */
    showSidebarTrigger?: boolean;
    showDesktopCollapse?: boolean;
    /**
     * La pillola Stato, solo sulla home del brand. Chi è "la home" NON si ricalcola qui da
     * una stringa: lo decide il layout, che ha già `isBrandRoot`. Default falso, così ogni
     * altro punto che monta la topbar (le impostazioni) resta pulito senza saperne nulla.
     */
    showStatus?: boolean;
  } = $props();

  const sidebar = useSidebar();
  const isMobile = new IsMobile(SHELL_MOBILE_BREAKPOINT);

  /**
   * Quale menu apre il burger. Dentro una sovrapposizione (una pagina della modal o le
   * impostazioni) apre il RAIL di quella sovrapposizione — da lì si raggiunge ogni altra
   * sezione; fuori resta la sidebar della dashboard. Chi risponde "sono dentro" è il
   * drawer stesso (`PageRailDrawer` accende `railDrawerReady` quando la rotta corrente ci
   * vive dentro): qui non si riclassifica nessun path.
   */
  const railBurger = $derived($railDrawerReady);
  const menuOpen = $derived(railBurger ? $railDrawerOpen : sidebar.openMobile);
  function toggleMenu() {
    if (railBurger) railDrawerOpen.set(!$railDrawerOpen);
    else sidebar.setOpenMobile(!sidebar.openMobile);
  }

  const brandSlug = $derived($page.params.brand as string | undefined);

  const meta = $derived($pageMeta);
  const actions = $derived($pageTopActions);
  const hasMeta = $derived(!!meta.title);
  const show = $derived(visible);
  const hasActions = $derived(!!actions && hasMeta);

  // Crediti: la striscia che mancava. Finora l'unico posto dove il consumo era visibile era il
  // dropdown dell'avatar — un click di distanza, quindi di fatto invisibile: si scopriva il muro
  // solo sbattendoci contro. Stessa soglia della barra nel dropdown (rosso a ≥80%): una soglia
  // sola, non due. Non è chiudibile di proposito — a 80% mancano pochi giorni al blocco.
  const creditPct = $derived($credits ? Math.round($credits.percent) : 0);
  const creditAlert = $derived(!!$credits && $credits.percent >= 80);
  const creditOut = $derived(!!$credits && $credits.remaining <= 0);
  const creditReset = $derived(
    $credits
      ? new Date($credits.periodEnd).toLocaleDateString(
          $locale === 'it' ? 'it-IT' : $locale === 'es' ? 'es-ES' : $locale === 'fr' ? 'fr-FR' : 'en-US',
          { day: 'numeric', month: 'short' }
        )
      : ''
  );

  let actionsOpen = $state(false);
  /** Assume a single CTA until measured — avoids flashing the Actions menu on one-button pages. */
  let actionCount = $state(1);
  let actionsRoot = $state<HTMLElement | null>(null);
  const useActionsMenu = $derived(isMobile.current && hasActions && actionCount > 1);

  function countTopbarActions(root: HTMLElement): number {
    let n = 0;
    for (const child of root.children) {
      if (!(child instanceof HTMLElement) || child.hidden) continue;
      n += 1;
    }
    return n;
  }

  // When the actions snippet changes, prefer inline until we re-count.
  $effect(() => {
    void actions;
    actionCount = 1;
    actionsOpen = false;
  });

  $effect(() => {
    if (!isMobile.current || !hasActions || useActionsMenu) return;
    const el = actionsRoot;
    if (!el) return;
    let cancelled = false;
    const recount = () => {
      if (cancelled) return;
      actionCount = Math.max(1, countTopbarActions(el));
    };
    void tick().then(recount);
    const mo = new MutationObserver(() => void tick().then(recount));
    mo.observe(el, { childList: true });
    return () => {
      cancelled = true;
      mo.disconnect();
    };
  });

  function closeActionsSoon() {
    // Defer so button/form click handlers run before the menu unmounts.
    queueMicrotask(() => {
      actionsOpen = false;
    });
  }
</script>

{#if show}
  <header class="page-topbar" class:meta={hasMeta}>
    <div class="page-topbar-inner">
      <div class="page-topbar-start">
        {#if showSidebarTrigger}
          {#if isMobile.current}
            <button
              type="button"
              class="page-topbar-burger"
              class:is-open={menuOpen}
              onclick={toggleMenu}
              aria-label={$_('app.nav.openMenu')}
              aria-expanded={menuOpen}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                <line class="b-top" x1="3" y1="6" x2="21" y2="6" />
                <line class="b-mid" x1="3" y1="12" x2="21" y2="12" />
                <line class="b-bot" x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          {:else if showDesktopCollapse}
            <Sidebar.Trigger class="page-topbar-collapse shrink-0" />
          {/if}
        {/if}
        <!-- Su una chat il titolo è l'agente del thread: il volto accanto al nome è la stessa
             identità della riga in sidebar (pageMeta.avatar, risolta da threadIdentity). -->
        {#if hasMeta && meta.avatars?.length}
          <!-- CHAT DI GRUPPO: i membri della stanza, in fila sovrapposta. Qui lo spazio in
               larghezza c'è (a differenza della riga in sidebar, che usa il cluster), quindi
               `layout="row"` — la resa che il componente ha già. `--sidebar` è ridefinito sul
               posto perché l'anello che stacca le palle è dipinto nel fondo di CHI le ospita:
               nel topbar è la carta, non la sidebar. -->
          <span class="page-topbar-avatar page-topbar-stack" aria-hidden="true">
            <!-- Più piccole sul telefono: quattro palle da 26px si mangiavano il titolo, e il
                 titolo è quello che dice DOVE sei. -->
            <AgentAvatarStack agents={meta.avatars} size={isMobile.current ? 20 : 26} max={4} layout="row" />
          </span>
        {:else if hasMeta && meta.avatar}
          <span class="page-topbar-avatar" aria-hidden="true">
            <AgentAvatar face={meta.avatar.face} color={meta.avatar.color} size={26} />
          </span>
        {/if}
        <div class="page-topbar-left">
          {#if hasMeta}
            {#if meta.section}
              <p class="page-topbar-section">{meta.section}</p>
            {/if}
            <h1 class="page-topbar-title" title={meta.title}>{meta.title}</h1>
            {#if meta.subtitle && !isMobile.current}
              <p class="page-topbar-sub" title={meta.subtitle}>{meta.subtitle}</p>
            {/if}
          {/if}
        </div>
      </div>
      <div class="page-topbar-right">
        <PresenceStack peers={brandChannel.here} />
        {#if hasActions}
          {#if useActionsMenu}
            <DropdownMenu.Root bind:open={actionsOpen}>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <button
                    type="button"
                    class="page-topbar-actions-btn"
                    aria-label={$_('app.shell.actions')}
                    {...props}
                  >
                    <EllipsisVertical class="size-4" strokeWidth={2} />
                    <span class="page-topbar-actions-btn-label">{$_('app.shell.actions')}</span>
                  </button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content
                class="page-topbar-actions-menu !w-[92vw] !max-w-[92vw] !min-w-[92vw]"
                style="--bits-dropdown-menu-anchor-width: 92vw;"
                align="end"
                sideOffset={8}
                collisionPadding={12}
              >
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div class="page-topbar-actions page-topbar-actions--menu" onclick={closeActionsSoon}>
                  {@render actions?.()}
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {:else}
            <div class="page-topbar-actions" bind:this={actionsRoot}>
              {@render actions?.()}
            </div>
          {/if}
        {/if}
        {#if brandSlug && showStatus}
          <!-- Lo Stato (coda di oggi, lead, avvisi, andamento) non è più sotto la chat:
               si apre da qui. È un <a> vero, non un bottone: su desktop PageModal
               intercetta il click e lo apre in overlay senza cambiare URL, su mobile
               naviga alla pagina piena. Un link morto non esiste in nessuno dei due casi.
               Ha l'etichetta accanto all'icona: un'icona sola non dice cosa apre. La parola è UNA — qui, nel titolo della modal e nel rail — perché
               tutti e tre la prendono da `app.home.workbench.title`. -->
          <a
            class="topbar-status"
            href={`/app/${brandSlug}/workbench`}
            aria-label={$_('app.home.workbench.open')}
          >
            <LayoutGrid class="size-4 shrink-0" strokeWidth={1.9} />
            {#if !isMobile.current}
              <span class="topbar-status-label">{$_('app.home.workbench.title')}</span>
            {/if}
          </a>
        {/if}
      </div>
    </div>
  </header>
  {#if creditAlert && brandSlug}
    <div
      class="credit-strip"
      class:out={creditOut}
      role="status"
      title={$_('app.credits.remainingTitle', {
        values: { remaining: $credits?.remaining ?? 0, quota: $credits?.quota ?? 0 }
      })}
    >
      <span>
        {creditOut
          ? $_('app.credits.exhausted', { values: { date: creditReset } })
          : $_('app.credits.warning', { values: { percent: creditPct } })}
      </span>
      <UpgradeLink slug={brandSlug} />
    </div>
  {/if}
{/if}

<style>
  /* Pillola, non icona muta: deve dire cosa apre. Nasce come gemella di quella della
     ricerca, che nel frattempo è migrata in sidebar — da lì il nome proprio, così una
     pulizia di `.topbar-search` non lascia questa senza stile. Su mobile resta la sola
     icona, come ogni altro controllo della barra. */
  .topbar-status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    text-decoration: none;
  }
  .topbar-status:hover {
    color: var(--ink);
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }
  .topbar-status-label {
    font-size: 12.5px;
  }

  .credit-strip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 7px 16px;
    font-size: 12.5px;
    line-height: 1.35;
    text-align: center;
    background: color-mix(in srgb, #ca8a04 14%, var(--paper-2));
    color: #92400e;
    border-bottom: 1px solid color-mix(in srgb, #ca8a04 28%, transparent);
  }
  .credit-strip.out {
    background: color-mix(in srgb, #ef4444 14%, var(--paper-2));
    color: #b91c1c;
    border-bottom-color: color-mix(in srgb, #ef4444 30%, transparent);
  }
  :global(:root[data-theme="dark"]) .credit-strip {
    color: #fcd34d;
  }
  :global(:root[data-theme="dark"]) .credit-strip.out {
    color: #fca5a5;
  }
  .page-topbar {
    position: sticky;
    top: 0;
    z-index: 30;
    flex: 0 0 auto;
    height: var(--shell-top-h, 56px);
    box-sizing: border-box;
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
  }
  .page-topbar-inner {
    width: 100%;
    height: 100%;
    padding: 0 var(--content-pad-x, 20px);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    overflow: hidden;
  }
  .page-topbar-start {
    min-width: 0;
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }
  .page-topbar-burger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    margin-inline-start: -6px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--ink);
    cursor: pointer;
    flex: 0 0 auto;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .page-topbar-burger:active {
    background: color-mix(in srgb, var(--ink) 8%, transparent);
    transform: scale(0.96);
  }
  .page-topbar-burger svg {
    width: 22px;
    height: 22px;
  }
  .page-topbar-burger svg line {
    transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s;
    transform-origin: center;
  }
  .page-topbar-burger.is-open .b-top {
    transform: translateY(6px) rotate(45deg);
  }
  .page-topbar-burger.is-open .b-mid {
    opacity: 0;
  }
  .page-topbar-burger.is-open .b-bot {
    transform: translateY(-6px) rotate(-45deg);
  }
  .page-topbar-avatar {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
  }
  .page-topbar-stack {
    --sidebar: var(--paper);
  }

  .page-topbar-left {
    min-width: 0;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0px;
    overflow: hidden;
  }
  .page-topbar-section {
    margin: 0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-faint);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .page-topbar-title {
    margin: 0;
    font-family: var(--serif);
    font-size: var(--page-title-bar-size, 0.95rem) !important;
    font-weight: var(--page-title-weight, 600) !important;
    letter-spacing: var(--page-title-tracking, -0.04em) !important;
    line-height: 1.2 !important;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .page-topbar-sub {
    margin: 0;
    font-size: var(--page-title-bar-sub-size, 0.8rem) !important;
    line-height: 1.35;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .page-topbar-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 0 0 auto;
    max-width: 52%;
  }
  .page-topbar-actions-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 36px;
    padding: 0 10px 0 8px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    touch-action: manipulation;
    flex: 0 0 auto;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    transition: background-color 0.12s ease, color 0.12s ease;
  }
  .page-topbar-actions-btn-label {
    white-space: nowrap;
  }
  .page-topbar-actions-btn:hover,
  .page-topbar-actions-btn[data-state='open'] {
    background: var(--paper-2);
    color: var(--ink);
  }
  .page-topbar-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: nowrap;
    gap: 10px;
    min-width: 0;
    overflow: hidden;
  }
  /* Portaled dropdown — bits-ui defaults width to the trigger via
     --bits-dropdown-menu-anchor-width; we force near-viewport width on the Content. */
  :global([data-slot='dropdown-menu-content'].page-topbar-actions-menu) {
    width: 92vw !important;
    max-width: 92vw !important;
    min-width: 92vw !important;
    box-sizing: border-box;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    padding: 10px !important;
  }
  .page-topbar-actions--menu {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    flex-wrap: nowrap;
    gap: 8px;
    overflow: visible;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 0;
    box-sizing: border-box;
  }
  .page-topbar-actions--menu :global(form),
  .page-topbar-actions--menu :global(.topbar-cta-wrap) {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .page-topbar-actions--menu :global(a),
  .page-topbar-actions--menu :global(button),
  .page-topbar-actions--menu :global(label),
  .page-topbar-actions--menu :global(.topbar-cta),
  .page-topbar-actions--menu :global(.create-single),
  .page-topbar-actions--menu :global(.approve-all),
  .page-topbar-actions--menu :global(.cal-plan-link),
  .page-topbar-actions--menu :global(.obj-edit) {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    justify-content: flex-start !important;
    box-sizing: border-box !important;
    white-space: normal !important;
  }
  .page-topbar-actions--menu :global(.topbar-cta-label) {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .page-topbar-actions :global(.topbar-cta-wrap) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .page-topbar-actions :global(.topbar-cta-wrap.is-busy) {
    pointer-events: none;
  }
  /* Fallback for legacy topbar buttons that still use .btn.primary / page-local classes */
  .page-topbar-actions :global(button.btn.primary),
  .page-topbar-actions :global(label.btn.primary),
  .page-topbar-actions :global(.create-single),
  .page-topbar-actions :global(.approve-all),
  .page-topbar-actions :global(.topbar-cta) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    appearance: none;
    border: none;
    border-radius: 999px;
    padding: 9px 16px;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    line-height: 1;
    letter-spacing: 0.01em;
    white-space: nowrap;
    cursor: pointer;
    color: #fff;
    background: var(--accent);
    text-decoration: none;
    box-shadow:
      0 1px 0 color-mix(in srgb, #000 12%, transparent),
      0 6px 16px -8px color-mix(in srgb, var(--accent) 70%, transparent);
    transform: translateY(0) scale(1);
    transition:
      transform 0.15s ease,
      background 0.15s ease,
      box-shadow 0.15s ease,
      opacity 0.15s ease;
    touch-action: manipulation;
    user-select: none;
  }
  .page-topbar-actions--menu :global(button.btn.primary),
  .page-topbar-actions--menu :global(label.btn.primary),
  .page-topbar-actions--menu :global(.create-single),
  .page-topbar-actions--menu :global(.approve-all),
  .page-topbar-actions--menu :global(.topbar-cta) {
    border-radius: 10px;
    box-shadow: none;
  }
  .page-topbar-actions :global(button.btn.primary:hover:not(:disabled)),
  .page-topbar-actions :global(label.btn.primary:hover:not(.disabled)),
  .page-topbar-actions :global(.create-single:hover:not(:disabled)),
  .page-topbar-actions :global(.approve-all:hover:not(:disabled)),
  .page-topbar-actions :global(.topbar-cta:hover:not(:disabled)) {
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--accent) 88%, #000);
  }
  .page-topbar-actions :global(button.btn.primary:active:not(:disabled)),
  .page-topbar-actions :global(label.btn.primary:active:not(.disabled)),
  .page-topbar-actions :global(.create-single:active:not(:disabled)),
  .page-topbar-actions :global(.approve-all:active:not(:disabled)),
  .page-topbar-actions :global(.topbar-cta:active:not(:disabled)) {
    transform: translateY(1px) scale(0.98);
    background: color-mix(in srgb, var(--accent) 78%, #000);
    box-shadow: none;
  }
  .page-topbar-actions :global(button.btn.primary:disabled),
  .page-topbar-actions :global(label.btn.primary.disabled),
  .page-topbar-actions :global(.create-single:disabled),
  .page-topbar-actions :global(.approve-all:disabled),
  .page-topbar-actions :global(.topbar-cta:disabled) {
    opacity: 0.72;
    cursor: not-allowed;
    pointer-events: none;
    transform: none;
    box-shadow: none;
  }
  .page-topbar-actions :global(a.btn.ghost),
  .page-topbar-actions :global(button.btn.ghost),
  .page-topbar-actions :global(.approve-all.ghost),
  .page-topbar-actions :global(.obj-edit),
  .page-topbar-actions :global(.topbar-cta.ghost),
  .page-topbar-actions :global(.cal-plan-link) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
    border-radius: 999px;
    padding: 8px 14px;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
    text-decoration: none;
    transform: translateY(0) scale(1);
    transition:
      transform 0.15s ease,
      background 0.15s ease,
      border-color 0.15s ease,
      opacity 0.15s ease;
    touch-action: manipulation;
    user-select: none;
  }
  .page-topbar-actions--menu :global(a.btn.ghost),
  .page-topbar-actions--menu :global(button.btn.ghost),
  .page-topbar-actions--menu :global(.approve-all.ghost),
  .page-topbar-actions--menu :global(.obj-edit),
  .page-topbar-actions--menu :global(.topbar-cta.ghost),
  .page-topbar-actions--menu :global(.cal-plan-link) {
    border-radius: 10px;
    justify-content: flex-start;
  }
  .page-topbar-actions :global(.topbar-cta-icon) {
    width: 15px;
    height: 15px;
    flex: 0 0 15px;
  }
  .page-topbar-actions :global(a.btn.ghost:hover),
  .page-topbar-actions :global(button.btn.ghost:hover:not(:disabled)),
  .page-topbar-actions :global(.approve-all.ghost:hover:not(:disabled)),
  .page-topbar-actions :global(.obj-edit:hover:not(:disabled)),
  .page-topbar-actions :global(.topbar-cta.ghost:hover:not(:disabled)),
  .page-topbar-actions :global(.cal-plan-link:hover) {
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--accent) 14%, var(--paper));
  }
  .page-topbar-actions :global(a.btn.ghost:active),
  .page-topbar-actions :global(button.btn.ghost:active:not(:disabled)),
  .page-topbar-actions :global(.approve-all.ghost:active:not(:disabled)),
  .page-topbar-actions :global(.obj-edit:active:not(:disabled)),
  .page-topbar-actions :global(.topbar-cta.ghost:active:not(:disabled)) {
    transform: translateY(1px) scale(0.98);
  }
  .page-topbar-actions :global(button.btn.ghost:disabled),
  .page-topbar-actions :global(.approve-all.ghost:disabled),
  .page-topbar-actions :global(.obj-edit:disabled),
  .page-topbar-actions :global(.topbar-cta.ghost:disabled) {
    opacity: 0.72;
    cursor: not-allowed;
    pointer-events: none;
    transform: none;
  }
  .page-topbar-actions :global(.topbar-cta.neutral) {
    gap: 6px;
    border: 1px solid var(--line);
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 550;
    color: var(--ink-soft);
    background: transparent;
    box-shadow: none;
    transform: none;
  }
  .page-topbar-actions :global(.topbar-cta.neutral:hover:not(:disabled)) {
    color: var(--ink);
    background: var(--paper-2);
    border-color: var(--line-2);
    box-shadow: none;
    transform: none;
  }
  .page-topbar-actions :global(.topbar-cta.neutral:active:not(:disabled)) {
    background: var(--paper-3);
    box-shadow: none;
    transform: none;
  }
  .page-topbar-actions :global(.topbar-cta.neutral:focus-visible) {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .page-topbar-actions :global(.topbar-cta.neutral:disabled) {
    opacity: 0.72;
    cursor: not-allowed;
    pointer-events: none;
    transform: none;
  }
  .page-topbar-actions :global(.topbar-cta-spin),
  .page-topbar-actions :global(.spin) {
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    animation: topbar-spin 0.7s linear infinite;
  }
  .page-topbar-actions :global(.approve-all.ghost .spin) {
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
    border-top-color: var(--accent);
  }
  @keyframes topbar-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .topbar-warn-btn {
    position: relative;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    touch-action: manipulation;
    flex: 0 0 auto;
    transition: background-color 0.12s ease, color 0.12s ease;
  }
  .topbar-warn-btn:hover,
  .topbar-warn-btn.on {
    background: var(--paper-2);
    color: var(--ink);
  }
  .topbar-warn-count {
    position: absolute;
    top: -3px;
    right: -3px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 700;
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1.5px solid var(--paper);
    line-height: 1;
  }
  .topbar-warn-count.sev-error {
    background: #dc2626;
  }
  .topbar-warn-count.sev-warning {
    background: #d97706;
  }
  .topbar-warn-count.sev-suggestion {
    background: #2563eb;
  }
</style>
