<script module lang="ts">
  /* eslint-disable @typescript-eslint/no-explicit-any */

  /**
   * L'UNICA API di apertura della modal (impostazioni E pagine del brand). Su desktop l'URL non
   * cambia mai: la modal è puro stato del client e ospita la `+page.svelte` VERA, con i dati presi
   * da `preloadData(href)` — funziona proprio perché la rotta su disco esiste ancora.
   *
   * Serve un'API esplicita e non basta l'interceptor sui click: molte voci vivono in `DropdownMenu`
   * di bits-ui, portalati, che alla selezione smontano il contenuto; altre non sono `<a>` ma
   * bottoni che navigano a mano. L'interceptor stesso passa da qui.
   */
  let opener: ((target: string) => boolean) | null = null;
  let closer: (() => void) | null = null;

  function registerOpener(fn: ((target: string) => boolean) | null) {
    opener = fn;
  }

  /** Chiude la modal. Serve a una pagina OSPITATA che manda l'utente altrove senza navigare —
   * es. il composer della home, che sta proprio sotto il backdrop. */
  export function closePageModal(): void {
    closer?.();
  }

  /**
   * Apre la modal. `target`: href completo, sezione settings (`'profile'`), o vuoto per il default.
   * Torna `false` — e non fa nulla — quando la modal non può occuparsene (mobile, superfici senza
   * brand, rotta classificata `page`): allora il chiamante deve navigare, mai un click morto.
   */
  export function openPageModal(target = ''): boolean {
    return opener ? opener(target) : false;
  }

  export function onModalLinkClick(e: MouseEvent, target = '') {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (openPageModal(target)) e.preventDefault();
  }
</script>

