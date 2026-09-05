<script lang="ts">
  /**
   * LA RICERCA GLOBALE (⌘K) — un campo solo per tutto il prodotto.
   *
   * Ora copre le pagine e le impostazioni, senza inventare cataloghi: OGNI gruppo legge la
   * fonte che il prodotto già usa —
   *   pagine       → `navGroups` (la nav vera) ∪ le rotte sotto /app/[brand] che stanno su disco
   *   impostazioni → SETTINGS_GROUPS (components/settings/platforms.ts)
   * Una lista scritta a mano qui invecchierebbe al primo rename di una rotta.
   */
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Search from '@lucide/svelte/icons/search';
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
  import { workbenchTabLabel } from '$lib/workbench-paths';
  import { SETTINGS_GROUPS } from '$lib/components/settings/platforms';
  import {
    GO_TARGETS,
    SECTION_LETTERS,
    SEQUENCE_TIMEOUT_MS,
    buildShortcuts,
    goTargetLabelKey,
    matchShortcut,
    paletteOpen,
    resolveSequence,
    seqLetter,
    type SeqTarget
  } from '$lib/shortcuts';

  let {
    base,
    brandSlug,
    navGroups = []
  }: {
    /** `/app/<slug>` del brand corrente. */
    base: string;
    brandSlug: string;
    /** La nav vera della sidebar, non una copia. */
    navGroups?: {
      label?: string;
      /** La SEZIONE stessa: dove porta il clic sulla riga di gruppo (landing del hub). */
      href?: string;
      /** L'id del hub (`web`, `publish`, …): la chiave con cui il registro le dà una lettera. */
      tourKey?: string;
      items?: { href: string; label: string }[];
    }[];
  } = $props();

  /**
   * Le rotte del brand che stanno su disco, lette a build time da Vite. Sostituisce l'elenco
   * scritto a mano che c'era prima: un registro di 46 stringhe da tenere allineato al
   * filesystem si stacca in silenzio, e qui non ha niente da decidere.
   * Fuori: le dinamiche (nessun href statico), le impostazioni (hanno il loro gruppo) e le tre
   * superfici di pagamento, che non sono una destinazione da cercare.
   */
  const NOT_A_DESTINATION = ['activate', 'success', 'proposal'];
  const BRAND_PREFIX = '/src/routes/app/[brand]/';
  const BRAND_ROUTES = Object.keys(import.meta.glob('/src/routes/app/**/+page.svelte'))
    .filter((file) => file.startsWith(BRAND_PREFIX))
    .map((file) => file.slice(BRAND_PREFIX.length, -'/+page.svelte'.length))
    .filter(
      (route) =>
        route &&
        !route.includes('[') &&
        !route.startsWith('settings/') &&
        !NOT_A_DESTINATION.includes(route)
    )
    .sort();

  type Group = 'action' | 'page' | 'settings';
  type Item = {
    id: string;
    group: Group;
    label: string;
    /** Riga secondaria: il gruppo di nav. */
    hint?: string;
    run: () => void;
  };

  let query = $state('');
  /** 'search' = la palette; 'help' = la scheda delle scorciatoie (tasto `?`). */
  let mode = $state<'search' | 'help'>('search');
  let cursor = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  const open = $derived($paletteOpen);

  // ── Apertura di una destinazione ────────────────────────────────────────────────────────────
  function openPage(href: string) {
    close();
    void goto(href);
  }
  function openSettings(section: string) {
    openPage(`${base}/settings/${section}`);
  }
  // ── Le sorgenti, tutte derivate da ciò che esiste già ────────────────────────────────────────
  const actionItems = $derived.by<Item[]>(() => [
    {
      id: 'a:workbench',
      group: 'action',
      label: $_('app.home.workbench.open'),
      run: () => openPage(`${base}/workbench`)
    },
    {
      id: 'a:settings',
      group: 'action',
      label: $_('app.nav.settings'),
      run: () => openSettings('')
    },
    {
      id: 'a:brands',
      group: 'action',
      label: $_('app.shell.cmdSwitchBrand'),
      run: () => {
        close();
        void goto('/app');
      }
    },
    {
      id: 'a:shortcuts',
      group: 'action',
      label: $_('app.shell.scHelp'),
      run: () => {
        mode = 'help';
      }
    }
  ]);

  /**
   * Le pagine: la nav vera per prima (porta le etichette che l'utente legge in sidebar e il nome
   * del gruppo), poi ogni rotta ospitabile che la nav non elenca, etichettata da
   * `workbenchTabLabel` — la stessa funzione che nomina le schede del workbench.
   */
  const pageItems = $derived.by<Item[]>(() => {
    const seen = new Set<string>();
    // Anche le ETICHETTE già usate dalla nav: `/content` e `/approvals` atterrano su Calendar e
    // `workbenchTabLabel` le chiama tutte "Calendario" — tre righe identiche non sono tre scelte.
    const seenLabels = new Set<string>();
    const out: Item[] = [];
    for (const g of navGroups) {
      for (const i of g.items ?? []) {
        if (!i.href || seen.has(i.href)) continue;
        seen.add(i.href);
        seenLabels.add(i.label);
        out.push({
          id: `p:${i.href}`,
          group: 'page',
          label: i.label,
          hint: g.label || undefined,
          run: () => openPage(i.href)
        });
      }
    }
    // Poi tutte le altre rotte del brand che stanno su disco. Nessun elenco da tenere allineato:
    // una pagina nuova si cerca il giorno che esiste, una cancellata sparisce da sola.
    for (const route of BRAND_ROUTES) {
      const href = `${base}/${route}`;
      if (seen.has(href)) continue;
      const label = workbenchTabLabel(href, base, $_);
      if (seenLabels.has(label)) continue;
      seen.add(href);
      seenLabels.add(label);
      out.push({
        id: `p:${href}`,
        group: 'page',
        label,
        hint: route,
        run: () => openPage(href)
      });
    }
    return out;
  });

  const settingsItems = $derived.by<Item[]>(() =>
    SETTINGS_GROUPS.flatMap((g) =>
      g.items.map((i) => ({
        id: `s:${i.section}`,
        group: 'settings' as const,
        label: $_(i.labelKey),
        hint: $_(g.labelKey),
        run: () => openSettings(i.section)
      }))
    )
  );

  // ── Filtro ──────────────────────────────────────────────────────────────────────────────────
  /** 3 = inizia con, 2 = inizio di parola, 1 = contiene, 0 = no. Basta a ordinare bene. */
  function score(text: string | undefined, q: string): number {
    if (!text) return 0;
    const t = text.toLowerCase();
    const i = t.indexOf(q);
    if (i < 0) return 0;
    if (i === 0) return 3;
    return /[\s/\-–—:.,]/.test(t[i - 1]) ? 2 : 1;
  }

  function filter(items: Item[], q: string, cap: number): Item[] {
    if (!q) return items.slice(0, cap);
    return items
      .map((it) => ({ it, s: score(it.label, q) * 2 + score(it.hint, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, cap)
      .map((r) => r.it);
  }

  const GROUP_LABEL: Record<Group, string> = {
    action: 'app.shell.cmdGroupActions',
    page: 'app.shell.cmdGroupPages',
    settings: 'app.shell.cmdGroupSettings'
  };

  /** I risultati raggruppati, nell'ordine in cui si mostrano. */
  const groups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const out: { group: Group; items: Item[] }[] = [
      // A campo vuoto la palette non è una lista di tutto: sono le azioni,
      // cioè quello che si fa davvero aprendola per sbaglio.
      { group: 'action', items: filter(actionItems, q, q ? 4 : 5) },
      { group: 'page', items: q ? filter(pageItems, q, 6) : [] },
      { group: 'settings', items: q ? filter(settingsItems, q, 5) : [] }
    ];
    return out.filter((g) => g.items.length > 0);
  });

  /** La lista piatta su cui si muovono le frecce (l'ordine visivo, gruppi inclusi). */
  const flat = $derived(groups.flatMap((g) => g.items));
  const activeId = $derived(flat[cursor]?.id ?? '');

  // Il cursore non può restare oltre la fine quando i risultati si accorciano scrivendo.
  $effect(() => {
    if (cursor > flat.length - 1) cursor = 0;
  });

  async function scrollActiveIntoView() {
    await tick();
    listEl?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    paletteOpen.set(false);
  }

  function openPalette(next: 'search' | 'help' = 'search') {
    mode = next;
    query = '';
    cursor = 0;
    paletteOpen.set(true);
  }

  $effect(() => {
    if (!open) return;
    void tick().then(() => inputEl?.focus());
  });

  // ── Le scorciatoie globali ──────────────────────────────────────────────────────────────────
  // UN solo ascoltatore per tutto il prodotto, e la decisione la prende il registro
  // ($lib/shortcuts.ts): qui si esegue e basta. `pending` è lo stato della sequenza `g`.
  let pending = $state(false);
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function armPending() {
    pending = true;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pending = false;
    }, SEQUENCE_TIMEOUT_MS);
  }
  function clearPending() {
    pending = false;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function runShortcut(id: string) {
    const letter = seqLetter(id);
    if (letter !== null) {
      // Lettera che non porta da nessuna parte: la sequenza muore lì, in silenzio.
      const hit = resolveSequence(letter, seqTargets);
      if (hit) openPage(hit.href);
      return;
    }
    if (id === 'palette') {
      if (open) close();
      else openPalette('search');
      return;
    }
    if (id === 'help') {
      openPalette('help');
      return;
    }
    if (id === 'settings') {
      openPage(`${base}/settings`);
      return;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    // Esc: lo gestisce l'overlay più in alto. Se la palette è aperta è lei.
    if (e.key === 'Escape') {
      clearPending();
      if (open) {
        e.preventDefault();
        close();
      }
      return;
    }
    const wasPending = pending;
    const m = matchShortcut(e, pending);
    if (wasPending) clearPending();
    // Con la palette aperta i tasti sono SUOI, sempre: il campo di ricerca è la superficie, e
    // `isTypingTarget` non basta perché per un istante (o se si clicca fuori dal campo) il fuoco
    // può stare altrove — e allora la `n` di "calendar" aprirebbe una chat dietro l'overlay.
    // Restano solo ⌘K, che chiude, ed Esc, gestito sopra.
    if (open && !(m.type === 'run' && m.id === 'palette')) return;
    if (m.type === 'pending') {
      e.preventDefault();
      armPending();
      return;
    }
    if (m.type !== 'run') return;
    e.preventDefault();
    runShortcut(m.id);
  }

  // La palette è stato del client: una navigazione vera (una CTA che porta altrove) la deve
  // trovare chiusa, non appesa sopra la pagina nuova.
  onMount(() => () => {
    clearPending();
    paletteOpen.set(false);
  });

  function onInputKeydown(e: KeyboardEvent) {
    if (mode === 'help') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cursor = flat.length ? (cursor + 1) % flat.length : 0;
      void scrollActiveIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cursor = flat.length ? (cursor - 1 + flat.length) % flat.length : 0;
      void scrollActiveIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[cursor]?.run();
    } else if (e.key === 'Home') {
      e.preventDefault();
      cursor = 0;
      void scrollActiveIntoView();
    } else if (e.key === 'End') {
      e.preventDefault();
      cursor = Math.max(0, flat.length - 1);
      void scrollActiveIntoView();
    }
  }

  /**
   * Le destinazioni di `g <lettera>`: le SEZIONI della sidebar (dai gruppi di nav vivi, così una
   * sezione tolta dal prodotto si porta via la sua scorciatoia) più le pagine-strumento di
   * GO_TARGETS, più la home. Nessuna lista scritta a mano: il registro dà solo le lettere.
   */
  const seqTargets = $derived.by<SeqTarget[]>(() => {
    const out: SeqTarget[] = [
      { key: SECTION_LETTERS.home, href: base, label: $_('app.nav.hireAgent') }
    ];
    for (const g of navGroups) {
      const key = g.tourKey ? SECTION_LETTERS[g.tourKey] : undefined;
      if (!key || !g.href) continue;
      out.push({ key, href: g.href, label: g.label ?? g.tourKey ?? '' });
    }
    for (const t of GO_TARGETS) {
      const labelKey = goTargetLabelKey(t.path);
      if (!labelKey) continue;
      out.push({ key: t.key, href: `${base}${t.path}`, label: $_(labelKey) });
    }
    return out;
  });

  const isMac =
    typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
  /** 'mod' → ⌘ o Ctrl, secondo la macchina. Le altre etichette passano com'erano. */
  function keyLabel(k: string): string {
    return k === 'mod' ? (isMac ? '⌘' : 'Ctrl') : k;
  }
  const helpRows = $derived(
    buildShortcuts(seqTargets).map((s) => ({
      keys: s.keys.map(keyLabel),
      label: s.label ?? $_(s.labelKey)
    }))
  );
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="cp-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
  >
    <div
      class="cp-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'help' ? $_('app.shell.scHelp') : $_('app.shell.cmdTitle')}
    >
      {#if mode === 'help'}
        <!-- La scheda di aiuto è GENERATA dal registro: se una scorciatoia cambia tasto, qui
             cambia da sola. Non può mentire su cosa fa la tastiera. -->
        <div class="cp-head">
          <h2 class="cp-help-title">{$_('app.shell.scHelp')}</h2>
          <button type="button" class="cp-esc" onclick={close}>Esc</button>
        </div>
        <ul class="cp-help">
          {#each helpRows as row (row.label + row.keys.join())}
            <li>
              <span class="cp-help-label">{row.label}</span>
              <span class="cp-keys">
                {#each row.keys as k (k)}<kbd>{k}</kbd>{/each}
              </span>
            </li>
          {/each}
          <li class="cp-help-note">{$_('app.shell.scGoNote')}</li>
        </ul>
      {:else}
        <div class="cp-head">
          <Search class="size-4 shrink-0 opacity-50" strokeWidth={1.9} aria-hidden="true" />
          <input
            bind:this={inputEl}
            bind:value={query}
            onkeydown={onInputKeydown}
            oninput={() => (cursor = 0)}
            class="cp-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-list"
            aria-autocomplete="list"
            aria-activedescendant={activeId ? `cp-opt-${activeId}` : undefined}
            placeholder={$_('app.shell.cmdPlaceholder')}
            aria-label={$_('app.shell.cmdTitle')}
            autocomplete="off"
            spellcheck="false"
          />
          <button
            type="button"
            class="cp-esc"
            onclick={() => (mode = 'help')}
            title={$_('app.shell.scHelp')}>?</button
          >
        </div>

        <div class="cp-list" id="cp-list" role="listbox" bind:this={listEl} tabindex="-1"
          aria-label={$_('app.shell.cmdTitle')}>
          {#if flat.length === 0}
            <!-- Mai un vuoto muto: si dice che non c'è niente e cosa provare. -->
            <p class="cp-empty">{$_('app.shell.cmdEmpty', { values: { q: query.trim() } })}</p>
          {:else}
            {#each groups as g (g.group)}
              <div class="cp-group" role="group" aria-label={$_(GROUP_LABEL[g.group])}>
                <div class="cp-group-label">{$_(GROUP_LABEL[g.group])}</div>
                {#each g.items as item (item.id)}
                  {@const idx = flat.indexOf(item)}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    id={`cp-opt-${item.id}`}
                    class="cp-item"
                    class:on={idx === cursor}
                    role="option"
                    aria-selected={idx === cursor}
                    tabindex="-1"
                    onclick={() => item.run()}
                    onmousemove={() => (cursor = idx)}
                  >
                    <span class="cp-text">
                      <span class="cp-label">{item.label}</span>
                      {#if item.hint}<span class="cp-hint">{item.hint}</span>{/if}
                    </span>
                    <!-- Ogni riga dice DI CHE TIPO è: un titolo di pagina e un titolo di chat
                         si somigliano troppo per lasciarlo indovinare. -->
                    <span class="cp-kind">{$_(GROUP_LABEL[item.group])}</span>
                    {#if idx === cursor}
                      <CornerDownLeft class="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
          {/if}
        </div>

        <div class="cp-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> {$_('app.shell.cmdNav')}</span>
          <span><kbd>↵</kbd> {$_('app.shell.cmdOpen')}</span>
          <span><kbd>?</kbd> {$_('app.shell.scHelp')}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* z-index 400: sopra la modal delle pagine (150) e sopra gli overlay che le pagine
     impostazioni aprono da sé (200-210) — la ricerca è sempre l'ultima cosa aperta. */
  .cp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 400;
    background: rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: min(14vh, 120px) 20px 20px;
  }
  .cp-dialog {
    display: flex;
    flex-direction: column;
    width: min(640px, 100%);
    max-height: min(68vh, 560px);
    background: var(--paper, #fff);
    border: 1px solid var(--line, #e3e3e6);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 40px 100px -24px rgba(0, 0, 0, 0.45);
  }
  /* Il movimento è un dettaglio, non il messaggio: chi lo ha disattivato vede la palette
     comparire e basta. */
  @media (prefers-reduced-motion: no-preference) {
    .cp-dialog {
      animation: cp-in 130ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes cp-in {
      from {
        opacity: 0;
        transform: translateY(-6px) scale(0.985);
      }
    }
  }

  .cp-head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line, #e3e3e6);
  }
  .cp-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 15px;
    color: var(--ink, #1d1d1f);
  }
  .cp-input::placeholder {
    color: var(--ink-faint, #86868b);
  }
  .cp-help-title {
    flex: 1;
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink, #1d1d1f);
  }
  .cp-esc {
    flex-shrink: 0;
    border: 1px solid var(--line, #e3e3e6);
    background: transparent;
    border-radius: 6px;
    padding: 2px 7px;
    font-size: 11px;
    color: var(--ink-soft, #6e6e73);
    cursor: pointer;
  }
  .cp-esc:hover {
    color: var(--ink, #1d1d1f);
  }

  .cp-list {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px;
  }
  .cp-group + .cp-group {
    margin-top: 4px;
  }
  .cp-group-label {
    padding: 6px 8px 3px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-faint, #86868b);
  }
  .cp-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 8px;
    border-radius: 9px;
    cursor: pointer;
  }
  .cp-item.on {
    background: var(--paper-2, #f5f5f7);
  }
  :global([data-theme='dark']) .cp-item.on {
    background: rgba(255, 255, 255, 0.07);
  }
  .cp-avatar {
    display: inline-flex;
    flex-shrink: 0;
  }
  .cp-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .cp-label {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ink, #1d1d1f);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cp-hint {
    font-size: 11.5px;
    color: var(--ink-soft, #6e6e73);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cp-kind {
    flex-shrink: 0;
    font-size: 10.5px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--ink-faint, #86868b);
  }

  .cp-empty {
    margin: 0;
    padding: 26px 16px;
    text-align: center;
    font-size: 13px;
    line-height: 1.6;
    color: var(--ink-soft, #6e6e73);
  }

  .cp-foot {
    display: flex;
    gap: 14px;
    padding: 8px 14px;
    border-top: 1px solid var(--line, #e3e3e6);
    font-size: 11px;
    color: var(--ink-faint, #86868b);
  }
  .cp-foot span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .cp-help {
    margin: 0;
    padding: 8px 8px 12px;
    list-style: none;
    overflow-y: auto;
  }
  .cp-help li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 8px;
    font-size: 13px;
    color: var(--ink, #1d1d1f);
  }
  .cp-help-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cp-help-note {
    display: block;
    padding-top: 10px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--ink-soft, #6e6e73);
  }
  .cp-keys {
    display: inline-flex;
    gap: 3px;
    flex-shrink: 0;
  }
  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border: 1px solid var(--line, #e3e3e6);
    border-radius: 5px;
    background: var(--paper-2, #f5f5f7);
    font-family: inherit;
    font-size: 11px;
    color: var(--ink-soft, #6e6e73);
  }
</style>
