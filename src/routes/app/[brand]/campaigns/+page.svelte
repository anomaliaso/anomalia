<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import PageHead from '$lib/components/PageHead.svelte';
  import SocialThumbPicker from '$lib/components/SocialThumbPicker.svelte';
  import { jpegIfHeicFile } from '$lib/raster-image-client';
  import { RASTER_IMAGE_ACCEPT, isRasterImageSource } from '$lib/raster-image';

  let { data, form } = $props();

  const brand = $derived(data.brand as { slug: string });
  const ownThumbs = $derived((data.ownThumbs as string[]) ?? []);

  // Social-CDN thumbnails are CORP-blocked → display through our proxy (same as SocialThumbPicker).
  const proxied = (url: string) => `/app/${brand.slug}/social-thumbs?u=${encodeURIComponent(url)}`;

  // Reference images for the single-campaign form: device upload + own-post picks + competitor picks.
  let refFiles = $state<File[]>([]);
  let refPreviews = $derived(refFiles.map((f) => URL.createObjectURL(f)));
  let ownSelected = $state<string[]>([]);
  let competitorRefs = $state<string[]>([]);
  const selectedUrls = $derived([...ownSelected, ...competitorRefs]);
  const totalRefs = $derived(refFiles.length + ownSelected.length + competitorRefs.length);

  // Which source panel is open: null = closed, 'menu' = dropdown visible.
  let refPanel = $state<'menu' | 'device' | 'own' | 'competitor' | null>(null);

  async function onRefFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const picked = Array.from(input.files ?? []).filter((f) =>
      isRasterImageSource({ mime: f.type, filename: f.name })
    );
    const converted: File[] = [];
    for (const f of picked) {
      try {
        converted.push(await jpegIfHeicFile(f));
      } catch {
        converted.push(f);
      }
    }
    refFiles = [...refFiles, ...converted].slice(0, 6);
    input.value = '';
    refPanel = null;
  }
  function removeRefFile(idx: number) {
    refFiles = refFiles.filter((_, i) => i !== idx);
  }
  function toggleOwnThumb(url: string) {
    if (ownSelected.includes(url)) ownSelected = ownSelected.filter((u) => u !== url);
    else if (totalRefs < 6) ownSelected = [...ownSelected, url];
  }
  function removeOwnThumb(url: string) {
    ownSelected = ownSelected.filter((u) => u !== url);
  }

  type CampaignPost = {
    id: string;
    campaign_step: string | null;
    caption: string | null;
    media_url: string | null;
    status: string;
    scheduled_for: string | null;
    platform: string | null;
  };
  type Campaign = { campaign_id: string; campaign_name: string | null; posts: CampaignPost[] };

  const campaigns = $derived((data.campaigns as Campaign[]) ?? []);
  const platforms = $derived((data.platforms as string[]) ?? ['instagram']);

  const STEP_ORDER = ['announcement', 'countdown', 'spotlight', 'day_of', 'recap'];
  function sortedPosts(posts: CampaignPost[]): CampaignPost[] {
    return [...posts].sort((a, b) => STEP_ORDER.indexOf(a.campaign_step ?? '') - STEP_ORDER.indexOf(b.campaign_step ?? ''));
  }

  let submitting = $state(false);

  // Toggle between single-campaign and bulk-campaign modes
  let mode = $state<'single' | 'bulk'>('single');

  function whenLabel(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  }
</script>

