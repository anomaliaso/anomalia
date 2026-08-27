import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import { extraReviewOpts, parseVideoStandard, resolveReviewVideoUrl, reviewVideo } from '$lib/server/video-review';
import { CreditsExhaustedError } from '$lib/server/credits';
import { loadCachedReview, persistReadyReview } from '$lib/server/video-review-store';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const GET: RequestHandler = async ({ url, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  const mediaUrl = url.searchParams.get('url')?.trim() ?? '';
  const postId = url.searchParams.get('post_id')?.trim() ?? '';
  const standard = parseVideoStandard(url.searchParams.get('standard')) ?? 'organic';
  const resolved = await resolveReviewVideoUrl(supabase, brand.id, { url: mediaUrl, postId });
  if ('error' in resolved) {
    return json({ error: resolved.error }, { status: resolved.error === 'post_not_found' ? 404 : 400 });
  }
  const review = await loadCachedReview(supabase, brand.id, resolved.url, standard);
  if (!review) return json({ ok: true, review: null });
  return json({ ok: true, review });
};

export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, content_prefs')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  let body: {
    url?: string;
    standard?: string;
    product?: string;
    caption?: string;
    script?: string;
    post_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON');
  }

  const standard = parseVideoStandard(body.standard) ?? 'organic';
  const resolved = await resolveReviewVideoUrl(supabase, brand.id, {
    url: body.url,
    postId: body.post_id
  });
  if ('error' in resolved) {
    return json({ error: resolved.error }, { status: resolved.error === 'post_not_found' ? 404 : 400 });
  }

  const language =
    brand.content_prefs && typeof brand.content_prefs === 'object'
      ? String((brand.content_prefs as { language?: string }).language ?? '')
      : '';

  try {
    const result = await withBrandContext(brand.id, () =>
      reviewVideo(resolved.url, {
        standard,
        brandName: brand.name,
        product: (typeof body.product === 'string' && body.product.trim()) || resolved.product || null,
        caption: (typeof body.caption === 'string' && body.caption.trim()) || resolved.caption || null,
        script: typeof body.script === 'string' ? body.script.trim() : null,
        language: language || null,
        ...extraReviewOpts(resolved)
      })
    );
    if (!result.ok) return json({ error: result.error }, { status: 422 });
    await persistReadyReview(supabase, {
      brandId: brand.id,
      url: resolved.url,
      postId: body.post_id ?? null,
      standard,
      review: result.review,
      kind: extraReviewOpts(resolved).kind
    });
    return json({ ok: true, review: result.review });
  } catch (e) {
    if (e instanceof CreditsExhaustedError) return json({ error: 'credits_exhausted' }, { status: 402 });
    throw e;
  }
};
