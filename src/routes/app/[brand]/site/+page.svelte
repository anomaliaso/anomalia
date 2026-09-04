<script lang="ts">
  import { enhance } from '$app/forms';
  import { Plus, ExternalLink, Sparkles, Upload, Calendar, Trash2, Pencil, Eye } from '@lucide/svelte';
  import { page } from '$app/stores';
  import { pageQuery } from '$lib/page-query';
  import { _ } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';
  import * as Dialog from '$lib/components/ui/dialog';
  import PageHead from '$lib/components/PageHead.svelte';
  import TopbarCta from '$lib/components/TopbarCta.svelte';
  import { jpegIfHeicFormFiles } from '$lib/raster-image-client';
  import { RASTER_IMAGE_ACCEPT } from '$lib/raster-image';

  let { data, form } = $props();
  // I parametri della pagina, non quelli dell'URL: nella modal l'URL non cambia.
  const q = pageQuery();

  const busy = new SvelteSet<string>();
  const isBusy = (key: string) => busy.has(key);
  const withBusy = (key: string) => () => {
    busy.add(key);
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy.delete(key);
    };
  };

  type Article = (typeof data.articles)[number];
  let selectedId = $state<string | null>(null);
  let dialogOpen = $state(false);
  let selectedIds = $state<string[]>([]);
  let confirmBulkDelete = $state(false);

  // Derive from live data so form actions refresh the dialog without sync effects
  // that reassign `selected` every tick (that loop left the dialog stuck open).
  const selected = $derived(
    selectedId ? (data.articles.find((a) => a.id === selectedId) ?? null) : null
  );

  function openArticle(a: Article) {
    selectedId = a.id;
    dialogOpen = true;
  }

  $effect(() => {
    if (!dialogOpen) selectedId = null;
  });

  $effect(() => {
    if (dialogOpen && selectedId && !selected) dialogOpen = false;
  });

  function toggleSelect(id: string, e?: Event) {
    e?.preventDefault();
    e?.stopPropagation();
    confirmBulkDelete = false;
    selectedIds = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
  }

  function clearSelection() {
    selectedIds = [];
    confirmBulkDelete = false;
  }

  const selectedArticles = $derived(data.articles.filter((a) => selectedIds.includes(a.id)));
  const selectedPublishable = $derived(
    selectedArticles.filter((a) => a.status !== 'published' && a.status !== 'planned')
  );

  const afterBulk = () => {
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      clearSelection();
    };
  };

  const unscheduled = $derived(
    data.articles.filter((a) => a.status !== 'published' && !a.scheduled_for).length
  );

  // Same queue as Overview: drafts + approved-but-unscheduled (exclude planned placeholders).

  const blogTitle = $derived(data.config.title || data.brandName || 'Blog');
  const blogDesc = $derived(
    data.config.description ||
      'Articoli long-form generati e pubblicati sul tuo dominio.'
  );

  const fmtSched = (iso: string) =>
    new Intl.DateTimeFormat('it-IT', {
      timeZone: data.timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(iso));

  function toLocalInput(iso: string): string {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: data.timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
        .formatToParts(new Date(iso))
        .map((x) => [x.type, x.value])
    );
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }

  function statusLabel(a: Article) {
    if (a.status === 'published') return 'Pubblicato';
    if (a.status === 'planned') return 'Pianificato';
    if (a.scheduled_for) return 'Programmato';
    return 'Bozza';
  }
</script>

