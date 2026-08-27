import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { withBrandContext } from '$lib/server/ai-log';
import { extraReviewOpts, parseVideoStandard, resolveReviewVideoUrl, reviewVideo } from '$lib/server/video-review';
import { createAdminClient } from '$lib/server/supabase-admin';
import { briefFor, positionAgainst } from '$lib/server/market-brief';
import { persistReadyReview } from '$lib/server/video-review-store';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug!, apiKey);
  if (brandError) return brandError;

  const gated = await gateAiAction(brand, apiKey);
  if (gated) return gated;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const standard =
    parseVideoStandard(body.standard) ?? (body.ugc_ad === true || body.ugcAd === true ? 'ads' : 'organic');
  const resolved = await resolveReviewVideoUrl(supabase, brand.id, {
    url: typeof body.url === 'string' ? body.url : null,
    postId: typeof body.post_id === 'string' ? body.post_id : null
  });
  if ('error' in resolved) {
    return json({ error: resolved.error }, { status: resolved.error === 'post_not_found' ? 404 : 400 });
  }

  const prefs = brand.content_prefs;
  const language =
    prefs && typeof prefs === 'object' ? String((prefs as { language?: string }).language ?? '') : '';

  const result = await withBrandContext(brand.id, () =>
    reviewVideo(resolved.url, {
      standard,
      brandName: brand.name,
      product:
        (typeof body.product === 'string' && body.product.trim()) || resolved.product || null,
      caption:
        (typeof body.caption === 'string' && body.caption.trim()) || resolved.caption || null,
      script: typeof body.script === 'string' ? body.script.trim() : null,
      language: language || null,
      ...extraReviewOpts(resolved)
    })
  );
  if (!result.ok) return json({ error: result.error }, { status: 422 });
  await persistReadyReview(supabase, {
    brandId: brand.id,
    url: resolved.url,
    postId: typeof body.post_id === 'string' ? body.post_id : null,
    standard,
    review: result.review,
    kind: extraReviewOpts(resolved).kind
  });
  // Where this sits against the market, computed AFTER the review and attached beside it.
  //
  // Deliberately not folded into the judge: the rubric stays fixed and versioned so a score from
  // this release and one from the next remain comparable, and market findings entering the prompt
  // would rescale that history at every change. So the score is produced first, untouched, and the
  // comparison is layered on top — a query, not a second instrument.
  //
  // It also never fails the request. A market block is a bonus; a review that 500s because a cohort
  // query timed out would be a worse product than one with no comparison in it.
  let market = null;
  try {
    const brief = await briefFor(createAdminClient(), {
      category: typeof body.category === 'string' ? body.category : null,
      contentForm: typeof body.content_form === 'string' ? body.content_form : null
    });
    if (brief.level !== 'none') market = positionAgainst(result.review, brief);
  } catch (e) {
    console.error('[videos/review] market position failed:', e instanceof Error ? e.message : e);
  }

  return json({ ok: true, review: result.review, market });
};
