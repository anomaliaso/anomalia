import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import { createManualPost, normalizePlatforms, type ManualPostMode } from '$lib/server/manual-posting';

export const POST: RequestHandler = async ({ params, request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, timezone')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return json({ error: 'brand_not_found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'bad_request' }, { status: 400 });

  const modeRaw = String(body.mode ?? 'draft');
  const mode: ManualPostMode = modeRaw === 'now' || modeRaw === 'schedule' ? modeRaw : 'draft';
  const platforms = normalizePlatforms(body.platforms);
  const platformCaptions =
    body.platformCaptions && typeof body.platformCaptions === 'object' && !Array.isArray(body.platformCaptions)
      ? Object.fromEntries(
          Object.entries(body.platformCaptions as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
        )
      : {};

  const result = await createManualPost({
    supabase,
    userId: user.id,
    brandId: brand.id,
    timezone: brand.timezone ?? 'Europe/Rome',
    input: {
      platforms,
      caption: String(body.caption ?? ''),
      platformCaptions,
      mediaPaths: Array.isArray(body.mediaPaths) ? body.mediaPaths.map(String) : [],
      libraryIds: Array.isArray(body.libraryIds) ? body.libraryIds.map(String) : [],
      isVideo: body.isVideo === true,
      title: typeof body.title === 'string' ? body.title : undefined,
      subreddit: typeof body.subreddit === 'string' ? body.subreddit : undefined,
      linkUrl: typeof body.linkUrl === 'string' ? body.linkUrl : undefined,
      mode,
      date: typeof body.date === 'string' ? body.date : undefined,
      time: typeof body.time === 'string' ? body.time : undefined
    }
  });

  if (!result.ok) {
    const status =
      result.error === 'over_limit' ||
      result.error === 'need_caption' ||
      result.error === 'need_media' ||
      result.error === 'need_video' ||
      result.error === 'no_platforms' ||
      result.error === 'reddit_title' ||
      result.error === 'too_soon'
        ? 400
        : 500;
    return json({ error: result.error }, { status });
  }

  return json({
    ok: true,
    id: result.id,
    status: result.status,
    noAccount: result.noAccount === true
  });
};
