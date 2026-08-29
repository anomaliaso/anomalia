/**
 * The reference wall, turned into something a Remotion engineer can act on.
 *
 * Two steps, and the split is the whole design:
 *
 *   searchMotionReferences()  — cheap. Ranks the posts.design index against the brief and returns
 *                               candidate CARDS: brand, category, style tags, the post's own words,
 *                               whether it moves. No model call, no clip downloaded.
 *   studyMotionReference()    — the expensive one, and the only one that ever looks at pixels.
 *                               Gemini watches the actual clip and returns a STRUCTURE: beats with
 *                               timings, what kind of transition sits between them, how the easing
 *                               feels, how much type is on screen at once, what the logo does.
 *
 * The agent picks from the cards, watches the two or three that could fit, and writes TSX from the
 * spec. That is a director's loop — look at references, choose one, build your own thing — and it
 * is deliberately the only loop available here, because the alternative (hand the model the frames
 * and let it match them) is how you end up rendering someone else's announcement card with a
 * different logo on it.
 *
 * WHAT CROSSES THE BOUNDARY. Text, and attribution. Never a media URL: the spec is scrubbed of
 * URLs before it is returned (`stripUrls`), so there is nothing for the model to paste into an
 * <Img>, and `assertNoReferenceHotlinks` in the agent refuses it even if a URL arrives some other
 * way. The clip itself is fetched, watched, and dropped — `market-media.ts` exists to archive
 * harvested video and is deliberately not used here.
 *
 * WHAT IS CACHED. The spec, not the media. A curated post never changes, so watching one twice is
 * pure waste; `motion_reference_specs` makes the second lookup free and instant. If the table is
 * missing the module still works — it just pays for the watch every time.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBrandContext } from '$lib/server/ai-log';
import { llmConfigured, llmStructured, llmVideoReviewerModel } from '$lib/server/llm';
import { createAdminClient } from '$lib/server/supabase-admin';
import { fetchVideoBytes, prepareReviewMedia } from '$lib/server/video-fetch';
import {
  isPostsDesignEnabled,
  loadPostsDesignDetail,
  loadPostsDesignIndex,
  rankIndex,
  type PostsDesignCard,
  type PostsDesignDetail,
  type PostsDesignIndexEntry
} from '$lib/server/posts-design';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Bump when the schema or the prompt changes — old rows stop being served, nothing is deleted. */
export const MOTION_SPEC_VERSION = 2;

/** Candidates returned per search. Enough to choose from, few enough to read in one tool result. */
export const MAX_SEARCH_RESULTS = 8;
/** Page fetches per search. The rest of the shortlist degrades to its index-level fields. */
const MAX_ENRICH = 8;
/** Vision calls one agent turn may spend on watching references. Cache hits do not count. */
export const MAX_STUDIES_PER_TURN = 4;
/** A still is one image; keep the cap tight — a 20MB webp is not a reference, it is a mistake. */
const MAX_STILL_BYTES = 8 * 1024 * 1024;

/**
 * How a beat could be rebuilt here, which is the difference between a reference that helps and one
 * that hurts.
 *
 * The wall is full of 3D renders, filmed product and After Effects work. Remotion builds none of
 * that, and an agent that chases a beat it cannot make ships a broken approximation of something
 * unreachable instead of a simple thing done well — worse than the generic composition it would
 * have written unaided. So every beat is labelled, and the spec tells the engineer to rebuild the
 * reachable ones and substitute the rest.
 */
export const BUILDABILITY = ['tsx', 'asset', 'out_of_reach'] as const;
export type Buildability = (typeof BUILDABILITY)[number];

export type MotionReferenceBeat = {
  at_s: number;
  on_screen: string;
  motion: string;
  /** tsx = pure code · asset = code plus a still we can mint · out_of_reach = 3D / filmed. */
  buildable: Buildability;
  /** What the beat needs that code alone cannot give. Empty for `tsx`. */
  needs: string;
};

export type MotionReferenceSpec = {
  /** One line naming the format, in the vocabulary of the format catalog. */
  format: string;
  duration_s: number;
  aspect: string;
  beats: MotionReferenceBeat[];
  /** Kind of change between beats: slide-with-overlap, iris/mask, push, morph, cut. */
  transitions: string[];
  easing: string;
  type_density: string;
  palette: string;
  logo_role: string;
  ui_elements: string[];
  sound_off: string;
  /** How to take the structure without taking the artwork. */
  adapt: string[];
  summary: string;
};

