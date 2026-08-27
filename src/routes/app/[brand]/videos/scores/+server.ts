import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isReviewableMediaUrl } from '$lib/content-formats';
import { loadBadgeForUrl, loadVideoScoreBadges, mediaUrlHash } from '$lib/server/video-review-store';

export const GET: RequestHandler = async ({ url, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  const one = url.searchParams.get('url')?.trim() ?? '';
  const many = url.searchParams.getAll('urls').flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  const urls = [...new Set([one, ...many].filter((u) => isReviewableMediaUrl(u)))].slice(0, 40);

  if (urls.length === 1) {
    const badge = await loadBadgeForUrl(supabase, brand.id, urls[0]);
    return json({ ok: true, badge });
  }
  if (!urls.length) return json({ ok: true, badges: [] });

  const map = await loadVideoScoreBadges(supabase, brand.id, urls);
  const badges = urls.map((u) => map.get(mediaUrlHash(u)) ?? map.get(u) ?? null);
  return json({ ok: true, badges });
};
