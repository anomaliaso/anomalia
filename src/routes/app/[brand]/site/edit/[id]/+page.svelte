<script lang="ts">
  import { page } from '$app/stores';
  import { enhance } from '$app/forms';
  import { backHref } from '$lib/page-modal-navigation';
  import { pageModalOrigin } from '$lib/stores/page-modal';
  import BlogEditor from '$lib/components/blog/BlogEditor.svelte';
  import { jpegIfHeicFile, jpegIfHeicFormFiles } from '$lib/raster-image-client';
  import { RASTER_IMAGE_ACCEPT } from '$lib/raster-image';

  let { data, form } = $props();
  const siteHref = $derived(`/app/${$page.params.brand}/site`);
  const returnHref = $derived(backHref($pageModalOrigin, siteHref));

  let title = $state(data.article.title);
  let metaTitle = $state(data.article.metaTitle);
  let metaDescription = $state(data.article.metaDescription);
  let cover = $state<string | null>(data.article.cover);
  let editorRef = $state<BlogEditor | null>(null);
  let busy = $state(false);
  let dirty = $state(false);
  let bodyMd = $state(data.article.bodyMd);
  let categoryId = $state(data.article.categoryId);
  let authorId = $state(data.article.authorId);
  let selectedTagIds = $state(new Set(data.articleTagIds));

  const uploadUrl = $derived(`${$page.url.pathname.replace(/\/$/, '')}/upload`);
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      busy = false;
      cover = data.article.cover;
    };
  };

  async function uploadImage(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = RASTER_IMAGE_ACCEPT;
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const fd = new FormData();
        try {
          fd.append('file', await jpegIfHeicFile(file));
        } catch {
          fd.append('file', file);
        }
        const res = await fetch(uploadUrl, { method: 'POST', body: fd });
        resolve(res.ok ? (await res.json()).url : null);
      };
      input.click();
    });
  }

</script>

