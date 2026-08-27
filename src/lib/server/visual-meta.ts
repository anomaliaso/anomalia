// P2 Learning Loop — deterministic visual metadata for every produced post.
//
// The loop reads a POST-LEVEL, persist-time snapshot of WHAT each post was (genre, subject,
// asset source, hook, params) without any AI or analysis at write time: everything here is
// derived from the post row alone, so writing meta is O(1), deterministic and free. The
// expensive "was it good?" analysis happens later in the analytics review; this table only
// ever answers "what did we post?".
//
// Derivation notes / limits:
// - `genre` prefers `posts.visual_genre` when the column exists (NOT created yet — read via
//   `any` so a future migration can start populating it); otherwise it is inferred from
//   format/content_type/media_url. The inference is a heuristic, not a classifier label.
// - `hook_type` is an ESTIMATE from the first ~80 caption chars (question / stat / howto /
//   myth patterns, bilingual EN/IT) — not an editorial judgment.
// - `person_present` only uses the dedicated `person` field (preview posts) or a `pillar`
//   match on /person|people/. Caption-level person detection is deliberately NOT attempted:
//   posts rows carry no People-registry reference, and a name regex over free text would be
//   noise.
// - The meta row is a SNAPSHOT written at persist time: later edits (caption/hook changes in
//   the editor, publish timestamps set by publish.ts) are not re-synced here — re-derive with
//   backfillVisualMeta. A metadata failure NEVER blocks the post itself.
import type { SupabaseClient } from '@supabase/supabase-js';

// Accepts a posts row (posts.*) OR the planner's PreviewPost shape, so every persist site can
// hand over whatever it holds without remapping.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VisualMetaPost = {
  id?: string | null;
  platform?: string | null;
  platforms?: string[] | null;
  format?: string | null;
  content_type?: string | null;
  media?: 'image' | 'text' | 'video' | 'link' | string | null;
  caption?: string | null;
  image_prompt?: string | null;
  image_prompts?: string[] | null;
  media_url?: string | null;
  imageUrl?: string | null;
  product_name?: string | null;
  product?: string | null;
  person?: string | null;
  pillar?: string | null;
  first_comment?: string | null;
  scheduled_for?: string | null;
  published_at?: string | null;
  status?: string | null;
  visual_genre?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

export type VisualMeta = {
  platform: string | null;
  format: string | null;
  genre: string;
  params: {
    hasCarousel: boolean;
    slideCount: number | undefined;
    isVideo: boolean;
    hasFirstComment: boolean;
  };
  subject_type: 'product' | 'person' | 'graphic' | 'scene';
  product_present: boolean;
  person_present: boolean;
  asset_source: 'real' | 'ai_generated';
  hook_type: 'question' | 'stat' | 'howto' | 'myth' | 'claim';
  caption_length: number;
  scheduled_at: string | null;
  published_at: string | null;
};

const VIDEO_FORMATS = /(video|reel|short|story|clip)/i;
const PERSON_PILLAR = /person|people/;

// content_type for the preview shape (which has `media` + __fromLibrary instead of
// content_type): mirrors exactly what the persist sites store on the posts row, so the derived
// meta matches the persisted row field-for-field.
function resolveContentType(post: VisualMetaPost): string {
  const raw = post.content_type;
  if (raw && String(raw).trim()) return String(raw).trim();
  if (post.media === 'text') return 'text';
  if (post.media === 'link') return 'link';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((post as any).__fromLibrary) return 'uploaded_image';
  return 'generated_image';
}

