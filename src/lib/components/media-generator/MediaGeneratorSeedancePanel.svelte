<script lang="ts">
  import { _ } from 'svelte-i18n';
  import X from '@lucide/svelte/icons/x';
  import { createSupabaseBrowserClient } from '$lib/supabase/client';
  import { downscaleImageFile } from '$lib/chat-attachments';
  import { jpegIfHeicFile } from '$lib/raster-image-client';
  import { RASTER_IMAGE_ACCEPT, isRasterImageSource } from '$lib/raster-image';
  import type { SeedanceAsset } from './media-generator-model';
  import { MAX_SEEDANCE_REFS, MAX_SEEDANCE_ASSET_BYTES } from './media-generator-model';

  type SeedancePanelKind = 'start' | 'end' | 'video' | 'audio';

  interface Props {
    loading: boolean;
    remakeFromVideo: boolean;
    seedancePanel: SeedancePanelKind | null;
    firstFrameUrl: string;
    lastFrameUrl: string;
    referenceVideoText: string;
    referenceAudioText: string;
    uploadedVideos: SeedanceAsset[];
    uploadedAudios: SeedanceAsset[];
    seedanceError: string | null;
    seedanceUploadBusy?: boolean;
  }

  let {
    loading,
    remakeFromVideo,
    seedancePanel = $bindable<SeedancePanelKind | null>(null),
    firstFrameUrl = $bindable(''),
    lastFrameUrl = $bindable(''),
    referenceVideoText = $bindable(''),
    referenceAudioText = $bindable(''),
    uploadedVideos = $bindable<SeedanceAsset[]>([]),
    uploadedAudios = $bindable<SeedanceAsset[]>([]),
    seedanceError = $bindable<string | null>(null),
    seedanceUploadBusy = $bindable(false)
  }: Props = $props();

  let firstFrameFileEl = $state<HTMLInputElement>();
  let lastFrameFileEl = $state<HTMLInputElement>();
  let videoRefFileEl = $state<HTMLInputElement>();
  let audioRefFileEl = $state<HTMLInputElement>();

  function closeSeedancePanel() {
    seedancePanel = null;
    seedanceError = null;
  }

  async function onFrameFile(
    e: Event,
    which: 'first' | 'last'
  ) {
    const inputEl = e.currentTarget as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file || !isRasterImageSource({ mime: file.type, filename: file.name })) return;
    try {
      const dataUrl = await downscaleImageFile(file);
      if (which === 'first') firstFrameUrl = dataUrl;
      else lastFrameUrl = dataUrl;
    } catch {
      /* ignore */
    }
  }

  async function uploadPublicMedia(file: File): Promise<string> {
    const supabase = createSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error('unauthorized');
    const ext = (
      (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
    ).slice(0, 8);
    const path = `${auth.user.id}/media-generator/${crypto.randomUUID()}.${ext}`;
    const uploadFile = file.type.startsWith('video/') || file.type.startsWith('audio/')
      ? file
      : await jpegIfHeicFile(file);
    const { error: upErr } = await supabase.storage.from('media').upload(path, uploadFile, {
      contentType: uploadFile.type || undefined
    });
    if (upErr) throw new Error(upErr.message);
    return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
  }

  async function onSeedanceFiles(e: Event, kindIn: 'video' | 'audio') {
    const el = e.currentTarget as HTMLInputElement;
    const files = Array.from(el.files ?? []);
    el.value = '';
    const prefix = kindIn === 'video' ? 'video/' : 'audio/';
    const current = kindIn === 'video' ? uploadedVideos : uploadedAudios;
    const room = MAX_SEEDANCE_REFS - current.length;
    seedanceError = null;
    seedanceUploadBusy = true;
    try {
      for (const file of files.slice(0, Math.max(0, room))) {
        if (!file.type.startsWith(prefix)) continue;
        if (file.size > MAX_SEEDANCE_ASSET_BYTES) {
          seedanceError = $_('app.media.fileTooLarge');
          continue;
        }
        const url = await uploadPublicMedia(file);
        const asset = { url, name: file.name };
        if (kindIn === 'video') uploadedVideos = [...uploadedVideos, asset];
        else uploadedAudios = [...uploadedAudios, asset];
      }
    } catch {
      seedanceError = $_('app.media.generator.uploadAssetFailed');
    } finally {
      seedanceUploadBusy = false;
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && seedancePanel) {
      e.preventDefault();
      closeSeedancePanel();
    }
  }}
