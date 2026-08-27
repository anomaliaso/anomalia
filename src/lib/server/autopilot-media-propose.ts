import type { SupabaseClient } from '@supabase/supabase-js';
import { formatVideoScore } from '$lib/video-score';
import { isWeakMediaScore } from '$lib/server/weekly-recap';

/** Stored `attention_reason` prefix — used to update/clear our flags without touching Director holds. */
export const MEDIA_QC_ATTENTION_PREFIX = 'Media QC';

export type MediaQcReview = {
  status?: string | null;
  overall?: number | null;
  verdict?: string | null;
  judgment?: string | null;
  next_test?: string | null;
};

export type RemakeCandidate = {
  id?: string;
  status?: string | null;
  content_type?: string | null;
  needs_attention?: boolean | null;
  attention_reason?: string | null;
  media_review?: MediaQcReview | null;
};

export function isMediaQcAttention(reason: string | null | undefined): boolean {
  return String(reason ?? '').startsWith(MEDIA_QC_ATTENTION_PREFIX);
}

export function remakeAttentionReason(review: MediaQcReview): string {
  const score = formatVideoScore(Number(review.overall));
  const verdict =
    review.verdict === 'kill' || review.verdict === 'fix' || review.verdict === 'ship'
      ? review.verdict
      : 'fix';
  const bits = [`${MEDIA_QC_ATTENTION_PREFIX} ${score}/10 (${verdict}) — remake suggested.`];
  const why = String(review.judgment ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (why) bits.push(why);
  const next = String(review.next_test ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (next) bits.push(`Next: ${next}`);
  return bits.join(' ').slice(0, 500);
}

export function shouldProposeRemake(post: RemakeCandidate): boolean {
  if (post.status && post.status !== 'pending_user') return false;
  const ct = String(post.content_type ?? '');
  if (ct === 'text' || ct === 'link' || ct === 'uploaded_image' || ct === 'uploaded_video') return false;
  const r = post.media_review;
  if (!r || String(r.status ?? 'ready') !== 'ready') return false;
  return isWeakMediaScore(r.overall, r.verdict);
}

/** Patch to apply, or null when the row should stay as-is. */
export function remakeFlagPatch(
  post: RemakeCandidate
): { needs_attention: boolean; attention_reason: string | null } | null {
  const ours = isMediaQcAttention(post.attention_reason);
  if (shouldProposeRemake(post)) {
    if (post.needs_attention && !ours) return null;
    const reason = remakeAttentionReason(post.media_review ?? {});
    if (post.needs_attention && post.attention_reason === reason) return null;
    return { needs_attention: true, attention_reason: reason };
  }
  if (ours) return { needs_attention: false, attention_reason: null };
  return null;
}

/**
 * After a media review lands: flag a pending post so the owner can remake it, or clear our
 * previous flag when the new score is fine. Never overwrites a Director / prepublish hold.
 */
export async function maybeFlagPostForMediaRemake(
  supabase: SupabaseClient,
  input: {
    brandId: string;
    postId: string;
    overall: number | null | undefined;
    verdict: string | null | undefined;
    judgment?: string | null;
    next_test?: string | null;
  }
): Promise<boolean> {
  const { data: post } = await supabase
    .from('posts')
    .select('id, status, content_type, needs_attention, attention_reason')
    .eq('id', input.postId)
    .eq('brand_id', input.brandId)
    .maybeSingle();
  if (!post) return false;
  const patch = remakeFlagPatch({
    ...post,
    media_review: {
      status: 'ready',
      overall: input.overall ?? null,
      verdict: input.verdict ?? null,
      judgment: input.judgment ?? null,
      next_test: input.next_test ?? null
    }
  });
  if (!patch) return false;
  const { error } = await supabase
    .from('posts')
    .update(patch)
    .eq('id', input.postId)
    .eq('brand_id', input.brandId);
  if (error) {
    console.warn('[media-qc] flag post', error.message);
    return false;
  }
  return patch.needs_attention;
}

/** Scan pending_user posts and propose remakes for weak media QC. Returns how many were flagged. */
export async function flagWeakPendingPosts(
  supabase: SupabaseClient,
  brandId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('posts')
    .select('id, status, content_type, media_url, media_urls, needs_attention, attention_reason')
    .eq('brand_id', brandId)
    .eq('status', 'pending_user')
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) {
    console.warn('[media-qc] load pending for remake propose', error.message);
    return 0;
  }
  const posts = (data ?? []) as RemakeCandidate[];
  if (!posts.length) return 0;
  const { attachChatMediaReviews } = await import('$lib/server/video-review-store');
  await attachChatMediaReviews(supabase, brandId, posts);
  let flagged = 0;
  for (const post of posts) {
    if (!post.id) continue;
    const patch = remakeFlagPatch(post);
    if (!patch) continue;
    const { error: upErr } = await supabase.from('posts').update(patch).eq('id', post.id).eq('brand_id', brandId);
    if (upErr) {
      console.warn('[media-qc] update remake flag', upErr.message);
      continue;
    }
    if (patch.needs_attention) flagged += 1;
  }
  return flagged;
}