/** Beat counts by buildability — the number that says whether this reference is usable here. */
export function buildabilityOf(spec: Pick<MotionReferenceSpec, 'beats'>): {
  tsx: number;
  asset: number;
  out_of_reach: number;
  reachable: number;
  total: number;
} {
  const count = (k: Buildability) => spec.beats.filter((b) => b.buildable === k).length;
  const tsx = count('tsx');
  const asset = count('asset');
  const out = count('out_of_reach');
  return { tsx, asset, out_of_reach: out, reachable: tsx + asset, total: spec.beats.length };
}

/** A candidate, as `search` returns it — no pixels have been looked at yet. */
export type MotionReferenceCard = {
  id: string;
  slug: string;
  /** posts.design reference page — the attribution link, not a media URL. */
  reference_url: string;
  /** Original post on the source platform. */
  source_url: string | null;
  title: string | null;
  brand: string | null;
  handle: string | null;
  category: string | null;
  style_tags: string[];
  post_text: string | null;
  captured_at: string | null;
  is_video: boolean;
};

export type StudiedMotionReference = MotionReferenceCard & {
  watched: 'video' | 'still';
  spec: MotionReferenceSpec;
  cached: boolean;
};

/**
 * Strip every URL out of model-written text.
 *
 * Belt to `assertNoReferenceHotlinks`'s braces. The spec is the one thing that crosses from the
 * reference wall into the agent's context, so it is the one place a posts.design media path could
 * be smuggled in — a model asked to describe a clip will happily quote the filename it was given.
 * Nothing downstream needs a URL, so nothing downstream gets one.
 */
export function stripUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b(?:www\.)?posts\.design\S*/gi, '')
    .replace(/\/(?:media|images)\/posts\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanLine(v: unknown, max = 300): string {
  return stripUrls(String(v ?? '').trim()).slice(0, max);
}

function cleanList(v: unknown, max = 8, itemMax = 200): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => cleanLine(x, itemMax)).filter(Boolean).slice(0, max);
}

/** Shape a raw model object into a spec. Pure — exported for the test. */
export function finalizeSpec(raw: AnyRec, fallbackDuration: number): MotionReferenceSpec {
  const beats = Array.isArray(raw.beats) ? raw.beats : [];
  return {
    format: cleanLine(raw.format, 120) || 'unnamed format',
    duration_s: Number.isFinite(Number(raw.duration_s)) && Number(raw.duration_s) > 0
      ? Math.round(Number(raw.duration_s) * 10) / 10
      : Math.round(fallbackDuration * 10) / 10,
    aspect: cleanLine(raw.aspect, 20) || 'unknown',
    beats: beats
      .slice(0, 12)
      .map((b: AnyRec) => ({
        at_s: Number.isFinite(Number(b?.at_s)) ? Math.max(0, Math.round(Number(b.at_s) * 10) / 10) : 0,
        on_screen: cleanLine(b?.on_screen, 200),
        motion: cleanLine(b?.motion, 200),
        // Unlabelled defaults to out_of_reach, not tsx: an over-optimistic default is exactly the
        // failure this field exists to prevent.
        buildable: (BUILDABILITY as readonly string[]).includes(String(b?.buildable))
          ? (String(b.buildable) as Buildability)
          : 'out_of_reach',
        needs: cleanLine(b?.needs, 160)
      }))
      .filter((b: MotionReferenceBeat) => b.on_screen || b.motion),
    transitions: cleanList(raw.transitions, 8, 160),
    easing: cleanLine(raw.easing, 200),
    type_density: cleanLine(raw.type_density, 200),
    palette: cleanLine(raw.palette, 200),
    logo_role: cleanLine(raw.logo_role, 200),
    ui_elements: cleanList(raw.ui_elements, 8, 120),
    sound_off: cleanLine(raw.sound_off, 200),
    adapt: cleanList(raw.adapt, 6, 240),
    summary: cleanLine(raw.summary, 600)
  };
}