/>

<div
  class="mg-seedance-scrim"
  role="presentation"
  onclick={closeSeedancePanel}
></div>
<div
  class="mg-seedance-panel"
  role="dialog"
  aria-modal="true"
  aria-labelledby="mg-seedance-panel-title"
  onclick={(e) => e.stopPropagation()}
>
  <header class="mg-seedance-panel-head">
    <h2 id="mg-seedance-panel-title">
      {#if seedancePanel === 'start'}
        {$_('app.media.generator.firstFrame')}
      {:else if seedancePanel === 'end'}
        {$_('app.media.generator.lastFrame')}
      {:else if seedancePanel === 'video'}
        {$_('app.media.generator.refVideoUrls')}
      {:else}
        {$_('app.media.generator.refAudioUrls')}
      {/if}
    </h2>
    <button
      type="button"
      class="mg-icon-btn"
      onclick={closeSeedancePanel}
      aria-label="Close"
    >
      <X size={16} />
    </button>
  </header>
  <div class="mg-seedance-panel-body">
    <input
      bind:this={firstFrameFileEl}
      type="file"
      accept={RASTER_IMAGE_ACCEPT}
      hidden
      onchange={(e) => onFrameFile(e, 'first')}
    />
    <input
      bind:this={lastFrameFileEl}
      type="file"
      accept={RASTER_IMAGE_ACCEPT}
      hidden
      onchange={(e) => onFrameFile(e, 'last')}
    />
    <input
      bind:this={videoRefFileEl}
      type="file"
      accept="video/*"
      multiple
      hidden
      onchange={(e) => onSeedanceFiles(e, 'video')}
    />
    <input
      bind:this={audioRefFileEl}
      type="file"
      accept="audio/*"
      multiple
      hidden
      onchange={(e) => onSeedanceFiles(e, 'audio')}
    />
    {#if seedancePanel === 'start' || seedancePanel === 'end'}
      <p class="mg-seedance-hint">{$_('app.media.generator.seedanceHint')}</p>
      {#if seedancePanel === 'start' && firstFrameUrl}
        <div class="mg-seedance-preview mg-seedance-preview-lg">
          <img src={firstFrameUrl} alt="" />
          <button
            type="button"
            class="mg-seedance-clear"
            onclick={() => (firstFrameUrl = '')}
            disabled={loading}>×</button
          >
        </div>
      {:else if seedancePanel === 'end' && lastFrameUrl}
        <div class="mg-seedance-preview mg-seedance-preview-lg">
          <img src={lastFrameUrl} alt="" />
          <button
            type="button"
            class="mg-seedance-clear"
            onclick={() => (lastFrameUrl = '')}
            disabled={loading}>×</button
          >
        </div>
      {/if}
      <button
        type="button"
        class="mg-seedance-pick"
        disabled={loading || seedanceUploadBusy}
        onclick={() =>
          seedancePanel === 'start' ? firstFrameFileEl?.click() : lastFrameFileEl?.click()}
      >
        {$_('app.media.generator.pickFrame')}
      </button>
    {:else if seedancePanel === 'video'}
      {#if remakeFromVideo}
        <p class="mg-seedance-hint">{$_('app.media.generator.remakeVideoHint')}</p>
      {:else}
        <p class="mg-seedance-hint">{$_('app.media.generator.seedanceHint')}</p>
      {/if}
      {#if uploadedVideos.length}
        <div class="mg-seedance-assets">
          {#each uploadedVideos as asset, i (asset.url)}
            <div class="mg-seedance-preview mg-seedance-preview-video">
              <video src={asset.url} muted playsinline preload="metadata"></video>
              <button
                type="button"
                class="mg-seedance-clear"
                onclick={() => (uploadedVideos = uploadedVideos.filter((_, idx) => idx !== i))}
                disabled={loading}>×</button
              >
            </div>
          {/each}
        </div>
      {/if}
      <button
        type="button"
        class="mg-seedance-pick"
        disabled={loading || seedanceUploadBusy || uploadedVideos.length >= MAX_SEEDANCE_REFS}
        onclick={() => videoRefFileEl?.click()}
      >
        {seedanceUploadBusy
          ? $_('app.media.generator.uploadingAsset')
          : $_('app.media.generator.pickVideo')}
      </button>
      <textarea
        class="mg-seedance-urls"
        rows="3"
        disabled={loading}
        bind:value={referenceVideoText}
        placeholder={$_('app.media.generator.refUrlsPlaceholder')}
      ></textarea>
    {:else}
      <p class="mg-seedance-hint">{$_('app.media.generator.seedanceHint')}</p>
      {#if uploadedAudios.length}
        <div class="mg-seedance-assets">
          {#each uploadedAudios as asset, i (asset.url)}
            <div class="mg-seedance-audio">
              <span class="mg-seedance-audio-name" title={asset.name}>{asset.name}</span>
              <audio src={asset.url} controls preload="metadata"></audio>
              <button
                type="button"
                class="mg-seedance-audio-x"
                onclick={() => (uploadedAudios = uploadedAudios.filter((_, idx) => idx !== i))}
                disabled={loading}>×</button
              >
            </div>
          {/each}
        </div>
      {/if}
      <button
        type="button"
        class="mg-seedance-pick"
        disabled={loading || seedanceUploadBusy || uploadedAudios.length >= MAX_SEEDANCE_REFS}
        onclick={() => audioRefFileEl?.click()}
      >
        {seedanceUploadBusy
          ? $_('app.media.generator.uploadingAsset')
          : $_('app.media.generator.pickAudio')}
      </button>
      <textarea
        class="mg-seedance-urls"
        rows="3"
        disabled={loading}
        bind:value={referenceAudioText}
        placeholder={$_('app.media.generator.refUrlsPlaceholder')}
      ></textarea>
    {/if}
    {#if seedanceError}
      <div class="mg-seedance-error">{seedanceError}</div>
    {/if}
  </div>
  <footer class="mg-seedance-panel-foot">
    <button type="button" class="mg-seedance-done" onclick={closeSeedancePanel}>
      {$_('app.media.generator.seedanceDone')}
    </button>
  </footer>
</div>

<style>
  .mg-seedance-scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.32);
    z-index: 70;
  }
  .mg-seedance-panel {
    position: fixed;
    z-index: 71;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    color: var(--ink);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
  }
  .mg-seedance-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px 10px;
  }
  .mg-seedance-panel-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
  }
  .mg-seedance-panel-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 16px 12px;
    overflow: auto;
    min-height: 0;
  }
  .mg-seedance-panel-foot {
    display: flex;
    justify-content: flex-end;
    padding: 10px 16px 16px;
    border-top: 1px solid var(--line);
  }
  .mg-seedance-done {
    appearance: none;
    border: none;
    background: var(--ink);
    color: var(--paper);
    height: 32px;
    padding: 0 14px;
    border-radius: 999px;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
  }
  .mg-icon-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    color: var(--ink-soft);
    display: grid;
    place-items: center;
  }
  .mg-seedance-hint {
    font-size: 12px;
    color: var(--ink-faint);
    line-height: 1.4;
  }
  .mg-seedance-pick {
    min-height: 72px;
    border: 1px dashed var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink-muted, var(--ink-faint));
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .mg-seedance-pick:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--ink);
  }
  .mg-seedance-pick:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .mg-seedance-preview {
    position: relative;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid var(--line);
    aspect-ratio: 16 / 10;
    background: #111;
  }
  .mg-seedance-preview img,
  .mg-seedance-preview video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .mg-seedance-assets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 8px;
  }
  .mg-seedance-preview-video {
    aspect-ratio: 16 / 10;
  }
  .mg-seedance-audio {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    grid-column: 1 / -1;
  }
  .mg-seedance-audio-name {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mg-seedance-audio audio {
    height: 28px;
    max-width: 160px;
  }
  .mg-seedance-audio-x {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    cursor: pointer;
    line-height: 1;
  }
  .mg-seedance-error {
    font-size: 12px;
    color: var(--danger, #c0392b);
    line-height: 1.4;
  }
  .mg-seedance-clear {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    cursor: pointer;
    line-height: 1;
  }
  .mg-seedance-urls {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 12.5px;
    line-height: 1.4;
    padding: 8px 10px;
    resize: vertical;
    min-height: 52px;
    box-sizing: border-box;
  }
  .mg-seedance-preview-lg {
    aspect-ratio: 16 / 10;
    max-height: 220px;
  }
  @media (max-width: 640px) {
    .mg-seedance-panel {
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      max-height: min(88vh, 560px);
      border-radius: 18px 18px 0 0;
    }
  }
  @media (min-width: 641px) {
    .mg-seedance-panel {
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(420px, calc(100vw - 32px));
      max-height: min(80vh, 560px);
      border-radius: 16px;
    }
  }
</style>
