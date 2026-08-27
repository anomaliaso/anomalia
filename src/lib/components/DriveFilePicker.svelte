<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { invalidateAll } from '$app/navigation';
  import { FolderOpen, Trash2 } from '@lucide/svelte';
  import {
    DRIVE_FILE_LIMIT,
    isDriveFolderMime,
    type DriveFileOption,
    type DriveFolderOption
  } from '$lib/drive-folders';
  import { openGoogleDrivePicker } from '$lib/google-picker';

  let {
    brandSlug,
    files = [],
    folders = [],
    busy = false
  }: {
    brandSlug: string;
    files?: DriveFileOption[];
    folders?: DriveFolderOption[];
    busy?: boolean;
  } = $props();

  let picking = $state(false);
  let pickerError = $state('');

  const items = $derived.by(() => {
    const out: DriveFileOption[] = [...files];
    const seen = new Set(out.map((f) => f.id));
    for (const folder of folders) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      out.push({ id: folder.id, name: folder.name, mimeType: 'application/vnd.google-apps.folder' });
    }
    return out;
  });

  async function save(next: DriveFileOption[]) {
    pickerError = '';
    const res = await fetch(`/app/${brandSlug}/knowledge/drive-picker`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: next })
    });
    const json = (await res.json()) as { error?: string; message?: string };
    if (!res.ok) throw new Error(json.message || json.error || 'Could not save Drive files');
    await invalidateAll();
  }

  async function chooseFiles() {
    picking = true;
    pickerError = '';
    try {
      const res = await fetch(`/app/${brandSlug}/knowledge/drive-picker`);
      const json = (await res.json()) as {
        error?: string;
        message?: string;
        accessToken?: string;
        apiKey?: string;
        appId?: string;
      };
      if (!res.ok) throw new Error(json.message || json.error || 'Could not start Google Picker');
      if (!json.accessToken || !json.apiKey || !json.appId) {
        throw new Error('Google Picker is missing API key or Cloud project number.');
      }
      const picked = await openGoogleDrivePicker({
        accessToken: json.accessToken,
        apiKey: json.apiKey,
        appId: json.appId,
        maxItems: DRIVE_FILE_LIMIT
      });
      if (!picked.length) return;
      const merged: DriveFileOption[] = [...items];
      for (const doc of picked) {
        if (merged.some((f) => f.id === doc.id)) continue;
        if (merged.length >= DRIVE_FILE_LIMIT) break;
        merged.push(doc);
      }
      if (!merged.length) throw new Error('Pick at least one Drive file.');
      await save(merged);
    } catch (e) {
      pickerError = e instanceof Error ? e.message : String(e);
    } finally {
      picking = false;
    }
  }

  async function remove(id: string) {
    picking = true;
    pickerError = '';
    try {
      const next = items.filter((f) => f.id !== id);
      if (!next.length) {
        pickerError = $_('app.knowledge.sources.drive.noneSelected');
        return;
      }
      await save(next);
    } catch (e) {
      pickerError = e instanceof Error ? e.message : String(e);
    } finally {
      picking = false;
    }
  }
</script>

<div class="drive-picker">
  <p class="picker-title">{$_('app.knowledge.sources.drive.pickTitle')}</p>
  <p class="muted">{$_('app.knowledge.sources.drive.pickHint')}</p>
  <p class="muted">{$_('app.knowledge.sources.drive.limit', { values: { n: DRIVE_FILE_LIMIT } })}</p>
  {#if pickerError}
    <p class="banner err tiny">{pickerError}</p>
  {/if}
  {#if items.length}
    <ul class="file-list">
      {#each items as item (item.id)}
        <li>
          <span class="file-name">{item.name}</span>
          {#if isDriveFolderMime(item.mimeType)}
            <span class="kind">{$_('app.knowledge.sources.drive.folder')}</span>
          {/if}
          <button class="icon-btn" type="button" disabled={busy || picking} onclick={() => remove(item.id)}>
            <Trash2 size={14} strokeWidth={2} />
            <span class="sr">{$_('app.knowledge.sources.drive.remove')}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{$_('app.knowledge.sources.drive.noneSelected')}</p>
  {/if}
  <button class="btn primary" type="button" disabled={busy || picking} onclick={chooseFiles}>
    <FolderOpen size={14} strokeWidth={2} />
    {picking ? $_('app.knowledge.sources.drive.picking') : $_('app.knowledge.sources.drive.choose')}
  </button>
</div>

<style>
  .drive-picker {
    flex: 1 1 100%;
    display: grid;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--line, #e5e5e8);
    margin-top: 4px;
  }
  .picker-title { margin: 8px 0 0; font-size: 13px; font-weight: 600; }
  .muted { color: var(--ink-soft, #6e6e73); font-size: 13px; }
  .banner.err { color: #a11; margin: 0; }
  .banner.tiny { font-size: 12px; margin: 8px 0 0; }
  .file-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line, #e5e5e8);
    border-radius: 10px;
    background: var(--paper, #fff);
    overflow: hidden;
  }
  .file-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    font-size: 13px;
    border-bottom: 1px solid var(--line, #e5e5e8);
  }
  .file-list li:last-child { border-bottom: 0; }
  .file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kind {
    font-size: 11px;
    font-weight: 600;
    color: var(--ink-soft, #6e6e73);
  }
  .icon-btn {
    border: 0;
    background: transparent;
    color: var(--ink-soft, #6e6e73);
    cursor: pointer;
    padding: 4px;
    display: inline-flex;
  }
  .icon-btn:disabled { opacity: 0.5; cursor: default; }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    border-radius: 10px;
    padding: 9px 14px;
    cursor: pointer;
    border: 1px solid transparent;
    font-family: inherit;
    color: inherit;
    justify-self: start;
  }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn.primary {
    background: var(--invert-surface, #1d1d1f);
    color: #fff;
    border-color: var(--invert-surface, #1d1d1f);
  }
</style>