/**
 * The spec, as the agent reads it.
 *
 * Attribution is not decoration here — it is the line between "we studied a reference" and "we took
 * something". It leads, and the adaptation rule closes, so the model never sees the beats without
 * seeing whose they are and what it is allowed to do with them.
 */
export function formatMotionReferenceSpec(ref: MotionReferenceCard, spec: MotionReferenceSpec): string {
  const reach = buildabilityOf(spec);
  const lines: string[] = [
    `REFERENCE STUDIED — ${ref.brand ?? 'unknown brand'}${ref.handle ? ` (@${ref.handle})` : ''}, ${ref.category ?? 'uncategorised'}${ref.style_tags.length ? ` [${ref.style_tags.join(', ')}]` : ''}`,
    `Curated on posts.design: ${ref.reference_url}${ref.source_url ? ` — original: ${ref.source_url}` : ''}`,
    ref.post_text ? `The post said: "${ref.post_text.slice(0, 240)}"` : '',
    '',
    `Format: ${spec.format} — ${spec.duration_s}s, ${spec.aspect}`,
    spec.summary ? `Read: ${spec.summary}` : ''
  ];
  if (spec.beats.length) {
    const mark: Record<Buildability, string> = {
      tsx: '[code]',
      asset: '[code + 1 still]',
      out_of_reach: '[OUT OF REACH]'
    };
    lines.push('Beats:');
    for (const b of spec.beats) {
      const needs = b.buildable !== 'tsx' && b.needs ? ` (needs: ${b.needs})` : '';
      lines.push(`- ${b.at_s}s ${mark[b.buildable]} — ${b.on_screen}${b.motion ? ` | ${b.motion}` : ''}${needs}`);
    }
  }
  if (spec.transitions.length) lines.push(`Transitions: ${spec.transitions.join('; ')}`);
  if (spec.easing) lines.push(`Easing: ${spec.easing}`);
  if (spec.type_density) lines.push(`Type on screen: ${spec.type_density}`);
  if (spec.palette) lines.push(`Palette use: ${spec.palette}`);
  if (spec.logo_role) lines.push(`Logo: ${spec.logo_role}`);
  if (spec.ui_elements.length) lines.push(`UI built in code: ${spec.ui_elements.join(', ')}`);
  if (spec.sound_off) lines.push(`Sound-off: ${spec.sound_off}`);
  if (spec.adapt.length) {
    lines.push('Adapt like this:');
    for (const a of spec.adapt) lines.push(`- ${a}`);
  }
  lines.push(
    '',
    'USE THE STRUCTURE, NOT THE ARTWORK. Rebuild the beats and the timing in THIS brand’s palette, type and logo. Do not reproduce the reference’s layout, colours, wordmark or copy, and never embed any image from it — its media is not available to you and must not be.',
    `FIT IT TO YOUR BRIEF. This reference runs ${spec.duration_s}s; keep the beat SHAPE and compress or extend the count to the length you were asked for. A 30s brand film does not become a 6s ad by playing faster.`,
    `WHAT YOU CAN ACTUALLY BUILD: ${reach.tsx} beat(s) in code, ${reach.asset} with one generated still each, ${reach.out_of_reach} out of reach (3D, filmed, camera in a real scene). Build the reachable ones. An [OUT OF REACH] beat is NOT a target — replace it with a code-built equivalent that serves the same purpose in the sequence, or drop it and give its seconds to a beat you can make. Attempting one produces a broken imitation, which is worse than the piece you would have written without any reference.${reach.reachable === 0 ? ' NOTHING here is reachable — ignore this reference and pick another.' : ''}`,
    'DEFAULT CRAFT STILL WINS. Where the reference does something the craft rules forbid — a hard cut, a freeze before the cut, linear easing — do it OUR way. You are studying what it builds, not how carelessly it changes scene.'
  );
  return lines.filter((l) => l !== '').join('\n');
}

