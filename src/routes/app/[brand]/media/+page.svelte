<script lang="ts">
  import { applyAction, deserialize, enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { ActionResult } from '@sveltejs/kit';
  import { _ } from 'svelte-i18n';
  import { createSupabaseBrowserClient } from '$lib/supabase/client';
  import { jpegIfHeicFile } from '$lib/raster-image-client';
  import { RASTER_OR_VIDEO_ACCEPT, isRasterOrVideoFile } from '$lib/raster-image';
  import PageHead from '$lib/components/PageHead.svelte';
  import { Upload } from '@lucide/svelte';

  let { data, form } = $props();

  let deferred = $state<{ items: MediaItem[] } | null>(null);
  let busy = $state(false);
  let uploadError = $state('');
  let filter = $state('');
  let selectedId = $state<string | null>(null);
  let editTitle = $state('');
  let editDescription = $state('');
  let editTags = $state('');
  let editSuggested = $state('');
  let editWhen = $state('');
  let editHow = $state('');
  let editWhere = $state('');

  type MediaItem = {
    id: string;
    kind: 'image' | 'video';
    file_name: string | null;
    title: string | null;
    description: string | null;
    tags: string[] | null;
    subjects: string[] | null;
    colors: string[] | null;
    mood: string | null;
    media_kind: string | null;
    suggested_use: string | null;
    when_to_use: string | null;
    how_to_use: string | null;
    where_to_use: string | null;
    catalog_status: string;
    catalog_error: string | null;
    mime: string | null;
    width: number | null;
    height: number | null;
    bytes: number | null;
    duration_seconds: number | null;
    signed_url: string | null;
    created_at: string;
  };

  $effect(() => {
    const p = data.deferred;
    p.then((v) => {
      if (p === data.deferred) deferred = v;
    }).catch(() => {});
  });

  const items = $derived(deferred?.items ?? []);
  const loading = $derived(deferred === null);
  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) => {
      const hay = [
        m.title,
        m.description,
        m.file_name,
        m.media_kind,
        m.mood,
        m.suggested_use,
        ...(m.tags ?? []),
        ...(m.subjects ?? [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  });

  const selected = $derived(items.find((m) => m.id === selectedId) ?? null);

  $effect(() => {
    if (!selected) return;
    editTitle = selected.title ?? '';
    editDescription = selected.description ?? '';
    editTags = (selected.tags ?? []).join(', ');
    editSuggested = selected.suggested_use ?? '';
    editWhen = selected.when_to_use ?? '';
    editHow = selected.how_to_use ?? '';
    editWhere = selected.where_to_use ?? '';
  });

  const supabase = createSupabaseBrowserClient();
  const brandId = $derived(data.brand.id);
  const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

  async function resolveUserId(): Promise<string> {
    const fromSession = data.session?.user?.id;
    if (fromSession) return fromSession;
    const { data: auth } = await supabase.auth.getUser();
    return auth.user?.id ?? '';
  }

  function formatBytes(n: number | null | undefined) {
    if (n == null || !Number.isFinite(n)) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function readImageMeta(file: File): Promise<{ width: number | null; height: number | null }> {
    if (!file.type.startsWith('image/')) return { width: null, height: null };
    try {
      const bmp = await createImageBitmap(file);
      const out = { width: bmp.width, height: bmp.height };
      bmp.close();
      return out;
    } catch {
      return { width: null, height: null };
    }
  }

  async function readVideoMeta(
    file: File
  ): Promise<{ width: number | null; height: number | null; duration: number | null }> {
    if (!file.type.startsWith('video/')) return { width: null, height: null, duration: null };
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve({
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          duration: Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : null
        });
        URL.revokeObjectURL(url);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: null, height: null, duration: null });
      };
      video.src = url;
    });
  }

  async function handleUpload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = input.files ? Array.from(input.files).filter((f) => f.size > 0) : [];
    if (!files.length) return;
    const userId = await resolveUserId();
    if (!userId) {
      uploadError = 'Not authenticated';
      return;
    }
    uploadError = '';
    busy = true;
    try {
      const fd = new FormData();
      for (const file of files.slice(0, 20)) {
        if (!isRasterOrVideoFile(file)) continue;
        if (file.size > 40 * 1024 * 1024) {
          uploadError = $_('app.media.fileTooLarge');
          continue;
        }
        const ready = file.type.startsWith('video/') ? file : await jpegIfHeicFile(file);
        const path = `${userId}/${brandId}/media/${crypto.randomUUID()}-${safeName(ready.name)}`;
        const up = await supabase.storage
          .from('brand-knowledge')
          .upload(path, ready, { contentType: ready.type || 'application/octet-stream', upsert: false });
        if (up.error) throw new Error(up.error.message);

        const imgMeta = await readImageMeta(ready);
        const vidMeta = await readVideoMeta(ready);

        fd.append('path', path);
        fd.append('file_name', ready.name);
        fd.append('mime_type', ready.type);
        fd.append('size_bytes', String(ready.size));
        fd.append('width', String(imgMeta.width ?? vidMeta.width ?? ''));
        fd.append('height', String(imgMeta.height ?? vidMeta.height ?? ''));
        fd.append('duration_seconds', String(vidMeta.duration ?? ''));
      }
      if (![...fd.keys()].includes('path')) {
        uploadError = $_('app.media.noValidFiles');
        return;
      }
      const res = await fetch(`?/upload`, { method: 'POST', body: fd });
      const result: ActionResult = deserialize(await res.text());
      if (result.type === 'failure') {
        uploadError = (result.data?.error as string) ?? 'Unknown error';
      } else {
        await invalidateAll();
      }
      applyAction(result);
    } catch (e) {
      uploadError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      input.value = '';
    }
  }

  function openItem(m: MediaItem) {
    selectedId = m.id;
  }

  function closeDetail() {
    selectedId = null;
  }
