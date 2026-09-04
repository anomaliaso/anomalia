<script lang="ts">
  /**
   * La mappa delle impostazioni dentro il drawer che apre il burger su mobile: là la
   * `SettingsSidebar` non è montata, e senza questo da una pagina di impostazioni non si
   * raggiunge nessun'altra. Le voci sono `SETTINGS_GROUPS`, le stesse della sidebar vera —
   * una seconda lista scritta per il telefono sarebbe la terza da tenere allineata.
   */
  import { page } from '$app/stores';
  import { _ } from 'svelte-i18n';
  import { SETTINGS_GROUPS } from '$lib/components/settings/platforms';

  let {
    base,
    section,
    onnavigate
  }: {
    /** `/app/<slug>` del brand corrente. */
    base: string;
    /** La sezione aperta (`profile`, `ads/accounts`): decide la voce attiva. */
    section: string | null;
    /** Il drawer si chiude quando si sceglie una voce. */
    onnavigate?: () => void;
  } = $props();

  const settingsBase = $derived(`${base}/settings`);
  const adsOn = $derived(!!$page.data.flags?.ads);
  const connectorsOn = $derived($page.data.flags?.connectors !== false);

  const groups = $derived(
    SETTINGS_GROUPS.map((g) => ({
      label: $_(g.labelKey),
      items: g.items
        .filter((i) => !i.flag || (i.flag === 'ads' ? adsOn : connectorsOn))
        .map((i) => ({
          section: i.section,
          href: `${settingsBase}/${i.section}`,
          label: $_(i.labelKey)
        }))
    })).filter((g) => g.items.length > 0)
  );

  // La lista è lunga (~25 voci) e si apre in cima: senza questo la sezione in cui SI È resta
  // sotto la piega, e il rail sembra non sapere dove sei.
  let railEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!railEl) return;
    railEl.querySelector('.sm-item.active')?.scrollIntoView({ block: 'center' });
  });
</script>

<nav class="sm-rail" aria-label={$_('app.nav.settings')} bind:this={railEl}>
  <div class="sm-rail-title">{$_('app.nav.settings')}</div>
  {#each groups as group, gi (group.label || gi)}
    {#if group.label}<div class="sm-group-label">{group.label}</div>{/if}
    {#each group.items as item (item.href)}
      <a
        class="sm-item"
        class:active={item.section === section}
        href={item.href}
        aria-current={item.section === section ? 'page' : undefined}
        onclick={() => onnavigate?.()}
      >
        <span>{item.label}</span>
      </a>
    {/each}
  {/each}
</nav>

<style>
  /* Il rail È il pannello del drawer: niente colonna fissa, niente bordo (ce l'ha il
     pannello). */
  .sm-rail {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 10px 18px;
    background: var(--paper-2, #f5f5f7);
    overflow-y: auto;
    overscroll-behavior: contain;
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
  /* Bersaglio da dito: il drawer esiste solo sul telefono. */
  .sm-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 10px;
    border-radius: 8px;
    font-size: 14.5px;
    font-weight: 500;
    color: var(--ink-soft, #6e6e73);
    text-decoration: none;
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