const SPEC_SCHEMA = {
  type: 'object' as const,
  properties: {
    format: {
      type: 'string' as const,
      description: 'Name the format in 3–8 words, e.g. "product screenshot push with kinetic caption".'
    },
    duration_s: { type: 'number' as const, description: 'Clip length in seconds.' },
    aspect: { type: 'string' as const, description: 'Aspect ratio as seen: 1:1, 9:16, 16:9, 4:5.' },
    beats: {
      type: 'array' as const,
      description: 'Every distinct beat in order. A beat is a state of the screen, not a frame.',
      items: {
        type: 'object' as const,
        properties: {
          at_s: { type: 'number' as const, description: 'Seconds from the start where the beat begins.' },
          on_screen: { type: 'string' as const, description: 'What is on screen — copy length, imagery, UI.' },
          motion: { type: 'string' as const, description: 'What moves and how: direction, distance, settle.' },
          buildable: {
            type: 'string' as const,
            enum: [...BUILDABILITY],
            description:
              'tsx = rebuildable in React/Remotion code alone (type, shapes, gradients, masks, programmatic UI). asset = code plus ONE generated still (photo, avatar, screenshot, product shot). out_of_reach = 3D render, filmed footage, a camera moving through a real scene, motion tracking, particle sim — code cannot make it and a still cannot fake it.'
          },
          needs: {
            type: 'string' as const,
            description: 'For asset / out_of_reach: what the beat needs beyond code. Empty for tsx.'
          }
        },
        required: ['at_s', 'on_screen', 'motion', 'buildable']
      }
    },
    transitions: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'One entry per scene change: slide-with-overlap, iris/mask, push, morph, wipe, hard cut.'
    },
    easing: { type: 'string' as const, description: 'How motion starts and stops. Overshoot and settle, or wall-stop?' },
    type_density: { type: 'string' as const, description: 'Words on screen at once, size relative to canvas, hierarchy.' },
    palette: { type: 'string' as const, description: 'How many colours carry the piece and what each does. Describe roles, not hexes.' },
    logo_role: { type: 'string' as const, description: 'Where the mark appears, at what size, for how long.' },
    ui_elements: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Chrome that could be rebuilt in TSX: cards, bars, cursors, toggles, chat bubbles.'
    },
    sound_off: { type: 'string' as const, description: 'Does it hold with no audio, and what carries it if so?' },
    adapt: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'How to reuse the STRUCTURE for another brand without copying the artwork.'
    },
    summary: { type: 'string' as const, description: 'Two sentences: what makes this one work.' }
  },
  required: ['format', 'duration_s', 'beats', 'transitions', 'easing', 'summary']
};

function studyPrompt(opts: {
  medium: 'video' | 'still';
  brandName?: string | null;
  language?: string | null;
  ref: MotionReferenceCard;
  duration: number;
}): string {
  const lang = opts.language?.trim() || 'Italian';
  const forBrand = opts.brandName?.trim()
    ? `The engineer reading this is about to build a DIFFERENT piece for ${opts.brandName.trim()}.`
    : 'The engineer reading this is about to build a different piece for another brand.';
  const watch =
    opts.medium === 'video'
      ? `MEDIA: stills from the scene changes plus the clip itself (~${opts.duration.toFixed(1)}s). Watch it in order and time the beats.`
      : 'MEDIA: a single still — this post does not move. Describe the composition as one beat and say what a motion version of it would animate.';

  return `You are a motion-design director breaking down a reference so someone else can build their own piece with the same STRUCTURE.

REFERENCE: ${opts.ref.brand ?? 'unknown'}${opts.ref.handle ? ` (@${opts.ref.handle})` : ''} — ${opts.ref.category ?? 'uncategorised'}${opts.ref.style_tags.length ? `, ${opts.ref.style_tags.join(', ')}` : ''}.
${opts.ref.post_text ? `The post read: "${opts.ref.post_text.slice(0, 300)}"` : ''}
${forBrand}

${watch}

THE ENGINEER BUILDS IN REMOTION — React that renders to video. It can do type, shapes, gradients,
masks, easing, springs and programmatic UI (cards, bars, cursors, toggles, charts), plus generated
STILLS dropped into that chrome. It cannot do 3D renders, filmed footage, a camera flying through a
real scene, motion tracking or particle simulation. So label every beat "buildable": tsx (code
alone), asset (code plus one generated still), or out_of_reach (neither). Label honestly — a
beat marked reachable that is not is worse than no reference at all, because it will be attempted.

Break it down so it can be REBUILT FROM SCRATCH in Remotion:
1. Beats — every state of the screen, with the second it starts. Copy length per beat, not the copy itself.
2. Transitions — name the mechanism between beats. Be exact: an overlapping slide is not a cut, an iris that completes is not a fade.
3. Easing — does motion overshoot and micro-settle, or stop dead? Is anything still moving through the cut?
4. Type — how many words at once, how big relative to the canvas, what the hierarchy is.
5. Palette — how many colours do the work, and what each is for. Roles, never hex values.
6. Logo — where, how big, how long.
7. UI — any chrome that is programmatic (cards, bars, cursors, toggles) rather than photographed.
8. Sound-off — does it hold silent?

Then write "adapt": how to reuse this STRUCTURE for a different brand. Structure, pacing and mechanism transfer; layout, colours, wordmark and copy do not. Never suggest reproducing this brand's artwork.

Do not quote any file name, path or URL anywhere in the output.
LANGUAGE: write every prose field in ${lang}. Keep field names and enum-ish words in English.

Return JSON.`;
}

