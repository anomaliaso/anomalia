import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { postMediaTarget } from '$lib/server/post-media';
import { restructureCarouselSlides } from '$lib/agent/tools/post-editor-tools';

// POST { order } — reorder or drop slides. Renders nothing, so no credits gate.
export const POST: RequestHandler = async ({ request, params }) => {
  const r = await postMediaTarget(request, params.slug, params.id);
  if (r.error) return r.error;

  const { order } = (await request.json().catch(() => ({}))) as { order?: number[] };
  if (!Array.isArray(order) || !order.length) {
    return json({ error: 'Missing order' }, { status: 400 });
  }

  const res = await restructureCarouselSlides(r.t, { order });
  return json(res, { status: res.error ? 400 : 200 });
};
