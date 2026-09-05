/**
 * Last-mile ship gate for scheduled social posts.
 *
 * Zernio already holds the copy. A few minutes before `scheduled_for`, Gemini Flash
 * (plus cheap deterministic checks) must OK the release. Broken / empty / placeholder
 * posts are pulled back to pending_user so they never go live.
 *
 * Fail-closed on a real defect. Fail-open when Gemini/infra is down and the slot is imminent
 * — a total publish outage is worse than a rare miss. Overlapping ticks are serialized by
 * claiming `prepublish_checked_at` before the model call.
 */
import { needMarkers } from '$lib/server/proof-discipline';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { isImageUrl, isVideoUrl } from '$lib/content-formats';
import { withBrandContext } from '$lib/server/ai-log';
import { isUrlSafe } from '$lib/server/brand-analysis';
import { llmConfigured, llmImagesFromInline, llmStructured } from '$lib/server/llm';
import {
  prepublishHeldEmailHtml,
  prepublishHeldEmailSubject,
  prepublishHeldEmailText
} from '$lib/server/email';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_GEMINI_IMAGES = 4;
const STALE_CLAIM_MS = 8 * 60 * 1000;

/** How far ahead of `scheduled_for` the cron starts judging. The cron runs every 5 minutes. */
export const PREPUBLISH_LEAD_MS = 18 * 60 * 1000;
/** Per-tick cap so one invocation stays under Vercel maxDuration. */
export const PREPUBLISH_BATCH = 12;
const GEMINI_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']);

export type PrepublishPost = {
  id: string;
  brand_id: string;
  platform: string | null;
  platforms?: string[] | null;
  caption: string | null;
  platform_captions?: Record<string, string> | null;
  media_url: string | null;
  media_urls?: string[] | null;
  content_type?: string | null;
  title?: string | null;
  link_url?: string | null;
  video_thumbnail_url?: string | null;
  youtube_thumbnail_url?: string | null;
  scheduled_for?: string | null;
  prepublish_ok?: boolean | null;
  prepublish_checked_at?: string | null;
  status?: string | null;
};

export type PrepublishDecision = 'pass' | 'hold' | 'skip';

export type PrepublishVerdict = {
  decision: PrepublishDecision;
  reason: string;
  reasons: string[];
};

type ImagePart = { inlineData: { mimeType: string; data: string } };

export type MediaProbe =
  | { ok: true; kind: 'image'; part: ImagePart }
  | { ok: true; kind: 'video' }
  | { ok: true; kind: 'other' }
  | { ok: false; reason: string };

export type PrepublishJudge = (input: {
  caption: string;
  contentType: string;
  imageParts: ImagePart[];
  mediaNotes: string[];
}) => Promise<{ ok: boolean; reasons: string[] } | { error: string }>;

export type PrepublishDeps = {
  probeMedia?: (url: string) => Promise<MediaProbe>;
  judge?: PrepublishJudge;
};

const PLACEHOLDER_RE =
  /^(lorem ipsum\b|placeholder\b|your caption here|insert caption|inserisci (la )?caption|todo\b|tbd\b|n\/?a\b|test(ing)?(\s+test)*\s*$|asdf+|xxx+|\[caption\]|\{\{.*\}\}|<.*>$)/i;

const VERDICT_SCHEMA = {
  type: 'object' as const,
  properties: {
    ok: {
      type: 'boolean' as const,
      description: 'True only if this is a finished post that may go live. False if it is broken, empty, or unfinished.'
    },
    reasons: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Short English reasons. Empty when ok is true.'
    }
  },
  required: ['ok', 'reasons']
};

export function shouldGatePrepublish(
  scheduledFor: string | undefined,
  opts: { now?: boolean; nowMs?: number } = {}
): boolean {
  if (opts.now) return true;
  if (!scheduledFor) return true;
  const t = new Date(scheduledFor).getTime();
  if (!Number.isFinite(t)) return true;
  return t - (opts.nowMs ?? Date.now()) <= PREPUBLISH_LEAD_MS;
}

