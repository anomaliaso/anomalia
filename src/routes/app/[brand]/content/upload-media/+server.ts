import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';

// "Carica media" — the user uploaded a photo/video from their device straight to the `media`
// bucket (browser → Storage, own-folder RLS; serverless bodies are too small for video). This
// endpoint turns that stored file into a pending_user post. No AI runs and no quota is charged.
export const POST: RequestHandler = async ({ params, request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'brand_not_found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { path?: string; platform?: string; caption?: string; isVideo?: boolean } | null;
  const path = String(body?.path ?? '');
  // Only files the user just uploaded to their own uploads folder can become posts.
  if (!path.startsWith(`${user.id}/uploads/`)) return json({ error: 'bad_request' }, { status: 400 });
  const platform = String(body?.platform ?? '').toLowerCase().trim() || 'instagram';
  const isVideo = body?.isVideo === true;

  const mediaUrl = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
  const contentType = isVideo ? 'uploaded_video' : 'uploaded_image';
  const { data: row, error: insErr } = await supabase
    .from('posts')
    .insert({
      brand_id: brand.id,
      platform,
      content_type: contentType,
      source: 'manual',
      caption: String(body?.caption ?? '').trim() || null,
      media_url: mediaUrl,
      format: isVideo ? 'reel' : 'post',
      status: 'pending_user'
    })
    .select('id')
    .single();
  if (insErr || !row) return json({ error: insErr?.message ?? 'insert_failed' }, { status: 500 });

  return json({ ok: true, id: row.id, contentType });
};