function cardFrom(detail: PostsDesignDetail): MotionReferenceCard {
  return {
    id: detail.id,
    slug: detail.slug,
    reference_url: detail.url,
    source_url: detail.sourceUrl,
    title: detail.title,
    brand: detail.brand,
    handle: detail.handle ?? detail.handleSlug,
    category: detail.category,
    style_tags: detail.styleTags,
    post_text: detail.text,
    captured_at: detail.capturedAt,
    is_video: detail.hasVideo
  };
}

function cardFromEntry(entry: PostsDesignIndexEntry | PostsDesignCard): MotionReferenceCard {
  const card = entry as Partial<PostsDesignCard>;
  return {
    id: entry.id,
    slug: entry.slug,
    reference_url: entry.url,
    source_url: null,
    title: card.title ?? null,
    brand: card.brand ?? null,
    handle: card.handle ?? entry.handleSlug,
    category: card.category ?? null,
    style_tags: card.styleTags ?? [],
    post_text: null,
    captured_at: entry.capturedAt,
    is_video: card.hasVideo === true
  };
}

/**
 * Candidates for a brief.
 *
 * Ranking happens on the index — which knows only the post's own words and who posted it — and then
 * the shortlist is enriched from the page, because category, style tags and "is this actually
 * motion" are what the agent needs to choose and none of them are in the index. Enrichment is
 * best-effort per candidate: a page that fails to load costs that card its taxonomy, not the search.
 */
export async function searchMotionReferences(opts: {
  query: string;
  onlyVideo?: boolean;
  limit?: number;
}): Promise<{ references: MotionReferenceCard[]; error?: string }> {
  if (!isPostsDesignEnabled()) return { references: [], error: 'reference_wall_disabled' };
  const index = await loadPostsDesignIndex();
  if (!index.length) return { references: [], error: 'reference_wall_unreachable' };

  const limit = Math.min(Math.max(1, opts.limit ?? MAX_SEARCH_RESULTS), MAX_SEARCH_RESULTS);
  // Rank wide, enrich a slice, then cut: filtering to video is only possible after enrichment, so
  // the shortlist has to carry spares or a video-only search comes back half empty.
  const shortlist = rankIndex(index, opts.query ?? '', Math.max(limit * 2, MAX_ENRICH));
  const enriched = await Promise.all(
    shortlist.slice(0, MAX_ENRICH).map(async (entry) => {
      const detail = await loadPostsDesignDetail(entry).catch((error) => { swallow('load design detail', error); return null; });
      return detail ? cardFrom(detail) : cardFromEntry(entry);
    })
  );
  const rest = shortlist.slice(MAX_ENRICH).map(cardFromEntry);
  const all = [...enriched, ...rest];
  const wanted = opts.onlyVideo ? all.filter((c) => c.is_video) : all;
  return { references: (wanted.length ? wanted : all).slice(0, limit) };
}

/**
 * The shortlist, rendered into the create-mode prompt.
 *
 * WHY THIS EXISTS AT ALL, given there is already a search tool. The first version shipped the wall
 * as two tools and one paragraph of prompt, and the agent ignored it — the very first real brief
 * went read_source → read_media → write_source → finish, no search. That was not a bug in the
 * tools: `read_media` is pushed FOUR times in the same system prompt (its own description, the mode
 * block, the workflow, and inside generate_image), always as an imperative, while the wall was
 * mentioned once as "worth doing". The model did exactly what the prompt weighted.
 *
 * Shouting louder is the weaker fix. The media library solved the identical problem years earlier
 * by putting the catalog IN the prompt (`loadMediaLibraryPromptSection`) and leaving `read_media`
 * for refinement — so the model never has to decide to go looking. This does the same: the search
 * is free and takes about two seconds, so a create turn simply ARRIVES with candidates, and the
 * only decision left is which one to watch.
 */