<script lang="ts">
  import { page } from '$app/stores';
  import { onDestroy, setContext } from 'svelte';
  import { writable } from 'svelte/store';
  import { preloadData } from '$app/navigation';
  import { applyAction, deserialize } from '$app/forms';
  import { _ } from 'svelte-i18n';
  import { fade, scale } from 'svelte/transition';
  import XIcon from '@lucide/svelte/icons/x';
  import PageRail from '$lib/components/PageRail.svelte';
  import { isSettingsRoute, overlayRoute } from '$lib/overlay-route';
  import {
    SETTINGS_MODAL_DEFAULT,
    SETTINGS_MODAL_GROUPS,
    SETTINGS_MODAL_WIDE
  } from '$lib/components/settings/platforms';
  import { workbenchTabLabel } from '$lib/workbench-paths';
  import { matchShortcut, paletteOpen } from '$lib/shortcuts';
  import { emptyPageMeta, PAGE_META_SINK, type PageMetaSink } from '$lib/stores/page-meta';
  import { setHostedQuery } from '$lib/page-query';
  import { ModalSurface, modalVisible } from '$lib/page-modal-navigation';
  import { pageModalOrigin } from '$lib/stores/page-modal';
  // La modal ospita le +page.svelte vere senza il loro +layout: il contratto `.settings-shell`
  // (bbtn, apikey-*, team-form…) va portato qui.
  import '$lib/styles/settings-shell.css';

  let {
    base,
    desktop,
    navGroups = []
  }: {
    /** `/app/<slug>` del brand corrente. */
    base: string;
    /** Falso su mobile e sulle superfici a tutta larghezza: lì niente modal, mai. */
    desktop: boolean;
    /**
     * La STESSA nav della sidebar, non una copia. Tipo strutturale invece di importare `NavGroup`
     * da DashboardSidebar: quell'import chiude un ciclo che fa fallire l'SSR.
     */
    navGroups?: { label?: string; items?: { href: string; label: string }[] }[];
  } = $props();

  /** Titolo/sottotitolo/azioni della pagina OSPITATA. `PageHead` scrive qui invece che nei
   * writable globali (li trova via contesto), così il topbar della pagina viva sotto il backdrop
   * resta suo. Vedi stores/page-meta.ts. */
  const hostedHead: PageMetaSink = writable({ meta: emptyPageMeta, actions: null });
  setContext(PAGE_META_SINK, hostedHead);

  /** Rotta aperta: STATO, non URL. Suffisso rispetto a `base` (`settings/profile`, `calendar`).
   * `null` = modal chiusa. */
  let route = $state<string | null>(null);
  /** La query dell'href aperto (`?edit=123`): va tenuta, il `load` della rotta la legge. */
  let routeSearch = $state('');
  /** Nella modal l'URL del browser non cambia: una pagina che leggesse `page.url.searchParams`
   * vedrebbe i parametri della pagina SOTTO. `pageQuery()` ($lib/page-query.ts) trova questa. */
  setHostedQuery(() => routeSearch);
  let origin = $state<string | null>(null);
  const currentHref = $derived(`${$page.url.pathname}${$page.url.search}${$page.url.hash}`);
  const open = $derived(
    modalVisible(
      { route, origin },
      currentHref,
      desktop ? ModalSurface.Desktop : ModalSurface.FullWidth
    )
  );
  /** Le pagine del brand vogliono sempre la taglia larga; nelle impostazioni è l'eccezione
   * elencata in platforms.ts. */
  const isWide = (r: string | null) =>
    !!r &&
    (isSettingsRoute(r)
      ? (SETTINGS_MODAL_WIDE as readonly string[]).includes(r.slice('settings/'.length))
      : true);
  /** Su desktop la modal è SEMPRE armata, anche essendo atterrati su una rotta ospitabile:
   * altrimenti da lì ogni link tornava a navigare e sovrascriveva la pagina di partenza. */
  const intercepting = $derived(desktop);

  /** Da un target (href o sezione settings) alla rotta ospitabile. `overlayRoute` è la STESSA
   * funzione del drawer del burger su mobile: le due superfici non possono divergere. */
  function resolve(target: string): string | null {
    if (!target.startsWith('/')) return `settings/${target || SETTINGS_MODAL_DEFAULT}`;
    return overlayRoute(target, base);
  }

  // Il pattern deve essere STATICO e analizzabile da Vite: `*` non attraversa `/`, quindi `**` è
  // obbligatorio per le rotte annidate. Le chiavi restano il percorso sorgente letterale,
  // `[brand]` incluso — a build time è una directory vera, non un parametro.
  const pageModules = import.meta.glob('/src/routes/app/**/+page.svelte');
  const importerFor = (r: string) => pageModules[`/src/routes/app/[brand]/${r}/+page.svelte`];

  type Hosted = { route: string; component: any; data: Record<string, any> };
  let hosted = $state<Hosted | null>(null);
  let loadError = $state<string | null>(null);
  /** Non reattivo apposta: serve solo a scartare le risposte fuori ordine. */
  let requestSeq = 0;

  /** Dati con `preloadData` (i `load` VERI della rotta) e componente con l'import del glob. */
  async function loadRoute(next: string, search = '') {
    const href = `${base}/${next}${search}`;
    const importer = importerFor(next);
    const seq = ++requestSeq;
    if (!importer) {
      loadError = `no module for ${next}`;
      return;
    }
    try {
      const [result, mod] = await Promise.all([preloadData(href), importer()]);
      if (seq !== requestSeq) return; // sorpassata da un'altra rotta
      if (result.type !== 'loaded' || result.status !== 200) {
        loadError = `load ${result.type} ${result.type === 'loaded' ? result.status : ''}`.trim();
        return;
      }
      hosted = { route: next + search, component: (mod as any).default, data: result.data };
      loadError = null;
    } catch (err) {
      if (seq !== requestSeq) return;
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  function show(next: string, search = '') {
    const href = `${location.pathname}${location.search}${location.hash}`;
    if (origin !== href) {
      origin = href;
      pageModalOrigin.set(href);
    }
    if (route === next && routeSearch === search && hosted?.route === next + search) return;
    route = next;
    routeSearch = search;
    loadError = null;
    // `hosted` NON viene mai riportato a null: il guard `hosted.route === route` basta a
    // nasconderla. `{@const h = hosted}` compila in un derived, rivalutato anche mentre il blocco
    // muore: con null si legge `.data` di null e la modal smette di rispondere ai click.
    void loadRoute(next, search);
  }

  /** Unico ingresso registrato: href completo o sezione settings abbreviata, così chi naviga a
   * mano non duplica il parsing del path. `false` = non è roba nostra, naviga davvero. */
  function openTarget(target: string): boolean {
    const url = target.startsWith('/') ? new URL(target, location.origin) : null;
    const next = resolve(url ? url.pathname : target);
    if (next === null || !importerFor(next)) return false;
    // Già atterrati su questa pagina: aprirla in overlay sopra sé stessa non ha senso. Se la
    // modal è aperta si chiude, cioè si torna proprio a quella pagina.
    if (next === resolve(location.pathname)) {
      close();
      return true;
    }
    show(next, url?.search ?? '');
    return true;
  }

  function close() {
    const previousOrigin = origin;
    route = null;
    origin = null;
    pageModalOrigin.update((current) => (current === previousOrigin ? null : current));
    loadError = null;
  }

  onDestroy(close);

  /**
   * Le azioni delle pagine ospitate sono relative (`?/disconnect`) e SvelteKit le risolve
   * contro l'URL del BROWSER — che nella modal non è mai la rotta ospitata → 404
   * "No action". Riscriviamo form/button sulla rotta vera in fase di submit (capture,
   * prima che `use:enhance` legga `action`), e applichiamo noi il risultato a `page.form`:
   * il fallback di SvelteKit salta `applyAction` quando il pathname non coincide, e senza
   * quello né i toast né il ricarico della sezione partirebbero.
   */
  const actionUrlFor = (relative: string) =>
    routeSearch ? `${base}/${route}${routeSearch}&${relative.slice(1)}` : `${base}/${route}${relative}`;

  function onFormSubmitCapture(e: SubmitEvent) {
    if (!open) {
      return;
    }
    const rewrite = (el: Element, attr: 'action' | 'formaction') => {
      const value = el.getAttribute(attr);
      if (value?.startsWith('?/')) el.setAttribute(attr, actionUrlFor(value));
    };
    if (e.target instanceof HTMLFormElement) rewrite(e.target, 'action');
    if (e.submitter) rewrite(e.submitter, 'formaction');
  }

  $effect(() => {
    const nativeFetch: typeof window.fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await nativeFetch(input as RequestInfo, init);
      try {
        const r = route;
        const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        if (open && r && method.toUpperCase() === 'POST' && url.pathname === `${base}/${r}` && res.ok) {
          const result = deserialize(await res.clone().text());
          if (result.type === 'success' || result.type === 'failure') void applyAction(result);
        }
      } catch {
        // risposta non-azione (o body non JSON): passa indietro intatta
      }
      return res;
    };
    return () => {
      window.fetch = nativeFetch;
    };
  });

  // Il marker su <html> dice "da adesso un click su una pagina del brand apre la modal invece di
  // navigare": prima dell'idratazione i link sono link normali e nessun JS può impedirlo, quindi
  // lo si dichiara invece di fingere.
  $effect(() => {
    if (!desktop) return;
    registerOpener(openTarget);
    closer = close;
    document.documentElement.dataset.settingsModal = 'ready';
    return () => {
      registerOpener(null);
      closer = null;
      delete document.documentElement.dataset.settingsModal;
    };
  });

  $effect(() => {
    const current = currentHref;
    if (route === null || current === origin || !desktop) {
      return;
    }
    close();
  });

  // Dopo una action (`use:enhance` nelle pagine ospitate) `applyAction` aggiorna
  // page.form, ma `invalidateAll` rilancia i load della route SOTTOSTANTE: i dati
  // della sezione ospitata vanno ricaricati a mano, o resterebbero stali.
  let lastForm: unknown = null;
  $effect(() => {
    const f = $page.form;
    if (f === lastForm) return;
    lastForm = f;
    if (f == null) return;
    const r = route;
    if (r) void loadRoute(r, routeSearch);
  });

  /**
   * UN solo interceptor per tutti i link interni al brand sparsi nel prodotto
   * (sidebar, gear, CTA, card, checklist): niente modifiche alle pagine. Capture-phase
   * per battere il router di SvelteKit. Perimetro: le rotte classificate `modal` sotto
   * /app/<slug>/ — `resolve` torna null per tutte le altre, che navigano come sempre.
   */
  function onClickCapture(e: MouseEvent) {
    if (!intercepting) return;
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || !a.href) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    if (a.hasAttribute('data-settings-full') || a.hasAttribute('data-sveltekit-reload')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    // Stessa porta di tutti gli altri ingressi: openTarget decide, e riconosce la pagina corrente.
    if (!openTarget(url.pathname + url.search)) return; // rotta `page` → navigazione vera
    e.preventDefault();
  }

  function onKeydown(e: KeyboardEvent) {
    // QUALE tasto lo dice il registro ($lib/shortcuts.ts), così la scheda di aiuto non può
    // divergere; COSA fa resta qui: aperta → chiude, chiusa → apre.
    const m = matchShortcut(e);
    if (m.type === 'run' && m.id === 'settings' && desktop) {
      e.preventDefault();
      if (open) close();
      else show(`settings/${SETTINGS_MODAL_DEFAULT}`);
      return;
    }
    // Esc chiude l'overlay più in alto: con la palette aperta è LEI, non questa modal.
    if (e.key === 'Escape' && open && !$paletteOpen) {
      e.preventDefault();
      close();
    }
  }

  let dialogEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogEl?.focus();
    // Il titolo della scheda appartiene alla pagina VIVA sotto: 21 pagine ospitabili hanno un
    // `<svelte:head><title>`, che finisce in `document.head` da ovunque nell'albero, e aprendo la
    // modal la scheda si rinominava restando poi col nome sbagliato.
    // ponytail: MutationObserver invece di toccare 21 `<svelte:head>`; il callback gira a fine
    // microtask, quindi prima del paint. Sparisce se le pagine passano da `PageHead`.
    const pinnedTitle = document.title;
    const repin = () => {
      if (document.title !== pinnedTitle) document.title = pinnedTitle;
    };
    const titleGuard = new MutationObserver(repin);
    titleGuard.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      document.body.style.overflow = prev;
      titleGuard.disconnect();
      repin();
    };
  });

  /** Il titolo: chiave i18n per le impostazioni, etichetta di workbench per le pagine. */
  const currentTitle = $derived.by(() => {
    if (!route) return $_('app.nav.settings');
    if (isSettingsRoute(route)) {
      const s = route.slice('settings/'.length);
      const key = SETTINGS_MODAL_GROUPS.flatMap((g) => g.items).find(
        (i) => i.section === s
      )?.labelKey;
      return $_(key ?? 'app.nav.settings');
    }
    return workbenchTabLabel(`${base}/${route}`, base, $_);
  });