<div class="editor-page">
  <header class="ed-head">
    <a class="back" href={returnHref}>← Blog</a>
    <div class="ed-actions">
      <a class="btn ghost" href="/blog-preview/{data.article.id}" target="_blank" rel="noopener noreferrer">Anteprima ↗</a>
      <span class="status-tag">{data.article.status === 'published' ? 'pubblicato' : 'bozza'}</span>
    </div>
  </header>

  {#if form?.saved}<p class="banner ok">Salvato.</p>
  {:else if form?.coverUploaded}<p class="banner ok">Copertina caricata.</p>
  {:else if form?.coverGenerated}<p class="banner ok">Copertina generata con l'AI.</p>
  {:else if form?.coverRemoved}<p class="banner ok">Copertina rimossa.</p>
  {:else if form?.error === 'title_required'}<p class="banner err">Il titolo è obbligatorio.</p>
  {:else if form?.error === 'cover_gen_failed'}<p class="banner err">Generazione copertina non riuscita. Riprova.</p>
  {:else if form?.error === 'too_large'}<p class="banner err">Immagine troppo grande (max 5MB).</p>
  {:else if form?.error === 'not_image'}<p class="banner err">Il file dev'essere un'immagine.</p>
  {:else if form?.error}<p class="banner err">Errore: {form.error}</p>{/if}

  <!-- Full-width cover / thumbnail with Ask-AI overlay -->
  <section class="cover-box">
    <div class="cover-hero" class:empty={!cover}>
      {#if cover}
        <img src={cover} alt="copertina" />
      {:else}
        <span class="cover-ph" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="M21 15l-5-5L5 21" />
          </svg>
          <span>Nessuna copertina</span>
        </span>
      {/if}
    </div>
    <div class="cover-ctl">
      <div class="cover-meta">
        <span class="cover-label">Immagine di copertina</span>
        <span class="muted small">Thumbnail nella homepage del blog e immagine per lo share social (og:image).</span>
      </div>
      <div class="cover-btns">
        <form
          method="POST"
          action="?/uploadCover"
          enctype="multipart/form-data"
          use:enhance={async ({ formData }) => {
            await jpegIfHeicFormFiles(formData, 'cover');
            return withBusy();
          }}
        >
          <label class="btn ghost file-btn">Carica dal device<input type="file" name="cover" accept={RASTER_IMAGE_ACCEPT} hidden onchange={(e) => e.currentTarget.form?.requestSubmit()} /></label>
        </form>
        <form method="POST" action="?/generateCover" use:enhance={withBusy}>
          <button class="btn ghost" type="submit" disabled={busy}>{busy ? 'Generazione…' : '✨ Genera con AI'}</button>
        </form>
        {#if cover}
          <form method="POST" action="?/removeCover" use:enhance={withBusy}>
            <button class="btn-link" type="submit" disabled={busy}>Rimuovi</button>
          </form>
        {/if}
      </div>
    </div>
  </section>

  <form
    method="POST"
    action="?/save"
    use:enhance={({ formData }) => {
      formData.set('body_md', editorRef?.getMarkdown() ?? bodyMd);
      busy = true;
      return async ({ update }) => { await update({ reset: false }); busy = false; dirty = false; };
    }}
  >
    <input class="title-input" name="title" bind:value={title} placeholder="Titolo dell'articolo" />

    <div class="workspace">
      <div class="editor-wrap">
        <BlogEditor
          bind:this={editorRef}
          initialMarkdown={bodyMd}
          onChange={() => (dirty = true)}
          onImageUpload={uploadImage}
        />
      </div>

      <div class="right-col">
        <details class="seo">
          <summary>SEO</summary>
          <label>Meta title<input name="meta_title" bind:value={metaTitle} maxlength="70" placeholder="Titolo SEO (max 60)" /></label>
          <label>Meta description<textarea name="meta_description" bind:value={metaDescription} rows="2" maxlength="200" placeholder="Descrizione SEO (max 155)"></textarea></label>
        </details>

        <details class="seo" open>
          <summary>Categoria, Tag e Autore</summary>
          <div class="tax-editor-grid">
            <label>Categoria
              <select name="category_id" bind:value={categoryId}>
                <option value="">Nessuna</option>
                {#each data.categories as cat}<option value={cat.id}>{cat.name}</option>{/each}
              </select>
            </label>
            <label>Autore
              <select name="author_id" bind:value={authorId}>
                <option value="">Nessuno</option>
                {#each data.authors as a}<option value={a.id}>{a.name}</option>{/each}
              </select>
            </label>
          </div>
          {#if data.allTags.length}
            <label>Tag</label>
            <div class="tag-picker">
              {#each data.allTags as tag}
                <label class="tag-check" class:selected={selectedTagIds.has(tag.id)}>
                  <input type="checkbox" name="tag_ids" value={tag.id}
                    checked={selectedTagIds.has(tag.id)}
                    onchange={() => { if (selectedTagIds.has(tag.id)) selectedTagIds.delete(tag.id); else selectedTagIds.add(tag.id); selectedTagIds = new Set(selectedTagIds); dirty = true; }} />
                  #{tag.name}
                </label>
              {/each}
            </div>
          {/if}
        </details>

        <details class="score-panel" open>
          <summary>
            Punteggio articolo — {data.score.score === null ? 'non assegnabile' : `${data.score.score}/100`}
            {#if data.score.tier === 'provisional'}<span class="tag prov">provvisorio</span>{/if}
          </summary>
          <div class="score-body">
            <div
              class="score-ring {data.score.score === null
                ? 'unknown'
                : data.score.score >= 80
                  ? 'good'
                  : data.score.score >= 55
                    ? 'mid'
                    : 'low'}"
            >
              {#if data.score.score === null}
                <b>—</b><small>evidenza</small>
              {:else}
                <b>{data.score.score}</b><small>/100</small>
              {/if}
            </div>
            <ul class="checks">
              <!-- Four verdicts, not two: an "unknown" is missing evidence, not a failure, and an
                   "na" is a question this article does not raise. Showing them as ○ told the user
                   to go fix something that was never broken. -->
              {#each data.score.checks as c}
                <li
                  class={c.verdict === 'pass' ? 'ok' : c.verdict === 'fail' ? 'no' : 'unk'}
                  title={c.note ?? ''}
                >
                  <span class="tick"
                    >{c.verdict === 'pass' ? '✓' : c.verdict === 'fail' ? '○' : c.verdict === 'na' ? '–' : '?'}</span
                  >{c.label}
                </li>
              {/each}
            </ul>
            <dl class="metrics">
              <div><dt>Parole</dt><dd>{data.score.metrics.wordCount.toLocaleString('it-IT')}</dd></div>
              <div><dt>Keyword</dt><dd>{data.score.metrics.keywords}</dd></div>
              <div><dt>Immagini</dt><dd>{data.score.metrics.images}</dd></div>
              <div><dt>Link interni</dt><dd>{data.score.metrics.internalLinks}</dd></div>
              <div><dt>Link esterni</dt><dd>{data.score.metrics.externalLinks}</dd></div>
            </dl>
          </div>
          <p class="muted small" style="margin:10px 0 0;">
            {data.score.label} Il punteggio si aggiorna dopo il salvataggio ed è calcolato solo sulle
            dimensioni davvero ispezionate: un check con <b>?</b> è evidenza che manca, non un errore da correggere,
            e uno con <b>–</b> non si applica a questo articolo.
          </p>
        </details>
      </div>
    </div>

    <div class="save-row">
      {#if dirty}<span class="dirty">Modifiche non salvate</span>{/if}
      <button class="btn primary" type="submit" disabled={busy}>{busy ? 'Salvataggio…' : 'Salva'}</button>
    </div>
  </form>

  <form method="POST" action="/app/{$page.params.brand}/site?/humanizeArticle" use:enhance={withBusy} class="humanize-form">
    <input type="hidden" name="id" value={data.article.id} />
    <button class="btn ghost" type="submit" disabled={busy}>{busy ? 'Humanizzazione…' : '🖊️ Humanizza'}</button>
  </form>
</div>

<style>
  /* Padding comes from content-shell (--content-pad-*); keep this shell flush. */
  .editor-page {
    max-width: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    width: 100%;
    overflow-x: hidden;
    box-sizing: border-box;
  }
  .editor-page form { display: flex; flex-direction: column; min-width: 0; width: 100%; }
  .ed-head {
    display: flex; flex-direction: row; align-items: center; justify-content: space-between;
    gap: 10px; margin-bottom: 10px; flex-shrink: 0; height: auto; min-width: 0;
  }
  .back { font-size: 14px; color: var(--ink-soft); text-decoration: none; flex-shrink: 0; }
  .back:hover { color: var(--ink); }
  .ed-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
  .status-tag { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px; background: var(--paper-2); color: var(--ink-faint); white-space: nowrap; }
  .banner { font-size: 13px; border-radius: 10px; padding: 10px 14px; margin: 0 0 12px; word-break: break-word; }
  .banner.ok { background: #dcfce7; color: #166534; }
  .banner.err { background: #fef2f2; color: #b91c1c; }

  .cover-box {
    display: flex; flex-direction: column; gap: 12px; margin-bottom: 14px;
    flex-shrink: 0; min-width: 0; box-sizing: border-box;
  }
  .cover-hero {
    position: relative; width: 100%; aspect-ratio: 16 / 9; max-height: min(420px, 48vw);
    border-radius: 14px; overflow: hidden; background: var(--paper-2);
    border: 1px solid var(--line);
  }
  .cover-hero.empty { max-height: 180px; aspect-ratio: 21 / 6; }
  .cover-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cover-ph {
    color: var(--ink-faint); display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; width: 100%; height: 100%; font-size: 13px;
  }
  .cover-ph svg { width: 36px; height: 36px; }
  .cover-ctl {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
    flex-wrap: wrap; min-width: 0;
  }
  .cover-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
  .cover-label { font-size: 14px; font-weight: 600; color: var(--ink); }
  .cover-btns { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cover-btns form { display: inline; }
  .file-btn { cursor: pointer; }
  .btn-link { background: none; border: none; color: var(--ink-faint); font-size: 12px; cursor: pointer; text-decoration: underline; padding: 0; }
  .muted { color: var(--ink-faint); }
  .small { font-size: 12px; }

  .title-input {
    width: 100%; max-width: 100%; box-sizing: border-box;
    font-size: 24px; font-weight: 700; letter-spacing: -0.02em;
    border: none; border-bottom: 1px solid var(--line); padding: 6px 2px 12px; margin-bottom: 12px;
    background: transparent; color: var(--ink); outline: none; flex-shrink: 0;
  }
  .workspace { display: flex; gap: 16px; min-width: 0; width: 100%; }
  .editor-wrap { flex: 1; min-width: 0; display: flex; min-height: 600px; }
  .editor-wrap :global(.editor-shell) { flex: 1; min-width: 0; max-width: 100%; }
  .right-col {
    width: 340px; max-width: 100%; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px;
    position: sticky; top: 14px; align-self: flex-start; max-height: calc(100dvh - 28px);
    overflow-y: auto; overflow-x: hidden; min-width: 0; box-sizing: border-box;
  }
  @container workbench (max-width: 1000px) {
    .workspace { flex-direction: column; }
    .editor-wrap { min-height: 420px; }
    .right-col { width: 100%; position: static; max-height: none; align-self: stretch; }
  }
  @container workbench (max-width: 640px) {
    .cover-hero { max-height: none; }
    .cover-ctl { flex-direction: column; align-items: stretch; }
    .title-input { font-size: 20px; }
    .tax-editor-grid { flex-direction: column; gap: 0; }
    .editor-wrap { min-height: 360px; }
    .checks { grid-template-columns: 1fr; min-width: 0; }
    .score-body { gap: 14px; }
    .metrics { width: 100%; }
    .btn { padding: 10px 14px; }
    .ed-actions .btn { padding: 8px 12px; font-size: 12px; }
  }

  .seo { border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; flex-shrink: 0; min-width: 0; box-sizing: border-box; }
  .seo summary { font-size: 13px; font-weight: 600; color: var(--ink-soft); cursor: pointer; }
  .seo label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--ink-soft); margin-top: 12px; min-width: 0; }
  .seo input, .seo textarea {
    font-size: 14px; padding: 8px 11px; border: 1px solid var(--line); border-radius: 10px;
    background: var(--paper); color: var(--ink); font-weight: 400; font-family: inherit;
    width: 100%; max-width: 100%; box-sizing: border-box;
  }
  .tax-editor-grid { display: flex; gap: 12px; min-width: 0; }
  .tax-editor-grid label { flex: 1; min-width: 0; }
  .tax-editor-grid select {
    width: 100%; max-width: 100%; box-sizing: border-box; font-size: 14px; padding: 8px 11px;
    border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink);
    font-weight: 400; font-family: inherit;
  }
  .tag-picker { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .tag-check {
    display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500;
    padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--paper);
    color: var(--ink-soft); cursor: pointer; transition: background 0.15s, border-color 0.15s;
  }
  .tag-check input { display: none; }
  .tag-check.selected { background: var(--accent, #7c5cff); color: #fff; border-color: var(--accent, #7c5cff); }

  .humanize-form { display: flex; justify-content: flex-end; margin-top: 8px; flex-shrink: 0; flex-wrap: wrap; gap: 8px; }
  .save-row { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin-top: 12px; flex-shrink: 0; flex-wrap: wrap; }
  .dirty { font-size: 12px; color: var(--ink-faint); }
  .btn {
    font-size: 13px; font-weight: 600; border-radius: 10px; padding: 10px 20px; cursor: pointer;
    border: 1px solid transparent; text-decoration: none; display: inline-flex; align-items: center;
    box-sizing: border-box; max-width: 100%;
  }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .btn.primary { background: var(--accent, #7c5cff); color: #fff; box-shadow: 0 4px 14px rgba(0,0,0,0.12); }
  .btn.ghost { background: var(--paper); color: var(--ink-soft); border-color: var(--line); }

  .score-panel { border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; flex-shrink: 0; min-width: 0; box-sizing: border-box; }
  .score-panel summary { font-size: 13px; font-weight: 700; color: var(--ink); cursor: pointer; }
  .score-body { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap; margin-top: 14px; min-width: 0; }
  .score-ring { width: 92px; height: 92px; border-radius: 50%; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 4px solid; }
  .score-ring b { font-size: 26px; font-weight: 800; line-height: 1; }
  .score-ring small { font-size: 11px; opacity: 0.65; }
  .score-ring.good { border-color: #22c55e; color: #166534; background: #f0fdf4; }
  .score-ring.mid { border-color: #f59e0b; color: #92400e; background: #fffbeb; }
  .score-ring.low { border-color: #ef4444; color: #b91c1c; background: #fef2f2; }
  .score-ring.unknown { border-color: var(--line); color: var(--ink-faint); background: transparent; }
  .tag.prov { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 999px; padding: 1px 7px; margin-left: 6px; }
  .checks {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
    gap: 4px 16px; flex: 1; min-width: 0;
  }
  .checks li { font-size: 12.5px; display: flex; align-items: center; gap: 7px; color: var(--ink-soft); min-width: 0; }
  .checks li .tick { font-weight: 700; width: 14px; text-align: center; flex-shrink: 0; }
  .checks li.ok .tick { color: #16a34a; }
  .checks li.no { color: var(--ink-faint); }
  .checks li.no .tick { color: var(--ink-faint); }
  /* Missing evidence and not-applicable read differently from a failure: neither is something the
     writer can go fix, so neither is styled like a to-do. */
  .checks li.unk { color: var(--ink-faint); font-style: italic; }
  .checks li.unk .tick { color: #a78bfa; }
  .metrics { display: flex; flex-direction: column; gap: 6px; margin: 0; flex-shrink: 0; min-width: 0; }
  .metrics div { display: flex; justify-content: space-between; gap: 18px; font-size: 12.5px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
  .metrics dt { color: var(--ink-faint); margin: 0; }
  .metrics dd { margin: 0; font-weight: 700; color: var(--ink); }
</style>
