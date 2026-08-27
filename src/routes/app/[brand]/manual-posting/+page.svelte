<script lang="ts">
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import PageHead from '$lib/components/PageHead.svelte';
  import { PLATFORM_META, PLATFORM_KEYS } from '$lib/components/platform-meta';
  import {
    PLATFORM_CHAR_LIMITS,
    VISUAL_REQUIRED_PLATFORMS,
    captionViolations,
    platformLabel,
    truncateForPlatform
  } from '$lib/platform-limits';
  import { createSupabaseBrowserClient } from '$lib/supabase/client';
  import { jpegIfHeicFile } from '$lib/raster-image-client';
  import { RASTER_OR_VIDEO_ACCEPT, isRasterOrVideoFile } from '$lib/raster-image';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Upload from '@lucide/svelte/icons/upload';
  import Images from '@lucide/svelte/icons/images';

  let { data } = $props();
  const brand = $derived(data.brand);
  const connected = $derived(new Set((data.connectedPlatforms as string[]) ?? []));
  const library = $derived(
    (data.library as { id: string; url: string; title: string | null }[]) ?? []
  );

  const initialPlats = (() => {
    const c = (data.connectedPlatforms as string[]) ?? [];
    const t = (data.targetPlatforms as string[]) ?? [];
    const list = c.length ? c : t.length ? t : ['instagram'];
    return list.filter((p) => PLATFORM_KEYS.includes(p));
  })();

  let selected = $state<string[]>(initialPlats);
  let caption = $state('');
  let alts = $state<Record<string, string>>({});
  let aiBrief = $state('');
  let redditTitle = $state('');
  let redditSub = $state('');
  let mode = $state<'now' | 'schedule' | 'draft'>('schedule');
  let date = $state(data.defaultDate as string);
  let time = $state(data.defaultTime as string);

  type DeviceItem = { file: File; preview: string; video: boolean };
  let device = $state<DeviceItem[]>([]);
  let libraryIds = $state<string[]>([]);
  let libOpen = $state(false);
  let busy = $state(false);
  let aiBusy = $state(false);
  let error = $state('');
  let dragOver = $state(false);

  const hasMedia = $derived(device.length + libraryIds.length > 0);
  const hasVideo = $derived(device.some((d) => d.video));
  const needsVisual = $derived(selected.some((p) => VISUAL_REQUIRED_PLATFORMS.has(p)));
  const showReddit = $derived(selected.includes('reddit'));
  const violations = $derived(captionViolations(caption, selected, alts));
  const creditsOk = $derived((data.creditsRemaining as number) > 0);

  const libThumbs = $derived(library.filter((m) => libraryIds.includes(m.id)));

  function togglePlat(p: string) {
    if (selected.includes(p)) {
      if (selected.length === 1) return;
      selected = selected.filter((x) => x !== p);
      return;
    }
    selected = [...selected, p];
    const limit = PLATFORM_CHAR_LIMITS[p];
    if (limit && caption.length > limit && !(alts[p] ?? '').trim()) {
      alts = { ...alts, [p]: truncateForPlatform(caption, limit) };
    }
  }

  async function onFiles(list: FileList | File[]) {
    const incoming = [...list].filter((f) => isRasterOrVideoFile(f));
    if (!incoming.length) return;
    const videos = incoming.filter((f) => f.type.startsWith('video/'));
    if (videos.length) {
      for (const d of device) URL.revokeObjectURL(d.preview);
      const f = videos[0];
      device = [{ file: f, preview: URL.createObjectURL(f), video: true }];
      libraryIds = [];
      return;
    }
    const images = incoming.filter((f) => !f.type.startsWith('video/'));
    const kept = device.filter((d) => !d.video);
    const next = [...kept];
    for (const f of images) {
      if (next.length + libraryIds.length >= 8) break;
      let ready = f;
      try {
        ready = await jpegIfHeicFile(f);
      } catch {
        /* keep original */
      }
      next.push({ file: ready, preview: URL.createObjectURL(ready), video: false });
    }
    device = next;
  }

  function removeDevice(i: number) {
    URL.revokeObjectURL(device[i].preview);
    device = device.filter((_, idx) => idx !== i);
  }

  function toggleLib(id: string) {
    if (hasVideo) return;
    if (libraryIds.includes(id)) {
      libraryIds = libraryIds.filter((x) => x !== id);
      return;
    }
    if (device.length + libraryIds.length >= 8) return;
    libraryIds = [...libraryIds, id];
  }

  async function writeWithAi() {
    const brief = aiBrief.trim();
    const draft = caption.trim();
    if (!brief && !draft) {
      error = $_('app.manualPosting.aiNeedInput');
      return;
    }
    if (!creditsOk) {
      error = $_('app.manualPosting.aiNeedCredits');
      return;
    }
    aiBusy = true;
    error = '';
    try {
      const res = await fetch(`/app/${brand.slug}/manual-posting/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platforms: selected,
          brief,
          caption: draft,
          hasMedia
        })
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        caption?: string;
        captions?: Record<string, string>;
        title?: string;
      };
      if (!res.ok || !body.ok) {
        error =
          body.error === 'credits'
            ? $_('app.manualPosting.aiNeedCredits')
            : $_('app.manualPosting.aiFailed');
        return;
      }
      if (body.caption) caption = body.caption;
      if (body.captions) alts = { ...alts, ...body.captions };
      if (body.title) redditTitle = body.title;
    } catch {
      error = $_('app.manualPosting.aiFailed');
    } finally {
      aiBusy = false;
    }
  }

  async function uploadDevice(): Promise<{ paths: string[]; isVideo: boolean }> {
    if (!device.length) return { paths: [], isVideo: false };
    const supabase = createSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error('auth');
    const paths: string[] = [];
    for (const item of device) {
      const ext = ((item.file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin').slice(0, 5);
      const path = `${auth.user.id}/uploads/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('media')
        .upload(path, item.file, { contentType: item.file.type || undefined });
      if (upErr) throw new Error('upload');
      paths.push(path);
    }
    return { paths, isVideo: device.some((d) => d.video) };
  }

  function validate(): string | null {
    if (!selected.length) return $_('app.manualPosting.noPlatforms');
    if (!caption.trim()) return $_('app.manualPosting.needCaption');
    if (needsVisual && !hasMedia) return $_('app.manualPosting.needMedia');
    if (showReddit && !redditTitle.trim()) return $_('app.manualPosting.redditNeedTitle');
    if (violations.length) {
      const v = violations[0];
      return $_('app.manualPosting.overLimit', { values: { label: v.label, limit: v.limit, n: v.length } });
    }
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) {
      error = v;
      return;
    }
    busy = true;
    error = '';
    try {
      const uploaded = await uploadDevice();
      const res = await fetch(`/app/${brand.slug}/manual-posting/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platforms: selected,
          caption: caption.trim(),
          platformCaptions: alts,
          mediaPaths: uploaded.paths,
          libraryIds,
          isVideo: uploaded.isVideo,
          title: redditTitle,
          subreddit: redditSub,
          mode,
          date,
          time
        })
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        noAccount?: boolean;
      };
      if (!res.ok || !body.ok) {
        error =
          body.error === 'need_media'
            ? $_('app.manualPosting.needMedia')
            : body.error === 'need_video'
              ? $_('app.manualPosting.needVideo')
              : body.error === 'too_soon'
              ? $_('app.manualPosting.tooSoon')
              : body.error === 'reddit_title'
                ? $_('app.manualPosting.redditNeedTitle')
                : body.error === 'over_limit'
                  ? violations[0]
                    ? $_('app.manualPosting.overLimit', {
                        values: { label: violations[0].label, limit: violations[0].limit, n: violations[0].length }
                      })
                    : $_('app.manualPosting.failed')
                  : $_('app.manualPosting.failed');
        return;
      }
      if (body.noAccount) {
        error = $_('app.manualPosting.noAccount');
        await goto(`/app/${brand.slug}/calendar`);
        return;
      }
      await goto(`/app/${brand.slug}/calendar`);
    } catch {
      error = $_('app.manualPosting.failed');
    } finally {
      busy = false;
    }
  }

  const cta = $derived(
    mode === 'now'
      ? $_('app.manualPosting.publish')
      : mode === 'schedule'
        ? $_('app.manualPosting.schedule')
        : $_('app.manualPosting.saveDraft')
  );

  function limitOf(p: string): number | null {
    return PLATFORM_CHAR_LIMITS[p] ?? null;
  }

  function effectiveCaption(p: string): string {
    const alt = (alts[p] ?? '').trim();
    return alt || caption;
  }

  function setAlt(p: string, value: string) {
    alts = { ...alts, [p]: value };
  }
</script>

<svelte:head>
  <title>Anomalia — {$_('app.hub.publish.manualPosting')}</title>
</svelte:head>

<div class="mp">
  <PageHead title={$_('app.manualPosting.title')} subtitle={$_('app.manualPosting.subtitle')} />

  <div class="mp-grid">
    <section class="mp-col">
      <div class="mp-card">
        <div class="mp-h">
          <h3>{$_('app.manualPosting.platforms')}</h3>
          <p>{$_('app.manualPosting.platformsHint')}</p>
        </div>
        <div class="plats" role="group" aria-label={$_('app.manualPosting.platforms')}>
          {#each PLATFORM_KEYS as p (p)}
            {@const meta = PLATFORM_META[p]}
            {@const on = selected.includes(p)}
            {@const live = connected.has(p)}
            <button
              type="button"
              class="plat"
              class:on
              class:ghost={!live}
              onclick={() => togglePlat(p)}
              aria-pressed={on}
            >
              {#if meta?.icon}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d={meta.icon.path} /></svg>
              {/if}
              <span>{meta?.label ?? p}</span>
              {#if !live}<em>{$_('app.manualPosting.notConnected')}</em>{/if}
            </button>
          {/each}
        </div>
        {#if selected.some((p) => !connected.has(p))}
          <a class="mp-link" href={`/app/${brand.slug}/settings/connected-accounts`}>{$_('app.manualPosting.connectCta')} →</a>
        {/if}
      </div>

      <div class="mp-card">
        <div class="mp-h">
          <h3>{$_('app.manualPosting.media')}</h3>
          <p>{$_('app.manualPosting.mediaHint')}</p>
        </div>
        <label
          class="drop"
          class:over={dragOver}
          class:disabled={busy}
          ondragover={(e) => {
            e.preventDefault();
            dragOver = true;
          }}
          ondragleave={() => (dragOver = false)}
          ondrop={(e) => {
            e.preventDefault();
            dragOver = false;
            if (e.dataTransfer?.files) onFiles(e.dataTransfer.files);
          }}
        >
          <Upload size={20} strokeWidth={1.8} />
          <span>{$_('app.manualPosting.mediaDrop')}</span>
          <input
            type="file"
            accept={RASTER_OR_VIDEO_ACCEPT}
            multiple
            disabled={busy}
            onchange={(e) => {
              const input = e.currentTarget;
              if (input.files) onFiles(input.files);
              input.value = '';
            }}
          />
        </label>
        {#if device.length || libThumbs.length}
          <div class="thumbs">
            {#each device as item, i (item.preview)}
              <div class="thumb">
                {#if item.video}
                  <video src={item.preview} muted playsinline></video>
                {:else}
                  <img src={item.preview} alt="" />
                {/if}
                <button type="button" class="thumb-x" onclick={() => removeDevice(i)} disabled={busy}>×</button>
              </div>
            {/each}
            {#each libThumbs as m (m.id)}
              <div class="thumb">
                <img src={m.url} alt={m.title ?? ''} />
                <button type="button" class="thumb-x" onclick={() => toggleLib(m.id)} disabled={busy}>×</button>
              </div>
            {/each}
          </div>
        {/if}
        {#if device.length > 1 || libraryIds.length > 1 || (device.length && libraryIds.length)}
          <p class="mp-note">{$_('app.manualPosting.carouselNote')}</p>
        {/if}
        <button type="button" class="lib-toggle" onclick={() => (libOpen = !libOpen)} disabled={busy || hasVideo}>
          <Images size={16} strokeWidth={1.8} />
          {$_('app.manualPosting.mediaLibrary')}
        </button>
        {#if libOpen}
          {#if library.length}
            <div class="lib-grid">
              {#each library as m (m.id)}
                <button
                  type="button"
                  class="lib-cell"
                  class:on={libraryIds.includes(m.id)}
                  onclick={() => toggleLib(m.id)}
                  disabled={busy || hasVideo}
                  style={`background-image:url(${m.url})`}
                  aria-label={m.title ?? $_('app.manualPosting.mediaLibrary')}
                ></button>
              {/each}
            </div>
          {:else}
            <p class="mp-note">{$_('app.manualPosting.emptyLibrary')}</p>
          {/if}
        {/if}
      </div>
    </section>

    <section class="mp-col">
      <div class="mp-card">
        <div class="mp-h">
          <h3>{$_('app.manualPosting.caption')}</h3>
          <p>{$_('app.manualPosting.captionHint')}</p>
        </div>
        <label class="alt">
          <span class="alt-h">
            {$_('app.manualPosting.captionDefault')}
            <em>{$_('app.manualPosting.charsCount', { values: { n: caption.length } })}</em>
          </span>
          <textarea
            rows="7"
            bind:value={caption}
            placeholder={$_('app.manualPosting.captionPh')}
            disabled={busy || aiBusy}
          ></textarea>
        </label>
        <div class="ai-row">
          <input
            type="text"
            bind:value={aiBrief}
            placeholder={$_('app.manualPosting.aiBriefPh')}
            disabled={busy || aiBusy}
          />
          <button type="button" class="ai-btn" onclick={writeWithAi} disabled={busy || aiBusy || !creditsOk}>
            {#if aiBusy}<span class="spin"></span>{$_('app.manualPosting.aiWriting')}{:else}
              <Sparkles size={15} strokeWidth={2} />
              {$_('app.manualPosting.aiWrite')}
            {/if}
          </button>
        </div>

        {#if selected.length}
          <div class="variants">
            <div class="mp-h">
              <h3>{$_('app.manualPosting.variants')}</h3>
              <p>{$_('app.manualPosting.variantsHint')}</p>
            </div>
            {#each PLATFORM_KEYS.filter((k) => selected.includes(k)) as p (p)}
              {@const meta = PLATFORM_META[p]}
              {@const limit = limitOf(p)}
              {@const custom = (alts[p] ?? '').trim().length > 0}
              {@const n = effectiveCaption(p).length}
              <label class="alt">
                <span class="alt-h">
                  <span class="alt-name">
                    {#if meta?.icon}
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d={meta.icon.path} /></svg>
                    {/if}
                    {platformLabel(p)}
                    {#if !custom}<i>{$_('app.manualPosting.usingDefault')}</i>{/if}
                  </span>
                  {#if limit}
                    <em class:over={n > limit}>{$_('app.manualPosting.chars', { values: { n, limit } })}</em>
                  {:else}
                    <em>{$_('app.manualPosting.charsCount', { values: { n } })}</em>
                  {/if}
                </span>
                <textarea
                  rows={p === 'linkedin' || p === 'facebook' ? 5 : 3}
                  value={alts[p] ?? ''}
                  placeholder={$_('app.manualPosting.variantPh')}
                  disabled={busy || aiBusy}
                  oninput={(e) => setAlt(p, (e.currentTarget as HTMLTextAreaElement).value)}
                ></textarea>
              </label>
            {/each}
          </div>
        {/if}

        {#if showReddit}
          <label class="field">
            <span class="alt-h">
              {$_('app.manualPosting.redditTitle')}
              <em class:over={redditTitle.length > 300}
                >{$_('app.manualPosting.chars', { values: { n: redditTitle.length, limit: 300 } })}</em
              >
            </span>
            <input type="text" maxlength="300" bind:value={redditTitle} placeholder={$_('app.manualPosting.redditTitlePh')} disabled={busy} />
          </label>
          <label class="field">
            <span>{$_('app.manualPosting.redditSub')}</span>
            <input type="text" bind:value={redditSub} placeholder={$_('app.manualPosting.redditSubPh')} disabled={busy} />
          </label>
        {/if}
      </div>

      <div class="mp-card">
        <div class="mp-h">
          <h3>{$_('app.manualPosting.when')}</h3>
        </div>
        <div class="when" role="radiogroup">
          <button type="button" class="when-opt" class:on={mode === 'now'} onclick={() => (mode = 'now')} role="radio" aria-checked={mode === 'now'}>
            <strong>{$_('app.manualPosting.whenNow')}</strong>
            <span>{$_('app.manualPosting.whenNowHint')}</span>
          </button>
          <button type="button" class="when-opt" class:on={mode === 'schedule'} onclick={() => (mode = 'schedule')} role="radio" aria-checked={mode === 'schedule'}>
            <strong>{$_('app.manualPosting.whenSchedule')}</strong>
            <span>{$_('app.manualPosting.whenScheduleHint')}</span>
          </button>
          <button type="button" class="when-opt" class:on={mode === 'draft'} onclick={() => (mode = 'draft')} role="radio" aria-checked={mode === 'draft'}>
            <strong>{$_('app.manualPosting.whenDraft')}</strong>
            <span>{$_('app.manualPosting.whenDraftHint')}</span>
          </button>
        </div>
        {#if mode === 'schedule'}
          <div class="when-pick">
            <label class="field">
              <span>{$_('app.manualPosting.date')}</span>
              <input type="date" bind:value={date} min={data.todayKey} disabled={busy} />
            </label>
            <label class="field">
              <span>{$_('app.manualPosting.time')}</span>
              <input type="time" bind:value={time} disabled={busy} />
            </label>
          </div>
          <p class="mp-note">{$_('app.manualPosting.tzHint', { values: { tz: data.timezone } })}</p>
        {/if}
      </div>

      {#if error}<p class="mp-err">{error}</p>{/if}

      <button type="button" class="go" onclick={submit} disabled={busy || aiBusy}>
        {#if busy}<span class="spin"></span>{$_('app.manualPosting.working')}{:else}{cta}{/if}
      </button>
    </section>
  </div>
</div>

<style>
  .mp { max-width: 1080px; }
  .mp-grid {
    display: grid;
    grid-template-columns: 1fr 1.15fr;
    gap: 18px;
    align-items: start;
  }
  .mp-col { display: flex; flex-direction: column; gap: 14px; }
  .mp-card {
    background: var(--paper, #fff);
    border: 1px solid var(--line, #ededef);
    border-radius: 20px;
    padding: 18px 18px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .mp-h h3 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.03em; }
  .mp-h p { margin: 4px 0 0; font-size: 12.5px; color: var(--ink-soft, #6e6e73); line-height: 1.45; }
  .plats { display: flex; flex-wrap: wrap; gap: 8px; }
  .plat {
    display: inline-flex; align-items: center; gap: 7px;
    border: 1.5px solid var(--line, #ededef); border-radius: 980px;
    padding: 7px 12px; background: var(--paper, #fff); color: var(--ink, #1d1d1f);
    font: inherit; font-size: 13px; font-weight: 550; cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
  }
  .plat:hover { border-color: var(--line-2, #d2d2d7); }
  .plat.on {
    border-color: var(--accent, #c485fe);
    background: rgba(var(--accent-rgb, 196, 133, 254), 0.08);
    color: var(--ink, #1d1d1f);
  }
  .plat.ghost em, .plat em {
    font-style: normal; font-size: 10px; font-weight: 600; color: var(--ink-faint, #86868b);
    letter-spacing: 0.01em;
  }
  .mp-link { font-size: 12.5px; font-weight: 600; color: var(--accent, #c485fe); text-decoration: none; }
  .drop {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    padding: 28px 14px; border: 1.5px dashed var(--line-2, #d2d2d7); border-radius: 16px;
    background: var(--paper-2, #f9f9f9); color: var(--ink-soft, #6e6e73); cursor: pointer;
    font-size: 13px; font-weight: 500; text-align: center;
  }
  .drop.over, .drop:hover { border-color: var(--accent, #c485fe); color: var(--accent, #c485fe); }
  .drop input { display: none; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
  .thumb {
    position: relative; width: 72px; height: 72px; border-radius: 12px; overflow: hidden;
    border: 1.5px solid var(--line, #ededef); background: var(--paper-2, #f9f9f9);
  }
  .thumb img, .thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb-x {
    position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; border: none; border-radius: 50%;
    background: rgba(0,0,0,0.6); color: #fff; font-size: 12px; line-height: 1; cursor: pointer;
  }
  .lib-toggle {
    display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
    border: 1.5px solid var(--line, #ededef); border-radius: 980px; padding: 7px 12px;
    background: var(--paper, #fff); color: var(--ink, #1d1d1f); font: inherit; font-size: 13px; font-weight: 550;
    cursor: pointer;
  }
  .lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; }
  .lib-cell {
    aspect-ratio: 1; border-radius: 10px; border: 1.5px solid var(--line, #ededef);
    background-size: cover; background-position: center; cursor: pointer;
  }
  .lib-cell.on { border-color: var(--accent, #c485fe); box-shadow: 0 0 0 2px rgba(var(--accent-rgb, 196, 133, 254), 0.35); }
  textarea, input[type='text'], input[type='date'], input[type='time'] {
    width: 100%; box-sizing: border-box;
    border: 1.5px solid var(--line, #ededef); border-radius: 12px; padding: 10px 12px;
    font: inherit; font-size: 14px; background: var(--paper, #fff); color: var(--ink, #1d1d1f);
  }
  textarea { resize: vertical; line-height: 1.45; }
  textarea:focus, input:focus {
    outline: none; border-color: var(--accent, #c485fe);
    box-shadow: 0 0 0 4px rgba(var(--accent-rgb, 196, 133, 254), 0.1);
  }
  .ai-row { display: flex; gap: 8px; }
  .ai-row input { flex: 1; min-width: 0; }
  .ai-btn {
    display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
    border: none; border-radius: 980px; padding: 0 14px;
    background: rgba(var(--accent-rgb, 196, 133, 254), 0.12); color: var(--accent, #c485fe);
    font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; white-space: nowrap;
  }
  .ai-btn:disabled { opacity: 0.5; cursor: default; }
  .alt { display: flex; flex-direction: column; gap: 6px; }
  .alt-h {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    font-size: 12.5px; font-weight: 650; color: var(--ink-soft, #6e6e73);
  }
  .alt-h em { font-style: normal; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink-faint, #86868b); }
  .alt-h em.over { color: #c0392b; }
  .alt-name { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .alt-name i {
    font-style: normal; font-size: 11px; font-weight: 550; color: var(--ink-faint, #86868b);
  }
  .variants {
    display: flex; flex-direction: column; gap: 12px;
    border-top: 1px solid var(--line, #ededef); padding-top: 12px;
  }
  .field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
  .field > span { font-weight: 600; color: var(--ink-soft, #6e6e73); }
  .when { display: flex; flex-direction: column; gap: 8px; }
  .when-opt {
    text-align: left; border: 1.5px solid var(--line, #ededef); border-radius: 14px;
    padding: 11px 13px; background: var(--paper, #fff); cursor: pointer; font: inherit;
    display: flex; flex-direction: column; gap: 2px;
  }
  .when-opt strong { font-size: 13.5px; font-weight: 650; }
  .when-opt span { font-size: 12px; color: var(--ink-soft, #6e6e73); line-height: 1.4; }
  .when-opt.on { border-color: var(--accent, #c485fe); background: rgba(var(--accent-rgb, 196, 133, 254), 0.06); }
  .when-pick { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .mp-note { margin: 0; font-size: 12px; color: var(--ink-faint, #86868b); line-height: 1.4; }
  .mp-err { margin: 0; color: #c0392b; font-size: 13px; }
  .go {
    border: none; border-radius: 980px; padding: 13px 20px;
    background: linear-gradient(120deg, var(--accent, #c485fe), var(--accent-2, #ecb2ed)); color: #fff;
    box-shadow: 0 8px 18px -8px rgba(var(--accent-rgb, 196, 133, 254), 0.55);
    font-size: 14px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .go:disabled { opacity: 0.5; cursor: default; }
  .spin {
    width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff;
    border-radius: 50%; animation: mp-spin 0.8s linear infinite; display: inline-block;
  }
  .ai-btn .spin { border-color: rgba(var(--accent-rgb, 196, 133, 254), 0.3); border-top-color: var(--accent, #c485fe); }
  @keyframes mp-spin { to { transform: rotate(360deg); } }
  @media (max-width: 860px) {
    .mp-grid { grid-template-columns: 1fr; }
    .ai-row { flex-direction: column; }
    .when-pick { grid-template-columns: 1fr; }
  }
</style>