export function formatReferenceCandidates(cards: MotionReferenceCard[]): string {
  const rows = cards.filter((c) => c.title || c.brand);
  if (!rows.length) return '';
  const lines = [
    'WALL CANDIDATES FOR THIS BRIEF (already searched for you — posts.design, curated launch/announcement posts):'
  ];
  for (const c of rows) {
    const tags = c.style_tags.length ? ` [${c.style_tags.join(', ')}]` : '';
    const said = c.post_text ? ` — "${c.post_text.slice(0, 90)}"` : '';
    lines.push(
      `- ${c.id} · ${c.brand ?? 'unknown'}${c.handle ? ` (@${c.handle})` : ''} · ${c.category ?? 'uncategorised'}${tags} · ${c.is_video ? 'MOVES' : 'still'}${said}`
    );
  }
  lines.push(
    'Call study_motion_reference with the closest reference_id BEFORE you write the composition. Use search_motion_references only if none of these fit the brief.'
  );
  return lines.join('\n');
}

/** Resolve an id or slug back to an index entry. */
async function findEntry(idOrSlug: string): Promise<PostsDesignIndexEntry | PostsDesignCard | null> {
  const key = idOrSlug.trim().replace(/^\/+|\/+$/g, '');
  if (!key) return null;
  const index = await loadPostsDesignIndex();
  return index.find((e) => e.id === key || e.slug === key) ?? null;
}

async function readCachedSpec(
  admin: SupabaseClient,
  id: string
): Promise<{ spec: MotionReferenceSpec; medium: 'video' | 'still' } | null> {
  const { data, error } = await admin
    .from('motion_reference_specs')
    .select('spec, medium')
    .eq('id', id)
    .eq('spec_version', MOTION_SPEC_VERSION)
    .maybeSingle();
  if (error || !data?.spec) return null;
  return { spec: data.spec as MotionReferenceSpec, medium: (data.medium as 'video' | 'still') ?? 'video' };
}

async function writeCachedSpec(
  admin: SupabaseClient,
  ref: MotionReferenceCard,
  medium: 'video' | 'still',
  spec: MotionReferenceSpec
): Promise<void> {
  const { error } = await admin.from('motion_reference_specs').upsert({
    id: ref.id,
    source: 'posts.design',
    slug: ref.slug,
    reference_url: ref.reference_url,
    source_url: ref.source_url,
    brand: ref.brand,
    handle: ref.handle,
    category: ref.category,
    style_tags: ref.style_tags,
    title: ref.title,
    post_text: ref.post_text,
    medium,
    spec_version: MOTION_SPEC_VERSION,
    spec,
    duration_s: spec.duration_s
  });
  if (error) console.warn(`[motion-references] spec cache write failed: ${error.message}`);
}
/**
 * The pixels of one reference, prepared for a model — whichever model.
 *
 * Same shape the craft judge already uses: stills lifted from the scene changes plus a small
 * re-encode of the clip. Kept separate from the study so BOTH consumers can have it: the vision
 * call that writes the spec, and the Motion agent itself when the caller wants the reference in
 * front of its own eyes rather than described to it.
 *
 * Nothing is written to disk or to a bucket. The buffers die with the request.
 */
export type ReferenceMedia = {
  medium: 'video' | 'still';
  durationS: number;
  frames: Array<{ mimeType: string; data: string; label: string }>;
  /** Base64 MP4 — the compact re-encode, not the original download. */
  clipMp4?: string;
};

async function prepareReferenceMedia(detail: PostsDesignDetail): Promise<ReferenceMedia | null> {
  if (detail.videoUrl) {
    const bytes = await fetchVideoBytes(detail.videoUrl);
    const media = bytes ? await prepareReviewMedia(bytes) : null;
    if (media) {
      return {
        medium: 'video',
        durationS: media.duration,
        frames: media.frames.map((f) => ({ mimeType: f.mimeType, data: f.data, label: f.label })),
        ...(media.videoMp4 ? { clipMp4: media.videoMp4.toString('base64') } : {})
      };
    }
  }
  const still = await fetchStill(detail.imageUrl);
  if (!still) return null;
  return {
    medium: 'still',
    durationS: 0,
    frames: [{ mimeType: still.mimeType, data: still.data, label: 'The post (it does not move)' }]
  };
}

