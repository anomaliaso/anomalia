<script lang="ts">
  import { enhance } from '$app/forms';
  import { SvelteSet } from 'svelte/reactivity';
  import { _ } from 'svelte-i18n';
  // Locale metadata is a plain constant list — safe to import into a component (no server deps).
  import { BLOG_LOCALES, BLOG_LOCALE_NATIVE } from '$lib/blog-locales';
  import { jpegIfHeicFormFiles } from '$lib/raster-image-client';
  import { RASTER_IMAGE_ACCEPT } from '$lib/raster-image';

  let {
    data,
    form
  }: {
    data: {
      config: {
        title: string;
        description: string;
        accent: string;
        font: string;
        iconUrl: string | null;
        styleInstructions: string;
        articlesPerWeek: number;
        locales: {
          defaultLocale: string;
          extraLocales: string[];
          allLocales: string[];
          maxExtra: number;
        };
        layout: string;
        navbarLinks: Array<{ label?: string; url?: string }>;
        showBlogLink: boolean;
        humanizerEnabled: boolean;
        backlinkNetwork: boolean;
      };
      brandName: string;
      brandLogoUrl: string | null;
      fontKeys: string[];
      backlinkNetworkAllowed?: boolean;
    };
    form?: Record<string, unknown> | null;
  } = $props();

  const busy = new SvelteSet<string>();
  const isBusy = (key: string) => busy.has(key);
  /** Keep field values after save — default reset would empty inputs and a second click would wipe DB. */
  const withBusy = (key: string) => () => {
    busy.add(key);
    return async ({
      update
    }: {
      update: (opts?: { reset?: boolean }) => Promise<void>;
    }) => {
      await update({ reset: false });
      busy.delete(key);
    };
  };

  const fontLabel: Record<string, string> = {
    sans: 'Sistema',
    serif: 'Serif',
    rounded: 'Arrotondato',
    mono: 'Mono'
  };

  let defaultLocale = $state(data.config.locales.defaultLocale);
  let layout = $state(data.config.layout === 'sidebar' ? 'sidebar' : 'navbar');
  let showBlogLink = $state(data.config.showBlogLink);
  let humanizerEnabled = $state(data.config.humanizerEnabled);
  let backlinkNetwork = $state(data.config.backlinkNetwork);
  let accent = $state(data.config.accent);

  $effect(() => {
    defaultLocale = data.config.locales.defaultLocale;
    layout = data.config.layout === 'sidebar' ? 'sidebar' : 'navbar';
    showBlogLink = data.config.showBlogLink;
    humanizerEnabled = data.config.humanizerEnabled;
    backlinkNetwork = data.config.backlinkNetwork;
    accent = data.config.accent;
  });

  const displayIcon = $derived(data.config.iconUrl || data.brandLogoUrl);
  const usingBrandLogo = $derived(!data.config.iconUrl && !!data.brandLogoUrl);
  const extraLocaleChoices = $derived(
    BLOG_LOCALES.filter((c) => c !== defaultLocale)
  );

  type Toast = { kind: 'ok' | 'err'; text: string };
  let toast = $state<Toast | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const f = form;
    if (!f) return;
    let next: Toast | null = null;
    if (f.customized) next = { kind: 'ok', text: 'Aspetto del blog aggiornato.' };
    else if (f.iconUploaded) next = { kind: 'ok', text: 'Icona aggiornata.' };
    else if (f.iconRemoved) next = { kind: 'ok', text: 'Icona rimossa.' };
    else if (f.error === 'too_large') next = { kind: 'err', text: 'Icona troppo grande (max 2MB).' };
    else if (f.error === 'not_image') next = { kind: 'err', text: 'Il file dev\'essere un\'immagine.' };
    else if (typeof f.error === 'string' && f.error)
      next = { kind: 'err', text: `Errore: ${f.error}` };
    if (!next) return;
    toast = next;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, 4200);
  });
</script>