export function requiresVisualMedia(contentType: string | null | undefined): boolean {
  const t = String(contentType ?? '').toLowerCase();
  return t !== 'text' && t !== 'link';
}

export function mediaUrlsForCheck(post: PrepublishPost): string[] {
  const slides = Array.isArray(post.media_urls)
    ? post.media_urls.map((u) => String(u ?? '').trim()).filter(Boolean)
    : [];
  if (slides.length) return Array.from(new Set(slides));
  const single = String(post.media_url ?? '').trim();
  return single ? [single] : [];
}

function targetsOf(post: PrepublishPost): string[] {
  const list = post.platforms?.length ? post.platforms : [post.platform];
  return (list ?? []).map((p) => String(p ?? '').toLowerCase()).filter(Boolean);
}

/** Lorem ipsum, "TODO", a caption made of hashtags only: text that exists and says nothing. */
export function isPlaceholderCaption(caption: string): boolean {
  const t = caption.replace(/\s+/g, ' ').trim();
  if (t.length < 2) return true;
  if (PLACEHOLDER_RE.test(t)) return true;
  // Caption that is only hashtags / mentions, no words.
  if (/^(?:[#@]\S+\s*)+$/.test(t)) return true;
  return false;
}

/** Pure, no I/O — empty caption, missing media, placeholder copy, Reddit without a title. */
export function deterministicPrepublishIssues(post: PrepublishPost): string[] {
  const issues: string[] = [];
  const caption = String(post.caption ?? '').trim();
  const type = String(post.content_type ?? '').toLowerCase();
  const targets = targetsOf(post);

  if (!caption || isPlaceholderCaption(caption)) {
    issues.push(caption ? 'Caption is a placeholder or has no real text' : 'Caption is empty');
  }

  if (type === 'link' && !String(post.link_url ?? '').trim()) {
    issues.push('Link post is missing a URL');
  }

  if (targets.includes('reddit') && !String(post.title ?? '').trim()) {
    issues.push('Reddit post is missing a title');
  }

  if (targets.includes('youtube')) {
    const urls = mediaUrlsForCheck(post);
    if (!urls.some((u) => isVideoUrl(u))) {
      issues.push('YouTube requires a video file');
    }
  }

  if (requiresVisualMedia(post.content_type)) {
    const urls = mediaUrlsForCheck(post);
    if (!urls.length) issues.push('Visual post has no media');
    else if (type === 'carousel' && urls.length < 2) {
      issues.push('Carousel has fewer than 2 slides');
    }
  }

  // A [NEED: …] marker is the generator being honest about a number it was never given. That is the
  // correct behaviour in a draft and an unacceptable one in a feed, so it is a HARD stop here — and
  // the fix is to supply the fact, never to delete the marker, which would turn an honest gap back
  // into an unsupported claim. See `proof-discipline.ts`.
  const needs = needMarkers(caption);
  if (needs.length) {
    issues.push(`Caption still needs real proof the generator did not have: ${needs.slice(0, 3).join('; ')}`);
  }

  return issues;
}

export async function probeMediaUrl(url: string): Promise<MediaProbe> {
  if (!url) return { ok: false, reason: 'Media URL is empty' };
  if (!isUrlSafe(url)) return { ok: false, reason: 'Media URL is not a public http(s) address' };
  try {
    const video = isVideoUrl(url);
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
      headers: video ? { Range: 'bytes=0-2047' } : undefined
    });
    if (!res.ok && res.status !== 206) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return { ok: false, reason: `Media URL returned HTTP ${res.status}` };
    }
    let mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (!mime || mime === 'application/octet-stream') {
      if (isVideoUrl(url)) mime = 'video/mp4';
      else if (isImageUrl(url)) mime = 'image/jpeg';
    }
    if (video || mime.startsWith('video/')) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return { ok: true, kind: 'video' };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, reason: 'Media file is empty' };
    if (buf.length > MAX_IMAGE_BYTES) return { ok: true, kind: 'other' };
    if (!GEMINI_IMAGE_MIME.has(mime)) {
      // Unknown still that we can't show Gemini — reachable is enough for the deterministic gate.
      return { ok: true, kind: 'other' };
    }
    return { ok: true, kind: 'image', part: { inlineData: { mimeType: mime, data: buf.toString('base64') } } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `Media URL unreachable (${msg.slice(0, 120)})` };
  }
}

