import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import { fetchSocialVisualRefs } from '$lib/server/design-visual-refs';

// Social CDNs (Instagram etc.) send Cross-Origin-Resource-Policy: same-origin, so the browser
// refuses to render their thumbnails in our page. We archive each thumb into OUR storage and serve
// a signed URL — same path the chat tool `fetch_social_thumbs` uses.
export const POST: RequestHandler = async ({ params, request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'brand_not_found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const platform = String(body?.platform ?? '').trim().toLowerCase();
  const handle = String(body?.handle ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!platform || !handle) return json({ error: 'missing_fields' }, { status: 400 });

  const { thumbs, error } = await fetchSocialVisualRefs(platform, handle);
  if (error && !thumbs.length) return json({ error, thumbs: [] }, { status: 502 });
  return json({ thumbs: thumbs.map((t) => t.url) });
};
