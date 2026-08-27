import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import {
  listBrandMediaReviews,
  queueVideoReview,
  kickVideoReviewWork,
  requestPostMediaReview,
  type MediaReviewStatusFilter
} from '$lib/server/video-review-store';

export const load: PageServerLoad = async ({ parent, url, locals: { supabase } }) => {
  const { brand } = await parent();
  const raw = url.searchParams.get('status');
  const status: MediaReviewStatusFilter =
    raw === 'ready' || raw === 'failed' || raw === 'pending' ? raw : 'all';
  const requestedPage = Math.max(1, Number(url.searchParams.get('page')) || 1);

  const logs = await listBrandMediaReviews(supabase, brand.id, {
    status,
    page: requestedPage
  });

  return {
    filter: status,
    reviews: logs.rows,
    counts: logs.counts,
    pagination: {
      page: logs.page,
      pageSize: logs.pageSize,
      total: logs.total,
      totalPages: logs.totalPages
    }
  };
};

export const actions: Actions = {
  requestReview: async ({ request, params, url, locals: { supabase } }) => {
    const data = await request.formData();
    const postId = String(data.get('post_id') ?? '').trim();
    const reviewId = String(data.get('review_id') ?? '').trim();
    const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });

    if (postId) {
      // Manuale: è una persona che preme "richiedi review" in questa pagina, quindi passa anche
      // con l'automatismo spento (AUTO_VIDEO_REVIEW_ENABLED).
      const r = await requestPostMediaReview(supabase, {
        brandId: brand.id,
        postId,
        origin: url.origin,
        force: true,
        manual: true
      });
      if (!r.queued && r.skippedRunning) return { reviewQueued: 0, skippedRunning: r.skippedRunning };
      if (!r.queued) return fail(400, { error: 'No reviewable media' });
      return { reviewQueued: r.queued, skippedRunning: r.skippedRunning };
    }

    if (!reviewId) return fail(400, { error: 'Missing review' });
    const { data: row } = await supabase
      .from('video_reviews')
      .select('media_url, post_id, standard')
      .eq('id', reviewId)
      .eq('brand_id', brand.id)
      .maybeSingle();
    if (!row) return fail(404, { error: 'Review not found' });
    if (row.post_id) {
      const r = await requestPostMediaReview(supabase, {
        brandId: brand.id,
        postId: String(row.post_id),
        origin: url.origin,
        force: true,
        manual: true
      });
      return { reviewQueued: r.queued, skippedRunning: r.skippedRunning };
    }
    const ok = await queueVideoReview(
      supabase,
      {
        brandId: brand.id,
        url: String(row.media_url ?? ''),
        standard: row.standard === 'ads' ? 'ads' : 'organic'
      },
      { force: true, manual: true }
    );
    if (ok) await kickVideoReviewWork(url.origin, brand.id);
    return { reviewQueued: ok ? 1 : 0, skippedRunning: ok ? 0 : 1 };
  }
};
