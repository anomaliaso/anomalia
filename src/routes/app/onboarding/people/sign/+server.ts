import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';

// Re-sign brand-knowledge storage paths after an onboarding resume: the signed URLs captured during
// the original upload/import expire, so on rehydration the client asks for fresh ones to show the
// people thumbnails (and feed the preview generator). Scoped to the caller's own folder.
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  let body: { paths?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const paths = Array.isArray(body?.paths)
    ? body.paths.filter((p): p is string => typeof p === 'string' && p.startsWith(`${user.id}/`)).slice(0, 32)
    : [];

  const urls: Record<string, string> = {};
  for (const path of paths) {
    const { data } = await supabase.storage.from('brand-knowledge').createSignedUrl(path, 60 * 60 * 2);
    if (data?.signedUrl) urls[path] = data.signedUrl;
  }
  return new Response(JSON.stringify({ urls }), { headers: { 'content-type': 'application/json' } });
};
