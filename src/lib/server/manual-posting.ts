import type { SupabaseClient } from '@supabase/supabase-js';
import { structured } from '$lib/server/research';
import { withBrandContext } from '$lib/server/ai-log';
import { aiActCopyGuardrail } from '$lib/ai-act';
import { platformPlaybook, houseVoiceFor, type ContentPrefs } from '$lib/server/content-preview';
import { publishApprovedPost, type ApprovablePost } from '$lib/server/publish';
import { earliestScheduleMs, wallClockToUtc, zonedClock } from '$lib/server/schedule';
import { findBrandMediaByIds, publishLibraryMediaAsPostMedia } from '$lib/server/brand-media';
import { EDITOR_POST_COLS } from '$lib/server/post-editing';
import {
  PLATFORM_CHAR_LIMITS,
  assemblePlatformCaptions,
  publishBlockers,
  youtubeTitleFrom
} from '$lib/platform-limits';
import {
  clampGeneratedCaptions,
  normalizePlatforms,
  type GeneratedCaptions
} from '$lib/manual-posting-captions';

export { clampGeneratedCaptions, normalizePlatforms };
export type { GeneratedCaptions };

const MAX_MEDIA = 8;
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type ManualPostMode = 'now' | 'schedule' | 'draft' | 'propose';

export type ManualPostOutcome = 'pending_user' | 'scheduled' | 'published';

export type PostAuthorship = 'manual' | 'external';

type DateSource = (input: CreateManualPostInput, tz: string) => string | null;

const NO_DATE: DateSource = () => null;

const FROM_WALL_CLOCK: DateSource = (input, tz) => {
  const date = String(input.date ?? '').trim();
  const time = String(input.time ?? '').trim();
  return date && time ? wallClockToUtc(date, time, tz) : null;
};

const FROM_INSTANT: DateSource = (input) => input.scheduledFor ?? null;

const MODE_BEHAVIOUR: Record<
  ManualPostMode,
  { dateFrom: DateSource; dateRequired: boolean; outcome: ManualPostOutcome }
> = {
  now: { dateFrom: NO_DATE, dateRequired: false, outcome: 'published' },
  schedule: { dateFrom: FROM_WALL_CLOCK, dateRequired: true, outcome: 'scheduled' },
  draft: { dateFrom: NO_DATE, dateRequired: false, outcome: 'pending_user' },
  propose: { dateFrom: FROM_INSTANT, dateRequired: false, outcome: 'pending_user' }
};

export type GenerateCaptionsInput = {
  platforms: string[];
  brief: string;
  caption?: string;
  hasMedia?: boolean;
};

const GEN_SCHEMA = {
  type: 'object' as const,
  properties: {
    caption: { type: 'string' as const },
    instagram: { type: 'string' as const },
    tiktok: { type: 'string' as const },
    facebook: { type: 'string' as const },
    linkedin: { type: 'string' as const },
    x: { type: 'string' as const },
    threads: { type: 'string' as const },
    bluesky: { type: 'string' as const },
    reddit: { type: 'string' as const },
    youtube: { type: 'string' as const },
    title: { type: 'string' as const }
  },
  required: ['caption']
};

type BrandKit = {
  about?: string | null;
  target_audience?: string | null;
  brand_style?: string | null;
  ai_character?: unknown;
  ai_context?: string | null;
};