// Pure and deterministic: the same post row always yields the same meta.
export function deriveVisualMeta(post: VisualMetaPost): VisualMeta {
  const format = post.format ?? null;
  const isVideo = !!format && VIDEO_FORMATS.test(String(format).toLowerCase());
  const contentType = resolveContentType(post);
  const mediaUrl = post.media_url ?? post.imageUrl ?? null;
  // Media-library assets are stored with their storage path verbatim on the row (starts with
  // 'library/'); the 'uploaded_*' content_types mean a pixel-perfect reuse of a real asset.
  const fromLibraryPath = !!mediaUrl && String(mediaUrl).startsWith('library/');
  const isRealAsset = fromLibraryPath || contentType.startsWith('uploaded');
  const pillar = String(post.pillar ?? '').toLowerCase();
  const personPresent = !!post.person || PERSON_PILLAR.test(pillar);
  const isGraphic = contentType.includes('graphic');

  // Column not created yet — tolerate it via `any` so a future migration can populate it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const genre =
    (post as any).visual_genre ??
    (isVideo
      ? 'cinematic_default'
      : isRealAsset
        ? 'real_asset'
        : isGraphic
          ? 'graphic_brand'
          : 'brand_studio');

  const subjectType = post.product_name || post.product
    ? 'product'
    : personPresent
      ? 'person'
      : isGraphic
        ? 'graphic'
        : 'scene';

  const caption = post.caption ? String(post.caption) : '';
  const head = caption.slice(0, 80).toLowerCase();
  let hookType: VisualMeta['hook_type'];
  if (head.includes('?')) hookType = 'question';
  else if (/[\d%€$£]/.test(head)) hookType = 'stat';
  else if (/\bhow to\b|\bcome\b/.test(head)) hookType = 'howto';
  else if (/\b(myth|mito)\b|bugia/.test(head)) hookType = 'myth';
  else hookType = 'claim';

  const prompts = Array.isArray(post.image_prompts) ? post.image_prompts : [];

  return {
    platform: String(post.platform ?? '').toLowerCase() || null,
    format,
    genre,
    params: {
      hasCarousel: prompts.length > 1,
      slideCount: prompts.length > 0 ? prompts.length : undefined,
      isVideo,
      hasFirstComment: !!post.first_comment
    },
    subject_type: subjectType,
    product_present: !!(post.product_name || post.product),
    person_present: personPresent,
    asset_source: mediaUrl && contentType.startsWith('uploaded') ? 'real' : 'ai_generated',
    hook_type: hookType,
    caption_length: caption.length,
    scheduled_at: post.scheduled_for ?? null,
    published_at: post.published_at ?? null
  };
}

// Best-effort upsert of the derived meta onto the post. Never throws, never blocks the post:
// a metadata failure is logged and swallowed.
export async function writeVisualMeta(
  supabase: SupabaseClient,
  brandId: string,
  post: VisualMetaPost
): Promise<{ ok: boolean }> {
  if (!post.id) return { ok: false };
  const meta = deriveVisualMeta(post);
  try {
    const { error } = await supabase
      .from('post_visual_meta')
      .upsert(
        {
          brand_id: brandId,
          post_id: post.id,
          platform: meta.platform,
          format: meta.format,
          genre: meta.genre,
          params: meta.params,
          subject_type: meta.subject_type,
          product_present: meta.product_present,
          person_present: meta.person_present,
          asset_source: meta.asset_source,
          hook_type: meta.hook_type,
          caption_length: meta.caption_length,
          scheduled_at: meta.scheduled_at,
          published_at: meta.published_at
        },
        { onConflict: 'post_id' }
      );
    if (error) {
      console.warn('[visual-meta] write failed (non-fatal):', error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    // A metadata failure must NEVER block the post itself — this is a best-effort side write.
    console.warn('[visual-meta] write threw (non-fatal):', e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

// One-off historical fill: published posts (published_at set OR status 'published') that have
// no meta row yet get one. Covered ids come from a SEPARATE meta query (PostgREST has no
// NOT EXISTS / nested left join that stays cheap), excluded via `not.in` on the posts query.
export async function backfillVisualMeta(
  admin: SupabaseClient,
  opts: { limit?: number; brandId?: string } = {}
): Promise<{ backfilled: number }> {
  const limit = opts.limit ?? 200;

  // 1. Which posts already carry a meta row.
  const { data: existing } = await admin.from('post_visual_meta').select('post_id');
  const covered = new Set<string>();
  for (const r of existing ?? []) {
    if (r?.post_id) covered.add(String(r.post_id));
  }

  // 2. Published posts without meta. Optional brandId narrows the run to one brand: the
  // analytics/visual/backfill route resolves ?brand=<slug> to an id and passes it down, so a
  // single brand can be re-derived without touching the others.
  let query = admin
    .from('posts')
    .select('*')
    .or('published_at.not.isnull,status.eq.published');
  if (opts.brandId) {
    query = query.eq('brand_id', opts.brandId);
  }
  if (covered.size) {
    query = query.not('id', 'in', `(${Array.from(covered).join(',')})`);
  }
  const { data: posts } = await query.limit(limit);

  let backfilled = 0;
  for (const post of posts ?? []) {
    if (!post?.id || covered.has(String(post.id))) continue;
    const { ok } = await writeVisualMeta(admin, String(post.brand_id), post);
    if (ok) backfilled += 1;
  }
  return { backfilled };
}
