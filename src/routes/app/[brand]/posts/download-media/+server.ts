import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { zipPostMedia } from '$lib/server/download-post-media';

/**
 * POST { ids: string[] } → ZIP of media for the selected social posts.
 * Used by calendar multi-select and the single-post download action.
 */
export const POST: RequestHandler = async ({ params, request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const { data: brand } = await supabase.from('brands').select('id, slug').eq('slug', params.brand).maybeSingle();
  if (!brand) return new Response('Brand not found', { status: 404 });

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids)
    ? (body.ids as unknown[]).map((x) => String(x)).filter(Boolean)
    : typeof body?.id === 'string'
      ? [body.id]
      : [];
  if (!ids.length) return new Response('Missing ids', { status: 400 });
  if (ids.length > 40) return new Response('Too many posts (max 40)', { status: 400 });

  const { data: posts, error } = await supabase
    .from('posts')
    .select('id, platform, media_url, media_urls')
    .eq('brand_id', brand.id)
    .in('id', ids);
  if (error) return new Response(error.message, { status: 500 });
  if (!posts?.length) return new Response('No posts found', { status: 404 });

  const result = await zipPostMedia(posts);
  if ('error' in result) return new Response(result.error, { status: result.status });

  const filename =
    posts.length === 1
      ? `anomalia-media-${posts[0].id.slice(0, 8)}.zip`
      : `anomalia-media-${posts.length}-posts.zip`;

  return new Response(Buffer.from(result.zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });
};