export async function generateManualCaptions(opts: {
  brandId: string;
  brandName: string;
  kit: BrandKit | null;
  prefs: ContentPrefs;
  input: GenerateCaptionsInput;
}): Promise<GeneratedCaptions> {
  const platforms = normalizePlatforms(opts.input.platforms);
  if (!platforms.length) throw new Error('no_platforms');
  const brief = opts.input.brief.trim();
  const draft = (opts.input.caption ?? '').trim();
  if (!brief && !draft) throw new Error('missing_input');

  const char = (opts.kit?.ai_character ?? {}) as Record<string, unknown>;
  const tone = [char.tone, char.speaking_style].filter(Boolean).join(' ');
  const playbook = platformPlaybook(platforms, opts.prefs);
  const language = String(opts.prefs.language ?? '').trim();
  const avoid = (opts.prefs.avoid ?? []).map((w) => String(w).trim()).filter(Boolean);

  const limits = platforms
    .map((p) => {
      const n = PLATFORM_CHAR_LIMITS[p];
      return n ? `${p}: max ${n} characters` : p;
    })
    .join('; ');

  const prompt = `Write social captions for the brand "${opts.brandName}" to publish the SAME post across: ${platforms.join(', ')}.

${language ? `LANGUAGE: write EVERY caption in ${language}. Never mix languages.` : `LANGUAGE: write in the brand's own primary language (infer from context). Never default to English unless the brand clearly communicates in English.`}
${opts.kit?.about ? `ABOUT: ${String(opts.kit.about).slice(0, 800)}` : ''}
${opts.kit?.target_audience ? `AUDIENCE: ${String(opts.kit.target_audience).slice(0, 400)}` : ''}
${opts.kit?.brand_style ? `STYLE: ${String(opts.kit.brand_style).slice(0, 400)}` : ''}
${tone ? `TONE: ${tone}` : ''}
${opts.kit?.ai_context ? `\nBRAND CONTEXT (authoritative voice):\n${String(opts.kit.ai_context).slice(0, 1800)}\n` : ''}
${houseVoiceFor(opts.prefs)}
${playbook}
${avoid.length ? `BANNED WORDS/PHRASES: ${avoid.join('; ')}.` : ''}
${aiActCopyGuardrail()}

CHARACTER LIMITS (hard — never exceed): ${limits}.
X must be a single tight thought, 0–2 hashtags, under 280 characters.
Threads must be conversational, under 500 characters.
LinkedIn (when selected) is long-form, not a one-liner.
Same facts and angle everywhere — change register and length, never invent claims.
${opts.input.hasMedia ? 'The post has media attached (photo/video/carousel). Captions should complement the visual, not describe it literally.' : 'This may be a text-only post where the platform allows it.'}

USER ${brief && draft && brief !== draft ? 'BRIEF' : draft && !brief ? 'DRAFT CAPTION' : 'BRIEF'}:
${brief || draft}
${brief && draft && brief !== draft ? `\nEXISTING DRAFT (rewrite / adapt, do not ignore):\n${draft}` : ''}

Return JSON. "caption" is the default (use for long-form networks). Also fill a field for EACH selected platform (${platforms.join(', ')}) with that network's custom caption. If Reddit is selected, also return "title" (max 300 chars, plain, honest).`;

  const parsed = await withBrandContext(opts.brandId, () =>
    structured<Record<string, unknown>>(null as never, prompt, GEN_SCHEMA, undefined, {
      label: 'manualPostingCaptions',
      brandId: opts.brandId,
      temperature: 0.7
    })
  );

  const out = clampGeneratedCaptions(parsed ?? {}, platforms);
  if (!out.caption) throw new Error('empty_caption');
  return out;
}

export type CreateManualPostInput = {
  platforms: string[];
  caption: string;
  platformCaptions?: Record<string, string>;
  mediaPaths?: string[];
  libraryIds?: string[];
  isVideo?: boolean;
  title?: string;
  subreddit?: string;
  linkUrl?: string;
  mode: ManualPostMode;
  date?: string;
  time?: string;
  scheduledFor?: string;
  source?: PostAuthorship;
};

export type CreateManualPostResult =
  | { ok: true; id: string; status: string; slot: string | null; noAccount?: boolean }
  | { ok: false; error: string };

function slotAt(iso: string, tz: string): string {
  const { date, time } = zonedClock(tz, new Date(iso));
  const [y, m, d] = date.split('-').map(Number);
  const dow = DOW_EN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? 'Mon';
  return `${dow} ${time}`;
}

type ResolvedMedia =
  | { ok: true; urls: string[]; video: boolean }
  | { ok: false; error: 'media_not_found' };

/**
 * Un media che il chiamante ha indicato e che non si risolve ferma la creazione. Veniva saltato
 * in silenzio: l'id di un altro brand diventava una bozza senza immagine che nessuno aveva
 * chiesto, e su Instagram un `need_media` che sembrava colpa di chi chiedeva.
 */
async function resolveMediaUrls(
  supabase: SupabaseClient,
  userId: string,
  brandId: string,
  paths: string[],
  libraryIds: string[]
): Promise<ResolvedMedia> {
  const urls: string[] = [];
  let video = false;

  for (const raw of paths.slice(0, MAX_MEDIA)) {
    const path = String(raw ?? '');
    if (!path.startsWith(`${userId}/uploads/`)) return { ok: false, error: 'media_not_found' };
    const publicUrl = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
    if (!publicUrl) return { ok: false, error: 'media_not_found' };
    urls.push(publicUrl);
    if (/\.(mp4|webm|mov)(\?|$)/i.test(path)) video = true;
  }

  const wanted = libraryIds.slice(0, MAX_MEDIA - urls.length).map(String);
  if (!wanted.length) return { ok: true, urls: urls.slice(0, MAX_MEDIA), video };

  const owned = new Map(
    (await findBrandMediaByIds(supabase, brandId, wanted)).map((row) => [row.id, row])
  );
  for (const id of wanted) {
    const media = owned.get(id);
    if (!media) return { ok: false, error: 'media_not_found' };
    const copied = await publishLibraryMediaAsPostMedia(supabase, {
      brandId,
      userId,
      mediaId: id,
      kind: media.kind
    });
    if (!('publicUrl' in copied) || !copied.publicUrl) return { ok: false, error: 'media_not_found' };
    urls.push(copied.publicUrl);
    if (media.kind === 'video') video = true;
  }

  return { ok: true, urls: urls.slice(0, MAX_MEDIA), video };
}

