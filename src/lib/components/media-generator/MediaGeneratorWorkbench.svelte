<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { nearBottom } from '$lib/chat-scroll';
  import { _ } from 'svelte-i18n';
  import { browser } from '$app/environment';
  import { invalidateAll } from '$app/navigation';
  import PageHead from '$lib/components/PageHead.svelte';
  import {
    applyChatStreamEvent,
    readSseEvents,
    emptyStreamState,
    type ChatStreamState
  } from '$lib/chat-stream-events';
  import { followDesignerJobChain } from '$lib/designer-job-follow';
  import type { StreamToolCall } from '$lib/stores/chat-session';
  import { downscaleImageFile } from '$lib/chat-attachments';
  import { isRasterImageSource } from '$lib/raster-image';
  import PromptHistoryButton from '$lib/components/PromptHistoryButton.svelte';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import {
    isUgcFormatId,
    isUgcPlatformId,
    type UgcFormatId,
    type UgcPlatformId
  } from '$lib/ugc-formats';
  import ChatImageLightbox from '$lib/components/ChatImageLightbox.svelte';
  import VideoReviewPanel from '$lib/components/VideoReviewPanel.svelte';
  import { isVideoUrl } from '$lib/content-formats';
  import {
    GROK_IMAGINE_VIDEO_MODEL,
    isKnownVideoModelId,
    isSeedanceFamily,
    modelSupportsReferenceVideo,
    SEEDANCE_25_MODEL,
    type VideoModelChoiceId
  } from '$lib/video-models';
  import MediaGeneratorGallery from './MediaGeneratorGallery.svelte';
  import MediaGeneratorComposer from './MediaGeneratorComposer.svelte';
  import MediaGeneratorSeedancePanel from './MediaGeneratorSeedancePanel.svelte';
  import type {
    AspectRatio,
    ComposerMenu,
    EntityPick,
    GridItem,
    MediaKindPreference,
    MediaRefsPayload,
    PickerAnchor,
    PickerKind,
    PromptHistoryEntry,
    SeedanceAsset,
    VariantsCount,
    WorkbenchMode
  } from './media-generator-model';
  import {
    ASPECTS,
    KINDS,
    VARIANTS,
    MAX_ENTITY_PICKS,
    MAX_SEEDANCE_REFS,
    MAX_UGC_MODEL_PICKS,
    MAX_UGC_PRODUCT_PICKS,
    MAX_UPLOADS,
    extractMediaFromOutput,
    isUsableMediaUrl,
    layoutFromAspect,
    mapServerItems,
    mapServerPrompts,
    mergeItemsByNewest,
    parseUrlLines
  } from './media-generator-model';

  let {
    data,
    mode = 'media'
  }: {
    data: {
      brand: { slug: string; id: string; name?: string };
      items?: unknown[];
      prompts?: unknown[];
      hasMore?: boolean;
      pageSize?: number;
    };
    mode?: WorkbenchMode;
  } = $props();

  const brand = $derived(data.brand as { slug: string; id: string; name?: string });
  const ugcMode = $derived(mode === 'ugc');
  const i18nPrefix = $derived(ugcMode ? 'app.media.ugcCreator' : 'app.media.generator');

  let items = $state<GridItem[]>([]);
  let selectedIds = $state<string[]>([]);
  let history = $state<PromptHistoryEntry[]>([]);
  let historyOpen = $state(false);
  let hasMore = $state(false);
  let loadingMore = $state(false);
  let loadMoreError = $state(false);
  let scrollSentinel = $state<HTMLDivElement | null>(null);
  const pageSize = $derived(
    typeof data.pageSize === 'number' && data.pageSize > 0 ? data.pageSize : 24
  );

  let input = $state('');
  let loading = $state(false);
  let errorMsg = $state<string | null>(null);
  let aspect = $state<AspectRatio>('4:5');
  let kind = $state<MediaKindPreference>('auto');
  let variants = $state<VariantsCount>(1);
  /** UGC Creator: how many talking clips to produce in this batch (1–20). */
  let videoCount = $state(1);
  /**
   * UGC ad format for the batch. Empty is a real choice, not a missing one: it means "rotate the
   * formats across the slots", which is what stops a ten-pack from being one clip ten times.
   */
  let ugcFormat = $state<'' | UgcFormatId>('');
  /** Destination platform — drives native formats, clip length, caption and hashtag guidance. */
  let ugcPlatform = $state<'' | UgcPlatformId>('');
  /** The playbook panel (production steps + formats + platforms). Open by default on an empty grid. */
  let playbookOpen = $state(false);
  /** When true, agent uses brand visual_style / look / mood. */
  let useBrandStyle = $state(true);
  /** Video model when kind=video. Empty = platform default. UGC defaults to Grok Imagine (480p). */
  let videoModel = $state<'' | VideoModelChoiceId>(mode === 'ugc' ? GROK_IMAGINE_VIDEO_MODEL : '');
  let firstFrameUrl = $state('');
  let lastFrameUrl = $state('');
  let referenceVideoText = $state('');
  let referenceAudioText = $state('');
  let uploadedVideos = $state<SeedanceAsset[]>([]);
  let uploadedAudios = $state<SeedanceAsset[]>([]);
  let seedanceUploadBusy = $state(false);
  let seedanceError = $state<string | null>(null);
  let seedancePanel = $state<null | 'start' | 'end' | 'video' | 'audio'>(null);
  let uploads = $state<string[]>([]);
  /** Post thumbs from another social account (ScrapeCreators via SocialThumbPicker). */
  let socialRefs = $state<string[]>([]);
  let picks = $state<EntityPick[]>([]);
  let menu = $state<ComposerMenu>('none');
  let pickerKind = $state<PickerKind>('talents');
  let pickerAnchor = $state<PickerAnchor>('plus');
  let mediaRefs = $state<MediaRefsPayload | null>(null);
  let mediaLoading = $state(false);
  let composerEl = $state<HTMLDivElement | null>(null);
  /** Clearance so the live stream panel never sits under the brand-style banner / composer. */
  let composerClearance = $state(220);

  let streamBuf = $state('');
  let streamToolCalls = $state<StreamToolCall[]>([]);
  let streamReasoning = $state('');
  let overlayEl = $state<HTMLDivElement | null>(null);

  let abort: AbortController | null = null;
  let hydrated = $state(false);
  let previewUrl = $state<string | null>(null);
  let previewCaption = $state('');

  const prefKey = $derived(
    ugcMode
      ? `anomalia.ugcCreator.prefs.${brand.slug}`
      : `anomalia.mediaGenerator.prefs.${brand.slug}`
  );

  let mediaReadyIds = $state<Record<string, true>>({});

  const selectedItems = $derived(items.filter((i) => selectedIds.includes(i.id) && isUsableMediaUrl(i.url)));
  const seedanceVideoN = $derived(
    uploadedVideos.length + parseUrlLines(referenceVideoText, MAX_SEEDANCE_REFS).length
  );
  const seedanceAudioN = $derived(
    uploadedAudios.length + parseUrlLines(referenceAudioText, MAX_SEEDANCE_REFS).length
  );

  function openSeedancePanel(which: 'start' | 'end' | 'video' | 'audio') {
    menu = 'none';
    seedanceError = null;
    seedancePanel = seedancePanel === which ? null : which;
  }

  $effect(() => {
    streamBuf;
    streamToolCalls;
    streamReasoning;
    // Si segue il flusso solo se l'utente sta già guardando l'ultima riga: se è scorso in su per
    // rileggere qualcosa, il chunk successivo non deve strappargli via la posizione.
    const el = overlayEl;
    if (el && nearBottom(el)) el.scrollTo({ top: el.scrollHeight });
  });

  /** Seedance materials (frames / video / audio) and grid-video remakes require the Seedance family. */
  $effect(() => {
    const needsSeedance =
      selectedItems.some((i) => i.type === 'video') ||
      uploadedVideos.length > 0 ||
      uploadedAudios.length > 0 ||
      !!firstFrameUrl ||
      !!lastFrameUrl;
    if (!needsSeedance) return;
    if (!modelSupportsReferenceVideo(videoModel)) {
      videoModel = SEEDANCE_25_MODEL;
    }
  });
  const entityPickCount = $derived(
    picks.filter((p) => p.kind === 'talent' || p.kind === 'person' || p.kind === 'product').length
  );
  const productPickCount = $derived(picks.filter((p) => p.kind === 'product').length);
  const modelPickCount = $derived(picks.filter((p) => p.kind === 'talent').length);
  /** Candidates with a real URL (may still be loading / probing). Newest first. */
  const mediaCandidates = $derived(
    items
      .filter((i) => isUsableMediaUrl(i.url))
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  );
  /** Only tiles that finished loading — never empty/error shells in the masonry. */
  const gridItems = $derived(mediaCandidates.filter((i) => mediaReadyIds[i.id]));
  /** Still probing — kept off-grid so they never occupy a cell. */
  const pendingMedia = $derived(mediaCandidates.filter((i) => !mediaReadyIds[i.id]));
  const socialPickMax = $derived(
    Math.max(
      socialRefs.length || 1,
      Math.max(0, 6 - uploads.length - picks.length - selectedItems.length)
    )
  );
  const canSend = $derived(!!input.trim() && !loading && !seedanceUploadBusy);

  // Server history is source of truth on enter / after invalidate (not while a run is in flight).
  // IMPORTANT: never read+write mediaReadyIds as a tracked dependency — that caused
  // effect_update_depth_exceeded (infinite $effect loop).
  // Full SSR / invalidate replaces the grid with the newest page and resets infinite scroll.
  $effect(() => {
    const serverItems = (data.items ?? []) as Array<{
      id: string;
      kind: string;
      url: string;
      prompt: string;
      aspect?: string | null;
      created_at: string;
    }>;
    const serverPrompts = (data.prompts ?? []) as Array<{
      id: string;
      prompt: string;
      kind: string;
      aspect: string | null;
      media_count: number;
      created_at: string;
    }>;
    history = mapServerPrompts(serverPrompts);
    hasMore = Boolean(data.hasMore);
    loadMoreError = false;
    if (loading) return;

    const mapped = mapServerItems(serverItems).filter((i) => isUsableMediaUrl(i.url));
    items = mapped;

    const keep = new Set(mapped.map((i) => i.id));
    const prevReady = untrack(() => mediaReadyIds);
    let pruned = false;
    const nextReady: Record<string, true> = {};
    for (const id of Object.keys(prevReady)) {
      if (keep.has(id)) nextReady[id] = true;
      else pruned = true;
    }
    if (pruned) mediaReadyIds = nextReady;
  });

  async function loadMore() {
    if (!browser || loadingMore || !hasMore || loading) return;
    const oldest = mediaCandidates[mediaCandidates.length - 1];
    if (!oldest) {
      hasMore = false;
      return;
    }
    loadingMore = true;
    loadMoreError = false;
    try {
      const before = new Date(oldest.createdAt).toISOString();
      const ugcQ = ugcMode ? '&ugc=1' : '';
      const res = await fetch(
        `/app/${brand.slug}/media-generator?items=1&before=${encodeURIComponent(before)}&limit=${pageSize}${ugcQ}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        items?: Array<{
          id: string;
          kind: string;
          url: string;
          prompt: string;
          aspect?: string | null;
          created_at: string;
        }>;
        hasMore?: boolean;
      };
      const mapped = mapServerItems(json.items ?? []);
      if (mapped.length) {
        items = mergeItemsByNewest(items, mapped);
      }
      hasMore = Boolean(json.hasMore);
    } catch (e) {
      console.error('[media-generator] load more', e);
      loadMoreError = true;
    } finally {
      loadingMore = false;
      // If the sentinel is still in view (short first pages), keep paging.
      queueMicrotask(() => {
        if (!hasMore || loadingMore || loadMoreError || !scrollSentinel) return;
        const root = scrollSentinel.closest('.mg-grid-wrap');
        if (!(root instanceof Element)) return;
        const rootRect = root.getBoundingClientRect();
        const rect = scrollSentinel.getBoundingClientRect();
        if (rect.top <= rootRect.bottom + 240) void loadMore();
      });
    }
  }

  onMount(() => {
    try {
      const raw = localStorage.getItem(prefKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          useBrandStyle?: boolean;
          aspect?: string;
          kind?: string;
          variants?: number;
          videoCount?: number;
          videoModel?: string;
          ugcFormat?: string;
          ugcPlatform?: string;
        };
        if (typeof parsed.useBrandStyle === 'boolean') useBrandStyle = parsed.useBrandStyle;
        if (ASPECTS.includes(parsed.aspect as AspectRatio)) aspect = parsed.aspect as AspectRatio;
        if (!ugcMode && KINDS.includes(parsed.kind as MediaKindPreference)) {
          kind = parsed.kind as MediaKindPreference;
        }
        if (VARIANTS.includes(parsed.variants as VariantsCount)) {
          variants = parsed.variants as VariantsCount;
        }
        if (
          typeof parsed.videoCount === 'number' &&
          parsed.videoCount >= 1 &&
          parsed.videoCount <= 20
        ) {
          videoCount = Math.round(parsed.videoCount);
        }
        if (isUgcFormatId(parsed.ugcFormat)) ugcFormat = parsed.ugcFormat;
        if (isUgcPlatformId(parsed.ugcPlatform)) ugcPlatform = parsed.ugcPlatform;
        if (parsed.videoModel === '' || isKnownVideoModelId(parsed.videoModel)) {
          // UGC: empty saved pref stays on Seedance 2.5 (the page default).
          if (!(ugcMode && parsed.videoModel === '')) {
            videoModel = (parsed.videoModel || '') as '' | VideoModelChoiceId;
          }
        }
      }
    } catch {
      /* ignore */
    }
    if (ugcMode) {
      kind = 'video';
      if (!ASPECTS.includes(aspect)) aspect = '9:16';
      // Styles are Media Generator only — drop any leftover style picks on UGC.
      picks = picks.filter((p) => p.kind !== 'style');
      // Prefer vertical for talking UGC when prefs never set aspect.
      try {
        const raw = localStorage.getItem(prefKey);
        if (!raw) aspect = '9:16';
      } catch {
        aspect = '9:16';
      }
    }
    hydrated = true;
  });

  // Infinite scroll: when the sentinel enters the scrollport, fetch the next older page.
  $effect(() => {
    if (!browser || !scrollSentinel || !hasMore) return;
    const node = scrollSentinel;
    const root = node.closest('.mg-grid-wrap');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root: root instanceof Element ? root : null, rootMargin: '240px 0px', threshold: 0 }
    );
    io.observe(node);
    return () => io.disconnect();
  });

  // Keep live-status overlay clear of the floating composer (banner + prompt).
  $effect(() => {
    if (!browser || !composerEl) return;
    const node = composerEl;
    const measure = () => {
      composerClearance = Math.ceil(node.getBoundingClientRect().height) + 28;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (!browser || !hydrated) return;
    try {
      localStorage.setItem(
        prefKey,
        JSON.stringify({
          useBrandStyle,
          aspect,
          kind,
          variants,
          videoCount,
          videoModel,
          ugcFormat,
          ugcPlatform
        })
      );
    } catch {
      /* ignore quota */
    }
  });

  $effect(() => {
    if (!browser) return;
    // Another tab may have produced UGC/media — refresh durable gallery when this tab is focused.
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (untrack(() => loading)) return;
      void invalidateAll().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });

  function markMediaReady(id: string) {
    if (mediaReadyIds[id]) return;
    mediaReadyIds = { ...mediaReadyIds, [id]: true };
  }

  /**
   * Remove a tile from the client grid. Never auto-DELETE durable history rows from a probe —
   * flaky video decode / late metadata on a second tab was wiping the UGC gallery from the DB
   * so a fresh tab looked empty ("starts from zero").
   */
  function dropBrokenMedia(id: string, opts?: { purgeServer?: boolean }) {
    const row = items.find((i) => i.id === id);
    items = items.filter((i) => i.id !== id);
    selectedIds = selectedIds.filter((x) => x !== id);
    if (mediaReadyIds[id]) {
      const next = { ...mediaReadyIds };
      delete next[id];
      mediaReadyIds = next;
    }
    if (opts?.purgeServer && row && isUsableMediaUrl(row.url) && brand.slug) {
      void fetch(`/app/${brand.slug}/media-generator`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      }).catch(() => {});
    }
  }

  function toggleSelect(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item || !item.url) return;
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((x) => x !== id);
    } else if (selectedIds.length < 6) {
      selectedIds = [...selectedIds, id];
    }
  }

  function openPreview(item: GridItem) {
    if (!isUsableMediaUrl(item.url)) return;
    previewUrl = item.url;
    previewCaption = item.prompt?.trim() ?? '';
  }

  function closePreview() {
    previewUrl = null;
    previewCaption = '';
  }

  function pushMedia(
    list: Array<{ type: 'image' | 'video'; url: string; prompt: string; id?: string }>
  ) {
    const seen = new Set(items.filter((i) => isUsableMediaUrl(i.url)).map((i) => i.url));
    const next: GridItem[] = [];
    for (const m of list) {
      if (!isUsableMediaUrl(m.url) || seen.has(m.url)) continue;
      seen.add(m.url);
      const layout = layoutFromAspect(aspect, m.type);
      next.push({
        id: m.id || crypto.randomUUID(),
        type: m.type,
        url: m.url.trim(),
        prompt: m.prompt,
        createdAt: Date.now(),
        tall: layout.tall,
        wide: layout.wide
      });
    }
    if (next.length) items = mergeItemsByNewest(items, next);
  }

  async function onPickFiles(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const files = Array.from(el.files ?? []).filter((f) =>
      isRasterImageSource({ mime: f.type, filename: f.name })
    );
    el.value = '';
    menu = 'none';
    for (const f of files.slice(0, MAX_UPLOADS - uploads.length)) {
      try {
        uploads = [...uploads, await downscaleImageFile(f)];
      } catch {
        /* skip */
      }
    }
  }

  async function openPicker(
    kindIn: PickerKind,
    anchor: PickerAnchor = 'plus'
  ) {
    pickerKind = kindIn;
    pickerAnchor = anchor;
    menu = 'picker';
    if (kindIn === 'styles') return;
    if (mediaRefs) return;
    mediaLoading = true;
    try {
      const res = await fetch(`/app/${brand.slug}/media-refs`);
      if (res.ok) {
        const json = await res.json();
        mediaRefs = {
          brandImages: json.brandImages ?? [],
          postThumbs: json.postThumbs ?? [],
          people: json.people ?? [],
          talents: json.talents ?? [],
          products: json.products ?? []
        };
      } else {
        mediaRefs = { brandImages: [], postThumbs: [], people: [], talents: [], products: [] };
      }
    } catch {
      mediaRefs = { brandImages: [], postThumbs: [], people: [], talents: [], products: [] };
    } finally {
      mediaLoading = false;
    }
  }

  function togglePick(pick: EntityPick) {
    const idx = picks.findIndex((p) => p.kind === pick.kind && p.id === pick.id);
    if (idx >= 0) {
      picks = picks.filter((_, i) => i !== idx);
      return;
    }
    if (ugcMode && pick.kind === 'style') return;
    if (pick.kind === 'product') {
      const maxProducts = ugcMode ? MAX_UGC_PRODUCT_PICKS : MAX_ENTITY_PICKS;
      if (productPickCount >= maxProducts) return;
      if (!ugcMode && entityPickCount >= MAX_ENTITY_PICKS) return;
    } else if (pick.kind === 'talent') {
      if (ugcMode) {
        if (modelPickCount >= MAX_UGC_MODEL_PICKS) return;
      } else if (entityPickCount >= MAX_ENTITY_PICKS) {
        return;
      }
    } else if (pick.kind === 'person') {
      if (entityPickCount >= MAX_ENTITY_PICKS) return;
    } else if (uploads.length + socialRefs.length + picks.length + selectedItems.length >= 6) {
      return;
    }
    picks = [...picks, pick];
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    errorMsg = null;
    loading = true;
    streamBuf = '';
    streamToolCalls = [];
    streamReasoning = '';
    abort = new AbortController();

    const productPicks = picks.filter((p) => p.kind === 'product');
    const modelPicks = picks.filter((p) => p.kind === 'talent');
    // UGC: products + models are redistributed server-side — keep them out of shared refs.
    // Styles are not used for UGC.
    const otherPicks = ugcMode
      ? picks.filter((p) => p.kind !== 'product' && p.kind !== 'talent' && p.kind !== 'style')
      : picks.filter((p) => p.kind !== 'product');
    const selectedImages = selectedItems.filter((i) => i.type === 'image');
    const selectedVideos = selectedItems.filter((i) => i.type === 'video');
    const referenceUrls = [
      ...uploads,
      ...socialRefs,
      ...otherPicks.flatMap((p) => (p.urls?.length ? p.urls : [p.url])),
      ...selectedImages.map((i) => i.url)
    ].slice(0, 6);
    const referenceVideoUrls = [
      ...selectedVideos.map((i) => i.url),
      ...uploadedVideos.map((a) => a.url),
      ...parseUrlLines(referenceVideoText, MAX_SEEDANCE_REFS)
    ]
      .filter((u, i, arr) => arr.indexOf(u) === i)
      .slice(0, MAX_SEEDANCE_REFS);
    const referenceAudioUrls = [
      ...uploadedAudios.map((a) => a.url),
      ...parseUrlLines(referenceAudioText, MAX_SEEDANCE_REFS)
    ]
      .filter((u, i, arr) => arr.indexOf(u) === i)
      .slice(0, MAX_SEEDANCE_REFS);

    // Remake from a selected video → Seedance (Grok has no reference_video_urls on Kie).
    // UGC Creator: empty "platform default" is Grok Imagine.
    const requestedModel = ugcMode && !videoModel ? GROK_IMAGINE_VIDEO_MODEL : videoModel;
    const effectiveVideoModel =
      (referenceVideoUrls.length || referenceAudioUrls.length || firstFrameUrl || lastFrameUrl) &&
      !modelSupportsReferenceVideo(requestedModel)
        ? SEEDANCE_25_MODEL
        : requestedModel;
    if (effectiveVideoModel !== videoModel) videoModel = effectiveVideoModel;

    history = [
      {
        id: crypto.randomUUID(),
        prompt: text,
        at: Date.now(),
        kind: ugcMode ? 'video' : kind,
        aspect,
        mediaCount: 0
      },
      ...history
    ].slice(0, 80);

    input = '';
    const promptUsed = text;
    let produced = 0;
    let promptIdFromServer: string | null = null;
    const state: ChatStreamState = emptyStreamState();
    let designerJobId: string | null = null;

    try {
      try {
        const res = await fetch(`/app/${brand.slug}/media-generator`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: promptUsed,
            aspectRatio: aspect,
            kind: ugcMode ? 'video' : kind,
            ...(ugcMode
              ? {
                  forceUgc: true,
                  videoCount,
                  products: productPicks.map((p) => ({
                    id: p.id,
                    name: p.label || 'product',
                    urls: p.urls?.length ? p.urls : [p.url]
                  })),
                  models: modelPicks.map((p) => ({
                    id: p.id,
                    name: p.label || 'model',
                    urls: p.urls?.length ? p.urls : [p.url]
                  })),
                  // Empty format = rotate across the batch (server side), so it is sent as-is.
                  ...(ugcFormat ? { ugcFormat } : {}),
                  ...(ugcPlatform ? { ugcPlatform } : {})
                }
              : { variants }),
            referenceUrls,
            useBrandStyle,
            ...((ugcMode || kind === 'video') && effectiveVideoModel
              ? { videoModel: effectiveVideoModel }
              : {}),
            ...((ugcMode || kind === 'video') && referenceVideoUrls.length
              ? { referenceVideoUrls }
              : {}),
            ...((ugcMode || kind === 'video') &&
            isSeedanceFamily(effectiveVideoModel)
              ? {
                  firstFrameUrl: firstFrameUrl || undefined,
                  lastFrameUrl: lastFrameUrl || undefined,
                  referenceAudioUrls
                }
              : {})
          }),
          signal: abort.signal
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(errText || `HTTP ${res.status}`);
        }

        promptIdFromServer = res.headers.get('X-Media-Generator-Prompt-Id');
        if (promptIdFromServer) {
          history = history.map((h, i) => (i === 0 ? { ...h, id: promptIdFromServer! } : h));
        }
        designerJobId = res.headers.get('X-Designer-Job-Id');

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let sseBuf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });
          const { events, rest } = readSseEvents(sseBuf);
          sseBuf = rest;

          for (const evt of events) {
            applyChatStreamEvent(state, evt);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const e = evt as any;

            if (e?.type === 'tool-output-available' && e.output != null) {
              const media = extractMediaFromOutput(e.output);
              if (media.length) {
                produced += media.length;
                pushMedia(media);
              }
            }
          }

          streamBuf = state.text;
          streamToolCalls = state.tools;
          streamReasoning = state.reasoning;

          if (state.failed) throw new Error('stream failed');
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError' || abort?.signal.aborted) throw e;
        if (!designerJobId) throw e;
        console.warn('[media-generator] live SSE dropped; following designer job', e);
      }

      if (designerJobId && abort && !abort.signal.aborted) {
        await followDesignerJobChain({
          brandSlug: brand.slug,
          jobId: designerJobId,
          seed: {
            text: state.text,
            tools: [...state.tools],
            reasoning: state.reasoning,
            failed: state.failed
          },
          signal: abort.signal,
          onState: (s) => {
            streamBuf = s.text;
            streamToolCalls = s.tools;
            streamReasoning = s.reasoning;
          },
          onMediaTick: () => void invalidateAll()
        });
      }

      if (produced) {
        history = history.map((h, i) => (i === 0 ? { ...h, mediaCount: produced } : h));
      }
      // Clear uploads + entity picks after a successful turn; keep grid selections for iteration.
      uploads = [];
      socialRefs = [];
      picks = [];
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        /* user stopped */
      } else {
        errorMsg = $_('app.media.generator.error');
        console.error('[media-generator]', e);
      }
    } finally {
      abort = null;
      // Drop the live overlay so the new tiles are fully visible.
      streamBuf = '';
      streamToolCalls = [];
      streamReasoning = '';
      // Reload durable history from the DB, then clear the loading flag so hydrate can replace the grid.
      try {
        await invalidateAll();
      } catch {
        /* ignore */
      }
      loading = false;
    }
  }

  function stop() {
    abort?.abort();
    loading = false;
  }
</script>

<svelte:head>
  <title>Anomalia — {$_(i18nPrefix + '.title')}</title>
</svelte:head>

<div class="mg-page" style={`--mg-composer-clearance: ${composerClearance}px`}>
  <PageHead
    title={$_(i18nPrefix + '.title')}
    subtitle={$_(i18nPrefix + '.subtitle')}
  >
    {#snippet actions()}
      {#if ugcMode}
        <button
          type="button"
          class="mg-playbook-btn"
          class:on={playbookOpen}
          onclick={() => (playbookOpen = !playbookOpen)}
        >
          <BookOpen size={14} strokeWidth={2} />
          <span>{$_('app.media.ugcCreator.playbook', { default: 'Playbook' })}</span>
        </button>
      {/if}
      <PromptHistoryButton
        label={$_(i18nPrefix + '.history')}
        onclick={() => (historyOpen = true)}
      />
    {/snippet}
  </PageHead>

  <MediaGeneratorGallery
    {ugcMode}
    {playbookOpen}
    {loading}
    {i18nPrefix}
    brandSlug={brand.slug}
    {gridItems}
    {pendingMedia}
    {selectedIds}
    {hasMore}
    {loadingMore}
    {loadMoreError}
    {streamBuf}
    {streamToolCalls}
    {streamReasoning}
    {videoCount}
    onProbeReady={markMediaReady}
    onProbeDropClient={(id) => dropBrokenMedia(id, { purgeServer: false })}
    onOpenPreview={openPreview}
    onToggleSelect={toggleSelect}
    onLoadMore={() => void loadMore()}
    bind:ugcFormat
    bind:ugcPlatform
    bind:sentinelEl={scrollSentinel}
    bind:overlayEl={overlayEl}
  />

  {#if errorMsg}
    <p class="mg-error">{errorMsg}</p>
  {/if}

  <div class="mg-composer" bind:this={composerEl}>
    <MediaGeneratorComposer
      {loading}
      {ugcMode}
      {i18nPrefix}
      brandSlug={brand.slug}
      {pickerAnchor}
      bind:menu
      bind:input
      bind:aspect
      bind:kind
      bind:variants
      bind:videoCount
      bind:ugcFormat
      bind:ugcPlatform
      bind:videoModel
      bind:useBrandStyle
      bind:socialRefs
      bind:picks
      bind:selectedIds
      bind:historyOpen
      bind:uploads
      {pickerKind}
      {mediaRefs}
      {mediaLoading}
      {socialPickMax}
      {canSend}
      {firstFrameUrl}
      {lastFrameUrl}
      {seedancePanel}
      {seedanceVideoN}
      {seedanceAudioN}
      {selectedItems}
      {history}
      onSend={() => void send()}
      onStop={stop}
      onPickFiles={onPickFiles}
      onOpenPicker={openPicker}
      onTogglePick={togglePick}
      onOpenSeedancePanel={openSeedancePanel}
    />
  </div>
</div>

{#if seedancePanel}
  <MediaGeneratorSeedancePanel
    {loading}
    remakeFromVideo={selectedItems.some((i) => i.type === 'video')}
    bind:seedancePanel
    bind:firstFrameUrl
    bind:lastFrameUrl
    bind:referenceVideoText
    bind:referenceAudioText
    bind:uploadedVideos
    bind:uploadedAudios
    bind:seedanceError
    bind:seedanceUploadBusy
  />
{/if}

{#if previewUrl}
  {#if isVideoUrl(previewUrl)}
    <ChatImageLightbox src={previewUrl} caption={previewCaption} onclose={closePreview}>
      {#snippet extra()}
        <VideoReviewPanel
          url={previewUrl}
          brandSlug={brand.slug}
          defaultStandard="organic"
          caption={previewCaption}
        />
      {/snippet}
    </ChatImageLightbox>
  {:else}
    <ChatImageLightbox src={previewUrl} caption={previewCaption} onclose={closePreview} />
  {/if}
{/if}

<style>
  .mg-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    position: relative;
    width: 100%;
    max-width: none;
  }

  .mg-playbook-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink-soft);
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12.5px;
    cursor: pointer;
  }
  .mg-playbook-btn:hover,
  .mg-playbook-btn.on {
    border-color: var(--accent);
    color: var(--ink);
  }

  .mg-error {
    position: absolute;
    left: 50%;
    bottom: calc(var(--mg-composer-clearance, 220px) + 12px);
    transform: translateX(-50%);
    z-index: 25;
    margin: 0;
    padding: 8px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, #dc2626 12%, var(--paper));
    color: #dc2626;
    font-size: 13px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    max-width: min(820px, calc(100% - 24px));
  }

  .mg-composer {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    z-index: 20;
    width: min(820px, calc(100% - 24px));
    padding: 0;
    pointer-events: none;
    background: none;
  }
  .mg-composer :global(.ch-shell),
  .mg-composer :global(.mg-style-banner),
  .mg-composer :global(.ch-box) {
    pointer-events: auto;
  }
</style>