{#if toast}
  <div class="snackbar {toast.kind}" role="status" aria-live="polite">{toast.text}</div>
{/if}

<div class="appearance-layout">
  <!-- ── Identità (icon forms can't nest inside the save form) ───── -->
  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Identità</div>
        <p class="panel-sub">Nome, descrizione e icona che i lettori vedono sul blog.</p>
      </div>
    </div>
    <div class="panel-body identity">
      <div class="icon-col">
        <div class="icon-preview" style="--accent:{accent};">
          {#if displayIcon}
            <img src={displayIcon} alt="icona del blog" />
          {:else}
            <span>{(data.config.title || data.brandName || '?').slice(0, 1)}</span>
          {/if}
        </div>
        <form
          method="POST"
          action="?/uploadIcon"
          use:enhance={async ({ formData }) => {
            await jpegIfHeicFormFiles(formData, 'icon');
            return withBusy('icon')();
          }}
          enctype="multipart/form-data"
          class="icon-upload"
        >
          <label class="btn ghost file-btn" class:loading={isBusy('icon')}>
            Carica icona
            <input
              type="file"
              name="icon"
              accept={RASTER_IMAGE_ACCEPT}
              onchange={(e) => e.currentTarget.form?.requestSubmit()}
              hidden
            />
          </label>
        </form>
        {#if data.config.iconUrl}
          <form method="POST" action="?/removeIcon" use:enhance={withBusy('icon')}>
            <button class="btn-link" type="submit" disabled={isBusy('icon')}>Rimuovi</button>
          </form>
        {/if}
        {#if usingBrandLogo}
          <p class="muted small">Usa il logo del brand come default.</p>
        {:else}
          <p class="muted small">Diventa la favicon. Se manca, usa il logo del brand.</p>
        {/if}
      </div>

      <div class="identity-fields">
        <label class="fld">
          <span class="fld-label">Nome del blog</span>
          <input
            form="blog-customize"
            type="text"
            name="title"
            value={data.config.title}
            placeholder={data.brandName}
          />
        </label>
        <label class="fld">
          <span class="fld-label">Descrizione (SEO)</span>
          <textarea
            form="blog-customize"
            name="description"
            rows="2"
            maxlength="300"
            placeholder="Una frase che descrive il blog — usata nei meta tag e nell'anteprima social."
            >{data.config.description}</textarea
          >
          <span class="fld-hint">Compare nei risultati di ricerca e nelle anteprime social.</span>
        </label>
      </div>
    </div>
  </section>

  <form
    id="blog-customize"
    method="POST"
    action="?/saveCustomization"
    use:enhance={withBusy('customize')}
    class="customize-form"
  >
  <!-- ── Aspetto ──────────────────────────────────────────────────── -->
  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Aspetto</div>
        <p class="panel-sub">Colore, tipografia e struttura della homepage.</p>
      </div>
    </div>
    <div class="panel-body stack">
      <div class="row2">
        <label class="fld">
          <span class="fld-label">Colore accent</span>
          <div class="color-wrap">
            <input type="color" name="accent" bind:value={accent} class="color" />
            <span class="color-hex">{accent}</span>
          </div>
          <span class="fld-hint">Tinge link, hover e dettagli.</span>
        </label>
        <label class="fld">
          <span class="fld-label">Font</span>
          <select name="font">
            {#each data.fontKeys as f}
              <option value={f} selected={data.config.font === f}>{fontLabel[f] ?? f}</option>
            {/each}
          </select>
          <span class="fld-hint">Si applica a testo e titoli.</span>
        </label>
      </div>

      <div class="fld">
        <span class="fld-label">Layout homepage</span>
        <div class="layout-grid" role="radiogroup" aria-label="Layout homepage">
          <label class="layout-card" class:on={layout === 'navbar'}>
            <input type="radio" name="layout" value="navbar" bind:group={layout} />
            <span class="layout-mock navbar" aria-hidden="true">
              <span class="mock-bar"></span>
              <span class="mock-rows">
                <span></span><span></span><span></span>
              </span>
            </span>
            <span class="layout-meta">
              <span class="layout-title">Navbar in alto</span>
              <span class="layout-desc">Navigazione orizzontale sopra gli articoli.</span>
            </span>
          </label>
          <label class="layout-card" class:on={layout === 'sidebar'}>
            <input type="radio" name="layout" value="sidebar" bind:group={layout} />
            <span class="layout-mock sidebar" aria-hidden="true">
              <span class="mock-side"></span>
              <span class="mock-rows">
                <span></span><span></span><span></span>
              </span>
            </span>
            <span class="layout-meta">
              <span class="layout-title">Sidebar a sinistra</span>
              <span class="layout-desc">Menu laterale fisso, più spazio agli articoli.</span>
            </span>
          </label>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Lingue ───────────────────────────────────────────────────── -->
  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Lingue</div>
        <p class="panel-sub">
          In quale lingua scrivi e, se il piano lo consente, in quali tradurre.
        </p>
      </div>
    </div>
    <div class="panel-body stack">
      <label class="fld">
        <span class="fld-label">Lingua principale</span>
        <select name="defaultLocale" bind:value={defaultLocale} class="locale-select">
          {#each BLOG_LOCALES as code (code)}
            <option value={code}>{BLOG_LOCALE_NATIVE[code]}</option>
          {/each}
        </select>
        <span class="fld-hint">
          Gli articoli vengono scritti in questa lingua e l'indirizzo del blog reindirizza qui.
        </span>
      </label>

      {#if data.config.locales.maxExtra > 0}
        <div class="fld">
          <div class="fld-label-row">
            <span class="fld-label">Lingue aggiuntive</span>
            <span class="fld-count">
              max {data.config.locales.maxExtra}
            </span>
          </div>
          <span class="fld-hint block">
            Ogni articolo viene tradotto automaticamente nelle lingue che selezioni.
          </span>
          <div class="locale-grid">
            {#each extraLocaleChoices as code (code)}
              <label class="locale-chip">
                <input
                  type="checkbox"
                  name="locales"
                  value={code}
                  checked={data.config.locales.extraLocales.includes(code)}
                />
                <span class="locale-chip-ui">
                  <span class="locale-check" aria-hidden="true"></span>
                  <span class="locale-name">{BLOG_LOCALE_NATIVE[code]}</span>
                  <span class="locale-code">{code.toUpperCase()}</span>
                </span>
              </label>
            {/each}
          </div>
        </div>
      {:else}
        <div class="upgrade-note">
          <strong>Traduzioni automatiche</strong>
          <p>Incluse nel piano Pro: ogni articolo viene tradotto nelle lingue che scegli.</p>
        </div>
      {/if}
    </div>
  </section>

  <!-- ── Opzioni ──────────────────────────────────────────────────── -->
  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Opzioni</div>
        <p class="panel-sub">Funzioni che puoi attivare o disattivare sul blog.</p>
      </div>
    </div>

    <div class="toggle-row">
      <div class="ftxt">
        <div class="fh">Link “Blog” nella navbar</div>
        <div class="fs">Mostra una voce “Blog” nel menu di navigazione del sito.</div>
      </div>
      <label class="ios-switch">
        <input type="checkbox" name="showBlogLink" value="true" bind:checked={showBlogLink} />
        <span class="ios-slider"></span>
      </label>
    </div>

    <div class="toggle-row">
      <div class="ftxt">
        <div class="fh">Humanizer AI</div>
        <div class="fs">Rifinisce lo stile degli articoli generati per renderli più naturali.</div>
      </div>
      <label class="ios-switch">
        <input
          type="checkbox"
          name="humanizerEnabled"
          value="true"
          bind:checked={humanizerEnabled}
        />
        <span class="ios-slider"></span>
      </label>
    </div>

    {#if data.backlinkNetworkAllowed !== false}
      <div class="toggle-row">
        <div class="ftxt">
          <div class="fh">{$_('app.backlinks.settingsTitle')}</div>
          <div class="fs">{$_('app.backlinks.settingsDesc')}</div>
        </div>
        <label class="ios-switch">
          <input
            type="checkbox"
            name="backlinkNetwork"
            value="true"
            bind:checked={backlinkNetwork}
          />
          <span class="ios-slider"></span>
        </label>
      </div>
    {:else}
      <!-- Keep opt-in state when saving appearance on Free/Go (unchecked inputs are omitted). -->
      <input type="hidden" name="backlinkNetwork" value={backlinkNetwork ? 'true' : 'false'} />
    {/if}

    <div class="panel-body stack cadence">
      <label class="fld">
        <span class="fld-label">{$_('app.site.articlesPerWeek.label')}</span>
        <input
          type="number"
          name="articlesPerWeek"
          min="0"
          max={data.articlesPerWeekMax ?? 7}
          step="1"
          value={data.config.articlesPerWeek}
          class="num"
        />
        <span class="fld-hint">{$_('app.site.articlesPerWeek.desc')}</span>
      </label>
    </div>
  </section>

  <!-- ── Stile articoli ────────────────────────────────────────────── -->
  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Stile degli articoli</div>
        <p class="panel-sub">Istruzioni permanenti per il tono e lo stile della generazione.</p>
      </div>
    </div>
    <div class="panel-body">
      <label class="fld">
        <span class="fld-label">Istruzioni di stile</span>
        <textarea
          name="styleInstructions"
          rows="5"
          maxlength="1500"
          placeholder="Tono, formalità, lunghezza, cose da evitare…"
          >{data.config.styleInstructions}</textarea
        >
        <span class="fld-hint">Esempio: “Tono diretto, niente jargon, chiudi sempre con una domanda.”</span>
      </label>
    </div>
  </section>

  <!-- ── Navbar links ─────────────────────────────────────────────── -->
  <section class="panel">
    <div class="panel-head">
      <div>
        <div class="t">Link nella navbar</div>
        <p class="panel-sub">Fino a 6 link personalizzati (es. Chi siamo, Contatti). Lascia vuoti i campi non usati.</p>
      </div>
    </div>
    <div class="panel-body">
      <div class="nav-links">
        <div class="nav-link-head" aria-hidden="true">
          <span>Etichetta</span>
          <span>URL</span>
        </div>
        {#each { length: 6 } as _, i}
          <div class="nav-link-row">
            <span class="nav-idx">{i + 1}</span>
            <input
              type="text"
              name="nav_label_{i}"
              value={data.config.navbarLinks[i]?.label ?? ''}
              placeholder="Es. Chi siamo"
              aria-label="Etichetta link {i + 1}"
            />
            <input
              type="text"
              name="nav_url_{i}"
              value={data.config.navbarLinks[i]?.url ?? ''}
              placeholder="/about o https://…"
              aria-label="URL link {i + 1}"
            />
          </div>
        {/each}
      </div>
    </div>
  </section>

  <div class="save-bar">
    <p class="save-hint">Le modifiche si applicano dopo il salvataggio.</p>
    <button
      class="btn primary"
      class:loading={isBusy('customize')}
      type="submit"
      disabled={isBusy('customize')}
      aria-busy={isBusy('customize')}
    >
      {isBusy('customize') ? 'Salvataggio…' : 'Salva aspetto'}
    </button>
  </div>
  </form>
</div>

<style>
  .appearance-layout,
  .customize-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .customize-form {
    padding-bottom: 88px;
  }

  .panel-head > div {
    min-width: 0;
  }
  .panel-sub {
    margin: 4px 0 0;
    font-size: 13px;
    font-weight: 400;
    color: var(--ink-faint);
    line-height: 1.45;
  }
  .panel-body {
    padding: 18px 22px 22px;
  }
  .panel-body.stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .panel-body.cadence {
    border-top: 1px solid var(--line);
    padding-top: 16px;
  }

  .snackbar {
    position: fixed;
    left: 50%;
    bottom: 96px;
    transform: translateX(-50%);
    z-index: 80;
    max-width: min(420px, calc(100vw - 32px));
    font-size: 13px;
    font-weight: 600;
    border-radius: 12px;
    padding: 12px 18px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.18);
    animation: snack-in 0.22s ease-out;
  }
  .snackbar.ok {
    background: #166534;
    color: #fff;
  }
  .snackbar.err {
    background: #b91c1c;
    color: #fff;
  }
  @keyframes snack-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  /* Identity */
  .identity {
    display: flex;
    gap: 28px;
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .icon-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 120px;
    flex-shrink: 0;
    text-align: center;
  }
  .icon-preview {
    width: 80px;
    height: 80px;
    border-radius: 18px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent, #111);
    color: #fff;
    font-size: 32px;
    font-weight: 700;
    border: 1px solid var(--line);
  }
  .icon-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .icon-upload {
    margin: 0;
  }
  .identity-fields {
    flex: 1;
    min-width: 240px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* Fields */
  .fld {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .fld-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .fld-label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .fld-count {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-faint);
  }
  .fld-hint {
    font-size: 12.5px;
    font-weight: 400;
    color: var(--ink-faint);
    line-height: 1.45;
  }
  .fld-hint.block {
    display: block;
    margin-bottom: 4px;
  }
  .fld input[type='text'],
  .fld input[type='number'],
  .fld select,
  .fld textarea {
    font-size: 14px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 400;
    font-family: inherit;
  }
  .fld input:focus,
  .fld select:focus,
  .fld textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.12);
  }
  .fld textarea {
    resize: vertical;
    line-height: 1.5;
  }
  .fld .num {
    max-width: 96px;
  }
  .locale-select {
    max-width: 280px;
  }

  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .color-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 4px 12px 4px 4px;
    background: var(--paper);
  }
  .color {
    width: 40px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
  }
  .color-hex {
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  /* Layout cards */
  .layout-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .layout-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: 14px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .layout-card:hover {
    border-color: var(--line-2, #d2d2d7);
  }
  .layout-card.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.14);
  }
  .layout-card input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .layout-mock {
    display: flex;
    gap: 6px;
    height: 72px;
    border-radius: 8px;
    background: var(--paper-2, #f5f5f7);
    border: 1px solid var(--line);
    padding: 8px;
    overflow: hidden;
  }
  .layout-mock.navbar {
    flex-direction: column;
  }
  .layout-mock.sidebar {
    flex-direction: row;
  }
  .mock-bar {
    height: 10px;
    border-radius: 4px;
    background: rgba(var(--accent-rgb), 0.35);
    flex-shrink: 0;
  }
  .mock-side {
    width: 22px;
    border-radius: 4px;
    background: rgba(var(--accent-rgb), 0.35);
    flex-shrink: 0;
  }
  .mock-rows {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .mock-rows span {
    flex: 1;
    border-radius: 4px;
    background: var(--line);
    opacity: 0.7;
  }
  .layout-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .layout-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
  }
  .layout-desc {
    font-size: 12.5px;
    color: var(--ink-faint);
    line-height: 1.4;
  }

  /* Locale chips */
  .locale-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 8px;
    margin-top: 6px;
  }
  .locale-chip {
    position: relative;
    cursor: pointer;
    margin: 0;
  }
  .locale-chip input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .locale-chip-ui {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      box-shadow 0.15s ease;
  }
  .locale-chip:hover .locale-chip-ui {
    border-color: var(--line-2, #d2d2d7);
  }
  .locale-chip input:checked + .locale-chip-ui {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.06);
    box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1);
  }
  .locale-chip input:focus-visible + .locale-chip-ui {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .locale-check {
    width: 18px;
    height: 18px;
    border-radius: 6px;
    border: 1.5px solid var(--line-2, #d2d2d7);
    background: var(--paper);
    flex-shrink: 0;
    position: relative;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .locale-chip input:checked + .locale-chip-ui .locale-check {
    background: var(--accent);
    border-color: var(--accent);
  }
  .locale-chip input:checked + .locale-chip-ui .locale-check::after {
    content: '';
    position: absolute;
    left: 5px;
    top: 2px;
    width: 5px;
    height: 9px;
    border: solid #fff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .locale-name {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .locale-code {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--ink-faint);
  }
  .locale-chip input:checked + .locale-chip-ui .locale-code {
    color: var(--accent);
  }

  .upgrade-note {
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--paper-2, #f5f5f7);
    border: 1px dashed var(--line);
  }
  .upgrade-note strong {
    display: block;
    font-size: 13.5px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .upgrade-note p {
    margin: 0;
    font-size: 13px;
    color: var(--ink-faint);
    line-height: 1.45;
  }

  /* Toggle rows — match settings .field pattern */
  .toggle-row {
    padding: 16px 22px;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
  }
  .toggle-row .ftxt {
    min-width: 0;
  }
  .toggle-row .fh {
    font-size: 14.5px;
    font-weight: 600;
  }
  .toggle-row .fs {
    font-size: 13px;
    color: var(--ink-faint);
    margin-top: 3px;
    max-width: 52ch;
    line-height: 1.45;
  }

  .ios-switch {
    position: relative;
    display: inline-block;
    width: 51px;
    height: 31px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .ios-switch input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }
  .ios-slider {
    position: absolute;
    inset: 0;
    background: #e9e9eb;
    border-radius: 31px;
    transition: background 0.2s;
  }
  .ios-slider::before {
    content: '';
    position: absolute;
    height: 27px;
    width: 27px;
    left: 2px;
    bottom: 2px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  .ios-switch input:checked + .ios-slider {
    background: #34c759;
  }
  .ios-switch input:checked + .ios-slider::before {
    transform: translateX(20px);
  }
  .ios-switch input:focus-visible + .ios-slider {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  :global([data-theme='dark']) .ios-slider {
    background: #39393d;
  }

  /* Navbar links */
  .nav-links {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .nav-link-head {
    display: grid;
    grid-template-columns: 28px 1fr 1.4fr;
    gap: 8px;
    padding: 0 0 4px;
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-faint);
  }
  .nav-link-head span:first-child {
    grid-column: 2;
  }
  .nav-link-row {
    display: grid;
    grid-template-columns: 28px 1fr 1.4fr;
    gap: 8px;
    align-items: center;
  }
  .nav-idx {
    font-size: 12px;
    font-weight: 700;
    color: var(--ink-faint);
    text-align: center;
  }
  .nav-link-row input {
    font-size: 13.5px;
    padding: 9px 11px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font-family: inherit;
    min-width: 0;
  }
  .nav-link-row input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.12);
  }

  /* Save bar */
  .save-bar {
    position: sticky;
    bottom: 12px;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    border-radius: 14px;
    background: var(--paper);
    border: 1px solid var(--line);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
  }
  .save-hint {
    margin: 0;
    font-size: 13px;
    color: var(--ink-faint);
  }

  .muted {
    color: var(--ink-faint);
  }
  .small {
    font-size: 12px;
    line-height: 1.4;
    margin: 0;
  }

  .btn {
    font-size: 13px;
    font-weight: 600;
    border-radius: 10px;
    padding: 9px 16px;
    cursor: pointer;
    border: 1px solid transparent;
    line-height: 1;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: inherit;
    font-family: inherit;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .btn.primary {
    background: var(--accent, #7c5cff);
    color: #fff;
    min-width: 128px;
  }
  .btn.ghost {
    background: transparent;
    color: var(--ink-soft);
    border-color: var(--line);
  }
  .btn-link {
    background: none;
    border: none;
    color: var(--ink-faint);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    font-family: inherit;
  }
  .file-btn {
    cursor: pointer;
  }

  .loading {
    position: relative;
    color: transparent !important;
    pointer-events: none;
  }
  .loading::after {
    content: '';
    position: absolute;
    inset: 0;
    margin: auto;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid var(--ink-faint);
    border-top-color: transparent;
    animation: spin 0.7s linear infinite;
  }
  .btn.primary.loading::after {
    border-color: #fff;
    border-top-color: transparent;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 640px) {
    .row2,
    .layout-grid {
      grid-template-columns: 1fr;
    }
    .nav-link-head {
      display: none;
    }
    .nav-link-row {
      grid-template-columns: 24px 1fr;
    }
    .nav-link-row input:last-child {
      grid-column: 2;
    }
    .save-bar {
      flex-direction: column;
      align-items: stretch;
    }
    .save-bar .btn {
      width: 100%;
    }
    .toggle-row {
      align-items: flex-start;
    }
  }
</style>