export async function createManualPost(opts: {
  supabase: SupabaseClient;
  userId: string;
  brandId: string;
  timezone: string;
  input: CreateManualPostInput;
}): Promise<CreateManualPostResult> {
  const platforms = normalizePlatforms(opts.input.platforms);
  if (!platforms.length) return { ok: false, error: 'no_platforms' };

  const caption = String(opts.input.caption ?? '').trim();
  if (!caption) return { ok: false, error: 'need_caption' };

  const media = await resolveMediaUrls(
    opts.supabase,
    opts.userId,
    opts.brandId,
    opts.input.mediaPaths ?? [],
    opts.input.libraryIds ?? []
  );
  if (!media.ok) return { ok: false, error: media.error };
  const { urls, video: pathVideo } = media;
  const isVideo = opts.input.isVideo === true || pathVideo;
  const hasMedia = urls.length > 0;

  const assembled = assemblePlatformCaptions(caption, opts.input.platformCaptions ?? {}, platforms);
  const reddit = platforms.includes('reddit');
  const youtube = platforms.includes('youtube');
  const title = reddit
    ? String(opts.input.title ?? '').trim().slice(0, 300)
    : youtube
      ? youtubeTitleFrom(assembled.caption, opts.input.title)
      : '';

  const blockers = publishBlockers({
    platforms,
    caption: assembled.caption,
    platformCaptions: assembled.platform_captions,
    hasMedia,
    hasVideo: isVideo,
    title
  });
  if (blockers.length) return { ok: false, error: blockers[0].code };

  const subreddit = reddit
    ? String(opts.input.subreddit ?? '')
        .trim()
        .replace(/^r\//i, '')
        .slice(0, 80) || null
    : null;
  const linkUrl = String(opts.input.linkUrl ?? '').trim() || null;

  const carousel = !isVideo && urls.length > 1;
  const contentType = !hasMedia ? (linkUrl ? 'link' : 'text') : isVideo ? 'uploaded_video' : 'uploaded_image';
  const format = !hasMedia ? (linkUrl ? 'link_post' : 'text_post') : isVideo ? 'reel' : carousel ? 'carousel' : 'post';

  const behaviour = MODE_BEHAVIOUR[opts.input.mode];
  const when = behaviour.dateFrom(opts.input, opts.timezone);
  if (!when && behaviour.dateRequired) return { ok: false, error: 'too_soon' };
  if (when && new Date(when).getTime() < earliestScheduleMs()) return { ok: false, error: 'too_soon' };
  const scheduledFor = when;
  const slot = when ? slotAt(when, opts.timezone) : null;

  const row = {
    brand_id: opts.brandId,
    platform: platforms[0],
    platforms,
    caption: assembled.caption,
    platform_captions: assembled.platform_captions,
    media_url: urls[0] ?? null,
    media_urls: carousel ? urls : null,
    content_type: contentType,
    format,
    source: opts.input.source ?? 'manual',
    title: title || null,
    subreddit,
    link_url: linkUrl,
    scheduled_for: scheduledFor,
    slot,
    status: 'pending_user' as const
  };

  const { data: inserted, error: insErr } = await opts.supabase.from('posts').insert(row).select('id').single();
  if (insErr || !inserted) return { ok: false, error: insErr?.message ?? 'insert_failed' };

  if (behaviour.outcome === 'pending_user') {
    return { ok: true, id: inserted.id, status: 'pending_user', slot };
  }

  const { data: post } = await opts.supabase.from('posts').select(EDITOR_POST_COLS).eq('id', inserted.id).maybeSingle();
  if (!post) return { ok: true, id: inserted.id, status: 'pending_user', slot };

  const res = await publishApprovedPost(opts.supabase, post as ApprovablePost, opts.timezone, {
    now: behaviour.outcome === 'published'
  });
  return {
    ok: true,
    id: inserted.id,
    status: behaviour.outcome,
    slot,
    noAccount: res.noAccount
  };
}