async function geminiJudge(input: {
  caption: string;
  contentType: string;
  imageParts: ImagePart[];
  mediaNotes: string[];
}): Promise<{ ok: boolean; reasons: string[] } | { error: string }> {
  if (!llmConfigured()) return { error: 'gemini_unconfigured' };
  const notes = input.mediaNotes.length ? `\nMEDIA NOTES:\n- ${input.mediaNotes.join('\n- ')}` : '';
  const prompt = `You are the LAST-MILE ship gate for a social post that is about to go live.
Approve unless the post is BROKEN and must not be published.

Reject ONLY for defects like:
- blank, solid-color, or missing visual (when this post is supposed to have one)
- garbled / unreadable / corrupted overlay text
- obvious generation failure (error screen, "image not available", empty template, lorem ipsum on the image)
- placeholder or empty caption
- carousel slide that is blank or clearly unfinished

Approve:
- any finished post, even if the copy is mediocre or the design is not your taste
- user-uploaded photos, stylized or artistic images, dense carousels
- text or link posts with no image (that is valid — judge caption/URL only)
- videos whose file is reachable even if you only see a thumbnail or no still

content_type: ${input.contentType || 'unknown'}
CAPTION:
${input.caption || '(empty)'}
${notes}

Return JSON { "ok": boolean, "reasons": string[] }. reasons empty when ok is true. English, one line each.`;

  try {
    const parsed = await llmStructured<{ ok?: boolean; reasons?: string[] }>({
      prompt,
      schema: VERDICT_SCHEMA,
      images: llmImagesFromInline(input.imageParts),
      label: 'prepublish.check'
    });
    if (typeof parsed?.ok !== 'boolean') return { error: 'model_parse_failed' };
    return {
      ok: parsed.ok,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : []
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[prepublish] gemini failed: ${msg}`);
    return { error: 'model_failed' };
  }
}

function holdVerdict(reasons: string[]): PrepublishVerdict {
  const unique = Array.from(new Set(reasons.map((r) => r.trim()).filter(Boolean)));
  const reason = unique[0] || 'Post looks broken or empty';
  return { decision: 'hold', reason, reasons: unique };
}

/**
 * Inspect a post that is about to go live. Does not write to the database.
 * `skip` = infra miss (caller fail-opens). `hold` = do not publish.
 */
export async function inspectPostForRelease(
  post: PrepublishPost,
  deps: PrepublishDeps = {}
): Promise<PrepublishVerdict> {
  const hard = deterministicPrepublishIssues(post);
  if (hard.length) return holdVerdict(hard);

  const probe = deps.probeMedia ?? probeMediaUrl;
  const urls = mediaUrlsForCheck(post);
  const imageParts: ImagePart[] = [];
  const mediaNotes: string[] = [];
  let videoOk = false;

  for (const url of urls) {
    const result = await probe(url);
    if (!result.ok) return holdVerdict([result.reason]);
    if (result.kind === 'video') {
      videoOk = true;
      mediaNotes.push('video file reachable');
    } else if (result.kind === 'image') {
      if (imageParts.length < MAX_GEMINI_IMAGES) imageParts.push(result.part);
    } else {
      mediaNotes.push('media reachable but not inlined for vision');
    }
  }

  if (post.video_thumbnail_url && (videoOk || isVideoUrl(post.media_url))) {
    const thumb = await probe(post.video_thumbnail_url);
    if (thumb.ok && thumb.kind === 'image' && imageParts.length < MAX_GEMINI_IMAGES) {
      imageParts.push(thumb.part);
      mediaNotes.push('video thumbnail attached');
    }
  }

  if (post.youtube_thumbnail_url) {
    const yt = await probe(post.youtube_thumbnail_url);
    if (!yt.ok) return holdVerdict([`YouTube thumbnail: ${yt.reason}`]);
    if (yt.kind === 'image' && imageParts.length < MAX_GEMINI_IMAGES) {
      imageParts.push(yt.part);
      mediaNotes.push('YouTube custom thumbnail attached');
    }
  }

  const judge = deps.judge ?? geminiJudge;
  const judged = await judge({
    caption: String(post.caption ?? ''),
    contentType: String(post.content_type ?? ''),
    imageParts,
    mediaNotes
  });
  if ('error' in judged) {
    console.warn(`[prepublish] skip (infra): ${judged.error} post=${post.id}`);
    return { decision: 'skip', reason: judged.error, reasons: [] };
  }
  if (!judged.ok) return holdVerdict(judged.reasons.length ? judged.reasons : ['Model rejected the post as broken']);
  return { decision: 'pass', reason: 'ok', reasons: [] };
}

export async function markPrepublishPass(supabase: SupabaseClient, postId: string): Promise<void> {
  await supabase
    .from('posts')
    .update({
      prepublish_ok: true,
      prepublish_checked_at: new Date().toISOString()
    })
    .eq('id', postId);
}

export async function holdBrokenScheduledPost(
  supabase: SupabaseClient,
  post: PrepublishPost,
  reason: string
): Promise<void> {
  const { requireZernioCancellation } = await import('$lib/server/post-editing');
  await requireZernioCancellation(supabase, post.id);
  const attention = `Pre-publish hold: ${reason}`.slice(0, 500);
  await supabase
    .from('posts')
    .update({
      status: 'pending_user',
      needs_attention: true,
      attention_reason: attention,
      prepublish_ok: false,
      prepublish_checked_at: new Date().toISOString(),
      external_post_id: null
    })
    .eq('id', post.id);
}

type HeldItem = { post: PrepublishPost; reason: string };

async function notifyHeld(
  supabase: SupabaseClient,
  items: HeldItem[]
): Promise<void> {
  if (!items.length) return;
  const byBrand = new Map<string, HeldItem[]>();
  for (const it of items) {
    const list = byBrand.get(it.post.brand_id) ?? [];
    list.push(it);
    byBrand.set(it.post.brand_id, list);
  }
  const appBase = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');

  for (const [brandId, held] of byBrand) {
    const { data: brand } = await supabase
      .from('brands')
      .select('id, org_id, name, slug')
      .eq('id', brandId)
      .maybeSingle();
    if (!brand?.org_id || !brand.slug) continue;
    const { brandContacts } = await import('$lib/server/scheduler');
    const { notifyBrandContacts } = await import('$lib/server/brand-notify');
    const contacts = await brandContacts(supabase, brand.org_id, brand.id);
    if (!contacts.length) continue;
    const url = `${appBase}/app/${brand.slug}/content`;
    await notifyBrandContacts(supabase, contacts, {
      logPrefix: '[prepublish]',
      buildEmail: (locale, to) => ({
        to,
        subject: prepublishHeldEmailSubject(locale, brand.name, held.length),
        html: prepublishHeldEmailHtml(
          locale,
          { name: brand.name, slug: brand.slug },
          held.map((h) => ({
            platform: h.post.platform,
            caption: h.post.caption,
            media_url: h.post.media_url,
            reason: h.reason
          })),
          url
        ),
        text: prepublishHeldEmailText(
          locale,
          { name: brand.name, slug: brand.slug },
          held.map((h) => ({ platform: h.post.platform, caption: h.post.caption, reason: h.reason })),
          url
        )
      }),
      push: {
        url,
        tag: `prepublish-hold-${brand.id}`,
        body: (locale) => prepublishHeldEmailSubject(locale, brand.name, held.length)
      }
    }).catch((e) => console.error('[prepublish] notify failed:', e instanceof Error ? e.message : e));
  }
}

function inFlight(post: PrepublishPost, nowMs: number): boolean {
  if (post.prepublish_ok === true) return true;
  if (!post.prepublish_checked_at || post.prepublish_ok === false) return false;
  const t = new Date(post.prepublish_checked_at).getTime();
  return Number.isFinite(t) && nowMs - t < STALE_CLAIM_MS;
}

async function claimPost(supabase: SupabaseClient, postId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('posts')
    .update({ prepublish_checked_at: now })
    .eq('id', postId)
    .eq('status', 'scheduled')
    .is('prepublish_ok', null)
    .select('id')
    .maybeSingle();
  if (error) {
    console.warn('[prepublish] claim failed:', error.message);
    return false;
  }
  return !!data?.id;
}

export type PrepublishTickResult = {
  checked: number;
  passed: number;
  held: number;
  skipped: number;
};

/**
 * Cron entry: scheduled posts whose slot is inside the lead window, not yet OK'd.
 */
export async function runPrepublishTick(
  supabase: SupabaseClient,
  opts: { nowMs?: number; limit?: number; brandId?: string; deps?: PrepublishDeps } = {}
): Promise<PrepublishTickResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const leadIso = new Date(nowMs + PREPUBLISH_LEAD_MS).toISOString();
  let q = supabase
    .from('posts')
    .select(
      'id, brand_id, platform, platforms, caption, platform_captions, media_url, media_urls, content_type, title, link_url, video_thumbnail_url, youtube_thumbnail_url, scheduled_for, prepublish_ok, prepublish_checked_at, status'
    )
    .eq('status', 'scheduled')
    .not('scheduled_for', 'is', null)
    .gte('scheduled_for', nowIso)
    .lte('scheduled_for', leadIso)
    .or('prepublish_ok.is.null,prepublish_ok.eq.false')
    .order('scheduled_for', { ascending: true })
    .limit(opts.limit ?? PREPUBLISH_BATCH);
  if (opts.brandId) q = q.eq('brand_id', opts.brandId);

  const { data, error } = await q;
  if (error) {
    console.error('[prepublish] load failed:', error.message);
    return { checked: 0, passed: 0, held: 0, skipped: 0 };
  }

  const result: PrepublishTickResult = { checked: 0, passed: 0, held: 0, skipped: 0 };
  const held: HeldItem[] = [];

  for (const row of (data ?? []) as PrepublishPost[]) {
    if (inFlight(row, nowMs)) {
      result.skipped++;
      continue;
    }
    const claimed = row.prepublish_ok === false ? true : await claimPost(supabase, row.id);
    if (!claimed) {
      result.skipped++;
      continue;
    }
    result.checked++;
    const verdict = await withBrandContext(row.brand_id, () => inspectPostForRelease(row, opts.deps));
    if (verdict.decision === 'hold') {
      try {
        await holdBrokenScheduledPost(supabase, row, verdict.reason);
        held.push({ post: row, reason: verdict.reason });
        result.held++;
        console.warn(`[prepublish] held ${row.id}: ${verdict.reason}`);
      } catch (e) {
        console.error(`[prepublish] hold failed ${row.id}:`, e instanceof Error ? e.message : e);
        result.skipped++;
      }
      continue;
    }
    if (verdict.decision === 'pass') {
      await markPrepublishPass(supabase, row.id);
      result.passed++;
      continue;
    }
    // Infra skip: unclaim so the next tick retries, unless the slot is < 6 min away.
    const slot = row.scheduled_for ? new Date(row.scheduled_for).getTime() : 0;
    if (slot && slot - nowMs < 6 * 60 * 1000) {
      await markPrepublishPass(supabase, row.id);
      result.passed++;
      console.warn(`[prepublish] fail-open (infra, slot imminent) ${row.id}: ${verdict.reason}`);
    } else {
      await supabase.from('posts').update({ prepublish_checked_at: null }).eq('id', row.id);
      result.skipped++;
    }
  }

  await notifyHeld(supabase, held);
  return result;
}