<div class="site-page">
  <PageHead
    title={$_('app.nav.site')}
    subtitle="Anteprima del blog, articoli e pubblicazione."
  >
    {#snippet actions()}
      <a
        class="btn ghost topbar-link"
        href={data.siteUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Vedi sito"
      >
        <ExternalLink class="topbar-cta-icon" strokeWidth={2.1} aria-hidden="true" />
        <span class="topbar-cta-short">Sito</span>
        <span class="topbar-cta-full">Vedi sito</span>
      </a>
      <a
        class="btn ghost topbar-link"
        href="/app/{$page.params.brand}/site/new"
        title="Nuovo post"
      >
        <Plus class="topbar-cta-icon" strokeWidth={2.1} aria-hidden="true" />
        <span class="topbar-cta-short">Nuovo</span>
        <span class="topbar-cta-full">Nuovo post</span>
      </a>
      {#if data.draftCount > 0}
        <form
          class="topbar-cta-wrap"
          class:is-busy={isBusy('publish-site')}
          method="POST"
          action="?/publishSite"
          use:enhance={withBusy('publish-site')}
        >
          <TopbarCta busy={isBusy('publish-site')} Icon={Upload} title={`Pubblica sito (${data.draftCount})`}>
            <span class="topbar-cta-short">Pubblica ({data.draftCount})</span>
            <span class="topbar-cta-full">Pubblica sito ({data.draftCount})</span>
          </TopbarCta>
        </form>
      {/if}
    {/snippet}
  </PageHead>

  {#if form?.error === 'generation_failed'}<p class="banner err">Generazione non riuscita. Riprova.</p>
  {:else if form?.generated}<p class="banner ok">Post generato — lo trovi nella griglia come bozza.</p>
  {:else if form?.sitePublished}<p class="banner ok">Sito pubblicato.</p>
  {:else if form?.humanized}<p class="banner ok">Articolo humanizzato: {form.changes}</p>
  {:else if form?.error === 'humanize_failed'}<p class="banner err">Humanizer non riuscito. Riprova.</p>
  {:else if form?.coverUploaded}<p class="banner ok">Immagine di copertina aggiornata.</p>
  {:else if form?.coverGenerated}<p class="banner ok">Copertina generata con l'AI.</p>
  {:else if form?.error === 'cover_gen_failed'}<p class="banner err">Generazione copertina non riuscita. Riprova.</p>
  {:else if form?.articleImages}<p class="banner ok">Immagini generate e inserite nell'articolo.</p>
  {:else if form?.articleOptimized}<p class="banner ok">Articolo ottimizzato — punteggio aggiornato.</p>
  {:else if form?.scheduledAll !== undefined}<p class="banner ok">{form.scheduledAll} {form.scheduledAll === 1 ? 'bozza programmata' : 'bozze programmate'}.</p>
  {:else if form?.error === 'images_failed'}<p class="banner err">Non sono riuscito a generare immagini. Riprova.</p>
  {:else if form?.blogToggled !== undefined}<p class="banner ok">Blog {form.blogToggled ? 'attivato' : 'disattivato'}.</p>
  {:else if form?.deletedSelectedArticles}<p class="banner ok">Eliminati {form.deletedSelectedArticles} articoli.</p>
  {:else if form?.publishedSelected !== undefined}<p class="banner ok">Pubblicati {form.publishedSelected} articoli.</p>
  {:else if q('from') === 'plan'}
    <p class="banner ok">Generati {q('n') ?? ''} articoli dal piano.</p>
  {:else if q('from') === 'month'}
    <!-- The month is now a background job: say what happens next, not just what was planned. -->
    <p class="banner ok">
      Pianificati {q('n') ?? ''} articoli per il prossimo mese — li stiamo scrivendo e
      illustrando ora.
      {#if q('job') === 'fast'}
        Generazione veloce attiva: ti avvisiamo via email appena sono pronti.
      {:else}
        Ti avvisiamo via email entro 12-24 ore.
      {/if}
    </p>
  {/if}

  {#if form?.cms && (form.cms.pushed || form.cms.failed)}
    <p class="banner {form.cms.failed ? 'warn' : 'ok'}">
      Pubblicazione esterna: {form.cms.pushed} riusciti{#if form.cms.failed}, {form.cms.failed} non riusciti{/if}.
    </p>
  {/if}

  <!-- Blog preview + on/off -->
  <section class="preview-card" class:off={!data.config.enabled}>
    <div class="preview-main">
      <div class="preview-logo" style="--accent:{data.config.accent};">
        {#if data.config.iconUrl || data.brandLogoUrl}
          <img src={data.config.iconUrl || data.brandLogoUrl} alt="" />
        {:else}
          <span>{blogTitle.slice(0, 1)}</span>
        {/if}
      </div>
      <div class="preview-copy">
        <h2 class="preview-title">{blogTitle}</h2>
        <p class="preview-desc">{blogDesc}</p>
        <div class="preview-links">
          <a class="preview-url" href={data.siteUrl} target="_blank" rel="noopener noreferrer">
            {data.siteUrl.replace(/^https?:\/\//, '')} ↗
          </a>
          <a class="preview-settings" href="/app/{$page.params.brand}/settings/blog-appearance"
            >Impostazioni blog →</a
          >
        </div>
      </div>
    </div>
    <form method="POST" action="?/toggleBlog" use:enhance={withBusy('toggle-blog')} class="preview-switch">
      <input type="hidden" name="enabled" value={data.config.enabled ? 'false' : 'true'} />
      <label class="switch" class:busy={isBusy('toggle-blog')} title={data.config.enabled ? $_('app.site.deactivate') : $_('app.site.activateBlog')}>
        <span class="sr-only">{data.config.enabled ? $_('app.site.blogOn') : $_('app.site.blogOff')}</span>
        <input
          type="checkbox"
          checked={data.config.enabled}
          disabled={isBusy('toggle-blog')}
          onchange={(e) => e.currentTarget.form?.requestSubmit()}
        />
        <span class="track"><span class="thumb"></span></span>
      </label>
    </form>
  </section>

  <!-- Posts grid -->
  <section class="posts-section">
    <div class="section-head">
      <div>
        <h2>Articoli</h2>
        <p class="muted small">{data.articles.length} totali · clicca una cella per gestirla</p>
      </div>
      <div class="section-actions">
        {#if unscheduled > 0}
          <form method="POST" action="?/scheduleAllDrafts" use:enhance={withBusy('schedule-all')}>
            <button
              class="btn ghost"
              class:loading={isBusy('schedule-all')}
              type="submit"
              disabled={isBusy('schedule-all')}
              title="Distribuisce le bozze senza data nei prossimi giorni."
            >
              <Calendar size={14} strokeWidth={2} />
              Programma bozze ({unscheduled})
            </button>
          </form>
        {/if}
        <a class="btn primary" href="/app/{$page.params.brand}/site/new">
          <Plus size={14} strokeWidth={2.2} />
          Nuovo post
        </a>
      </div>
    </div>

    {#if data.articles.length}
      <div class="posts-grid">
        {#each data.articles as a (a.id)}
          {@const on = selectedIds.includes(a.id)}
          <div class="post-card-wrap" class:on>
            <button
              type="button"
              class="card-check"
              class:on
              aria-pressed={on}
              aria-label="Seleziona articolo"
              onclick={(e) => toggleSelect(a.id, e)}
            >
              {#if on}✓{/if}
            </button>
            <button type="button" class="post-card" class:on onclick={() => openArticle(a)}>
              <div class="post-cover">
                {#if a.status === 'planned'}
                  <span class="cover-placeholder plan">🗓️</span>
                {:else if a.cover_image}
                  <img src={a.cover_image} alt="" />
                {:else}
                  <span class="cover-placeholder">+</span>
                {/if}
              </div>
              <div class="post-body">
                <span class="post-title">{a.title}</span>
                {#if a.angle}<span class="muted small angle">{a.angle}</span>{/if}
                <div class="post-meta">
                  {#if a.status !== 'planned'}
                    <span
                      class="score {a.score >= 80 ? 'good' : a.score >= 55 ? 'ok' : 'low'}"
                      title="Punteggio qualità"
                    >{a.score}<small>/100</small></span>
                  {/if}
                  <span class="badge {a.status === 'published' ? 'ok' : a.status === 'planned' ? 'plan' : ''}">{statusLabel(a)}</span>
                </div>
                {#if a.scheduled_for && a.status !== 'published'}
                  <span class="sched-note">{fmtSched(a.scheduled_for)}</span>
                {/if}
              </div>
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">
        <p class="muted">Nessun articolo ancora.</p>
        <a class="btn primary" href="/app/{$page.params.brand}/site/new">Crea il primo post</a>
      </div>
    {/if}
  </section>
</div>

{#if selectedIds.length}
  <div class="bulk-bar" role="toolbar" aria-label="Azioni articoli selezionati">
    <div class="bulk-info">
      <span class="bulk-count">{selectedIds.length} selezionati</span>
      <button type="button" class="bulk-link" onclick={() => (selectedIds = data.articles.map((a) => a.id))}>
        Seleziona tutti
      </button>
      <button type="button" class="bulk-link" onclick={clearSelection}>Deseleziona</button>
    </div>
    <div class="bulk-actions">
      {#if selectedPublishable.length}
        <form method="POST" action="?/publishSelected" use:enhance={afterBulk}>
          <input type="hidden" name="ids" value={selectedPublishable.map((a) => a.id).join(',')} />
          <button class="btn primary" type="submit">Pubblica ({selectedPublishable.length})</button>
        </form>
      {/if}
      {#if confirmBulkDelete}
        <form method="POST" action="?/deleteSelected" use:enhance={afterBulk}>
          <input type="hidden" name="ids" value={selectedIds.join(',')} />
          <button class="btn danger" type="submit">Conferma eliminazione ({selectedIds.length})</button>
        </form>
        <button type="button" class="bulk-link" onclick={() => (confirmBulkDelete = false)}>Annulla</button>
      {:else}
        <button type="button" class="btn ghost danger" onclick={() => (confirmBulkDelete = true)}>
          <Trash2 size={14} /> Elimina
        </button>
      {/if}
    </div>
  </div>
{/if}

<!-- Article actions dialog -->
<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="article-dialog flex flex-col sm:max-w-lg">
    {#if selected}
      {@const a = selected}
      <Dialog.Header>
        <Dialog.Title class="dialog-title">{a.title}</Dialog.Title>
        <Dialog.Description class="dialog-desc">
          <span class="badge {a.status === 'published' ? 'ok' : a.status === 'planned' ? 'plan' : ''}">{statusLabel(a)}</span>
          {#if a.status !== 'planned'}
            <span class="score {a.score >= 80 ? 'good' : a.score >= 55 ? 'ok' : 'low'}">{a.score}/100</span>
          {/if}
          {#if a.scheduled_for && a.status !== 'published'}
            <span class="sched-note">{fmtSched(a.scheduled_for)}</span>
          {/if}
        </Dialog.Description>
      </Dialog.Header>

      <div class="dlg-sections">
        {#if a.status === 'planned'}
          <section class="dlg-block">
            <h4>Produzione</h4>
            <form method="POST" action="?/generateNow" use:enhance={withBusy(`gen-now-${a.id}`)}>
              <input type="hidden" name="id" value={a.id} />
              <button
                class="btn primary full"
                class:loading={isBusy(`gen-now-${a.id}`)}
                type="submit"
                disabled={isBusy(`gen-now-${a.id}`)}
              >
                <Sparkles size={14} /> Scrivi ora
              </button>
            </form>
          </section>
        {:else}
          <section class="dlg-block">
            <h4>Azioni principali</h4>
            <div class="dlg-row">
              <a class="btn ghost" href="/app/{$page.params.brand}/site/edit/{a.id}">
                <Pencil size={14} /> Modifica
              </a>
              <a class="btn ghost" href="/blog-preview/{a.id}" target="_blank" rel="noopener noreferrer">
                <Eye size={14} /> Anteprima
              </a>
              <form method="POST" action="?/setStatus" use:enhance={withBusy(`status-${a.id}`)}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="publish" value={a.status === 'published' ? 'false' : 'true'} />
                <button
                  class="btn {a.status === 'published' ? 'ghost' : 'primary'}"
                  class:loading={isBusy(`status-${a.id}`)}
                  type="submit"
                  disabled={isBusy(`status-${a.id}`)}
                >
                  {a.status === 'published' ? 'Rimuovi' : 'Pubblica'}
                </button>
              </form>
            </div>
          </section>

          <section class="dlg-block">
            <h4>Copertina</h4>
            <div class="cover-row">
              <form
                method="POST"
                action="?/uploadCover"
                enctype="multipart/form-data"
                use:enhance={async ({ formData }) => {
                  await jpegIfHeicFormFiles(formData, 'cover');
                  return withBusy(`cover-${a.id}`)();
                }}
                class="cover-up"
              >
                <input type="hidden" name="id" value={a.id} />
                <label class:loading={isBusy(`cover-${a.id}`) || isBusy(`gen-cover-${a.id}`)}>
                  {#if a.cover_image}<img src={a.cover_image} alt="cover" />{:else}<span>+</span>{/if}
                  <input
                    type="file"
                    name="cover"
                    accept={RASTER_IMAGE_ACCEPT}
                    hidden
                    onchange={(e) => e.currentTarget.form?.requestSubmit()}
                  />
                </label>
              </form>
              <form method="POST" action="?/generateCover" use:enhance={withBusy(`gen-cover-${a.id}`)}>
                <input type="hidden" name="id" value={a.id} />
                <button
                  class="btn ghost"
                  class:loading={isBusy(`gen-cover-${a.id}`)}
                  type="submit"
                  disabled={isBusy(`gen-cover-${a.id}`)}
                >
                  <Sparkles size={14} /> Genera copertina
                </button>
              </form>
            </div>
          </section>

          <section class="dlg-block">
            <h4>Migliora</h4>
            <div class="dlg-row wrap">
              <form method="POST" action="?/optimizeArticle" use:enhance={withBusy(`optimize-${a.id}`)}>
                <input type="hidden" name="id" value={a.id} />
                <button
                  class="btn ghost"
                  class:loading={isBusy(`optimize-${a.id}`)}
                  type="submit"
                  disabled={isBusy(`optimize-${a.id}`)}
                >✨ Ottimizza</button>
              </form>
              <form method="POST" action="?/humanizeArticle" use:enhance={withBusy(`humanize-${a.id}`)}>
                <input type="hidden" name="id" value={a.id} />
                <button
                  class="btn ghost"
                  class:loading={isBusy(`humanize-${a.id}`)}
                  type="submit"
                  disabled={isBusy(`humanize-${a.id}`)}
                >🖊️ Humanizza</button>
              </form>
              <form method="POST" action="?/generateArticleImages" use:enhance={withBusy(`gen-images-${a.id}`)}>
                <input type="hidden" name="id" value={a.id} />
                <button
                  class="btn ghost"
                  class:loading={isBusy(`gen-images-${a.id}`)}
                  type="submit"
                  disabled={isBusy(`gen-images-${a.id}`)}
                >✨ Immagini</button>
              </form>
            </div>
          </section>
        {/if}

        {#if a.status !== 'published'}
          <section class="dlg-block">
            <h4>Programmazione</h4>
            <form method="POST" action="?/scheduleArticle" use:enhance={withBusy(`schedule-${a.id}`)} class="sched-form">
              <input type="hidden" name="id" value={a.id} />
              <input
                type="datetime-local"
                name="when"
                value={a.scheduled_for ? toLocalInput(a.scheduled_for) : ''}
              />
              <button
                class="btn ghost"
                class:loading={isBusy(`schedule-${a.id}`)}
                type="submit"
                disabled={isBusy(`schedule-${a.id}`)}
              >
                {a.status === 'planned' ? 'Sposta la data' : a.scheduled_for ? 'Aggiorna' : 'Programma'}
              </button>
            </form>
            {#if a.scheduled_for && a.status !== 'planned'}
              <form method="POST" action="?/scheduleArticle" use:enhance={withBusy(`schedule-${a.id}`)}>
                <input type="hidden" name="id" value={a.id} />
                <button class="btn-link" type="submit" disabled={isBusy(`schedule-${a.id}`)}>
                  Annulla programmazione
                </button>
              </form>
            {/if}
          </section>
        {/if}

        <section class="dlg-block danger-zone">
          <form method="POST" action="?/deleteArticle" use:enhance={withBusy(`delete-${a.id}`)}>
            <input type="hidden" name="id" value={a.id} />
            <button
              class="btn ghost danger"
              class:loading={isBusy(`delete-${a.id}`)}
              type="submit"
              disabled={isBusy(`delete-${a.id}`)}
            >
              <Trash2 size={14} /> Elimina articolo
            </button>
          </form>
        </section>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .site-page {
    max-width: var(--content-max, 960px);
    margin: 0 auto;
    padding: 0;
  }

  /* Desktop topbar: compact labels. Mobile actions menu: full labels. */
  .topbar-cta-full {
    display: none;
  }
  :global(.page-topbar-actions--menu) .topbar-cta-short {
    display: none;
  }
  :global(.page-topbar-actions--menu) .topbar-cta-full {
    display: inline;
  }

  .banner {
    font-size: 13px;
    border-radius: 10px;
    padding: 10px 14px;
    margin: 0 0 16px;
  }
  .banner.ok { background: #dcfce7; color: #166534; }
  .banner.err { background: #fef2f2; color: #b91c1c; }
  .banner.warn { background: #fef3c7; color: #92400e; }

  /* Preview */
  .preview-card {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    padding: 22px 24px;
    margin-bottom: 28px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background:
      linear-gradient(145deg, color-mix(in srgb, var(--accent, #111) 6%, var(--paper)) 0%, var(--paper) 55%),
      var(--paper);
  }
  .preview-card.off {
    opacity: 0.85;
  }
  .preview-main {
    display: flex;
    gap: 16px;
    align-items: center;
    min-width: 0;
  }
  .preview-logo {
    width: 64px;
    height: 64px;
    border-radius: 14px;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent, #111);
    color: #fff;
    font-size: 26px;
    font-weight: 700;
    border: 1px solid var(--line);
  }
  .preview-logo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .preview-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .preview-title {
    margin: 0;
    font-size: 20px;
    font-weight: 650;
    color: var(--ink);
    letter-spacing: -0.02em;
  }
  .preview-desc {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.45;
    color: var(--ink-soft);
    max-width: 42ch;
  }
  .preview-links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
    align-items: center;
    margin-top: 2px;
  }
  .preview-url {
    font-size: 12.5px;
    color: var(--ink-faint);
    text-decoration: none;
  }
  .preview-url:hover { color: var(--accent); text-decoration: underline; }
  .preview-settings {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-soft);
    text-decoration: none;
  }
  .preview-settings:hover { color: var(--accent); }

  .preview-switch { margin: 0; flex-shrink: 0; }
  .switch {
    display: inline-flex;
    cursor: pointer;
    align-items: center;
  }
  .switch.busy { opacity: 0.6; pointer-events: none; }
  .switch input { position: absolute; opacity: 0; width: 0; height: 0; }
  .switch .track {
    width: 44px;
    height: 26px;
    border-radius: 999px;
    background: var(--line);
    position: relative;
    transition: background 0.15s;
  }
  .switch .thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    transition: transform 0.15s;
  }
  .switch input:checked + .track { background: #22c55e; }
  .switch input:checked + .track .thumb { transform: translateX(18px); }

  /* Posts */
  .posts-section { margin-bottom: 40px; }
  .section-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .section-head h2 {
    margin: 0 0 2px;
    font-size: 18px;
    font-weight: 600;
    color: var(--ink);
  }
  .section-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
  }
  .section-actions form {
    margin: 0;
  }
  .section-actions .btn {
    max-width: 100%;
  }

  .posts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }
  .post-card-wrap {
    position: relative;
  }
  .post-card-wrap.on .post-card {
    border-color: var(--accent, #111);
    box-shadow: 0 0 0 1px var(--accent, #111);
  }
  .card-check {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 2;
    width: 22px;
    height: 22px;
    border-radius: 7px;
    border: 1.5px solid rgba(255, 255, 255, 0.9);
    background: rgba(0, 0, 0, 0.4);
    color: #fff;
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .post-card-wrap:hover .card-check,
  .posts-grid:has(.card-check.on) .card-check,
  .card-check.on { opacity: 1; }
  .card-check.on { background: var(--accent, #111); border-color: var(--accent, #111); }
  .post-card {
    display: flex;
    flex-direction: column;
    text-align: left;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--paper);
    cursor: pointer;
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
    font: inherit;
    color: inherit;
    width: 100%;
  }
  .post-card:hover {
    border-color: color-mix(in srgb, var(--accent, #111) 35%, var(--line));
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
    transform: translateY(-1px);
  }
  .post-cover {
    aspect-ratio: 16 / 10;
    background: var(--paper-2);
    overflow: hidden;
  }
  .post-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cover-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--ink-faint);
    font-size: 22px;
    border-bottom: 1px dashed var(--line);
  }
  .cover-placeholder.plan { font-size: 28px; }
  .post-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px 14px;
    min-width: 0;
  }
  .post-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .angle {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .post-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 2px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 32px 20px;
    border: 1px dashed var(--line);
    border-radius: 14px;
    background: var(--paper-2);
  }

  .badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--paper-2);
    color: var(--ink-faint);
    white-space: nowrap;
  }
  .badge.ok { background: #dcfce7; color: #166534; }
  .badge.plan { background: #ede9fe; color: #5b21b6; }
  .score {
    font-size: 12px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 8px;
    white-space: nowrap;
  }
  .score small { font-weight: 500; opacity: 0.7; }
  .score.good { background: #dcfce7; color: #166534; }
  .score.ok { background: #fef3c7; color: #92400e; }
  .score.low { background: #fef2f2; color: #b91c1c; }
  .sched-note {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
  }

  .muted { color: var(--ink-faint); }
  .small { font-size: 12px; }

  .btn {
    font-size: 13px;
    font-weight: 600;
    border-radius: 10px;
    padding: 9px 14px;
    cursor: pointer;
    border: 1px solid transparent;
    line-height: 1;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    color: inherit;
  }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .btn.primary { background: var(--accent, #7c5cff); color: #fff; }
  .btn.ghost { background: transparent; color: var(--ink-soft); border-color: var(--line); }
  .btn.ghost.danger:hover { color: #dc2626; border-color: #dc2626; }
  .btn.danger { background: #dc2626; color: #fff; border-color: #dc2626; }

  .bulk-bar {
    position: sticky;
    bottom: 12px;
    z-index: 20;
    margin: 0 0 16px;
    padding: 12px 16px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    backdrop-filter: blur(10px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 18px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
  }
  .bulk-info { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; flex: 1 1 auto; }
  .bulk-count { font-size: 13.5px; font-weight: 700; color: var(--ink); }
  .bulk-link {
    border: none; background: none; padding: 0; cursor: pointer; font: inherit;
    font-size: 12.5px; font-weight: 600; color: var(--accent, #111);
  }
  .bulk-link:hover { text-decoration: underline; }
  .bulk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .btn.full { width: 100%; justify-content: center; }
  .btn-link {
    background: none;
    border: none;
    color: var(--ink-faint);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    margin-top: 8px;
  }

  .loading { position: relative; color: transparent !important; pointer-events: none; }
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
  .btn.primary.loading::after { border-color: #fff; border-top-color: transparent; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Dialog internals (global because Dialog portals content) */
  :global(.article-dialog) {
    max-height: min(86vh, 720px);
    overflow-y: auto;
  }
  :global(.article-dialog .dialog-title) {
    font-size: 17px;
    font-weight: 650;
    line-height: 1.3;
    padding-right: 28px;
  }
  :global(.article-dialog .dialog-desc) {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
  }
  .dlg-sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 4px;
  }
  .dlg-block h4 {
    margin: 0 0 10px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .dlg-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .dlg-row.wrap { flex-wrap: wrap; }
  .cover-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .cover-up { margin: 0; }
  .cover-up label {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    width: 88px;
    height: 56px;
    border-radius: 10px;
    overflow: hidden;
    border: 1px dashed var(--line);
    background: var(--paper-2);
    color: var(--ink-faint);
    font-size: 18px;
  }
  .cover-up label:hover {
    border-color: var(--accent, #7c5cff);
    color: var(--accent, #7c5cff);
  }
  .cover-up img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .sched-form {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .sched-form input[type='datetime-local'] {
    font: inherit;
    font-size: 13px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
    color: var(--ink);
  }
  .danger-zone {
    border-top: 1px solid var(--line);
    padding-top: 14px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @container workbench (max-width: 640px) {
    .preview-card {
      flex-direction: column;
      align-items: stretch;
    }
    .preview-switch {
      align-self: flex-end;
    }
    .posts-grid {
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .section-head {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
    }
    .section-actions {
      flex-direction: column;
      align-items: stretch;
      width: 100%;
    }
    .section-actions form,
    .section-actions .btn {
      width: 100%;
    }
    .section-actions .btn {
      justify-content: center;
      padding: 11px 14px;
    }
    }
</style>