<div class="camp-page">
  <!-- Page header -->
  <PageHead
    title={$_('app.campaigns.title', { default: 'Campagne evento' })}
    subtitle={$_('app.campaigns.subtitle', { default: 'Descrivi un evento e genera automaticamente 5 post collegati: annuncio, countdown, spotlight, giorno stesso e recap.' })}
  />

  {#if form?.error}
    <div class="banner err">{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="banner ok">
      {#if form.campaigns !== undefined}
        {$_('app.campaigns.result.bulk', { default: '{campaigns} campagne create: {count} post pronti per la revisione.', values: { campaigns: form.campaigns, count: form.count } })}
      {:else if form.count < form.requested}
        {$_('app.campaigns.result.partial', { default: 'Creati {count} post su 5 per "{name}" (limite mensile raggiunto).', values: { count: form.count, name: form.campaignName } })}
      {:else}
        {$_('app.campaigns.result.success', { default: 'Campagna "{name}" creata: {count} post pronti per la revisione.', values: { count: form.count, name: form.campaignName } })}
      {/if}
    </div>
  {/if}

  <!-- Mode switcher -->
  <div class="mode-switcher">
    <div class="ios-segmented">
      <label class:active={mode === 'single'}>
        <input type="radio" name="mode-switch" value="single" checked={mode === 'single'} onchange={() => (mode = 'single')} />
        <span>{$_('app.campaigns.mode.single', { default: 'Singolo evento' })}</span>
      </label>
      <label class:active={mode === 'bulk'}>
        <input type="radio" name="mode-switch" value="bulk" checked={mode === 'bulk'} onchange={() => (mode = 'bulk')} />
        <span>{$_('app.campaigns.mode.bulk', { default: 'Lista eventi' })}</span>
      </label>
    </div>
  </div>

  <!-- Single campaign form -->
  {#if mode === 'single'}
    <form
      method="POST"
      action="?/create"
      enctype="multipart/form-data"
      use:enhance={({ formData }) => {
        // The picker input has no `name` — submit the converted JPEGs from state, not the HEIC originals.
        formData.delete('refs');
        for (const f of refFiles) formData.append('refs', f);
        submitting = true;
        return async ({ update }) => {
          await update();
          submitting = false;
          refFiles = [];
          ownSelected = [];
          competitorRefs = [];
          refPanel = null;
          await invalidateAll();
        };
      }}
    >
      <div class="card">
        <div class="card-body">
          <!-- Event name -->
          <div class="field-group">
            <label class="field-label" for="camp-name">{$_('app.campaigns.form.name', { default: 'Nome evento' })}</label>
            <input id="camp-name" name="name" type="text" class="field-input" required maxlength="120" placeholder={$_('app.campaigns.form.namePh', { default: 'Es. Apertura estiva' })} disabled={submitting} />
          </div>

          <!-- Date + Platform row -->
          <div class="field-row">
            <div class="field-group">
              <label class="field-label" for="camp-date">{$_('app.campaigns.form.date', { default: 'Data evento' })}</label>
              <input id="camp-date" name="event_date" type="date" class="field-input" required disabled={submitting} />
            </div>
            <div class="field-group">
              <label class="field-label" for="camp-platform">{$_('app.campaigns.form.platform', { default: 'Piattaforma' })}</label>
              <div class="ios-segmented platform-picker">
                {#each platforms as p (p)}
                  <label>
                    <input type="radio" name="platform" value={p} checked={platforms[0] === p} />
                    <span class="platform-icon">{p}</span>
                  </label>
                {/each}
              </div>
            </div>
          </div>

          <!-- Brief -->
          <div class="field-group">
            <label class="field-label" for="camp-brief">{$_('app.campaigns.form.brief', { default: 'Descrizione breve' })}</label>
            <textarea id="camp-brief" name="brief" class="field-textarea" rows="3" required placeholder={$_('app.campaigns.form.briefPh', { default: 'Cosa succede, per chi è, cosa lo rende speciale...' })} disabled={submitting}></textarea>
          </div>

          <!-- Divider -->
          <div class="setting-divider"></div>

          <!-- Reference images -->
          <div class="ref-section">
            <div class="ref-section-head">
              <span class="ref-section-title">{$_('app.campaigns.form.refs', { default: 'Immagini di riferimento (opzionale)' })}</span>
              <span class="ref-section-hint">{$_('app.campaigns.form.refsHint', { default: 'Verranno usate come riferimento visivo per tutti e 5 i post.' })}</span>
            </div>

            <!-- Unified preview of all selected images -->
            {#if totalRefs > 0}
              <div class="ref-grid">
                {#each refPreviews as src, i (src)}
                  <div class="ref-cell selected" style={`background-image:url(${src})`}>
                    <button type="button" class="ref-remove" onclick={() => removeRefFile(i)} aria-label={$_('app.campaigns.form.refsRemove', { default: 'Rimuovi' })}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                {/each}
                {#each ownSelected as url (url)}
                  <button type="button" class="ref-cell selected" onclick={() => removeOwnThumb(url)} aria-label={$_('app.campaigns.form.refsRemove', { default: 'Rimuovi' })}>
                    <img src={proxied(url)} alt="" loading="lazy" />
                    <span class="ref-remove"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
                  </button>
                {/each}
                {#each competitorRefs as url (url)}
                  <div class="ref-cell selected">
                    <img src={proxied(url)} alt="" loading="lazy" />
                    <button type="button" class="ref-remove" onclick={() => (competitorRefs = competitorRefs.filter((u) => u !== url))} aria-label={$_('app.campaigns.form.refsRemove', { default: 'Rimuovi' })}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Add image button + dropdown menu -->
            <div class="ref-add-wrap">
              <button
                type="button"
                class="ref-add-btn"
                onclick={() => (refPanel = refPanel === null ? 'menu' : null)}
                disabled={submitting || totalRefs >= 6}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                {$_('app.campaigns.form.addImage', { default: 'Aggiungi immagine' })}
              </button>

              {#if refPanel === 'menu'}
                <div class="ref-menu" role="menu">
                  <button type="button" class="ref-menu-item" onclick={() => { refPanel = 'device'; }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                    {$_('app.campaigns.form.refsUpload', { default: 'Dal dispositivo' })}
                  </button>
                  <button type="button" class="ref-menu-item" onclick={() => { refPanel = 'own'; }} disabled={!ownThumbs.length}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                    {$_('app.campaigns.form.refsOwn', { default: 'I tuoi post' })}
                  </button>
                  <button type="button" class="ref-menu-item" onclick={() => { refPanel = 'competitor'; }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    {$_('app.campaigns.form.refsCompetitor', { default: "Un altro account" })}
                  </button>
                </div>
              {/if}
            </div>

            <!-- Device upload panel -->
            {#if refPanel === 'device'}
              <div class="ref-panel">
                <div class="ref-panel-head">
                  <span class="ref-panel-title">{$_('app.campaigns.form.refsUpload', { default: 'Dal dispositivo' })}</span>
                  <button type="button" class="ref-panel-close" onclick={() => (refPanel = null)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <label class="upload-dropzone">
                  <input type="file" accept={RASTER_IMAGE_ACCEPT} multiple onchange={onRefFiles} disabled={submitting} class="upload-hidden" />
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <span class="dropzone-text">{$_('app.campaigns.form.refsChoose', { default: 'Scegli immagini' })}</span>
                </label>
              </div>
            {/if}

            <!-- Own posts panel -->
            {#if refPanel === 'own'}
              <div class="ref-panel">
                <div class="ref-panel-head">
                  <span class="ref-panel-title">{$_('app.campaigns.form.refsOwn', { default: 'I tuoi post' })}</span>
                  <button type="button" class="ref-panel-close" onclick={() => (refPanel = null)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                {#if ownThumbs.length}
                  <div class="ref-grid ref-pick-grid">
                    {#each ownThumbs as url (url)}
                      <button
                        type="button"
                        class="ref-cell pick"
                        class:on={ownSelected.includes(url)}
                        onclick={() => toggleOwnThumb(url)}
                        disabled={submitting}
                        aria-label={$_('app.campaigns.form.refsPick', { default: 'Seleziona' })}
                      >
                        <img src={proxied(url)} alt="" loading="lazy" />
                        {#if ownSelected.includes(url)}<span class="ref-check">✓</span>{/if}
                      </button>
                    {/each}
                  </div>
                {:else}
                  <span class="ref-empty">{$_('app.campaigns.form.refsOwnEmpty', { default: 'Nessun post ancora pubblicato.' })}</span>
                {/if}
              </div>
            {/if}

            <!-- Competitor panel -->
            {#if refPanel === 'competitor'}
              <div class="ref-panel">
                <div class="ref-panel-head">
                  <span class="ref-panel-title">{$_('app.campaigns.form.refsCompetitor', { default: 'Un altro account' })}</span>
                  <button type="button" class="ref-panel-close" onclick={() => (refPanel = null)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <SocialThumbPicker brandSlug={brand.slug} bind:selected={competitorRefs} max={6} />
              </div>
            {/if}

            <input type="hidden" name="ref_urls" value={JSON.stringify(selectedUrls)} />
          </div>
        </div>

        <div class="card-footer">
          <button class="btn primary" type="submit" disabled={submitting} aria-busy={submitting}>
            {#if submitting}
              <span class="spin"></span> {$_('app.campaigns.form.generating', { default: 'Genero i 5 post…' })}
            {:else}
              {$_('app.campaigns.form.submit', { default: 'Genera campagna' })}
            {/if}
          </button>
        </div>
      </div>
    </form>
  {/if}

  <!-- Bulk campaign form -->
  {#if mode === 'bulk'}
    <form
      method="POST"
      action="?/createBulk"
      use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          await update();
          submitting = false;
          await invalidateAll();
        };
      }}
    >
      <div class="card">
        <div class="card-body">
          <div class="field-group">
            <label class="field-label">{$_('app.campaigns.bulk.title', { default: 'Più campagne da una lista eventi' })}</label>
            <span class="field-hint">{$_('app.campaigns.bulk.hint', { default: 'Una riga per evento' })}</span>
            <textarea
              name="events"
              class="field-textarea bulk-textarea"
              rows="8"
              required
              placeholder={$_('app.campaigns.bulk.placeholder', {
                default: 'Sagra della Porchetta | 2026-08-15 | menu speciale estivo\nFestival Jazz | 2026-09-10 | sera live\nMercatini Natalizi | 2026-12-01'
              })}
              disabled={submitting}
            ></textarea>
          </div>
        </div>
        <div class="card-footer">
          <button class="btn primary" type="submit" disabled={submitting} aria-busy={submitting}>
            {#if submitting}
              <span class="spin"></span> {$_('app.campaigns.bulk.generating', { default: 'Genero le campagne…' })}
            {:else}
              {$_('app.campaigns.bulk.submit', { default: 'Genera da lista' })}
            {/if}
          </button>
        </div>
      </div>
    </form>
  {/if}

  <!-- Existing campaigns -->
  <section class="section">
    <div class="section-head">
      <h2>{$_('app.campaigns.list.title', { default: 'Campagne esistenti' })}</h2>
      {#if campaigns.length}<span class="section-count">{campaigns.length}</span>{/if}
    </div>

    {#if campaigns.length === 0}
      <div class="card">
        <div class="empty-state">
          <div class="empty-emoji">🎉</div>
          <div class="empty-title">{$_('app.campaigns.empty.title', { default: 'Nessuna campagna ancora' })}</div>
          <div class="empty-sub">{$_('app.campaigns.empty.sub', { default: 'Crea la tua prima campagna evento con il form qui sopra.' })}</div>
        </div>
      </div>
    {:else}
      {#each campaigns as c (c.campaign_id)}
        <div class="card camp-card">
          <div class="camp-card-head">
            <h3 class="camp-card-name">{c.campaign_name}</h3>
            <span class="camp-card-count">{c.posts.length} {$_('app.campaigns.list.posts', { default: 'post' })}</span>
          </div>
          <div class="camp-posts">
            {#each sortedPosts(c.posts) as p (p.id)}
              <div class="camp-post">
                {#if p.media_url}
                  <div class="camp-thumb" style={`background-image:url(${p.media_url})`}></div>
                {:else}
                  <div class="camp-thumb placeholder">
                    <span>🎉</span>
                  </div>
                {/if}
                <div class="camp-post-info">
                  <div class="camp-post-top">
                    <span class="camp-step">{$_(`app.campaigns.step.${p.campaign_step}`, { default: p.campaign_step ?? '' })}</span>
                    <span class="camp-status {p.status}">{$_(`app.campaigns.status.${p.status}`, { default: p.status })}</span>
                  </div>
                  {#if p.scheduled_for}<span class="camp-when">{whenLabel(p.scheduled_for)}</span>{/if}
                  <p class="camp-caption">{(p.caption ?? '').slice(0, 90)}{(p.caption ?? '').length > 90 ? '…' : ''}</p>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </section>
</div>

<style>
  .camp-page {
    width: 100%; min-width: 0; max-width: var(--content-max, 960px);
    margin: 0 auto; padding: 0;
    box-sizing: border-box; overflow-x: hidden;
  }

  /* ── Page header ─────────────────────────────────────────────────── */
  .page-header { margin-bottom: 28px; }
  .page-sub {
    margin: 8px 0 0; max-width: 60ch;
  }

  /* ── Banners ─────────────────────────────────────────────────────── */
  .banner {
    font-size: 13px; font-weight: 500; border-radius: 12px;
    padding: 12px 16px; margin-bottom: 16px;
  }
  .banner.ok { background: #dcfce7; color: #166534; }
  .banner.err { background: #fef2f2; color: #b91c1c; }

  /* ── Mode switcher ───────────────────────────────────────────────── */
  .mode-switcher { margin-bottom: 20px; }

  /* ── Card ────────────────────────────────────────────────────────── */
  .card {
    background: var(--paper); border: 1px solid var(--line);
    border-radius: 16px; margin-bottom: 16px;
  }
  .card-body { padding: 20px 22px; border-radius: 16px 16px 0 0; }
  .card-footer {
    padding: 14px 22px; border-top: 1px solid var(--line);
    background: var(--paper-2); display: flex; justify-content: flex-end;
    border-radius: 0 0 16px 16px;
  }

  /* ── Fields ──────────────────────────────────────────────────────── */
  .field-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
  .field-label {
    font-size: 15px; font-weight: 500; color: var(--ink);
  }
  .field-hint { font-size: 13px; color: var(--ink-faint); }
  .field-input {
    font-size: 15px; padding: 10px 14px; border-radius: 10px;
    border: 1px solid var(--line); background: var(--paper);
    color: var(--ink); font-family: inherit; box-sizing: border-box; width: 100%;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .field-input:focus {
    outline: none; border-color: var(--accent, #7c5cff);
    box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.08);
  }
  .field-input::placeholder { color: var(--ink-faint); }
  .field-textarea {
    font-size: 15px; padding: 10px 14px; border-radius: 10px;
    border: 1px solid var(--line); background: var(--paper);
    color: var(--ink); font-family: inherit; box-sizing: border-box;
    width: 100%; resize: vertical; line-height: 1.5;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .field-textarea:focus {
    outline: none; border-color: var(--accent, #7c5cff);
    box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.08);
  }
  .field-textarea::placeholder { color: var(--ink-faint); }
  .bulk-textarea { font-size: 13.5px; line-height: 1.7; }

  /* ── Setting divider ─────────────────────────────────────────────── */
  .setting-divider { height: 1px; background: var(--line); margin: 4px 0 18px; }

  /* ── iOS segmented control (platform picker) ─────────────────────── */
  .ios-segmented {
    display: inline-flex; background: var(--paper-2); border: 1px solid var(--line);
    border-radius: 10px; padding: 2px; position: relative;
  }
  .ios-segmented label {
    position: relative; z-index: 1; cursor: pointer;
    font-size: 13px; font-weight: 500; color: var(--ink-soft);
    padding: 6px 16px; border-radius: 8px; transition: all 0.2s ease;
    display: flex; align-items: center; justify-content: center;
  }
  .ios-segmented label.active {
    background: var(--paper); color: var(--ink);
    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.04);
  }
  .ios-segmented input { position: absolute; opacity: 0; width: 0; height: 0; }
  .platform-picker { width: 100%; }
  .platform-picker label { flex: 1; text-transform: capitalize; }

  /* ── Reference images ────────────────────────────────────────────── */
  .ref-section-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 16px; }
  .ref-section-title { font-size: 15px; font-weight: 500; color: var(--ink); }
  .ref-section-hint { font-size: 13px; color: var(--ink-faint); }

  .ref-empty { font-size: 13px; color: var(--ink-faint); }

  .ref-grid { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
  .ref-cell {
    position: relative; width: 56px; height: 56px; border-radius: 10px;
    border: 2px solid transparent; padding: 0; cursor: default;
    background-color: var(--paper-2); background-size: cover; background-position: center;
    flex: 0 0 auto;
  }
  .ref-cell.selected { border-color: var(--line); overflow: hidden; }
  .ref-cell.selected img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ref-cell.pick { cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; overflow: hidden; }
  .ref-cell.pick img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ref-cell.pick:hover { border-color: var(--line-2, #d2d2d7); }
  .ref-cell.on {
    border-color: var(--accent, #7c5cff);
    box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.25);
  }
  .ref-check {
    position: absolute; top: 2px; right: 2px; width: 16px; height: 16px;
    border-radius: 50%; background: var(--accent); color: #fff;
    font-size: 10px; font-weight: 700; line-height: 16px; text-align: center;
  }
  .ref-remove {
    position: absolute; top: -4px; right: -4px; width: 18px; height: 18px;
    border-radius: 50%; background: rgba(0,0,0,0.6); color: #fff;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; border: none; padding: 0; transition: background 0.15s;
  }
  .ref-remove:hover { background: rgba(0,0,0,0.85); }

  /* ── Add image button + inline menu ──────────────────────────────── */
  .ref-add-wrap { position: relative; }
  .ref-add-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border: 1px dashed var(--line-2, #c7c7cc);
    border-radius: 10px; background: transparent; cursor: pointer;
    font-size: 13px; font-weight: 500; color: var(--accent, #7c5cff);
    font-family: inherit; transition: background 0.15s, border-color 0.15s;
  }
  .ref-add-btn:hover:not(:disabled) { background: var(--paper-2); border-color: var(--accent, #7c5cff); }
  .ref-add-btn:disabled { opacity: 0.45; cursor: default; }

  .ref-menu {
    margin-top: 10px; display: flex; flex-direction: column; gap: 2px;
    padding: 4px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--paper);
  }
  .ref-menu-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border: none; background: transparent;
    border-radius: 8px; cursor: pointer; text-align: left;
    font-size: 14px; font-weight: 400; color: var(--ink);
    font-family: inherit; transition: background 0.12s;
  }
  .ref-menu-item:hover:not(:disabled) { background: var(--paper-2); }
  .ref-menu-item:disabled { opacity: 0.4; cursor: default; }
  .ref-menu-item svg { color: var(--ink-faint); flex-shrink: 0; }

  /* ── Source panels ───────────────────────────────────────────────── */
  .ref-panel {
    margin-top: 12px; padding: 14px; border: 1px solid var(--line);
    border-radius: 12px; background: var(--paper-2);
  }
  .ref-panel-head {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
  }
  .ref-panel-title {
    font-size: 13px; font-weight: 600; color: var(--ink-faint);
    text-transform: uppercase; letter-spacing: 0.03em;
  }
  .ref-panel-close {
    width: 26px; height: 26px; border: none; border-radius: 8px;
    background: transparent; color: var(--ink-faint); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, color 0.15s;
  }
  .ref-panel-close:hover { background: var(--paper); color: var(--ink); }

  .upload-hidden { display: none; }

  .upload-dropzone {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 24px; border: 2px dashed var(--line-2, #c7c7cc);
    border-radius: 12px; cursor: pointer; color: var(--ink-faint);
    transition: border-color 0.15s, color 0.15s;
  }
  .upload-dropzone:hover { border-color: var(--accent, #7c5cff); color: var(--accent, #7c5cff); }
  .dropzone-text { font-size: 13px; font-weight: 500; }

  .ref-pick-grid { margin-bottom: 0; }

  /* ── Buttons ─────────────────────────────────────────────────────── */
  .btn {
    font-size: 14px; font-weight: 600; border-radius: 10px;
    padding: 10px 20px; cursor: pointer; border: 1px solid transparent;
    line-height: 1; display: inline-flex; align-items: center; gap: 8px;
    transition: opacity 0.15s;
  }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .btn.primary { background: var(--accent, #7c5cff); color: #fff; }
  .spin {
    width: 14px; height: 14px; border-radius: 50%; flex: 0 0 auto;
    border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff;
    animation: camp-spin 0.7s linear infinite;
  }
  @keyframes camp-spin { to { transform: rotate(360deg); } }

  /* ── Section ─────────────────────────────────────────────────────── */
  .section { margin-top: 32px; }
  .section-head {
    display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
  }
  .section-head h2 {
    font-size: 18px; font-weight: 600; letter-spacing: -0.02em;
    margin: 0; color: var(--ink);
  }
  .section-count {
    font-size: 12px; font-weight: 600; color: var(--ink-faint);
    background: var(--paper-2); border: 1px solid var(--line);
    border-radius: 999px; padding: 2px 10px;
  }

  /* ── Empty state ─────────────────────────────────────────────────── */
  .empty-state { padding: 48px 24px; text-align: center; }
  .empty-emoji { font-size: 36px; }
  .empty-title {
    font-size: 17px; font-weight: 600; color: var(--ink); margin-top: 12px;
  }
  .empty-sub { font-size: 14px; color: var(--ink-faint); margin-top: 6px; }

  /* ── Campaign cards ──────────────────────────────────────────────── */
  .camp-card { margin-bottom: 16px; }
  .camp-card-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 22px; border-bottom: 1px solid var(--line);
  }
  .camp-card-name { font-size: 16px; font-weight: 600; margin: 0; color: var(--ink); }
  .camp-card-count {
    font-size: 12px; font-weight: 600; color: var(--ink-faint);
    white-space: nowrap;
  }
  .camp-posts {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 14px; padding: 18px 22px;
  }
  .camp-post {
    border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
    background: var(--paper-2); transition: border-color 0.15s;
  }
  .camp-post:hover { border-color: var(--line-2, #d2d2d7); }
  .camp-thumb {
    width: 100%; aspect-ratio: 1; background-color: var(--paper-2);
    background-size: cover; background-position: center;
  }
  .camp-thumb.placeholder {
    display: flex; align-items: center; justify-content: center;
    font-size: 28px;
  }
  .camp-post-info { padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
  .camp-post-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .camp-step {
    font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--accent, #7c5cff);
  }
  .camp-status {
    font-size: 10px; font-weight: 600; width: fit-content;
    padding: 2px 8px; border-radius: 999px;
    background: var(--paper); color: var(--ink-soft);
  }
  .camp-status.pending_user { color: #a3700a; }
  .camp-status.scheduled { color: var(--accent, #7c5cff); }
  .camp-status.published { color: #1f8a4c; }
  .camp-status.failed { color: #c0392b; }
  .camp-when { font-size: 11px; color: var(--ink-faint); }
  .camp-caption { font-size: 12.5px; color: var(--ink-soft); line-height: 1.4; margin: 2px 0 0; }

  /* ── Responsive ──────────────────────────────────────────────────── */
  @container workbench (max-width: 768px) {
    .camp-page { padding: 0; }
    .card-body { padding: 16px; }
    .card-footer { padding: 12px 16px; justify-content: stretch; }
    .card-footer .btn { width: 100%; justify-content: center; }
    .field-row { grid-template-columns: 1fr; gap: 0; }
    .field-row .field-group { margin-bottom: 18px; }
    .field-group { margin-bottom: 16px; }
    .field-label { font-size: 14px; }
    .field-input, .field-textarea { font-size: 14px; }
    .ios-segmented label { padding: 6px 10px; font-size: 12px; }
    .platform-picker label { font-size: 11px; }
    .camp-card-head { padding: 14px 16px; }
    .camp-posts { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); padding: 14px 16px; gap: 10px; }
    .section-head h2 { font-size: 16px; }
    .ref-grid { gap: 6px; }
    .ref-cell { width: 48px; height: 48px; }
    .ref-add-wrap { width: 100%; }
    .ref-add-btn { width: 100%; justify-content: center; }
  }

  @container workbench (max-width: 480px) {
    .page-header { margin-bottom: 20px; }
    .camp-posts { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
    .camp-post-info { padding: 8px 10px; }
    .camp-caption { font-size: 12px; }
    .mode-switcher .ios-segmented { width: 100%; }
    .mode-switcher .ios-segmented label { flex: 1; justify-content: center; }
  }
</style>