/**
 * Watch one reference and return its structure.
 *
 * The clip is downloaded into memory, handed to the model, and dropped when this function returns.
 * Nothing about it is archived, and the URL it came from never leaves this module.
 *
 * `withMedia` also hands the prepared frames and clip back to the caller. A cached spec normally
 * costs nothing and touches no network; asking for media makes it fetch and re-encode again (still
 * no model call), because the pixels are deliberately not in the cache — the cache holds text.
 */
export async function studyMotionReference(opts: {
  idOrSlug: string;
  brandName?: string | null;
  language?: string | null;
  withMedia?: boolean;
  abortSignal?: AbortSignal;
}): Promise<
  | { ok: true; reference: StudiedMotionReference; media: ReferenceMedia | null }
  | { ok: false; error: string }
> {
  if (!isPostsDesignEnabled()) return { ok: false, error: 'reference_wall_disabled' };
  if (!llmConfigured()) return { ok: false, error: 'gemini_unconfigured' };

  const entry = await findEntry(opts.idOrSlug);
  if (!entry) return { ok: false, error: 'unknown_reference' };
  const detail = await loadPostsDesignDetail(entry);
  if (!detail) return { ok: false, error: 'reference_page_unreachable' };
  const ref = cardFrom(detail);

  let admin: SupabaseClient | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }
  const cached = admin ? await readCachedSpec(admin, ref.id).catch((error) => { swallow('read cached spec', error); return null; }) : null;
  if (cached) {
    const media = opts.withMedia ? await prepareReferenceMedia(detail) : null;
    return {
      ok: true,
      reference: { ...ref, watched: cached.medium, spec: cached.spec, cached: true },
      media
    };
  }

  const gateBrand = getBrandContext();
  if (gateBrand) {
    const { gateCredits } = await import('$lib/server/credits');
    await gateCredits(gateBrand);
  }

  const media = await prepareReferenceMedia(detail);
  if (opts.abortSignal?.aborted) return { ok: false, error: 'aborted' };
  if (!media) return { ok: false, error: 'media_unavailable' };

  const frameNote = media.frames.map((f, i) => `${i + 1}. ${f.label || `frame ${i + 1}`}`).join('\n');

  try {
    // QC video sul centralino (`llmVideoReviewerModel`): kie ignorava `videoMetadata.fps: 4`.
    const prompt = [
      studyPrompt({
        medium: media.medium,
        brandName: opts.brandName,
        language: opts.language,
        ref,
        duration: media.durationS
      }),
      frameNote ? `\nSTILLS (in order):\n${frameNote}` : '',
      media.clipMp4 ? '\nFULL CLIP is attached (watch the scene changes in order).' : ''
    ]
      .filter(Boolean)
      .join('');
    const raw = (await llmStructured<AnyRec>({
      prompt,
      schema: SPEC_SCHEMA,
      images: media.frames.map((f) => ({ mediaType: f.mimeType, data: f.data })),
      file: media.clipMp4 ? { mediaType: 'video/mp4', data: media.clipMp4 } : undefined,
      model: llmVideoReviewerModel(),
      label: 'motion.reference_study'
    })) as AnyRec | null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'model_parse_failed' };
    const spec = finalizeSpec(raw, media.durationS);
    if (admin) await writeCachedSpec(admin, ref, media.medium, spec).catch((error) => { swallow('cache motion spec', error); return undefined; });
    return {
      ok: true,
      reference: { ...ref, watched: media.medium, spec, cached: false },
      media: opts.withMedia ? media : null
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'CreditsExhaustedError') throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[motion-references] study failed: ${msg}`);
    return { ok: false, error: 'model_failed' };
  }
}


async function fetchStill(url: string | null): Promise<{ mimeType: string; data: string } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_STILL_BYTES) return null;
    return { mimeType: mime, data: buf.toString('base64') };
  } catch {
    return null;
  }
}
