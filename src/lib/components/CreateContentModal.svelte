<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { invalidateAll } from '$app/navigation';
  import { Image as ImageIcon, Images as ImagesIcon, Clapperboard, Video as VideoIcon, Upload as UploadIcon } from '@lucide/svelte';
  import { PLATFORM_META } from '$lib/components/platform-meta';
  import { VIDEO_ONLY_PLATFORMS } from '$lib/platform-limits';
  import { createSupabaseBrowserClient } from '$lib/supabase/client';
  import { jpegIfHeicFile } from '$lib/raster-image-client';
  import { RASTER_IMAGE_ACCEPT, RASTER_OR_VIDEO_ACCEPT, isRasterImageSource } from '$lib/raster-image';
  import UpgradeLink from '$lib/components/UpgradeLink.svelte';

  // "Crea contenuto" — one user-briefed content. Photo/AI-video post multipart to
  // /app/<brand>/content/create-single; 'team' (a founder-made video commission, plan-gated)
  // posts to /content/request-video instead — no AI runs, the request lands in the founders'
  // queue and the clip comes back in-app. Reloads the page data on success either way.
  let {
    open = $bindable(false),
    brandSlug,
    platforms = [],
    founderVideos = { remaining: 0, quota: 0 },
    onDone
  }: {
    open?: boolean;
    brandSlug: string;
    platforms?: string[];
    founderVideos?: { remaining: number; quota: number };
    onDone?: (r: { kind: 'single' | 'team'; contentType: string; videoFallback: boolean }) => void;
  } = $props();

  const MAX_REFS = 3;

  let kind = $state<'upload' | 'image' | 'carousel' | 'video' | 'team'>('image');
  let platform = $state('');
  // Platforms whose publish API accepts a multi-image carousel (mirror of the server's
  // CAROUSEL_PLATFORMS). A carousel on any other platform is blocked before generation.
  const CAROUSEL_PLATFORMS = ['instagram', 'facebook', 'linkedin'];
  const carouselOk = $derived(kind !== 'carousel' || CAROUSEL_PLATFORMS.includes(platform));
  const videoOnly = $derived(VIDEO_ONLY_PLATFORMS.has(platform));
  // User-chosen carousel slide count (clamped to the same 3-8 bounds the server enforces).
  const CAROUSEL_MIN = 3;
  const CAROUSEL_MAX = 8;
  let slideCount = $state(4);
  function bumpSlides(d: number) {
    slideCount = Math.max(CAROUSEL_MIN, Math.min(CAROUSEL_MAX, slideCount + d));
  }
  let brief = $state('');
  let files = $state<File[]>([]);
  let previews = $state<string[]>([]);
  // 'upload' kind: one photo/video from the device, posted as-is (no AI, no quota).
  let media = $state<File | null>(null);
  let mediaPreview = $state('');
  let creating = $state(false);
  let error = $state('');
  /** Crediti finiti: il messaggio ha bisogno di un'uscita, non di un "riprova". */
  let exhausted = $state(false);
  let platOpen = $state(false);

  const plats = $derived(platforms.length ? platforms : ['instagram']);
  $effect(() => {
    if (!platform || !plats.includes(platform)) platform = plats[0];
  });
  $effect(() => {
    if (videoOnly && (kind === 'image' || kind === 'carousel')) kind = 'video';
  });

  // The dialog lives under <body>: the layout nests pages inside the shadcn sidebar shell,
  // and only a portal guarantees the backdrop paints above the sidebar too.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.parentNode?.removeChild(node);
      }
    };
  }

  function close() {
    if (creating) return; // never abandon a paid render mid-flight
    open = false;
    error = '';
  }

  async function pickFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const picked = [...(input.files ?? [])].filter((f) =>
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
    files = [...files, ...converted].slice(0, MAX_REFS);
    for (const url of previews) URL.revokeObjectURL(url);
    previews = files.map((f) => URL.createObjectURL(f));
    input.value = '';
  }

  async function pickMedia(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    const isVideo = f.type.startsWith('video/');
    const isImage = isRasterImageSource({ mime: f.type, filename: f.name });
    if (!(isImage || isVideo)) return;
    if (videoOnly && !isVideo) return;
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    try {
      media = isVideo ? f : await jpegIfHeicFile(f);
    } catch {
      media = f;
    }
    mediaPreview = URL.createObjectURL(media);
    input.value = '';
  }

  function removeMedia() {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    media = null;
    mediaPreview = '';
  }

  function removeFile(i: number) {
    URL.revokeObjectURL(previews[i]);
    files = files.filter((_f, idx) => idx !== i);
    previews = previews.filter((_p, idx) => idx !== i);
  }

  function onWindowClick(e: MouseEvent) {
    if (!platOpen) return;
    const target = e.target as HTMLElement;
    if (!target.closest('.plat-sel')) platOpen = false;
  }

  // 'upload': browser → Storage (own-folder RLS; serverless bodies are too small for video),
  // then a tiny endpoint turns the stored file into a pending_user post.
  async function uploadMedia() {
    if (!media) return;
    const supabase = createSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error($_('app.content.single.uploadFailed'));
    const ext = ((media.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin').slice(0, 5);
    const path = `${auth.user.id}/uploads/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('media').upload(path, media, { contentType: media.type || undefined });
    if (upErr) throw new Error($_('app.content.single.uploadFailed'));
    const res = await fetch(`/app/${brandSlug}/content/upload-media`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, platform, caption: brief.trim(), isVideo: media.type.startsWith('video/') })
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; contentType?: string };
    if (!res.ok || !body.ok) throw new Error($_('app.content.single.uploadFailed'));
    await invalidateAll();
    onDone?.({ kind: 'single', contentType: body.contentType ?? 'uploaded_image', videoFallback: false });
    brief = '';
    removeMedia();
    open = false;
  }

  async function create() {
    if (creating || (kind === 'upload' ? !media : !brief.trim())) return;
    creating = true;
    error = '';
    exhausted = false;
    if (kind === 'upload') {
      try {
        await uploadMedia();
      } catch (e) {
        error = e instanceof Error ? e.message : $_('app.content.single.uploadFailed');
      } finally {
        creating = false;
      }
      return;
    }
    try {
      const fd = new FormData();
      fd.set('kind', kind);
      fd.set('platform', platform);
      fd.set('brief', brief.trim());
      if (kind === 'carousel') fd.set('slides', String(slideCount));
      for (const f of files) fd.append('refs', f);
      const endpoint = kind === 'team' ? 'request-video' : 'create-single';
      const res = await fetch(`/app/${brandSlug}/content/${endpoint}`, { method: 'POST', body: fd });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        contentType?: string;
        videoFallback?: boolean;
      };
      if (!res.ok || !body.ok) {
        error =
          body.error === 'quota'
            ? kind === 'team'
              ? $_('app.content.single.teamQuotaFull')
              : $_('app.content.single.quotaFull')
            : body.error === 'render_failed'
              ? $_('app.content.single.renderFailed')
              : body.error === 'carousel_platform'
                ? $_('app.content.single.carouselPlatform')
                : body.error === 'credits_exhausted'
                  ? $_('app.content.single.creditsExhausted')
                  : $_('app.content.single.failed');
        // "Creazione non riuscita — riprova" era la risposta anche ai crediti finiti: un invito a
        // ripetere una cosa che non può riuscire finché non si cambia piano o non si rinnova.
        exhausted = body.error === 'credits_exhausted' || res.status === 402;
        return;
      }
      await invalidateAll();
      onDone?.({
        kind: kind === 'team' ? 'team' : 'single',
        contentType: body.contentType ?? 'generated_image',
        videoFallback: body.videoFallback === true
      });
      // Reset for the next use and close.
      brief = '';
      for (const url of previews) URL.revokeObjectURL(url);
      files = [];
      previews = [];
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : $_('app.content.single.failed');
    } finally {
      creating = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && close()} onclick={onWindowClick} />

{#if open}
  <div class="ccm-backdrop" role="presentation" use:portal onclick={close}>
    <div class="ccm" role="dialog" aria-modal="true" tabindex="-1" aria-label={$_('app.content.single.title')} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <div class="ccm-head">
        <div class="ccm-title">
          <span class="ccm-dot"></span>
          <h3>{$_('app.content.single.title')}</h3>
        </div>
        <button type="button" class="ccm-x" onclick={close} aria-label="×">×</button>
      </div>

      <!-- 1. Device upload, photo, AI video, or a founder-made video commission (plan-gated) -->
      <div class="ccm-kinds" role="radiogroup" aria-label={$_('app.content.single.kindLabel')}>
        <button type="button" class="kind" role="radio" aria-checked={kind === 'upload'} class:on={kind === 'upload'} onclick={() => (kind = 'upload')} disabled={creating}>
          <span class="kind-ic"><UploadIcon size={18} strokeWidth={1.8} /></span>
          <span class="kind-tx">
            <span class="kind-t">{$_('app.content.single.upload')}</span>
            <span class="kind-d">{$_('app.content.single.uploadDesc')}</span>
          </span>
          <span class="kind-check" aria-hidden="true"></span>
        </button>
        <button type="button" class="kind" role="radio" aria-checked={kind === 'image'} class:on={kind === 'image'} onclick={() => (kind = 'image')} disabled={creating || videoOnly}>
          <span class="kind-ic"><ImageIcon size={18} strokeWidth={1.8} /></span>
          <span class="kind-tx">
            <span class="kind-t">{$_('app.content.single.photo')}</span>
            <span class="kind-d">{$_('app.content.single.photoDesc')}</span>
          </span>
          <span class="kind-check" aria-hidden="true"></span>
        </button>
        <button type="button" class="kind" role="radio" aria-checked={kind === 'carousel'} class:on={kind === 'carousel'} onclick={() => (kind = 'carousel')} disabled={creating || videoOnly}>
          <span class="kind-ic"><ImagesIcon size={18} strokeWidth={1.8} /></span>
          <span class="kind-tx">
            <span class="kind-t">{$_('app.content.single.carousel')}</span>
            <span class="kind-d">{$_('app.content.single.carouselDesc')}</span>
          </span>
          <span class="kind-check" aria-hidden="true"></span>
        </button>
        <button type="button" class="kind" role="radio" aria-checked={kind === 'video'} class:on={kind === 'video'} onclick={() => (kind = 'video')} disabled={creating}>
          <span class="kind-ic"><Clapperboard size={18} strokeWidth={1.8} /></span>
          <span class="kind-tx">
            <span class="kind-t">{$_('app.content.single.video')}</span>
            <span class="kind-d">{$_('app.content.single.videoDesc')}</span>
          </span>
          <span class="kind-check" aria-hidden="true"></span>
        </button>
        <button
          type="button"
          class="kind"
          role="radio"
          aria-checked={kind === 'team'}
          class:on={kind === 'team'}
          onclick={() => (kind = 'team')}
          disabled={creating || founderVideos.quota <= 0 || founderVideos.remaining <= 0}
          title={founderVideos.quota <= 0 ? $_('app.content.single.teamNotInPlan') : ''}
        >
          <span class="kind-ic"><VideoIcon size={18} strokeWidth={1.8} /></span>
          <span class="kind-tx">
            <span class="kind-t">
              {$_('app.content.single.team')}
              <span class="kind-badge">{founderVideos.remaining}/{founderVideos.quota}</span>
            </span>
            <span class="kind-d">{$_('app.content.single.teamDesc')}</span>
          </span>
          <span class="kind-check" aria-hidden="true"></span>
        </button>
      </div>
      {#if kind === 'team'}
        <p class="ccm-team-note">{$_('app.content.single.teamNote')}</p>
      {/if}

      <!-- 2. Platform -->
      <div class="ccm-f">
        <span>{$_('app.content.single.platform')}</span>
        <div class="plat-sel" class:open={platOpen}>
          <button type="button" class="plat-trigger" onclick={() => (platOpen = !platOpen)} disabled={creating}>
            {#if PLATFORM_META[platform]?.icon}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d={PLATFORM_META[platform]?.icon?.path} /></svg>
            {/if}
            <span>{PLATFORM_META[platform]?.label ?? platform}</span>
            <svg class="plat-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {#if platOpen}
            <div class="plat-drop">
              {#each plats as p (p)}
                <button type="button" class="plat-opt" class:active={p === platform} onclick={() => { platform = p; platOpen = false; }}>
                  {#if PLATFORM_META[p]?.icon}
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d={PLATFORM_META[p]?.icon?.path} /></svg>
                  {/if}
                  <span>{PLATFORM_META[p]?.label ?? p}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      {#if kind === 'carousel'}
        <div class="ccm-f">
          <span>{$_('app.content.single.slides')}</span>
          <div class="slide-step">
            <button type="button" class="ss-btn" onclick={() => bumpSlides(-1)} disabled={creating || slideCount <= CAROUSEL_MIN} aria-label="−">−</button>
            <span class="ss-n">{slideCount}</span>
            <button type="button" class="ss-btn" onclick={() => bumpSlides(1)} disabled={creating || slideCount >= CAROUSEL_MAX} aria-label="+">+</button>
            <span class="ss-hint">{$_('app.content.single.slidesHint')}</span>
          </div>
        </div>
      {/if}

      {#if kind === 'carousel' && !carouselOk}
        <p class="ccm-note-warn">{$_('app.content.single.carouselPlatform')}</p>
      {/if}

      {#if kind === 'upload'}
        <!-- 3a. The media file itself -->
        <div class="ccm-f">
          <span>{$_('app.content.single.uploadMedia')}</span>
          {#if media}
            <div class="up-prev">
              {#if media.type.startsWith('video/')}
                <video src={mediaPreview} muted playsinline controls></video>
              {:else}
                <img src={mediaPreview} alt="" />
              {/if}
              <button type="button" class="ref-x" onclick={removeMedia} disabled={creating}>×</button>
            </div>
          {:else}
            <label class="up-drop" class:disabled={creating}>
              <UploadIcon size={20} strokeWidth={1.8} />
              <span>{$_('app.content.single.uploadPick')}</span>
              <input type="file" accept={videoOnly ? 'video/*' : RASTER_OR_VIDEO_ACCEPT} onchange={pickMedia} disabled={creating} />
            </label>
          {/if}
        </div>

        <!-- 3b. Caption (optional — editable later like any post) -->
        <label class="ccm-f">
          <span>{$_('app.content.single.captionLabel')}</span>
          <textarea rows="3" bind:value={brief} placeholder={$_('app.content.single.captionPh')} disabled={creating}></textarea>
        </label>
      {:else}
        <!-- 3. Brief -->
        <label class="ccm-f">
          <span>{$_('app.content.single.brief')}</span>
          <textarea rows="4" bind:value={brief} placeholder={$_('app.content.single.briefPh')} disabled={creating}></textarea>
        </label>

        <!-- 4. Visual references (optional) -->
        <div class="ccm-f">
          <span>{$_('app.content.single.refs')}</span>
          <div class="refs">
            {#each previews as src, i (src)}
              <div class="ref">
                <img {src} alt="" />
                <button type="button" class="ref-x" onclick={() => removeFile(i)} disabled={creating}>×</button>
              </div>
            {/each}
            {#if files.length < MAX_REFS}
              <label class="ref add" class:disabled={creating}>
                +
                <input type="file" accept={RASTER_IMAGE_ACCEPT} multiple onchange={pickFiles} disabled={creating} />
              </label>
            {/if}
          </div>
          <small>{$_('app.content.single.refsHint')}</small>
        </div>
      {/if}

      {#if error}<p class="ccm-err">{error}{#if exhausted}{' '}<UpgradeLink slug={brandSlug} />{/if}</p>{/if}

      <button type="button" class="ccm-go" onclick={create} disabled={creating || !carouselOk || (kind === 'upload' ? !media : !brief.trim())}>
        {#if creating}
          <span class="spin"></span>
          {kind === 'upload' ? $_('app.content.single.uploading') : kind === 'team' ? $_('app.content.single.sendingRequest') : kind === 'video' ? $_('app.content.single.creatingVideo') : kind === 'carousel' ? $_('app.content.single.creatingCarousel') : $_('app.content.single.creating')}
        {:else}
          {kind === 'upload' ? $_('app.content.single.uploadCta') : kind === 'team' ? $_('app.content.single.sendRequest') : $_('app.content.single.create')}
        {/if}
      </button>
    </div>
  </div>
{/if}

<style>
  .ccm-backdrop {
    position: fixed; inset: 0; z-index: 210; background: rgba(17, 17, 17, 0.55);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center; padding: 20px;
    animation: ccm-fade 0.22s var(--ease, cubic-bezier(0.22, 1, 0.36, 1)) both;
  }
  .ccm {
    width: 100%; max-width: 480px; background: var(--paper, #fff);
    border: 1px solid var(--line, #ededef); border-radius: 24px;
    padding: 26px; display: flex; flex-direction: column; gap: 15px; max-height: 90vh; overflow: auto;
    box-shadow: 0 32px 80px -20px rgba(0, 0, 0, 0.35);
    animation: ccm-pop 0.28s var(--ease, cubic-bezier(0.22, 1, 0.36, 1)) both;
  }
  @keyframes ccm-fade { from { opacity: 0; } }
  @keyframes ccm-pop { from { opacity: 0; transform: translateY(14px) scale(0.97); } }
  .ccm-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .ccm-title { display: flex; align-items: center; gap: 10px; }
  .ccm-dot {
    width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto;
    background: linear-gradient(135deg, var(--accent-2, #ecb2ed), var(--accent, #c485fe));
    box-shadow: 0 0 0 4px rgba(var(--accent-2-rgb, 236, 178, 237), 0.12);
  }
  .ccm-head h3 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.03em; }
  .ccm-x {
    width: 30px; height: 30px; flex: 0 0 auto; border: none; border-radius: 50%;
    background: var(--paper-2, #f9f9f9); color: var(--ink-soft, #6e6e73);
    font-size: 18px; line-height: 1; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.2s var(--ease, ease), color 0.2s var(--ease, ease);
  }
  .ccm-x:hover { background: var(--paper-3, #f4f4f4); color: var(--ink, #1d1d1f); }
  .ccm-kinds { display: flex; flex-direction: column; gap: 8px; }
  .kind {
    display: flex; align-items: center; gap: 12px; text-align: left; padding: 12px 14px;
    border: 1.5px solid var(--line, #ededef); border-radius: 16px; background: var(--paper, #fff);
    cursor: pointer; font: inherit;
    transition: border-color 0.2s var(--ease, ease), background 0.2s var(--ease, ease);
  }
  .kind:hover:not(:disabled):not(.on) { border-color: var(--line-2, #d2d2d7); background: var(--paper-2, #f9f9f9); }
  .kind.on { border-color: var(--accent, #c485fe); background: rgba(var(--accent-rgb, 196, 133, 254), 0.06); }
  .kind:disabled { opacity: 0.45; cursor: default; }
  .kind-ic {
    flex: 0 0 38px; width: 38px; height: 38px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(var(--accent-rgb, 196, 133, 254), 0.1); color: var(--accent, #c485fe);
    transition: background 0.2s var(--ease, ease), color 0.2s var(--ease, ease);
  }
  .kind.on .kind-ic {
    background: linear-gradient(120deg, var(--accent, #c485fe), var(--accent-2, #ecb2ed)); color: #fff;
  }
  .kind-tx { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .kind-t { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .kind-d { font-size: 12px; color: var(--ink-soft, #6e6e73); line-height: 1.4; letter-spacing: -0.02em; }
  .kind-badge {
    font-size: 11px; font-weight: 700; color: var(--accent, #c485fe);
    background: rgba(var(--accent-rgb, 196, 133, 254), 0.1); padding: 2px 8px; border-radius: 980px;
  }
  .kind-check {
    flex: 0 0 18px; width: 18px; height: 18px; border-radius: 50%; position: relative;
    border: 1.5px solid var(--line-2, #d2d2d7);
    transition: border-color 0.2s var(--ease, ease), background 0.2s var(--ease, ease);
  }
  .kind.on .kind-check { border-color: var(--accent, #c485fe); background: var(--accent, #c485fe); }
  .kind.on .kind-check::after { content: ''; position: absolute; inset: 4px; border-radius: 50%; background: #fff; }
  .ccm-team-note {
    margin: -5px 0 0; font-size: 12.5px; color: var(--ink-soft, #6e6e73); line-height: 1.45;
    padding: 10px 12px; border-radius: 12px;
    background: rgba(var(--accent-rgb, 196, 133, 254), 0.06);
    border: 1px solid rgba(var(--accent-rgb, 196, 133, 254), 0.18);
  }
  .ccm-f { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
  .ccm-f > span { font-weight: 600; color: var(--ink-soft, #6e6e73); }
  .ccm-f textarea {
    border: 1.5px solid var(--line, #ededef); border-radius: 12px; padding: 9px 11px;
    font: inherit; font-size: 14px; background: var(--paper, #fff); color: var(--ink, #1d1d1f);
    transition: border-color 0.2s var(--ease, ease), box-shadow 0.2s var(--ease, ease);
  }
  .ccm-f textarea:focus {
    outline: none; border-color: var(--accent, #c485fe);
    box-shadow: 0 0 0 4px rgba(var(--accent-rgb, 196, 133, 254), 0.1);
  }
  .ccm-f textarea { resize: vertical; }
  .ccm-f small { color: var(--ink-faint, #86868b); }

  /* Platform dropdown */
  .plat-sel { position: relative; }
  .plat-trigger {
    display: flex; align-items: center; gap: 8px; width: 100%;
    border: 1.5px solid var(--line, #ededef); border-radius: 12px; padding: 9px 11px;
    font: inherit; font-size: 14px; background: var(--paper, #fff); color: var(--ink, #1d1d1f);
    cursor: pointer; text-align: left;
    transition: border-color 0.2s var(--ease, ease), box-shadow 0.2s var(--ease, ease);
  }
  .plat-trigger:focus { outline: none; border-color: var(--accent, #c485fe); box-shadow: 0 0 0 4px rgba(var(--accent-rgb, 196, 133, 254), 0.1); }
  .plat-trigger:disabled { opacity: 0.5; cursor: default; }
  .plat-trigger span { flex: 1; }
  .plat-chevron { transition: transform 0.2s var(--ease, ease); color: var(--ink-soft, #6e6e73); }
  .plat-sel.open .plat-chevron { transform: rotate(180deg); }
  .plat-sel.open .plat-trigger { border-color: var(--accent, #c485fe); box-shadow: 0 0 0 4px rgba(var(--accent-rgb, 196, 133, 254), 0.1); }
  .plat-drop {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 10;
    background: var(--paper, #fff); border: 1.5px solid var(--line, #ededef); border-radius: 12px;
    padding: 4px; box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.15);
    max-height: 240px; overflow-y: auto;
    animation: plat-drop-in 0.18s var(--ease, cubic-bezier(0.22, 1, 0.36, 1)) both;
  }
  @keyframes plat-drop-in { from { opacity: 0; transform: translateY(-6px); } }
  .plat-opt {
    display: flex; align-items: center; gap: 8px; width: 100%; border: none; border-radius: 8px;
    padding: 8px 10px; font: inherit; font-size: 14px; background: transparent; color: var(--ink, #1d1d1f);
    cursor: pointer; text-align: left;
    transition: background 0.15s var(--ease, ease);
  }
  .plat-opt:hover { background: var(--paper-2, #f9f9f9); }
  .plat-opt.active { background: rgba(var(--accent-rgb, 196, 133, 254), 0.08); color: var(--accent, #c485fe); }
  .refs { display: flex; gap: 8px; flex-wrap: wrap; }
  .ref {
    position: relative; width: 64px; height: 64px; border-radius: 12px; overflow: hidden;
    border: 1.5px solid var(--line, #ededef);
  }
  .ref img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ref-x {
    position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border: none; border-radius: 50%;
    background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 12px; line-height: 1; cursor: pointer;
  }
  .ref.add {
    display: flex; align-items: center; justify-content: center; font-size: 22px; color: var(--ink-faint, #86868b);
    cursor: pointer; border-style: dashed; background: var(--paper-2, #f9f9f9);
    transition: border-color 0.2s var(--ease, ease), color 0.2s var(--ease, ease);
  }
  .ref.add:hover:not(.disabled) { border-color: var(--accent, #c485fe); color: var(--accent, #c485fe); }
  .ref.add.disabled { opacity: 0.5; cursor: default; }
  .ref.add input { display: none; }
  .up-drop {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 22px 14px; border: 1.5px dashed var(--line-2, #d2d2d7); border-radius: 16px;
    background: var(--paper-2, #f9f9f9); color: var(--ink-soft, #6e6e73); cursor: pointer;
    font-size: 13px; font-weight: 500;
    transition: border-color 0.2s var(--ease, ease), color 0.2s var(--ease, ease);
  }
  .up-drop:hover:not(.disabled) { border-color: var(--accent, #c485fe); color: var(--accent, #c485fe); }
  .up-drop.disabled { opacity: 0.5; cursor: default; }
  .up-drop input { display: none; }
  .up-prev {
    position: relative; border-radius: 16px; overflow: hidden;
    border: 1.5px solid var(--line, #ededef); background: var(--paper-2, #f9f9f9);
  }
  .up-prev img, .up-prev video { display: block; width: 100%; max-height: 260px; object-fit: contain; }
  .slide-step { display: flex; align-items: center; gap: 10px; }
  .ss-btn {
    width: 34px; height: 34px; flex: 0 0 auto; border: 1.5px solid var(--line, #ededef); border-radius: 10px;
    background: var(--paper, #fff); color: var(--ink, #1d1d1f); font-size: 18px; line-height: 1; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: border-color 0.2s var(--ease, ease), background 0.2s var(--ease, ease);
  }
  .ss-btn:hover:not(:disabled) { border-color: var(--accent, #c485fe); color: var(--accent, #c485fe); }
  .ss-btn:disabled { opacity: 0.4; cursor: default; }
  .ss-n { min-width: 22px; text-align: center; font-size: 16px; font-weight: 700; color: var(--ink, #1d1d1f); }
  .ss-hint { font-size: 12px; color: var(--ink-faint, #86868b); }
  .ccm-note-warn {
    margin: -6px 0 0; font-size: 12.5px; color: #8a6d12; line-height: 1.45;
    padding: 10px 12px; border-radius: 12px; background: #fff3d6; border: 1px solid #f0d79a;
  }
  :global([data-theme='dark']) .ccm-note-warn { background: rgba(163, 112, 10, 0.12); border-color: rgba(163, 112, 10, 0.25); color: #fbbf24; }
  .ccm-err { margin: 0; color: #c0392b; font-size: 13px; }
  .ccm-go {
    border: none; border-radius: 980px; padding: 13px 20px;
    background: linear-gradient(120deg, var(--accent, #c485fe), var(--accent-2, #ecb2ed)); color: #fff;
    box-shadow: 0 8px 18px -8px rgba(var(--accent-rgb, 196, 133, 254), 0.55);
    font-size: 14px; font-weight: 600; letter-spacing: 0.01em; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: transform 0.25s var(--ease, ease), opacity 0.25s var(--ease, ease);
  }
  .ccm-go:hover:not(:disabled) { transform: scale(1.02); }
  .ccm-go:disabled { opacity: 0.5; cursor: default; }
  .spin {
    width: 14px; height: 14px; border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: #fff;
    border-radius: 50%; animation: ccm-spin 0.8s linear infinite;
  }
  @keyframes ccm-spin { to { transform: rotate(360deg); } }
</style>
