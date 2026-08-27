<script lang="ts">
  /**
   * Il rail della sovrapposizione: UNA definizione delle voci e UNA resa, per due
   * superfici. Su desktop è la colonna sinistra della modal (`PageModal`), su mobile è il
   * contenuto del drawer che apre il burger (`PageRailDrawer`). Stesse voci, stessi
   * gruppi, stesso stato attivo, stesso aspetto: una seconda lista scritta per il telefono
   * sarebbe la terza da tenere allineata.
   *
   * Le DUE famiglie (impostazioni / pagine del brand) sono quelle di sempre: le sezioni
   * settings vengono da `SETTINGS_MODAL_GROUPS`, le pagine dalla nav della sidebar passata
   * dal layout — mai una copia scritta a mano.
   */
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import { SETTINGS_MODAL_GROUPS } from '$lib/components/settings/platforms';
  import { isSettingsRoute, overlayRoute } from '$lib/overlay-route';

  let {
    base,
    route,
    navGroups = [],
    hosted = () => true,
    drawer = false,
    onnavigate
  }: {
    /** `/app/<slug>` del brand corrente. */
    base: string;
    /** La rotta aperta (`settings/profile`, `calendar`): decide famiglia e voce attiva. */
    route: string | null;
    /**
     * La nav della sidebar, in forma strutturale invece di importare `NavGroup` da
     * DashboardSidebar: quell'import chiudeva un ciclo che faceva fallire l'SSR.
     */
    navGroups?: { label?: string; items?: { href: string; label: string }[] }[];
    /**
     * Quali voci la superficie sa ospitare. Nella modal è il glob dei moduli (le altre
     * mostrano ↗ e navigano davvero); su mobile è sempre vero, perché lì ogni voce È una
     * pagina piena.
     */
    hosted?: (route: string) => boolean;
    /** Nel drawer il rail riempie il pannello invece di essere una colonna fissa. */
    drawer?: boolean;
    /** Il drawer si chiude quando si sceglie una voce. */
    onnavigate?: () => void;
  } = $props();

  const settingsBase = $derived(`${base}/settings`);
  const adsOn = $derived(!!$page.data.flags?.ads);
  const connectorsOn = $derived($page.data.flags?.connectors !== false);

  const groups = $derived.by(() => {
    if (isSettingsRoute(route)) {
      return SETTINGS_MODAL_GROUPS.map((g) => ({
        label: $_(g.labelKey),
        items: g.items
          .filter((i) => !i.flag || (i.flag === 'ads' ? adsOn : connectorsOn))
          .map((i) => ({
            route: `settings/${i.section}`,
            href: `${settingsBase}/${i.section}`,
            label: $_(i.labelKey)
          }))
      })).filter((g) => g.items.length > 0);
    }
    return navGroups
      .map((g) => ({
        label: g.label ?? '',
        items: (g.items ?? [])
          .filter((i) => !!i.href)
          .map((i) => ({
            route: overlayRoute(new URL(i.href, 'http://x').pathname, base) ?? '',
            href: i.href,
            label: i.label
          }))
      }))
      .filter((g) => g.items.length > 0);
  });

  const title = $derived(isSettingsRoute(route) ? $_('app.nav.settings') : $_('app.nav2.spaces'));

  // Nel drawer la lista è lunga (le impostazioni sono ~25 voci) e si apre in cima: senza
  // questo la sezione in cui SI È resta sotto la piega, e il rail sembra non sapere dove
  // sei. Nella colonna della modal non serve — ci sta quasi tutta.
  let railEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!drawer || !railEl) return;
    railEl.querySelector('.sm-item.active')?.scrollIntoView({ block: 'center' });
  });
</script>

<nav class="sm-rail" class:drawer aria-label={title} bind:this={railEl}>
  <div class="sm-rail-title">{title}</div>
  {#each groups as group, gi (group.label || gi)}
    {#if group.label}<div class="sm-group-label">{group.label}</div>{/if}
    {#each group.items as item (item.href)}
      {@const full = !item.route || !hosted(item.route)}
      <a
        class="sm-item"
        class:active={!!item.route && item.route === route}
        href={item.href}
        aria-current={item.route === route ? 'page' : undefined}
        data-settings-full={full ? '' : undefined}
        onclick={() => onnavigate?.()}
      >
        <span>{item.label}</span>
        {#if full}
          <!-- Resta pagina piena: si dichiara, non sembra rotta. -->
          <ArrowUpRight class="size-3 shrink-0 opacity-50" strokeWidth={2} />
        {/if}
      </a>
    {/each}
  {/each}
</nav>

<style>
  .sm-rail {
    flex: 0 0 214px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 16px 10px 14px;
    background: var(--paper-2, #f5f5f7);
    border-right: 1px solid var(--line, #e3e3e6);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  /* Nel drawer il rail È il pannello: niente colonna fissa, niente bordo (ce l'ha il
     pannello) — stesso fondo della modal, che è il punto della richiesta. */
  .sm-rail.drawer {
    flex: 1 1 auto;
    min-height: 0;
    border-right: 0;
    padding: 6px 10px 18px;
  }
  .sm-rail-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink, #1d1d1f);
    padding: 0 8px 6px;
  }
  .sm-group-label {
    margin: 12px 0 3px;
    padding: 0 8px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-faint, #86868b);
  }
  .sm-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-soft, #6e6e73);
    text-decoration: none;
  }
  /* Bersaglio da dito: nel drawer le righe sono più alte e più grandi, la resa resta
     la stessa (stesso fondo, stesso attivo, stessi gruppi). */
  .sm-rail.drawer .sm-item {
    padding: 10px 10px;
    font-size: 14.5px;
  }
  .sm-item:hover {
    background: rgba(0, 0, 0, 0.045);
    color: var(--ink, #1d1d1f);
  }
  :global([data-theme='dark']) .sm-item:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .sm-item.active {
    background: var(--paper, #fff);
    color: var(--ink, #1d1d1f);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
</style>