</script>

<svelte:window onclickcapture={onClickCapture} onkeydown={onKeydown} onsubmitcapture={onFormSubmitCapture} />

<!-- Mai un corpo vuoto e muto: se la sezione non si carica lo si dice, con la via d'uscita verso
     la pagina piena. È l'UNICA uscita da un carico fallito, per questo `app.settings.modalExpand`
     non è orfana. -->
{#snippet loadFailed()}
  <p class="sm-error">
    {$_('app.settings.modalFailed')}
    <a href={`${base}/${route}${routeSearch}`} data-settings-full>
      {$_('app.settings.modalExpand')}
    </a>
  </p>
{/snippet}

{#if open}
  <div
    class="sm-backdrop"
    role="presentation"
    transition:fade={{ duration: 140 }}
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
  >
    <div
      class="sm-dialog"
      class:wide={isWide(route)}
      role="dialog"
      aria-modal="true"
      aria-label={currentTitle}
      tabindex="-1"
      bind:this={dialogEl}
      transition:scale={{ duration: 160, start: 0.97 }}
    >
      <PageRail {base} {route} {navGroups} hosted={(r) => !!importerFor(r)} />

      <div class="sm-content">
        <header class="sm-head">
          <div class="sm-head-title">
            <h2>{$hostedHead.meta.title ?? currentTitle}</h2>
            {#if $hostedHead.meta.subtitle}
              <p class="sm-head-sub">{$hostedHead.meta.subtitle}</p>
            {/if}
          </div>
          <div class="sm-head-actions">
            {#if $hostedHead.actions}
              <div class="sm-head-cta">{@render $hostedHead.actions()}</div>
            {/if}
            <button
              type="button"
              class="sm-iconbtn"
              onclick={close}
              aria-label={$_('app.settings.close')}
              title={$_('app.settings.close')}
            >
              <XIcon class="size-4" strokeWidth={1.8} />
            </button>
          </div>
        </header>

        <div class="sm-body settings-shell" data-in-modal>
          {#if hosted && hosted.route === (route ?? '') + routeSearch}
            <!-- `{@const}` compila in un derived: `h` NON è una copia, rilegge `hosted` anche
                 mentre il blocco muore. Per questo `hosted` non torna mai a null (vedi `show`). -->
            {@const h = hosted}
            {@const PageComponent = h.component}
            <!-- `{#key}` sulla rotta: senza, cambiando pagina Svelte può AGGIORNARE il componente
                 ancora montato coi dati della pagina nuova prima di sostituirlo. -->
            {#key h.route}
              <!-- Il carico fallisce in DUE punti: la rete (`loadError`) e il RENDER della pagina
                   ospitata. Senza boundary un errore di render lascia lo scheletro che pulsa per
                   sempre, senza uscita. -->
              <svelte:boundary onerror={(e) => console.error('[PageModal]', h.route, e)}>
                <div class="settings">
                  <!-- Stesse props che riceve come pagina: `data` dai load reali, `form`
                       dall'ultima action. -->
                  <PageComponent data={h.data} form={$page.form} />
                </div>
                {#snippet failed()}
                  {@render loadFailed()}
                {/snippet}
              </svelte:boundary>
            {/key}
          {:else if loadError}
            {@render loadFailed()}
          {:else}
            <!-- preload in corso (o riallineamento back/forward) -->
            <div class="sm-shimmer" aria-hidden="true">
              <div class="sm-sk" style="width: 40%"></div>
              <div class="sm-sk tall"></div>
              <div class="sm-sk" style="width: 65%"></div>
              <div class="sm-sk tall"></div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* z-index 150: sopra la chrome dell'app (sidebar 30, barre 100-111) ma SOTTO gli overlay che le
     pagine settings aprono da sé (z 200-210), o la conferma "scrivi il nome del brand" resterebbe
     intrappolata dietro il modal. */
  .sm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 150;
    background: rgba(0, 0, 0, 0.44);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 28px;
  }
  .sm-dialog {
    display: flex;
    width: min(920px, 100%);
    height: min(85vh, 680px);
    background: var(--paper, #fff);
    border: 1px solid var(--line, #e3e3e6);
    border-radius: 18px;
    overflow: hidden;
    box-shadow: 0 40px 100px -24px rgba(0, 0, 0, 0.45);
    outline: none;
    transition: width 160ms var(--ease, ease);
  }
  /* Sezioni con griglie, anteprime o grafici: più larghezza, non l'esclusione. */
  .sm-dialog.wide {
    width: min(1180px, 100%);
  }

  /* Il rail (`.sm-rail`, `.sm-item`…) vive in PageRail.svelte: una resa sola per la colonna
     della modal e per il drawer del burger. */

  .sm-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .sm-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--line, #e3e3e6);
  }
  .sm-head-title {
    min-width: 0;
  }
  .sm-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink, #1d1d1f);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sm-head-sub {
    margin: 2px 0 0;
    font-size: 12px;
    line-height: 1.35;
    color: var(--ink-soft, #6e6e73);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sm-head-cta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
    margin-right: 4px;
  }
  .sm-head-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sm-iconbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-soft, #6e6e73);
    cursor: pointer;
    text-decoration: none;
  }
  .sm-iconbtn:hover {
    background: rgba(0, 0, 0, 0.05);
    color: var(--ink, #1d1d1f);
  }
  :global([data-theme='dark']) .sm-iconbtn:hover {
    background: rgba(255, 255, 255, 0.07);
  }

  .sm-body {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 18px 20px 26px;
  }

  /* Le pagine ospitate nascono per la colonna larga delle impostazioni: si adattano da shell,
     MAI ritoccando i CSS delle singole pagine. */
  .sm-body :global(.panel) {
    max-width: none;
  }
  .sm-body :global(.banner) {
    margin-top: 0;
  }

  .sm-error {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--ink-soft, #6e6e73);
  }
  .sm-error a {
    color: var(--accent, #7c5cff);
  }

  .sm-shimmer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sm-sk {
    height: 16px;
    border-radius: 8px;
    background: var(--paper-2, #f5f5f7);
    animation: sm-pulse 1.2s ease-in-out infinite;
  }
  .sm-sk.tall {
    height: 120px;
    border-radius: 14px;
  }
  @keyframes sm-pulse {
    50% {
      opacity: 0.55;
    }
  }
</style>
