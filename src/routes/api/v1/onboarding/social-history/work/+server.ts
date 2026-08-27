import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cronAuthorized } from '$lib/server/cron-auth';
import { runSocialHistoryForBrand } from '$lib/server/social-history-work';

/** Own budget — create redirects immediately; social analysis does not share that request. */
export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request }) => {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  let brandId = '';
  try {
    const body = await request.json();
    brandId = typeof body?.brandId === 'string' ? body.brandId.trim() : '';
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  if (!brandId) return new Response('Missing brandId', { status: 400 });

  try {
    const result = await runSocialHistoryForBrand(brandId);
    return json({ ok: true, ...result });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
};
