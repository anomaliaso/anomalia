<script lang="ts">
  import { enhance } from '$app/forms';
  import { SvelteSet } from 'svelte/reactivity';
  import { jpegIfHeicFormFiles } from '$lib/raster-image-client';
  import { RASTER_IMAGE_ACCEPT } from '$lib/raster-image';

  let {
    data,
    form
  }: {
    data: {
      authors: Array<{
        id: string;
        name: string;
        role: string;
        bio: string | null;
        avatarUrl: string | null;
      }>;
    };
    form?: Record<string, unknown> | null;
  } = $props();

  const busy = new SvelteSet<string>();
  const isBusy = (key: string) => busy.has(key);
  const withBusy = (key: string) => () => {
    busy.add(key);
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy.delete(key);
    };
  };

  let avatarPreview = $state<string | null>(null);

  function onAvatarChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    avatarPreview = file ? URL.createObjectURL(file) : null;
  }

  const roleLabel: Record<string, string> = {
    writer: 'Writer',
    editor: 'Editor',
    contributor: 'Contributor'
  };
</script>

{#if form?.authorCreated}<p class="banner ok">Autore aggiunto.</p>
{:else if form?.authorDeleted}<p class="banner ok">Autore eliminato.</p>
{:else if form?.error === 'too_large'}<p class="banner err">Avatar troppo grande (max 2MB).</p>
{:else if form?.error === 'not_image'}<p class="banner err">Il file dev'essere un'immagine.</p>{/if}

<section class="panel">
  <div class="panel-head">
    <div>
      <div class="t">Autori</div>
      <p class="panel-sub">Compare come byline negli articoli del blog.</p>
    </div>
  </div>
  <div class="panel-body">
    {#if data.authors.length}
      <ul class="author-list">
        {#each data.authors as author (author.id)}
          <li>
            <div class="author-info">
              {#if author.avatarUrl}
                <img src={author.avatarUrl} alt={author.name} class="author-thumb" />
              {:else}
                <span class="author-thumb fallback">{author.name.slice(0, 1)}</span>
              {/if}
              <div class="author-meta">
                <b>{author.name}</b>
                <span class="role-pill">{roleLabel[author.role] ?? author.role}</span>
                {#if author.bio}<p class="muted small">{author.bio}</p>{/if}
              </div>
            </div>
            <form method="POST" action="?/deleteAuthor" use:enhance={withBusy(`del-author-${author.id}`)}>
              <input type="hidden" name="id" value={author.id} />
              <button class="btn-link danger" type="submit" disabled={isBusy(`del-author-${author.id}`)}
                >Elimina</button
              >
            </form>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted empty">Nessun autore. Aggiungine uno per mostrarlo come byline.</p>
    {/if}

    <form
      method="POST"
      action="?/createAuthor"
      use:enhance={async ({ formData }) => {
        await jpegIfHeicFormFiles(formData, 'avatar');
        busy.add('new-author');
        return async ({ update, result }) => {
          await update();
          busy.delete('new-author');
          if (result.type === 'success') {
            if (avatarPreview) URL.revokeObjectURL(avatarPreview);
            avatarPreview = null;
          }
        };
      }}
      enctype="multipart/form-data"
      class="add-card"
    >
      <div class="add-card-title">Nuovo autore</div>
      <div class="author-form">
        <div class="avatar-field">
          <div class="avatar-preview">
            {#if avatarPreview}
              <img src={avatarPreview} alt="" />
            {:else}
              <span>?</span>
            {/if}
          </div>
          <label class="btn ghost file-btn">
            Scegli avatar
            <input type="file" name="avatar" accept={RASTER_IMAGE_ACCEPT} onchange={onAvatarChange} hidden />
          </label>
        </div>
        <div class="author-fields">
          <label>
            Nome completo
            <input type="text" name="name" placeholder="Es. Sara Bianchi" required disabled={isBusy('new-author')} />
          </label>
          <label>
            Ruolo
            <select name="role" disabled={isBusy('new-author')}>
              <option value="writer">Writer</option>
              <option value="editor">Editor</option>
              <option value="contributor">Contributor</option>
            </select>
          </label>
          <label class="full">
            Bio breve <span class="opt">(opzionale)</span>
            <textarea
              name="bio"
              rows="2"
              maxlength="300"
              placeholder="Una riga su chi è e di cosa scrive…"
              disabled={isBusy('new-author')}
            ></textarea>
          </label>
        </div>
      </div>
      <div class="add-card-actions">
        <button
          class="btn primary"
          class:loading={isBusy('new-author')}
          type="submit"
          disabled={isBusy('new-author')}>Aggiungi autore</button
        >
      </div>
    </form>
  </div>
</section>

<style>
  .panel-body {
    padding: 18px 22px 22px;
  }
  .panel-sub {
    margin: 4px 0 0;
    font-size: 13px;
    font-weight: 400;
    color: var(--ink-faint);
    line-height: 1.4;
  }
  .banner {
    font-size: 13px;
    border-radius: 10px;
    padding: 10px 14px;
    margin: 0 0 16px;
  }
  .banner.ok {
    background: #dcfce7;
    color: #166534;
  }
  .banner.err {
    background: #fef2f2;
    color: #b91c1c;
  }
  .empty {
    margin: 0 0 16px;
  }
  .author-list {
    list-style: none;
    margin: 0 0 20px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .author-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--paper);
  }
  .author-info {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .author-thumb {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .author-thumb.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--paper-2);
    color: var(--ink-soft);
    font-size: 15px;
    font-weight: 700;
  }
  .author-meta {
    min-width: 0;
  }
  .author-meta b {
    font-size: 14px;
    color: var(--ink);
    display: inline;
    margin-right: 8px;
  }
  .role-pill {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--ink-soft);
    background: var(--paper-2);
    padding: 2px 7px;
    border-radius: 999px;
  }
  .author-meta p {
    margin: 4px 0 0;
  }
  .btn-link {
    background: none;
    border: none;
    color: var(--ink-faint);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    flex-shrink: 0;
  }
  .btn-link.danger {
    color: #dc2626;
  }
  .add-card {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px 18px;
    background: var(--paper-2);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .add-card-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--ink);
  }
  .author-form {
    display: flex;
    gap: 18px;
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .avatar-field {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .avatar-preview {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--paper);
    border: 1px dashed var(--line-2, var(--line));
    color: var(--ink-faint);
    font-size: 20px;
    font-weight: 600;
  }
  .avatar-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .file-btn {
    cursor: pointer;
    font-size: 12px;
    padding: 6px 10px;
  }
  .author-fields {
    flex: 1;
    min-width: 220px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .author-fields label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .author-fields label.full {
    grid-column: 1 / -1;
  }
  .opt {
    font-weight: 400;
    color: var(--ink-faint);
  }
  .author-fields input,
  .author-fields select,
  .author-fields textarea {
    font-size: 14px;
    padding: 9px 11px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 400;
    font-family: inherit;
  }
  .author-fields textarea {
    resize: vertical;
    line-height: 1.45;
  }
  .add-card-actions {
    display: flex;
    justify-content: flex-end;
  }
  .muted {
    color: var(--ink-faint);
  }
  .small {
    font-size: 12px;
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
    background: transparent;
    color: inherit;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .btn.primary {
    background: var(--accent, #7c5cff);
    color: #fff;
  }
  .btn.ghost {
    background: transparent;
    color: var(--ink-soft);
    border-color: var(--line);
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
    .author-fields {
      grid-template-columns: 1fr;
    }
  }
</style>
