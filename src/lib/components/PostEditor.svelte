<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import UpgradeLink from '$lib/components/UpgradeLink.svelte';
  import { untrack } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { siInstagram, siTiktok, siFacebook, siX, siThreads, siYoutube, siBluesky, siReddit } from 'simple-icons';
  import { captionViolations, captionFor, platformLabel, PLATFORM_CHAR_LIMITS, ALT_CAPTION_PLATFORMS, YOUTUBE_TITLE_LIMIT } from '$lib/platform-limits';
  import { downscaleImageFile } from '$lib/chat-attachments';
  import { RASTER_IMAGE_ACCEPT, isRasterImageSource } from '$lib/raster-image';
  import { YOUTUBE_THUMB_FILE_ACCEPT, prepareYoutubeThumbnailFile } from '$lib/youtube-thumbnail-client';

  // Shared post editor dialog — used by both Approvals and Content. The host page must define the
  // matching form actions (?/updatePost, ?/approve, ?/reject, ?/reschedule, ?/cancelSchedule, ?/repost).
  type Post = {
    id: string;
    platform: string | null;
    platforms?: string[] | null;
    caption: string | null;
    // Per-platform caption overrides ({x, threads}) — see platform-limits.ts.
    platform_captions?: Record<string, string> | null;
    title?: string | null;
    link_url?: string | null;
    subreddit?: string | null;
    image_prompt?: string | null;
    media_url: string | null;
    // Carousel slides in order (media_url is slide 1). Absent/≤1 → single-media post.
    media_urls?: string[] | null;
    content_type?: string | null;
    status: string;
    published_url?: string | null;
    product_name?: string | null;
    revisions_count?: number | null;
    whenISO: string;
    needs_attention?: boolean | null;
    attention_reason?: string | null;
    video_thumbnail_url?: string | null;
    youtube_thumbnail_url?: string | null;
  };

  // Must match MAX_REVISIONS in approvals/regenerate/+server.ts (the server is the source of truth;
  // this only drives the UI hint + disabled state). The endpoint still enforces the real limit.
  const MAX_REVISIONS = 3;

  let {
    post,
    brandSlug,
    tz,
    todayKey,
    nowISO,
    busyDays,
    availablePlatforms = [],
    flags = { studio: false },
    // Lightbox (calendar) vs full-page post dashboard.
    embedded = false,
    // Which columns to show when embedded. Modal always shows all available.
    panels = 'all' as 'all' | 'edit',
    onClose
  }: {
    post: Post;
    brandSlug: string;
    tz: string;
    todayKey: string;
    nowISO: string;
    busyDays: Record<string, number>;
    // Platforms the brand can publish to (connected accounts) — the cross-post picker offers these.
    availablePlatforms?: string[];
    // Global feature flags (from the [brand] layout). studio → graphic source editor.
    flags?: { studio?: boolean };
    embedded?: boolean;
    panels?: 'all' | 'edit';
    onClose?: () => void;
  } = $props();

  const studioOn = $derived(!!flags?.studio);
  const showForm = $derived(panels === 'all' || panels === 'edit');
  const close = () => onClose?.();

  // Mobile dual-pane: bottom bar switches between settings (first) and preview (second).
  // Default to the editable pane so properties are reachable without scrolling past the image.
  let mobilePane = $state<'primary' | 'preview'>('primary');

  function setMobilePane(next: 'primary' | 'preview') {
    mobilePane = next;
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' } as ScrollToOptions);
    }
  }

  const PLATFORMS: Record<string, { label: string; bg: string; glyph: string }> = {
    instagram: { label: 'Instagram', bg: 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af)', glyph: 'IG' },
    tiktok: { label: 'TikTok', bg: '#111', glyph: 'TT' },
    facebook: { label: 'Facebook', bg: '#1877f2', glyph: 'f' },
    linkedin: { label: 'LinkedIn', bg: '#0a66c2', glyph: 'in' },
    x: { label: 'X', bg: '#0a0a0a', glyph: 'X' },
    threads: { label: 'Threads', bg: '#000', glyph: '@' },
    youtube: { label: 'YouTube', bg: '#ff0000', glyph: 'YT' },
    bluesky: { label: 'Bluesky', bg: '#0285ff', glyph: 'BS' },
    reddit: { label: 'Reddit', bg: '#ff4500', glyph: 'RD' }
  };
  const ICONS: Record<string, { path: string; hex: string }> = {
    instagram: siInstagram, tiktok: siTiktok, facebook: siFacebook, x: siX, threads: siThreads, youtube: siYoutube, bluesky: siBluesky, reddit: siReddit
  };
  const meta = $derived(PLATFORMS[(post.platform ?? '').toLowerCase()]);
  const icon = $derived(ICONS[(post.platform ?? '').toLowerCase()]);

  // English weekday short-names — used ONLY to build the backend `slot` string ("Mon 9:00"),
  // which the scheduler parses case-insensitively against English names. Never translate these.
  const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW = $derived([0, 1, 2, 3, 4, 5, 6].map((i) => $_('posteditor.dow.' + i)));
  const MON = $derived(
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => $_('posteditor.mon.' + i))
  );
  const WEEKDAYS = $derived([1, 2, 3, 4, 5, 6, 0].map((i) => $_('posteditor.dow.' + i)));
  const pad = (n: number) => String(n).padStart(2, '0');

  function isoToZoned(iso: string, zone: string) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])
    );
    const h = p.hour === '24' ? '00' : p.hour;
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${h}:${p.minute}` };
  }
  const weekdayOf = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  };
  const dateLabel = (date: string, time: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return `${weekdayOf(date)}, ${MON[m - 1]} ${d} · ${time}`;
  };

  const minLead = $derived(
    isoToZoned(new Date(Math.floor(Date.parse(nowISO) / 60000) * 60000 + 2 * 60000).toISOString(), tz)
  );
  const todayMinTime = $derived(minLead.date === todayKey ? minLead.time : null);

  // ---- editor state (component is remounted per open, so these init from `post` once) ----
  const z0 = isoToZoned(post.whenISO, tz);
  let eCaption = $state(post.caption ?? '');
  let eDate = $state(z0.date);
  let eTime = $state(z0.time);
  let eMedia = $state(post.media_url);
  let eImagePrompt = $state<string | null>(post.image_prompt ?? null);
  let eContentType = $state<string | null>(post.content_type ?? null);
  // Carousel: all slides in order (or null for a single-media post). The main preview shows the
  // selected slide; a thumbnail strip lets the user step through them. Local state so the editor
  // chat (studio) can update slides live after a per-slide render.
  let eMediaUrls = $state<string[] | null>(post.media_urls ?? null);
  const carouselSlides = $derived(Array.isArray(eMediaUrls) && eMediaUrls.length > 1 ? eMediaUrls : null);
  let activeSlide = $state(0);
  const displayMedia = $derived(carouselSlides ? (carouselSlides[activeSlide] ?? eMedia) : eMedia);
  const isVideoMedia = $derived(!!displayMedia && !carouselSlides && (eContentType?.includes('video') || /\.(mp4|webm|mov)(\?|$)/i.test(displayMedia ?? '')));

  let graphicSource = $state('');
  let graphicKind = $state<'html' | 'tsx' | null>(null);
  let graphicOpen = $state(false);
  let graphicBusy = $state<'load' | 'save' | 'export' | null>(null);
  let graphicErr = $state<string | null>(null);
  const graphicApi = $derived(
    `/app/${brandSlug}/content/${post.id}/graphic${carouselSlides ? `?slide=${activeSlide}` : ''}`
  );

  async function loadGraphicSource() {
    if (isVideoMedia) {
      graphicKind = null;
      graphicSource = '';
      return;
    }
    graphicBusy = 'load';
    graphicErr = null;
    try {
      const res = await fetch(graphicApi);
      if (res.status === 404) {
        graphicKind = null;
        graphicSource = '';
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { source?: string; kind?: 'html' | 'tsx' };
      graphicSource = j.source ?? '';
      graphicKind = j.kind ?? (graphicSource ? 'html' : null);
    } catch (e) {
      graphicKind = null;
      graphicErr = e instanceof Error ? e.message : String(e);
    } finally {
      graphicBusy = null;
    }
  }

  $effect(() => {
    const url = graphicApi;
    const skip = isVideoMedia;
    untrack(() => {
      if (skip) {
        graphicKind = null;
        graphicSource = '';
        return;
      }
      void loadGraphicSource();
    });
    void url;
  });

  async function saveGraphicSource() {
    if (!graphicSource.trim()) return;
    graphicBusy = 'save';
    graphicErr = null;
    try {
      const res = await fetch(`/app/${brandSlug}/content/${post.id}/graphic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: graphicSource,
          format: 'png',
          slide_index: carouselSlides ? activeSlide : null
        })
      });
      const j = (await res.json()) as { error?: string; media_url?: string; source?: string; kind?: 'html' | 'tsx' };
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (j.source) graphicSource = j.source;
      if (j.kind) graphicKind = j.kind;
      if (j.media_url) {
        if (carouselSlides && eMediaUrls) {
          const next = [...eMediaUrls];
          next[activeSlide] = j.media_url;
          eMediaUrls = next;
          eMedia = next[0] ?? j.media_url;
        } else {
          eMedia = j.media_url;
        }
        eContentType = 'generated_graphic';
      }
    } catch (e) {
      graphicErr = e instanceof Error ? e.message : String(e);
    } finally {
      graphicBusy = null;
    }
  }

  async function exportGraphic(format: 'png' | 'jpeg') {
    if (!graphicSource.trim()) return;
    graphicBusy = 'export';
    graphicErr = null;
    try {
      const res = await fetch(`/app/${brandSlug}/content/${post.id}/graphic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: graphicSource, format, export: true })
      });
      const j = (await res.json()) as { error?: string; mime?: string; data?: string };
      if (!res.ok || !j.data) throw new Error(j.error || `HTTP ${res.status}`);
      const bin = atob(j.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: j.mime || 'image/png' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `graphic.${format === 'jpeg' ? 'jpg' : 'png'}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      graphicErr = e instanceof Error ? e.message : String(e);
    } finally {
      graphicBusy = null;
    }
  }

  // The dialog must live under <body>: the app shell wraps pages in a scroll container with
  // `contain: layout`, which re-bases `position: fixed` to that container — so a non-portaled
  // overlay sticks to the top of the scrolled content instead of the viewport.
  // Embedded mode stays in-flow under the post dashboard layout.
  function portal(node: HTMLElement) {
    if (embedded) return {};
    document.body.appendChild(node);
    return { destroy() { node.parentNode?.removeChild(node); } };
  }
  // Reddit-specific editable fields. Title is required for Reddit (max 300 chars).
  let eTitle = $state(post.title ?? '');
  let eLinkUrl = $state(post.link_url ?? '');
  let eSubreddit = $state(post.subreddit ?? '');
  const isReddit = $derived((post.platform ?? '').toLowerCase() === 'reddit');
  const isLinkPost = $derived(eContentType === 'link');
  let eYoutubeThumb = $state<string | null>(post.youtube_thumbnail_url ?? null);
  let ytBrief = $state('');
  let ytBusy = $state<'generate' | 'upload' | 'set' | 'clear' | null>(null);
  let ytError = $state('');
  /** Crediti finiti: la nota rossa non aveva un posto dove mandare l'utente. */
  let ytExhausted = $state(false);
  let ytPicker = $state(false);
  let ytFileEl = $state<HTMLInputElement>();

  // Cross-post targets. Defaults to the post's own platforms (or its single platform). The picker
  // offers the brand's connected platforms ∪ whatever this post already targets.
  const initialPlatforms = (post.platforms?.length ? post.platforms : post.platform ? [post.platform] : [])
    .map((p) => p.toLowerCase());
  let ePlatforms = $state<string[]>(initialPlatforms);
  const isYoutube = $derived(ePlatforms.includes('youtube') || (post.platform ?? '').toLowerCase() === 'youtube');
  // Offer every supported channel (not just the connected ones) so the user can retarget the post,
  // with the brand's connected accounts listed first. Union with ePlatforms keeps any legacy target.
  const platformChoices = $derived([
    ...new Set([
      ...availablePlatforms.map((p) => p.toLowerCase()),
      ...Object.keys(PLATFORMS),
      ...ePlatforms
    ])
  ]);
  // Platforms that require a visual: a text/link post can't publish (or cross-post) there.
  // ponytail: 2 entries inlined; VISUAL_REQUIRED in content-preview.ts is the server source of truth.
  const VISUAL_REQUIRED = new Set(['instagram', 'tiktok', 'youtube']);
  const isVisualPost = $derived(eContentType !== 'text' && eContentType !== 'link');
  // Only offer targets compatible with the media the user is currently looking at (changes on
  // regenerate / version switch). Text-only → drop the visual-required platforms.
  const compatiblePlatforms = $derived(platformChoices.filter((p) => isVisualPost || !VISUAL_REQUIRED.has(p)));
  // Prune any now-incompatible target if the post turns text-only, so we never save an invalid one.
  $effect(() => {
    if (isVisualPost) return;
    const pruned = ePlatforms.filter((p) => !VISUAL_REQUIRED.has(p));
    if (pruned.length !== ePlatforms.length) ePlatforms = pruned;
  });
  function togglePlatform(p: string) {
    ePlatforms = ePlatforms.includes(p) ? ePlatforms.filter((x) => x !== p) : [...ePlatforms, p];
  }

  // Short-network cuts of the same post: X (280) and Threads (500) can each carry their own caption
  // so a long post stays cross-postable. Empty = that platform publishes the main caption.
  let eAltCaptions = $state<Record<string, string>>({ ...(post.platform_captions ?? {}) });
  // Only offer the cut for a short network that is actually a target and isn't the post's own
  // platform (its caption was already written for it).
  const altCaptionTargets = $derived(
    ALT_CAPTION_PLATFORMS.filter((p) => ePlatforms.includes(p) && post.platform !== p)
  );

  // Live char-limit check against the currently selected targets, each measured against the caption
  // IT will publish. Blocks Approve/Publish while any target is over its limit (X's 280 is the one
  // that actually gets rejected by Zernio).
  const capViolations = $derived(captionViolations(eCaption, ePlatforms, eAltCaptions));

  let feedback = $state('');
  let regenerating = $state(false);
  let revisionsLeft = $state(Math.max(0, MAX_REVISIONS - (post.revisions_count ?? 0)));
  let regenError = $state('');
  // Chat-style composer: user-attached reference images (base64 data URLs) sent with the feedback,
  // plus the textarea/file refs for auto-grow and the hidden picker.
  const MAX_REF_IMAGES = 4;
  let refImages = $state<string[]>([]);
  let feedbackEl = $state<HTMLTextAreaElement>();
  let refInputEl = $state<HTMLInputElement>();
  // References picked from the brand's own library (images / post thumbs). Kept as {id,url}: the id
  // goes to the server (which re-resolves it), the url is only for the thumbnail preview.
  type Pick = { kind: 'brand' | 'post'; id: string; url: string };
  let refPicks = $state<Pick[]>([]);
  let brandPicker = $state(false);
  let mediaRefs = $state<{ brandImages: { id: string; url: string }[]; postThumbs: { id: string; url: string }[] } | null>(null);
  let mediaLoading = $state(false);
  const refCount = $derived(refImages.length + refPicks.length);

  async function openBrandPicker() {
    brandPicker = !brandPicker;
    if (!brandPicker || mediaRefs || mediaLoading) return;
    mediaLoading = true;
    try {
      const res = await fetch(`/app/${brandSlug}/media-refs`);
      mediaRefs = res.ok ? await res.json() : { brandImages: [], postThumbs: [] };
    } catch {
      mediaRefs = { brandImages: [], postThumbs: [] };
    }
    mediaLoading = false;
  }

  function togglePick(kind: 'brand' | 'post', id: string, url: string) {
    const i = refPicks.findIndex((p) => p.kind === kind && p.id === id);
    if (i >= 0) { refPicks.splice(i, 1); return; }
    if (refCount >= MAX_REF_IMAGES) return;
    refPicks.push({ kind, id, url });
  }
  const isPicked = (kind: 'brand' | 'post', id: string) => refPicks.some((p) => p.kind === kind && p.id === id);
  function removePick(i: number) { refPicks.splice(i, 1); }

  async function openYtPicker() {
    ytPicker = !ytPicker;
    if (!ytPicker || mediaRefs || mediaLoading) return;
    mediaLoading = true;
    try {
      const res = await fetch(`/app/${brandSlug}/media-refs`);
      mediaRefs = res.ok ? await res.json() : { brandImages: [], postThumbs: [] };
    } catch {
      mediaRefs = { brandImages: [], postThumbs: [] };
    }
    mediaLoading = false;
  }

  async function ytRequest(init: RequestInit): Promise<string | null> {
    ytError = '';
    ytExhausted = false;
    const res = await fetch(`/app/${brandSlug}/posts/${post.id}/youtube-thumbnail`, init);
    const j = await res.json().catch(() => ({}));
    if (res.status === 402 || j.error === 'credits_exhausted') {
      ytExhausted = true;
      ytError = get(_)('posteditor.youtube.errCredits');
      return null;
    }
    if (!res.ok || !j.ok) {
      const err = String(j.error ?? '');
      ytError =
        err === 'too_large'
          ? get(_)('posteditor.youtube.errTooLarge')
          : err === 'convert_failed'
            ? get(_)('posteditor.youtube.errConvert')
            : get(_)('posteditor.youtube.errGeneric');
      return null;
    }
    return (j.youtube_thumbnail_url as string | null) ?? null;
  }

  async function generateYtThumb() {
    if (ytBusy) return;
    ytBusy = 'generate';
    try {
      const url = await ytRequest({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          brief: ytBrief,
          caption: eCaption,
          title: eTitle
        })
      });
      if (url) eYoutubeThumb = url;
    } finally {
      ytBusy = null;
    }
  }

  async function setYtThumb(src: string) {
    if (ytBusy || !src) return;
    ytBusy = 'set';
    ytPicker = false;
    try {
      const url = await ytRequest({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set', url: src })
      });
      if (url) eYoutubeThumb = url;
    } finally {
      ytBusy = null;
    }
  }

  async function useYtCover() {
    if (ytBusy) return;
    ytBusy = 'set';
    try {
      const url = await ytRequest({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'use_cover' })
      });
      if (url) eYoutubeThumb = url;
    } finally {
      ytBusy = null;
    }
  }

  async function clearYtThumb() {
    if (ytBusy) return;
    ytBusy = 'clear';
    try {
      const url = await ytRequest({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clear' })
      });
      if (url === null && !ytError) eYoutubeThumb = null;
    } finally {
      ytBusy = null;
    }
  }

  async function onYtFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || ytBusy) return;
    ytBusy = 'upload';
    ytError = '';
    try {
      const prepared = await prepareYoutubeThumbnailFile(file);
      if ('error' in prepared) {
        ytError =
          prepared.error === 'too_large'
            ? get(_)('posteditor.youtube.errTooLarge')
            : prepared.error === 'convert_failed'
              ? get(_)('posteditor.youtube.errConvert')
              : get(_)('posteditor.youtube.errGeneric');
        return;
      }
      const fd = new FormData();
      fd.set('file', prepared.file);
      const url = await ytRequest({ method: 'POST', body: fd });
      if (url) eYoutubeThumb = url;
    } finally {
      ytBusy = null;
    }
  }

  // Auto-grow the feedback textarea like the Chat composer.
  $effect(() => {
    void feedback;
    if (feedbackEl) {
      feedbackEl.style.height = 'auto';
      feedbackEl.style.height = Math.min(feedbackEl.scrollHeight, 160) + 'px';
    }
  });

  async function onPickRefs(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) =>
      isRasterImageSource({ mime: f.type, filename: f.name })
    );
    input.value = '';
    for (const f of files.slice(0, MAX_REF_IMAGES - refCount)) {
      try { refImages.push(await downscaleImageFile(f)); } catch { /* skip unreadable image */ }
    }
  }
  function removeRef(i: number) { refImages.splice(i, 1); }

  // Version stack: index 0 is the original; each successful regeneration appends a new version.
  // Revisions are now persisted server-side (post_revisions table) so they survive a dialog reopen.
  // On mount we fetch any persisted revisions and rebuild the stack; regenerations append live.
  type Version = { caption: string; media: string | null; imagePrompt: string | null; contentType: string | null; feedback?: string | null; title?: string; linkUrl?: string; subreddit?: string };
  let versions = $state<Version[]>([
    { caption: post.caption ?? '', media: post.media_url, imagePrompt: post.image_prompt ?? null, contentType: post.content_type ?? null, title: post.title ?? '', linkUrl: post.link_url ?? '', subreddit: post.subreddit ?? '' }
  ]);
  let current = $state(0);
  let revisionsLoaded = $state(false);

  // Load persisted revisions on mount when the post has been regenerated at least once.
  $effect(() => {
    if (revisionsLoaded || !(post.revisions_count ?? 0)) return;
    revisionsLoaded = true;
    (async () => {
      try {
        const res = await fetch(`/app/${brandSlug}/approvals/regenerate?id=${post.id}`);
        if (!res.ok) return;
        const j = await res.json();
        const revs = j.revisions as Array<{ version: number; caption: string | null; image_prompt: string | null; media_url: string | null; content_type: string | null; feedback?: string | null; title?: string | null; link_url?: string | null; subreddit?: string | null }>;
        if (!revs?.length) return;
        const built: Version[] = revs.map((r) => ({
          caption: r.caption ?? '',
          media: r.media_url ?? null,
          imagePrompt: r.image_prompt ?? null,
          contentType: r.content_type ?? null,
          feedback: r.feedback ?? null,
          title: r.title ?? '',
          linkUrl: r.link_url ?? '',
          subreddit: r.subreddit ?? ''
        }));
        versions = built;
        current = built.length - 1;
        const v = built[current];
        eCaption = v.caption;
        eMedia = v.media;
        eImagePrompt = v.imagePrompt;
        eContentType = v.contentType;
        if (v.title) eTitle = v.title;
        if (v.linkUrl) eLinkUrl = v.linkUrl;
        if (v.subreddit) eSubreddit = v.subreddit;
      } catch { /* ignore — fall back to the post's own fields */ }
    })();
  });

  // Switch to version `i`, first stashing any manual edits made to the version we're leaving so
  // they're not lost when the user flips back.
  function goto(i: number) {
    if (i < 0 || i >= versions.length || i === current) return;
    versions[current] = { caption: eCaption, media: eMedia, imagePrompt: eImagePrompt, contentType: eContentType, title: eTitle, linkUrl: eLinkUrl, subreddit: eSubreddit };
    current = i;
    const v = versions[i];
    eCaption = v.caption;
    eMedia = v.media;
    eImagePrompt = v.imagePrompt;
    eContentType = v.contentType;
    eTitle = v.title ?? '';
    eLinkUrl = v.linkUrl ?? '';
    eSubreddit = v.subreddit ?? '';
  }
  let saveError = $state('');
  let showReport = $state(false);
  let reportNote = $state('');
  let reposting = $state(false);
  const isTextOnly = $derived(post.content_type === 'text' || post.content_type === 'link');
  const weekdayEnOf = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return DOW_EN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  };
  const slotValue = $derived(eDate ? `${weekdayEnOf(eDate)} ${eTime}` : `Mon ${eTime}`);
  const whenLabel = $derived(eDate ? dateLabel(eDate, eTime) : '');

  // ---- reschedule calendar picker ----
  let pickerOpen = $state(false);
  let pickY = $state(2026);
  let pickM = $state(1);
  let pickDate = $state('');
  let pickTime = $state('09:00');

  function openPicker() {
    const [y, m] = eDate.split('-').map(Number);
    pickY = y;
    pickM = m;
    pickDate = eDate;
    pickTime = eTime;
    pickerOpen = true;
  }
  function shiftMonth(delta: number) {
    const dt = new Date(Date.UTC(pickY, pickM - 1 + delta, 1));
    pickY = dt.getUTCFullYear();
    pickM = dt.getUTCMonth() + 1;
  }
  const pickGrid = $derived.by(() => {
    const firstDow = new Date(Date.UTC(pickY, pickM - 1, 1)).getUTCDay();
    const lead = (firstDow + 6) % 7;
    const cells: Array<{ key: string; dayNum: number; inMonth: boolean; isToday: boolean; past: boolean; busy: number }> = [];
    for (let i = 0; i < 42; i++) {
      const dt = new Date(Date.UTC(pickY, pickM - 1, 1 - lead + i));
      const key = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
      cells.push({
        key,
        dayNum: dt.getUTCDate(),
        inMonth: dt.getUTCMonth() + 1 === pickM,
        isToday: key === todayKey,
        past: key < todayKey,
        busy: busyDays[key] ?? 0
      });
    }
    return cells.slice(35).every((c) => !c.inMonth) ? cells.slice(0, 35) : cells;
  });
  const pickTodayBlocked = $derived(pickDate === todayKey && todayMinTime === null);
  function selectDay(key: string, past: boolean) {
    if (past) return;
    pickDate = key;
    if (key === todayKey && todayMinTime && pickTime < todayMinTime) pickTime = todayMinTime;
  }
  function confirmPick() {
    if (!pickDate || pickDate < todayKey || pickTodayBlocked) return;
    if (pickDate === todayKey && todayMinTime && pickTime < todayMinTime) return;
    eDate = pickDate;
    eTime = pickTime;
    pickerOpen = false;
  }

  async function regenerate() {
    if (!feedback.trim() || regenerating || revisionsLeft <= 0) return;
    regenerating = true;
    regenError = '';
    try {
      const res = await fetch(`/app/${brandSlug}/approvals/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Send what the user is currently looking at so the revision builds on this version (incl.
        // an earlier regeneration) — caption as reference text, media as the image edit base.
        body: JSON.stringify({
          id: post.id,
          feedback,
          caption: eCaption,
          image_prompt: eImagePrompt,
          media_url: eMedia,
          title: eTitle,
          link_url: eLinkUrl,
          subreddit: eSubreddit,
          referenceImages: refImages,
          brandImageIds: refPicks.filter((p) => p.kind === 'brand').map((p) => p.id),
          postThumbIds: refPicks.filter((p) => p.kind === 'post').map((p) => p.id)
        })
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        // Stash edits on the current version, then append the new one and jump to it.
        versions[current] = { caption: eCaption, media: eMedia, imagePrompt: eImagePrompt, contentType: eContentType, title: eTitle, linkUrl: eLinkUrl, subreddit: eSubreddit };
        versions.push({
          caption: j.caption ?? eCaption,
          media: j.media_url ?? eMedia,
          imagePrompt: j.image_prompt ?? eImagePrompt,
          contentType: j.content_type ?? eContentType,
          feedback: feedback.trim(),
          title: j.title ?? eTitle,
          linkUrl: j.link_url ?? eLinkUrl,
          subreddit: j.subreddit ?? eSubreddit
        });
        current = versions.length - 1;
        const v = versions[current];
        eCaption = v.caption;
        eMedia = v.media;
        eImagePrompt = v.imagePrompt;
        eContentType = v.contentType;
        if (typeof j.revisionsLeft === 'number') revisionsLeft = j.revisionsLeft;
        feedback = '';
        refImages = [];
        refPicks = [];
        brandPicker = false;
      } else if (res.status === 429 || j.error === 'revision_limit') {
        revisionsLeft = 0;
        regenError = get(_)('posteditor.revisionLimit');
      } else {
        regenError = get(_)('posteditor.errGeneric');
      }
    } finally {
      regenerating = false;
    }
  }

  // Which form action is in flight (its `?/name`), so the clicked button shows a spinner and every
  // action button disables until the server replies. The server actions take a couple of seconds;
  // without this the buttons looked dead. Cleared on failure; on success the dialog closes anyway.
  let submitting = $state<string | null>(null);

  // Close only when the action succeeds; surface the error otherwise. `name` matches the `?/action`
  // so the right button can render its own spinner.
  const runAction = (name: string): SubmitFunction => () => {
    submitting = name;
    return async ({ result, update }) => {
      if (result.type === 'success' && name === 'reject') {
        submitting = null;
        close();
        return;
      }

      await update();
      submitting = null;
      if (result.type === 'success') {
        if (embedded) await invalidateAll();
        else close();
      } else if (result.type === 'failure') {
        saveError = (result.data?.error as string) ?? get(_)('posteditor.errGeneric');
      }
    };
  };

  const repostEnhance: SubmitFunction = () => {
    reposting = true;
    return async ({ result, update }) => {
      await update();
      reposting = false;
      if (result.type === 'success') {
        if (embedded) await invalidateAll();
        else close();
      } else if (result.type === 'failure') saveError = (result.data?.error as string) ?? get(_)('posteditor.errRepost');
    };
  };
</script>

<!-- Committed alongside caption + schedule on Save/Approve: the picked version's media/prompt/type
     and the cross-post target platforms. -->
{#snippet versionFields()}
  <input type="hidden" name="media_url" value={eMedia ?? ''} />
  <input type="hidden" name="image_prompt" value={eImagePrompt ?? ''} />
  <input type="hidden" name="content_type" value={eContentType ?? ''} />
  <input type="hidden" name="platforms" value={ePlatforms.join(',')} />
  <!-- Always sent (even when that network isn't a current target) so an existing cut is preserved
       rather than silently dropped by the partial patch. -->
  {#each ALT_CAPTION_PLATFORMS as p (p)}
    <input type="hidden" name={`caption_${p}`} value={eAltCaptions[p] ?? ''} />
  {/each}
  {#if isReddit}
    <input type="hidden" name="title" value={eTitle} />
    <input type="hidden" name="link_url" value={eLinkUrl} />
    <input type="hidden" name="subreddit" value={eSubreddit} />
  {:else if isYoutube}
    <input type="hidden" name="title" value={eTitle} />
  {/if}
  {#if isYoutube}
    <input type="hidden" name="youtube_thumbnail_url" value={eYoutubeThumb ?? ''} />
  {/if}
{/snippet}

<!-- Spinner shown inside the button whose action is currently in flight. -->
{#snippet spin(name: string)}{#if submitting === name}<span class="spinner sm"></span>{/if}{/snippet}

<!-- Publish immediately: cancels any scheduled Zernio copy first, then sends now (server-side). -->
{#snippet publishNowForm()}
  <form method="POST" action="?/publishNow" use:enhance={runAction('publishNow')}>
    <input type="hidden" name="id" value={post.id} />
    <input type="hidden" name="caption" value={eCaption} />
    <input type="hidden" name="slot" value={slotValue} />
    {@render versionFields()}
    <button class="ctrl btn-out" type="submit" disabled={!!submitting || capViolations.length > 0} title={capViolations.length ? $_('posteditor.overLimit.hint') : ''}>{@render spin('publishNow')}⚡ {$_('posteditor.publishNow')}</button>
  </form>
{/snippet}

<svelte:window
  onkeydown={(e) => {
    if (embedded) return;
    if (e.key !== 'Escape' || regenerating || submitting) return;
    if (pickerOpen) pickerOpen = false;
    else if (ytPicker) ytPicker = false;
    else close();
  }}
/>

<div
  class={embedded ? 'lb-embed-root' : 'lb-overlay'}
  use:portal
  role={embedded ? 'region' : 'button'}
  tabindex="-1"
  aria-label={embedded ? undefined : $_('posteditor.close')}
  onclick={embedded ? undefined : (e) => e.target === e.currentTarget && !regenerating && !submitting && close()}
  onkeydown={embedded ? undefined : (e) => e.key === 'Enter' && e.target === e.currentTarget && !submitting && close()}
>
  <div
    class="lb-card"
    class:embedded
    class:edit-focus={embedded && panels === 'edit'}
    class:mobile-primary={mobilePane === 'primary'}
    class:mobile-preview={mobilePane === 'preview'}
    role={embedded ? 'region' : 'dialog'}
    aria-modal={embedded ? undefined : 'true'}
    tabindex="-1"
  >
    {#if !embedded}
      <button type="button" class="lb-close" onclick={() => !submitting && close()} aria-label={$_('posteditor.close')}>×</button>
    {/if}

    <div class="lb-img" style={displayMedia && !isVideoMedia ? `background-image:url(${displayMedia})` : ''}>
      {#if isVideoMedia}
        <!-- Delivered/generated clips need a real player — a background-image renders nothing. -->
        <video class="lb-video" src={displayMedia} controls playsinline preload="metadata">
          <track kind="captions" />
        </video>
      {/if}
      {#if isTextOnly}<span class="ph">{$_('posteditor.textOnly')}</span>{:else if !displayMedia}<span class="ph">{$_('posteditor.noImage')}</span>{/if}
      {#if carouselSlides}
        <span class="slide-count">{activeSlide + 1}/{carouselSlides.length}</span>
        <div class="lb-slides">
          {#each carouselSlides as s, i (s)}
            <button type="button" class="lb-slide" class:on={i === activeSlide}
              style={`background-image:url(${s})`} onclick={() => (activeSlide = i)} aria-label={`Slide ${i + 1}`}>
              <span class="lb-slide-n">{i + 1}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if regenerating}<div class="regen-veil"><span class="spinner"></span>{$_('posteditor.regenerating')}</div>{/if}
    </div>

    {#if showForm}
    <div class="lb-body">
      <div class="lb-meta">
        {#if icon}
          <svg class="picon" viewBox="0 0 24 24" fill={`#${icon.hex}`}><path d={icon.path} /></svg>
        {:else}
          <span class="pglyph" style={`background:${meta?.bg ?? '#999'}`}>{meta?.glyph ?? (post.platform ?? '?').slice(0, 2)}</span>
        {/if}
        <span class="pplat">{meta?.label ?? post.platform}</span>
        {#if post.product_name}<span class="prod-tag" title={$_('posteditor.featuredProduct')}>{post.product_name}</span>{/if}
      </div>

      {#if post.needs_attention && post.attention_reason}
        <p class="attn-flag">{post.attention_reason}</p>
      {/if}

      <!-- Reddit-specific fields: title, subreddit, link URL -->
      {#if isReddit}
        <label class="fld">
          <span class="flbl">{$_('posteditor.redditTitle')}</span>
          <input class="ctrl" type="text" bind:value={eTitle} maxlength="300" placeholder={$_('posteditor.redditTitlePlaceholder')} />
          <span class="fld-hint">{eTitle.length}/300</span>
        </label>
        <div class="reddit-row">
          <label class="fld flex-1">
            <span class="flbl">{$_('posteditor.redditSubreddit')}</span>
            <div class="subreddit-input">
              <span class="subreddit-prefix">r/</span>
              <input class="ctrl" type="text" bind:value={eSubreddit} placeholder={$_('posteditor.redditSubredditPlaceholder')} />
            </div>
          </label>
          {#if isLinkPost}
            <label class="fld flex-2">
              <span class="flbl">{$_('posteditor.redditLinkUrl')}</span>
              <input class="ctrl" type="url" bind:value={eLinkUrl} placeholder="https://..." />
            </label>
          {/if}
        </div>
      {/if}

      {#if isYoutube}
        {#if !isReddit}
          <label class="fld">
            <span class="flbl">{$_('posteditor.youtube.title')}</span>
            <input class="ctrl" type="text" bind:value={eTitle} maxlength={YOUTUBE_TITLE_LIMIT} placeholder={$_('posteditor.youtube.titlePlaceholder')} />
            <span class="fld-hint">{eTitle.length}/{YOUTUBE_TITLE_LIMIT}</span>
          </label>
        {/if}
        <div class="fld yt-thumb">
          <span class="flbl">{$_('posteditor.youtube.thumb')}</span>
          <p class="fld-hint left">{$_('posteditor.youtube.thumbHint')}</p>
          <div class="yt-thumb-preview" class:empty={!eYoutubeThumb} style={eYoutubeThumb ? `background-image:url(${eYoutubeThumb})` : ''}>
            {#if !eYoutubeThumb}<span>{$_('posteditor.youtube.empty')}</span>{/if}
            {#if ytBusy}<div class="regen-veil"><span class="spinner"></span>{$_('posteditor.youtube.working')}</div>{/if}
          </div>
          <input class="ctrl" type="text" bind:value={ytBrief} placeholder={$_('posteditor.youtube.briefPlaceholder')} disabled={!!ytBusy} />
          <div class="yt-thumb-actions">
            <button type="button" class="ctrl btn-fill" disabled={!!ytBusy} onclick={() => generateYtThumb()}>
              {ytBusy === 'generate' ? $_('posteditor.youtube.generating') : $_('posteditor.youtube.generate')}
            </button>
            <button type="button" class="ctrl btn-out" disabled={!!ytBusy} onclick={() => openYtPicker()}>
              {$_('posteditor.youtube.library')}
            </button>
            <label class="ctrl btn-out yt-file">
              {$_('posteditor.youtube.upload')}
              <input bind:this={ytFileEl} type="file" accept={YOUTUBE_THUMB_FILE_ACCEPT} hidden disabled={!!ytBusy} onchange={onYtFile} />
            </label>
            {#if post.video_thumbnail_url}
              <button type="button" class="ctrl btn-out" disabled={!!ytBusy} onclick={() => useYtCover()}>
                {$_('posteditor.youtube.useCover')}
              </button>
            {/if}
            {#if eYoutubeThumb}
              <button type="button" class="btn-link" disabled={!!ytBusy} onclick={() => clearYtThumb()}>
                {$_('posteditor.youtube.clear')}
              </button>
            {/if}
          </div>
          {#if ytPicker}
            <div class="ref-picker">
              {#if mediaLoading}
                <div class="ref-empty">{$_('posteditor.loadingRefs')}</div>
              {:else if mediaRefs && (mediaRefs.brandImages.length || mediaRefs.postThumbs.length)}
                {#if mediaRefs.brandImages.length}
                  <div class="ref-grp-lbl">{$_('posteditor.brandImages')}</div>
                  <div class="ref-grid">
                    {#each mediaRefs.brandImages as bi (bi.id)}
                      <button type="button" class="ref-cell" style={`background-image:url(${bi.url})`}
                        onclick={() => setYtThumb(bi.url)} aria-label={$_('posteditor.youtube.pick')}></button>
                    {/each}
                  </div>
                {/if}
                {#if mediaRefs.postThumbs.length}
                  <div class="ref-grp-lbl">{$_('posteditor.yourPosts')}</div>
                  <div class="ref-grid">
                    {#each mediaRefs.postThumbs as pt (pt.id)}
                      <button type="button" class="ref-cell" style={`background-image:url(${pt.url})`}
                        onclick={() => setYtThumb(pt.url)} aria-label={$_('posteditor.youtube.pick')}></button>
                    {/each}
                  </div>
                {/if}
              {:else}
                <div class="ref-empty">{$_('posteditor.noBrandMedia')}</div>
              {/if}
            </div>
          {/if}
          {#if ytError}<span class="regen-note err">{ytError}{#if ytExhausted}{' '}<UpgradeLink slug={brandSlug} />{/if}</span>{/if}
        </div>
      {/if}

      {#if versions.length > 1}
        <div class="ver-nav">
          <button type="button" class="ver-arrow" onclick={() => goto(current - 1)} disabled={current === 0 || regenerating} aria-label={$_('posteditor.prevVersion')}>‹</button>
          <div class="ver-info">
            <span class="ver-label">{$_('posteditor.version', { values: { n: current + 1, total: versions.length } })}</span>
            {#if versions[current]?.feedback}
              <span class="ver-feedback" title={versions[current].feedback}>{versions[current].feedback}</span>
            {/if}
          </div>
          <button type="button" class="ver-arrow" onclick={() => goto(current + 1)} disabled={current === versions.length - 1 || regenerating} aria-label={$_('posteditor.nextVersion')}>›</button>
        </div>
      {/if}

      <label class="fld">
        <span class="flbl">{$_('posteditor.caption')}</span>
        <textarea class="ctrl ta" class:over={capViolations.length > 0} rows="4" bind:value={eCaption}></textarea>
        {#if capViolations.length}
          <span class="cap-over">⚠ {$_('posteditor.overLimit.warn', { values: { platform: capViolations.map((v) => v.label).join(', '), length: capViolations[0].length, limit: capViolations[0].limit } })}</span>
        {/if}
      </label>

      <!-- Short-network cuts: a separate caption for X (280) / Threads (500) when the post is
           cross-posted there. Left empty they simply publish the main caption. -->
      {#each altCaptionTargets as p (p)}
        {@const limit = PLATFORM_CHAR_LIMITS[p]}
        {@const len = captionFor(eCaption, eAltCaptions, p).length}
        <label class="fld">
          <span class="flbl">
            {$_('posteditor.altCaption.label', { values: { platform: platformLabel(p) } })}
            <span class="cap-count" class:over={len > limit}>{len}/{limit}</span>
          </span>
          <textarea
            class="ctrl ta"
            class:over={len > limit}
            rows="2"
            placeholder={$_('posteditor.altCaption.hint', { values: { platform: platformLabel(p), limit } })}
            value={eAltCaptions[p] ?? ''}
            oninput={(e) => (eAltCaptions = { ...eAltCaptions, [p]: e.currentTarget.value })}
          ></textarea>
        </label>
      {/each}

      <div class="fld">
        <span class="flbl">{$_('posteditor.publish')}</span>
        <button type="button" class="ctrl when" onclick={openPicker}>
          <span>{whenLabel}</span>
          <span class="chg">{$_('posteditor.change')}</span>
        </button>
      </div>

      {#if compatiblePlatforms.length > 1}
        <div class="fld">
          <span class="flbl">{$_('posteditor.crossPost')}</span>
          <div class="plat-chips">
            {#each compatiblePlatforms as p (p)}
              {@const pm = PLATFORMS[p]}
              {@const pi = ICONS[p]}
              <button type="button" class="plat-chip" class:on={ePlatforms.includes(p)} onclick={() => togglePlatform(p)}>
                <span class="cglyph" style={`background:${pm?.bg ?? '#999'}`}>
                  {#if pi}<svg viewBox="0 0 24 24" fill="#fff"><path d={pi.path} /></svg>{:else}{pm?.glyph ?? p.slice(0, 2)}{/if}
                </span>
                {pm?.label ?? p}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if graphicKind || graphicSource}
        <div class="fld graphic-src">
          <button type="button" class="graphic-toggle" onclick={() => (graphicOpen = !graphicOpen)}>
            <span class="flbl">{$_('posteditor.graphicSource.title')}</span>
            <span class="graphic-kind">{graphicKind === 'tsx' ? 'TSX' : 'HTML'}</span>
          </button>
          {#if graphicOpen}
            <p class="fld-hint left">{$_('posteditor.graphicSource.hint')}</p>
            <textarea
              class="ctrl ta graphic-code"
              spellcheck="false"
              bind:value={graphicSource}
              disabled={graphicBusy === 'save'}
            ></textarea>
            {#if graphicErr}<p class="err">{graphicErr}</p>{/if}
            <div class="graphic-actions">
              <button type="button" class="ctrl btn-fill" disabled={!!graphicBusy || !graphicSource.trim()} onclick={() => saveGraphicSource()}>
                {graphicBusy === 'save' ? $_('posteditor.graphicSource.saving') : $_('posteditor.graphicSource.save')}
              </button>
              <button type="button" class="ctrl btn-out" disabled={!!graphicBusy || !graphicSource.trim()} onclick={() => exportGraphic('png')}>
                {$_('posteditor.graphicSource.exportPng')}
              </button>
              <button type="button" class="ctrl btn-out" disabled={!!graphicBusy || !graphicSource.trim()} onclick={() => exportGraphic('jpeg')}>
                {$_('posteditor.graphicSource.exportJpg')}
              </button>
            </div>
          {/if}
        </div>
      {/if}

      {#if !studioOn}
      <div class="fld">
        <div class="regen-head">
          <span class="flbl">{$_('posteditor.feedbackLabel')}</span>
          <span class="rev-counter" class:out={revisionsLeft <= 0}>{$_('posteditor.revisionsCounter', { values: { left: revisionsLeft, max: MAX_REVISIONS } })}</span>
        </div>
        <div class="regen-box" class:disabled={regenerating || revisionsLeft <= 0}>
          {#if refImages.length || refPicks.length}
            <div class="ref-strip">
              {#each refImages as src, i (i)}
                <div class="ref-thumb" style={`background-image:url(${src})`}>
                  <button type="button" class="ref-del" onclick={() => removeRef(i)} aria-label={$_('posteditor.removeRef')}>×</button>
                </div>
              {/each}
              {#each refPicks as p, i (p.kind + p.id)}
                <div class="ref-thumb" style={`background-image:url(${p.url})`}>
                  <button type="button" class="ref-del" onclick={() => removePick(i)} aria-label={$_('posteditor.removeRef')}>×</button>
                </div>
              {/each}
            </div>
          {/if}
          <textarea bind:this={feedbackEl} bind:value={feedback} rows="1"
            placeholder={$_('posteditor.feedbackPlaceholder')}
            onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); regenerate(); } }}
            disabled={regenerating || revisionsLeft <= 0}></textarea>
          <div class="regen-bar">
            <button type="button" class="ref-add" onclick={() => refInputEl?.click()}
              disabled={regenerating || revisionsLeft <= 0 || refCount >= MAX_REF_IMAGES}
              title={$_('posteditor.addRef')} aria-label={$_('posteditor.addRef')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15l-5-5L5 21"/><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><circle cx="8.5" cy="8.5" r="1.5"/></svg>
            </button>
            <button type="button" class="ref-add" class:on={brandPicker} onclick={openBrandPicker}
              disabled={regenerating || revisionsLeft <= 0}
              title={$_('posteditor.addRefFromBrand')} aria-label={$_('posteditor.addRefFromBrand')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            </button>
            <input bind:this={refInputEl} type="file" accept={RASTER_IMAGE_ACCEPT} multiple hidden onchange={onPickRefs} />
            <button class="regen-send" type="button" onclick={regenerate} disabled={regenerating || !feedback.trim() || revisionsLeft <= 0} aria-label={$_('posteditor.regenerate')}>
              {#if regenerating}<span class="spinner sm"></span>{:else}↻{/if}
            </button>
          </div>
          {#if brandPicker}
            <div class="ref-picker">
              {#if mediaLoading}
                <div class="ref-empty">{$_('posteditor.loadingRefs')}</div>
              {:else if mediaRefs && (mediaRefs.brandImages.length || mediaRefs.postThumbs.length)}
                {#if mediaRefs.brandImages.length}
                  <div class="ref-grp-lbl">{$_('posteditor.brandImages')}</div>
                  <div class="ref-grid">
                    {#each mediaRefs.brandImages as bi (bi.id)}
                      <button type="button" class="ref-cell" class:on={isPicked('brand', bi.id)} style={`background-image:url(${bi.url})`}
                        onclick={() => togglePick('brand', bi.id, bi.url)} aria-label={$_('posteditor.pick')}></button>
                    {/each}
                  </div>
                {/if}
                {#if mediaRefs.postThumbs.length}
                  <div class="ref-grp-lbl">{$_('posteditor.yourPosts')}</div>
                  <div class="ref-grid">
                    {#each mediaRefs.postThumbs as pt (pt.id)}
                      <button type="button" class="ref-cell" class:on={isPicked('post', pt.id)} style={`background-image:url(${pt.url})`}
                        onclick={() => togglePick('post', pt.id, pt.url)} aria-label={$_('posteditor.pick')}></button>
                    {/each}
                  </div>
                {/if}
              {:else}
                <div class="ref-empty">{$_('posteditor.noBrandMedia')}</div>
              {/if}
            </div>
          {/if}
        </div>
        {#if regenError}
          <span class="regen-note err">{regenError}</span>
        {:else if revisionsLeft <= 0}
          <span class="regen-note err">{$_('posteditor.revisionLimit')}</span>
        {/if}
      </div>
      {/if}

      {#if saveError}<p class="err">{saveError}</p>{/if}

      <div class="editor-actions">
        {#if post.status === 'pending_user'}
          <form method="POST" action="?/updatePost" use:enhance={runAction('updatePost')}>
            <input type="hidden" name="id" value={post.id} /><input type="hidden" name="caption" value={eCaption} />
            <input type="hidden" name="slot" value={slotValue} /><input type="hidden" name="date" value={eDate} /><input type="hidden" name="time" value={eTime} />
            {@render versionFields()}
            <button class="ctrl btn-out" type="submit" disabled={!!submitting}>{@render spin('updatePost')}{$_('posteditor.saveDraft')}</button>
          </form>
          <form method="POST" action="?/approve" use:enhance={runAction('approve')}>
            <input type="hidden" name="id" value={post.id} /><input type="hidden" name="caption" value={eCaption} />
            <input type="hidden" name="slot" value={slotValue} /><input type="hidden" name="date" value={eDate} /><input type="hidden" name="time" value={eTime} />
            {@render versionFields()}
            <button class="ctrl btn-fill" type="submit" disabled={!!submitting || capViolations.length > 0} title={capViolations.length ? $_('posteditor.overLimit.hint') : ''}>{@render spin('approve')}{$_('posteditor.approveSchedule')}</button>
          </form>
          {@render publishNowForm()}
                    <form method="POST" action="?/reject" use:enhance={runAction('reject')}>
            <input type="hidden" name="id" value={post.id} />
            <button class="btn-link danger" type="submit" disabled={!!submitting}>{@render spin('reject')}{$_('posteditor.reject')}</button>
          </form>
        {:else}
          {#if post.published_url}
            <a class="ctrl live" href={post.published_url} target="_blank" rel="noopener">{$_('posteditor.viewLive')}</a>
          {/if}
          {#if post.status !== 'published'}
            <form method="POST" action="?/reschedule" use:enhance={runAction('reschedule')}>
              <input type="hidden" name="id" value={post.id} /><input type="hidden" name="caption" value={eCaption} />
              <input type="hidden" name="slot" value={slotValue} /><input type="hidden" name="date" value={eDate} /><input type="hidden" name="time" value={eTime} />
              {@render versionFields()}
              <button class="ctrl btn-fill" type="submit" disabled={!!submitting}>{@render spin('reschedule')}{$_('posteditor.updateReschedule')}</button>
            </form>
            {@render publishNowForm()}
            <form method="POST" action="?/cancelSchedule" use:enhance={runAction('cancelSchedule')}>
              <input type="hidden" name="id" value={post.id} />
              <button class="btn-link danger" type="submit" disabled={!!submitting}>{@render spin('cancelSchedule')}{$_('posteditor.cancelSchedule')}</button>
            </form>
          {/if}
                    <button type="button" class="btn-link" onclick={() => (showReport = !showReport)}>{$_('posteditor.somethingWrong')}</button>
        {/if}
      </div>

      {#if showReport && post.status !== 'pending_user'}
        <form method="POST" action="?/repost" use:enhance={repostEnhance} class="report-box">
          <input type="hidden" name="id" value={post.id} />
          <textarea class="ctrl ta" rows="2" name="note" placeholder={$_('posteditor.reportPlaceholder')} bind:value={reportNote} disabled={reposting}></textarea>
          <button class="ctrl btn-fill rep" type="submit" disabled={reposting}>
            {#if reposting}<span class="spinner sm"></span>{$_('posteditor.reposting')}{:else}{$_('posteditor.repostNow')}{/if}
          </button>
          <p class="hint">{$_('posteditor.repostHint')}</p>
        </form>
      {/if}
    </div>
    {/if}


    <nav class="lb-mobile-bar" aria-label={$_('posteditor.mobilePane.label')}>
      <button
        type="button"
        class="lb-mobile-tab"
        class:on={mobilePane === 'primary'}
        aria-pressed={mobilePane === 'primary'}
        onclick={() => setMobilePane('primary')}
      >
        <svg class="lb-mobile-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
        <span>{$_('posteditor.mobilePane.edit')}</span>
      </button>
      <button
        type="button"
        class="lb-mobile-tab"
        class:on={mobilePane === 'preview'}
        aria-pressed={mobilePane === 'preview'}
        onclick={() => setMobilePane('preview')}
      >
        <svg class="lb-mobile-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span>{$_('posteditor.mobilePane.preview')}</span>
      </button>
    </nav>
  </div>
</div>

{#if pickerOpen}
  <div class="lb-overlay deep" use:portal role="button" tabindex="-1" aria-label={$_('posteditor.close')}
    onclick={(e) => e.target === e.currentTarget && (pickerOpen = false)}
    onkeydown={(e) => e.key === 'Enter' && (pickerOpen = false)}>
    <div class="pick-card" role="dialog" aria-modal="true" tabindex="-1">
      <div class="pick-head">
        <button type="button" class="navbtn" onclick={() => shiftMonth(-1)} aria-label={$_('posteditor.prevMonth')}>‹</button>
        <div class="mlabel">{MON[pickM - 1]} {pickY}</div>
        <button type="button" class="navbtn" onclick={() => shiftMonth(1)} aria-label={$_('posteditor.nextMonth')}>›</button>
      </div>
      <div class="pick-grid head">{#each WEEKDAYS as w (w)}<span class="dh">{w}</span>{/each}</div>
      <div class="pick-grid">
        {#each pickGrid as c (c.key)}
          <button type="button" class="pcell" class:out={!c.inMonth} class:today={c.isToday}
            class:sel={c.key === pickDate} class:past={c.past} disabled={c.past}
            onclick={() => selectDay(c.key, c.past)}>
            <span class="pn">{c.dayNum}</span>
            {#if c.busy}<span class="bdot" title={$_('posteditor.scheduledCount', { values: { count: c.busy } })}></span>{/if}
          </button>
        {/each}
      </div>
      <div class="pick-foot">
        <label class="fld time">
          <span class="flbl">{$_('posteditor.timeLabel', { values: { zone: tz.split('/').pop() } })}</span>
          <input class="ctrl" type="time" bind:value={pickTime} min={pickDate === todayKey ? (todayMinTime ?? undefined) : undefined} />
        </label>
        <button class="ctrl btn-fill" type="button" onclick={confirmPick}
          disabled={!pickDate || pickDate < todayKey || pickTodayBlocked || (pickDate === todayKey && todayMinTime !== null && pickTime < todayMinTime)}>
          {$_('posteditor.set', { values: { when: pickDate ? dateLabel(pickDate, pickTime) : '' } })}
        </button>
      </div>
      <p class="hint">{$_('posteditor.pickerHint')}</p>
    </div>
  </div>
{/if}

<style>
  .prod-tag { font-size: 11px; font-weight: 600; color: var(--ink-soft); background: var(--paper-2);
    border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; max-width: 180px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attn-flag {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--ink, #1d1d1f);
    background: #fbf6e4;
    border: 1px solid #ead89a;
    border-radius: 12px;
    padding: 9px 12px;
  }
  .pglyph { width: 18px; height: 18px; border-radius: 5px; color: #fff; font-size: 9px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  form { margin: 0; }
  .err { color: #c0392b; font-size: 13px; margin: 0; }
  .review-note { color: var(--accent); font-size: 13px; margin: 0; }

  /* shared overlay + card */
  .lb-embed-root { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
  .lb-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
    padding: 24px; background: rgba(18, 26, 22, 0.5); backdrop-filter: blur(5px); animation: fade 0.2s ease; }
  .lb-overlay.deep { z-index: 70; background: rgba(18, 26, 22, 0.55); }
  .lb-card { position: relative; width: min(1500px, 96vw); height: 94vh; max-height: 94vh; overflow: hidden; display: grid;
    grid-template-columns: 1.1fr 1fr; background: var(--paper, #fff); border-radius: 22px; box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.5); }
  .lb-card.embedded {
    width: 100%; height: 100%; max-height: none; min-height: min(720px, calc(100vh - 160px));
    border-radius: 16px; box-shadow: none; border: 1px solid var(--line, #e3e3e6);
    flex: 1 1 auto;
  }
  .lb-card.embedded.edit-focus { grid-template-columns: 1.05fr 1fr; }
  .lb-close { position: absolute; top: 12px; right: 14px; z-index: 2; width: 32px; height: 32px; border-radius: 50%;
    border: none; cursor: pointer; background: rgba(0, 0, 0, 0.4); color: #fff; font-size: 20px; line-height: 1; }
  /* Show the post image at its TRUE aspect ratio (no cover-crop): contain renders portrait 4:5 /
     9:16 and landscape 16:9 uncropped, letterboxed within the dialog's image area. */
  .lb-img { position: relative; flex: 1 1 auto; background-color: var(--paper-2, #f5f5f7); background-size: contain; background-repeat: no-repeat; background-position: center;
    min-height: 360px; display: flex; align-items: center; justify-content: center; }
  .lb-img .ph { font-size: 12px; color: var(--ink-faint, #86868b); font-weight: 600; }
  .lb-video { width: 100%; max-height: 70vh; display: block; background: #000; }
  /* Carousel: slide counter (top-left) + filmstrip pinned to the bottom of the image area. */
  .slide-count { position: absolute; top: 12px; left: 14px; z-index: 2; font-family: var(--mono, monospace);
    font-size: 12px; font-weight: 600; color: #fff; background: rgba(0, 0, 0, 0.55); padding: 3px 9px; border-radius: 999px; }
  .lb-slides { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; display: flex; gap: 8px; overflow-x: auto;
    padding: 12px; background: linear-gradient(to top, rgba(0, 0, 0, 0.45), transparent); }
  .lb-slide { flex: 0 0 auto; width: 52px; height: 52px; border-radius: 8px; cursor: pointer; padding: 0;
    background-size: cover; background-position: center; border: 2px solid rgba(255, 255, 255, 0.6); position: relative; opacity: 0.75; }
  .lb-slide.on { border-color: #fff; opacity: 1; box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.3); }
  .lb-slide-n { position: absolute; top: 2px; left: 4px; font-size: 10px; font-weight: 700; color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8); }
  .regen-veil { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    background: rgba(255, 255, 255, 0.78); backdrop-filter: blur(2px); font-size: 13px; font-weight: 600; color: var(--ink-soft); }
  .lb-body { padding: 22px 22px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
  .lb-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lb-meta .picon { width: 18px; height: 18px; flex: 0 0 auto; }
  .pplat { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; }
  .fld { display: flex; flex-direction: column; gap: 6px; }
  .flbl { font-size: 12px; font-weight: 600; color: var(--ink-soft); }
  .fld-hint { font-size: 11px; color: var(--ink-faint); text-align: right; margin-top: -2px; }
  .fld-hint.left { text-align: left; }
  .graphic-toggle {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    background: none; border: none; padding: 0; cursor: pointer; font: inherit; text-align: left;
  }
  .graphic-kind {
    font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-faint);
    border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px;
  }
  textarea.ctrl.ta.graphic-code {
    min-height: 220px; font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 12px; line-height: 1.45;
  }
  .graphic-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .reddit-row { display: flex; gap: 10px; }
  .reddit-row .flex-1 { flex: 1; }
  .reddit-row .flex-2 { flex: 2; }
  .subreddit-input { display: flex; align-items: center; }
  .subreddit-prefix { font-size: 13.5px; color: var(--ink-soft); padding-right: 0; margin-right: -1px;
    height: 40px; display: flex; align-items: center; font-weight: 600; }
  .subreddit-input .ctrl { border-top-left-radius: 0; border-bottom-left-radius: 0; flex: 1; }

  .yt-thumb-preview {
    position: relative; aspect-ratio: 16/9; width: 100%; border-radius: 10px;
    background: var(--paper-2, #f5f5f7) center/cover no-repeat;
    border: 1px solid var(--line-2, #d2d2d7); overflow: hidden;
    min-height: 96px; display: flex; align-items: center; justify-content: center;
  }
  .yt-thumb-preview.empty span { font-size: 12.5px; color: var(--ink-faint, #86868b); }
  .yt-thumb-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .yt-file { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; margin: 0; }
  .yt-file input { display: none; }

  .ctrl { height: 40px; font: inherit; font-size: 13.5px; padding: 0 12px; border: 1px solid var(--line-2, #d2d2d7);
    border-radius: 10px; outline: none; background: var(--paper, #fff); color: var(--ink); box-sizing: border-box; }
  .ctrl:focus { border-color: var(--accent); }
  textarea.ctrl.ta { height: auto; min-height: 92px; padding: 10px 12px; line-height: 1.45; resize: vertical; }
  textarea.ctrl.ta.over { border-color: #dc2626; }
  .cap-over { color: #b91c1c; font-size: 12px; font-weight: 600; }
  .cap-count { float: right; font-weight: 500; color: var(--ink-faint); }
  .cap-count.over { color: #b91c1c; font-weight: 600; }
  .when { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; text-align: left; font-weight: 600; }
  .when:hover { border-color: var(--ink-faint); }
  .when .chg { font-size: 12px; font-weight: 600; color: var(--accent); }
  /* Chat-style regeneration composer */
  .regen-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .lb-mobile-bar { display: none; }
  @media (max-width: 900px) {
    /* Dual-pane → single scrollable pane; floating bottom bar switches views. */
    .lb-card,
    .lb-card.embedded.edit-focus {
      display: flex;
      flex-direction: column;
      grid-template-columns: none;
      grid-template-rows: none;
      width: 100%;
      height: auto;
      max-height: none;
      min-height: 0;
      overflow: visible;
    }
    .lb-card.embedded {
      min-height: 0;
      height: auto;
      max-height: none;
      border-radius: 14px;
    }
    .lb-overlay {
      align-items: stretch;
      padding: 0;
    }
    .lb-overlay .lb-card {
      width: 100%;
      max-width: none;
      height: auto;
      max-height: none;
      min-height: 100dvh;
      border-radius: 0;
    }

    .lb-img,
    .lb-body {
      position: relative;
      flex: 0 0 auto;
      width: 100%;
      height: auto;
      max-height: none;
      min-height: 0;
      overflow: visible;
    }
    .lb-img {
      min-height: min(72vw, 420px);
      border-bottom: none;
      border-radius: 12px;
    }
    .lb-body {
      padding: 16px 14px 20px;
    }
    /* Settings first; preview second — hide the inactive pane. */
    .lb-card.mobile-primary .lb-img { display: none; }
    .lb-card.mobile-preview .lb-body { display: none; }
    .lb-card.mobile-preview .lb-img { display: flex; }

    /* Leave room for the floating bottom bar so content isn't covered. */
    .lb-card.embedded,
    .lb-overlay .lb-card {
      padding-bottom: calc(84px + env(safe-area-inset-bottom, 0px));
    }

    .lb-mobile-bar {
      display: flex;
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(12px + env(safe-area-inset-bottom, 0px));
      z-index: 50;
      flex: 0 0 auto;
      align-items: stretch;
      gap: 4px;
      padding: 6px;
      border: 1px solid var(--line, #e3e3e6);
      border-radius: 18px;
      background: color-mix(in srgb, var(--paper, #fff) 92%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 10px 32px -12px rgba(0, 0, 0, 0.28);
    }
    .lb-mobile-tab {
      flex: 1 1 0;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      min-height: 48px;
      padding: 6px 8px;
      border: none;
      border-radius: 14px;
      background: transparent;
      color: var(--ink-soft, #6e6e73);
      font: inherit;
      font-size: 11px;
      font-weight: 650;
      cursor: pointer;
    }
    .lb-mobile-tab.on {
      background: var(--paper-2, #f5f5f7);
      color: var(--ink, #1d1d1f);
    }
    .lb-mobile-ico { width: 20px; height: 20px; flex: 0 0 auto; }
  }
  .rev-counter { font-size: 11px; font-weight: 600; color: var(--ink-faint); background: var(--paper-2);
    border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
  .rev-counter.out { color: #c0392b; border-color: #e6b7ae; }
  .regen-box { border: 1px solid var(--line-2, #d2d2d7); border-radius: 16px; padding: 10px 12px 8px;
    background: var(--paper); transition: border-color 0.15s ease; }
  .regen-box:focus-within { border-color: var(--accent); }
  .regen-box.disabled { opacity: 0.6; }
  .regen-box textarea { width: 100%; border: none; outline: none; resize: none; background: none; font: inherit;
    font-size: 13.5px; line-height: 1.45; color: var(--ink); min-height: 24px; max-height: 160px; box-sizing: border-box; }
  .regen-box textarea::placeholder { color: var(--ink-faint); }
  .ref-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .ref-thumb { position: relative; width: 52px; height: 52px; border-radius: 9px; border: 1px solid var(--line);
    background-color: var(--paper-2); background-size: cover; background-position: center; }
  .ref-del { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 999px;
    border: 1px solid var(--line); background: var(--paper); color: var(--ink); font-size: 12px; line-height: 1;
    cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
  .regen-bar { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
  .ref-add { margin-right: auto; width: 32px; height: 32px; border-radius: 8px; border: 1px solid transparent;
    background: none; color: var(--ink-soft); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
  .ref-add:hover:not(:disabled) { background: var(--paper-2); color: var(--ink); }
  .ref-add.on { background: var(--paper-2); color: var(--accent); }
  .ref-add:disabled { opacity: 0.4; cursor: default; }
  .ref-add svg { width: 18px; height: 18px; }
  .ref-add + .ref-add { margin-right: 0; }
  .ref-picker { margin-top: 10px; border-top: 1px solid var(--line); padding-top: 10px; max-height: 240px; overflow-y: auto; }
  .ref-grp-lbl { font-size: 11px; font-weight: 600; color: var(--ink-faint); margin: 6px 0 6px; text-transform: uppercase; letter-spacing: 0.03em; }
  .ref-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
  .ref-cell { width: 56px; height: 56px; border-radius: 9px; border: 2px solid transparent; padding: 0; cursor: pointer;
    background-color: var(--paper-2); background-size: cover; background-position: center; }
  .ref-cell:hover { border-color: var(--line-2, #d2d2d7); }
  .ref-cell.on { border-color: var(--accent); }
  .ref-empty { font-size: 12px; color: var(--ink-faint); padding: 8px 2px; }
  .regen-send { width: 34px; height: 34px; border: none; border-radius: 50%; background: var(--accent); color: #fff;
    display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: 0 0 auto; font-size: 16px;
    transition: opacity 0.15s, transform 0.15s; }
  .regen-send:disabled { opacity: 0.4; cursor: default; }
  .regen-send:not(:disabled):hover { transform: scale(1.05); }
  .regen-note { font-size: 12px; color: var(--ink-faint); margin-top: 4px; }
  .regen-note.err { color: #c0392b; }
  .ver-nav { display: inline-flex; align-items: center; align-self: stretch; gap: 6px;
    background: var(--paper-2); border: 1px solid var(--line); border-radius: 999px; padding: 3px 6px; }
  .ver-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; padding: 0 2px; }
  .ver-label { font-size: 12px; font-weight: 600; color: var(--ink-soft); text-align: center; }
  .ver-feedback { font-size: 11px; color: var(--ink-faint); white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; max-width: 180px; font-style: italic; }
  .ver-arrow { width: 24px; height: 24px; border-radius: 50%; border: none; background: var(--paper); color: var(--ink);
    cursor: pointer; font-size: 15px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0; }
  .ver-arrow:hover:not(:disabled) { background: var(--accent); color: #fff; }
  .ver-arrow:disabled { opacity: 0.4; cursor: default; }
  .plat-chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .plat-chip { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 12.5px; font-weight: 600;
    color: var(--ink-soft); background: var(--paper); border: 1px solid var(--line-2); border-radius: 999px;
    padding: 5px 11px 5px 6px; cursor: pointer; }
  .plat-chip:hover { border-color: var(--ink-faint); }
  .plat-chip.on { color: var(--accent); border-color: var(--accent); background: rgba(var(--accent-rgb), 0.06); }
  .cglyph { width: 18px; height: 18px; border-radius: 5px; color: #fff; font-size: 9px; font-weight: 700;
    display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .cglyph svg { width: 12px; height: 12px; }
  .btn-out { cursor: pointer; font-weight: 600; color: var(--ink-soft); white-space: nowrap; }
  .btn-out:hover:not(:disabled) { background: var(--paper-2); color: var(--ink); }
  .btn-fill { cursor: pointer; font-weight: 600; background: var(--accent); border-color: var(--accent); color: #fff; white-space: nowrap; }
  .btn-fill:hover:not(:disabled) { filter: brightness(1.05); }
  .ctrl:disabled, .btn-fill:disabled, .btn-out:disabled { opacity: 0.55; cursor: default; }
  .editor-actions { display: flex; align-items: center; gap: 10px; margin-top: 2px; flex-wrap: wrap; }
  .live { display: inline-flex; align-items: center; text-decoration: none; font-weight: 600; color: var(--accent); border-color: var(--accent); }
  .live:hover { background: rgba(var(--accent-rgb), 0.06); }
  .report-box { display: flex; flex-direction: column; gap: 8px; margin-top: 2px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper-2); }
  .btn-link { background: none; border: none; color: var(--ink-soft); font-size: 13.5px; font-weight: 500; cursor: pointer; text-decoration: underline; padding: 0 4px; }
  .btn-link.danger { color: #c0392b; }
  .hint { font-size: 12px; color: var(--ink-faint); margin: 0; }
  .spinner { width: 24px; height: 24px; border-radius: 50%; border: 3px solid rgba(var(--accent-rgb), 0.25); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
  .spinner.sm { width: 15px; height: 15px; border-width: 2px; border-color: rgba(255, 255, 255, 0.45); border-top-color: #fff; }
  /* Action buttons align their in-flight spinner beside the label; light buttons need a tinted
     spinner (the default white one is invisible on them). */
  .editor-actions .ctrl, .editor-actions .btn-link { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
  .btn-out .spinner.sm, .btn-link .spinner.sm { border-color: rgba(var(--accent-rgb), 0.3); border-top-color: var(--accent); }
  .btn-link.danger .spinner.sm { border-color: rgba(192, 57, 43, 0.3); border-top-color: #c0392b; }
  .rep { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }

  /* date picker */
  .pick-card { width: min(380px, 94vw); background: var(--paper, #fff); border-radius: 20px; padding: 18px; box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.5); }
  .pick-head { display: flex; align-items: center; gap: 10px; justify-content: center; margin-bottom: 12px; }
  .pick-head .mlabel { font-size: 15px; font-weight: 600; min-width: 9.5ch; text-align: center; }
  .navbtn { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: var(--paper); cursor: pointer; font-size: 17px; line-height: 1; color: var(--ink); }
  .navbtn:hover { background: var(--paper-2); }
  .pick-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
  .pick-grid.head { margin-bottom: 4px; }
  .pick-grid.head .dh { text-align: center; font-size: 10.5px; font-weight: 700; color: var(--ink-faint); padding: 2px 0; }
  .pcell { position: relative; aspect-ratio: 1; border: none; background: none; border-radius: 9px; cursor: pointer; font: inherit;
    display: flex; align-items: center; justify-content: center; color: var(--ink); }
  .pcell .pn { font-size: 13px; font-weight: 500; }
  .pcell:hover:not(:disabled) { background: var(--paper-2); }
  .pcell.out .pn { color: var(--ink-faint); opacity: 0.5; }
  .pcell.past { color: var(--ink-faint); opacity: 0.4; cursor: default; }
  .pcell.today { box-shadow: inset 0 0 0 1.5px var(--accent); }
  .pcell.sel { background: var(--accent); }
  .pcell.sel .pn { color: #fff; }
  .bdot { position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%); width: 4px; height: 4px; border-radius: 50%; background: var(--accent); }
  .pcell.sel .bdot { background: #fff; }
  .pick-foot { display: flex; align-items: flex-end; gap: 10px; margin-top: 14px; }
  .pick-foot .fld.time { flex: 0 0 auto; width: 130px; }
  .pick-foot .btn-fill { flex: 1; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
</style>