</script>

<div class="media-page">
  <PageHead title={$_('app.media.title')} subtitle={$_('app.media.subtitle')}>
    {#snippet actions()}
      <label class="topbar-cta upload-btn" class:is-busy={busy} class:disabled={busy}>
        {#if busy}
          <span class="topbar-cta-spin" aria-hidden="true"></span>
        {:else}
          <Upload class="topbar-cta-icon" strokeWidth={2.1} aria-hidden="true" />
        {/if}
        <span>{busy ? $_('app.media.uploading') : $_('app.media.upload')}</span>
        <input
          type="file"
          accept={RASTER_OR_VIDEO_ACCEPT}
          multiple
          disabled={busy}
          onchange={handleUpload}
        />
      </label>
    {/snippet}
  </PageHead>

  {#if form?.error}
    <p class="banner err">{form.error}</p>
  {:else if form?.saved}
    <p class="banner ok">{$_('app.media.saved')}</p>
  {/if}
  {#if uploadError}
    <p class="banner err">{uploadError}</p>
  {/if}

  <div class="toolbar">
    <input
      class="search"
      type="search"
      placeholder={$_('app.media.search')}
      bind:value={filter}
    />
    <span class="count">{filtered.length} / {items.length}</span>
  </div>

  {#if loading}
    <p class="muted">{$_('app.media.loading')}</p>
  {:else if !filtered.length}
      <div class="empty">
        <h3>{$_('app.media.emptyTitle')}</h3>
        <p>{$_('app.media.emptyBody')}</p>
        <label class="btn primary upload-btn">
          {$_('app.media.upload')}
          <input type="file" accept={RASTER_OR_VIDEO_ACCEPT} multiple disabled={busy} onchange={handleUpload} />
        </label>
      </div>
    {:else}
      <div class="grid">
        {#each filtered as m (m.id)}
          <button type="button" class="tile" class:active={selectedId === m.id} onclick={() => openItem(m)}>
            <div class="thumb">
              {#if m.kind === 'video'}
                {#if m.signed_url}
                  <video src={m.signed_url} muted playsinline preload="metadata"></video>
                {:else}
                  <span class="ph">▶</span>
                {/if}
                <span class="badge vid">video</span>
              {:else if m.signed_url}
                <img src={m.signed_url} alt={m.title ?? m.file_name ?? ''} loading="lazy" />
              {:else}
                <span class="ph">img</span>
              {/if}
              {#if m.catalog_status === 'pending'}
                <span class="badge st">…</span>
              {:else if m.catalog_status === 'failed'}
                <span class="badge fail">!</span>
              {/if}
            </div>
            <div class="meta">
              <strong>{m.title || m.file_name || 'Untitled'}</strong>
              <span class="dim">
                {#if m.width && m.height}{m.width}×{m.height} · {/if}{formatBytes(m.bytes)}
              </span>
              {#if m.tags?.length}
                <span class="tags">{m.tags.slice(0, 3).join(' · ')}</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}

  {#if selected}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="drawer-bg" onclick={closeDetail}></div>
    <aside class="drawer" role="dialog" aria-label={$_('app.media.detail')}>
      <header class="drawer-head">
        <h2>{selected.title || selected.file_name}</h2>
        <button type="button" class="btn ghost" onclick={closeDetail}>×</button>
      </header>

      <div class="preview">
        {#if selected.kind === 'video' && selected.signed_url}
          <video src={selected.signed_url} controls playsinline></video>
        {:else if selected.signed_url}
          <img src={selected.signed_url} alt="" />
        {/if}
      </div>

      <dl class="tech">
        <div><dt>{$_('app.media.kind')}</dt><dd>{selected.kind}{selected.media_kind ? ` · ${selected.media_kind}` : ''}</dd></div>
        <div><dt>{$_('app.media.resolution')}</dt><dd>{selected.width && selected.height ? `${selected.width}×${selected.height}` : '—'}</dd></div>
        <div><dt>{$_('app.media.size')}</dt><dd>{formatBytes(selected.bytes)}</dd></div>
        <div><dt>MIME</dt><dd>{selected.mime ?? '—'}</dd></div>
        {#if selected.duration_seconds != null}
          <div><dt>{$_('app.media.duration')}</dt><dd>{selected.duration_seconds}s</dd></div>
        {/if}
        <div><dt>{$_('app.media.catalog')}</dt><dd>{selected.catalog_status}{selected.catalog_error ? ` — ${selected.catalog_error}` : ''}</dd></div>
      </dl>

      {#if selected.subjects?.length}
        <p class="subjects"><strong>{$_('app.media.subjects')}:</strong> {selected.subjects.join(', ')}</p>
      {/if}
      {#if selected.mood}
        <p class="subjects"><strong>{$_('app.media.mood')}:</strong> {selected.mood}</p>
      {/if}

      <form
        method="POST"
        action="?/update"
        class="edit"
        use:enhance={() => {
          return async ({ result, update }) => {
            const deleted =
              result.type === 'success' &&
              typeof window !== 'undefined' &&
              (document.activeElement as HTMLButtonElement | null)?.getAttribute('formaction')?.includes('delete');
            await update();
            await invalidateAll();
            if (deleted) closeDetail();
          };
        }}
      >
        <input type="hidden" name="id" value={selected.id} />
        <label>
          <span>{$_('app.media.fieldTitle')}</span>
          <input name="title" bind:value={editTitle} />
        </label>
        <label>
          <span>{$_('app.media.fieldDescription')}</span>
          <textarea name="description" rows="4" bind:value={editDescription}></textarea>
        </label>
        <label>
          <span>{$_('app.media.fieldTags')}</span>
          <input name="tags" bind:value={editTags} placeholder="product, outdoor, lifestyle" />
        </label>
        <label>
          <span>{$_('app.media.fieldSuggested')}</span>
          <textarea name="suggested_use" rows="2" bind:value={editSuggested}></textarea>
        </label>
        <label>
          <span>{$_('app.media.fieldWhen')}</span>
          <textarea name="when_to_use" rows="2" bind:value={editWhen}></textarea>
        </label>
        <label>
          <span>{$_('app.media.fieldHow')}</span>
          <textarea name="how_to_use" rows="2" bind:value={editHow}></textarea>
        </label>
        <label>
          <span>{$_('app.media.fieldWhere')}</span>
          <textarea name="where_to_use" rows="2" bind:value={editWhere}></textarea>
        </label>
        <div class="actions">
          <button class="btn primary" type="submit">{$_('app.media.save')}</button>
          <button class="btn ghost" type="submit" formaction="?/recatalog">{$_('app.media.recatalog')}</button>
          <button class="btn ghost danger" type="submit" formaction="?/delete">{$_('app.media.delete')}</button>
        </div>
      </form>
    </aside>
  {/if}
</div>

<style>
  .media-page { max-width: var(--content-max, 960px); margin: 0 auto; padding: 0; position: relative; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
  .sub { margin: 0; max-width: 560px; }

  .upload-btn {
    position: relative;
    overflow: hidden;
    cursor: pointer;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 999px;
    padding: 9px 16px;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    line-height: 1;
    color: #fff;
    background: var(--accent);
    box-shadow:
      0 1px 0 color-mix(in srgb, #000 12%, transparent),
      0 6px 16px -8px color-mix(in srgb, var(--accent) 70%, transparent);
    transform: translateY(0) scale(1);
    transition:
      transform 0.15s ease,
      background 0.15s ease,
      box-shadow 0.15s ease,
      opacity 0.15s ease;
    user-select: none;
  }
  .upload-btn:hover:not(.disabled):not(.is-busy) {
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--accent) 88%, #000);
  }
  .upload-btn:active:not(.disabled):not(.is-busy) {
    transform: translateY(1px) scale(0.98);
    background: color-mix(in srgb, var(--accent) 78%, #000);
    box-shadow: none;
  }
  .upload-btn.disabled,
  .upload-btn.is-busy {
    opacity: 0.72;
    cursor: not-allowed;
    pointer-events: none;
    transform: none;
    box-shadow: none;
  }
  .upload-btn input[type='file'] {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .upload-btn.is-busy input[type='file'] {
    pointer-events: none;
  }
  .upload-btn :global(.topbar-cta-icon) {
    width: 15px;
    height: 15px;
    flex: 0 0 15px;
  }
  .topbar-cta-spin {
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    animation: media-spin 0.7s linear infinite;
  }
  @keyframes media-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .banner { font-size: 13px; border-radius: 10px; padding: 10px 14px; margin: 0 0 16px; }
  .banner.ok { background: #dcfce7; color: #166534; }
  .banner.err { background: #fef2f2; color: #b91c1c; }

  .toolbar { display: flex; align-items: center; gap: 12px; margin: 8px 0 18px; }
  .search {
    flex: 1; border: 1px solid var(--line); background: var(--paper); color: var(--ink);
    border-radius: 10px; padding: 10px 12px; font-size: 14px;
  }
  .count { font-size: 12px; color: var(--ink-faint); white-space: nowrap; }
  .muted { color: var(--ink-soft); font-size: 14px; }

  .empty { text-align: center; padding: 48px 20px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .empty h3 { margin: 0; font-size: 18px; }
  .empty p { margin: 0 0 8px; color: var(--ink-soft); max-width: 420px; line-height: 1.5; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 14px;
  }
  .tile {
    text-align: left; border: 1px solid var(--line); background: var(--paper);
    border-radius: 14px; padding: 0; overflow: hidden; cursor: pointer; color: inherit;
  }
  .tile:hover, .tile.active { border-color: var(--ink-soft); }
  .thumb {
    position: relative; aspect-ratio: 1; background: var(--paper-2);
    display: grid; place-items: center; overflow: hidden;
  }
  .thumb img, .thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ph { font-size: 12px; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.06em; }
  .badge {
    position: absolute; top: 8px; left: 8px; font-size: 10px; font-weight: 700;
    padding: 2px 7px; border-radius: 999px; background: rgba(0,0,0,0.55); color: #fff;
  }
  .badge.st, .badge.fail { left: auto; right: 8px; }
  .badge.fail { background: #b91c1c; }
  .meta { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 3px; }
  .meta strong { font-size: 13px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .dim, .tags { font-size: 11px; color: var(--ink-faint); }
  .tags { color: var(--ink-soft); }

  .drawer-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.28); z-index: 40; }
  .drawer {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw);
    background: var(--paper); border-left: 1px solid var(--line); z-index: 41;
    overflow: auto; padding: 20px 20px 40px; display: flex; flex-direction: column; gap: 14px;
  }
  .drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .drawer-head h2 { margin: 0; font-size: 18px; line-height: 1.3; }
  .preview { border-radius: 12px; overflow: hidden; background: var(--paper-2); }
  .preview img, .preview video { width: 100%; display: block; max-height: 280px; object-fit: contain; background: #111; }

  .tech { margin: 0; display: grid; gap: 8px; }
  .tech > div { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
  .tech dt { color: var(--ink-faint); }
  .tech dd { margin: 0; color: var(--ink); text-align: right; }
  .subjects { margin: 0; font-size: 13px; color: var(--ink-soft); line-height: 1.45; }

  .edit { display: flex; flex-direction: column; gap: 10px; }
  .edit label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-soft); }
  .edit input, .edit textarea {
    border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px;
    font: inherit; font-size: 13px; color: var(--ink); background: var(--paper); resize: vertical;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
  .danger { color: #b91c1c !important; }
</style>
