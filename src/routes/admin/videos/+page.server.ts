import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RequestEvent } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';

// Founder dashboard for video commissions (internal tool — plain labels, no i18n).
// Gated by public.is_admin() (the admins table); everything else runs under the service-role
// client because fulfilment crosses brands, which user RLS rightly forbids. Delivery uploads the
// clip straight from the browser to Storage via a signed upload URL (serverless bodies are too
// small for video), then the deliver action turns it into a pending_user post on the brand.

async function requireAdmin(locals: RequestEvent['locals']) {
  const { session, user } = await locals.safeGetSession();
  // 404 (not 403) so the admin area's existence isn't advertised to non-admins.
  if (!session || !user) throw error(404, 'Not found');
  const { data } = await locals.supabase.rpc('is_admin');
  if (data !== true) throw error(404, 'Not found');
  return user;
}

export const load: PageServerLoad = async ({ locals }) => {
  await requireAdmin(locals);
  const admin = createAdminClient();

  const { data: requests } = await admin
    .from('video_requests')
    .select('id, brand_id, platform, brief, reference_urls, status, admin_note, delivered_media_url, created_at, delivered_at, month_key')
    .order('created_at', { ascending: false })
    .limit(60);

  const brandIds = [...new Set((requests ?? []).map((r) => String(r.brand_id)))];
  const { data: brands } = brandIds.length
    ? await admin.from('brands').select('id, name, slug, plan').in('id', brandIds)
    : { data: [] as { id: string; name: string; slug: string; plan: string | null }[] };
  const brandById = new Map((brands ?? []).map((b) => [String(b.id), b]));

  return {
    requests: (requests ?? []).map((r) => ({
      ...r,
      reference_urls: Array.isArray(r.reference_urls) ? (r.reference_urls as string[]) : [],
      brand: brandById.get(String(r.brand_id)) ?? null
    }))
  };
};

export const actions: Actions = {
  // Claim a request (requested → in_progress) so the user sees it's being worked on.
  start: async ({ request, locals }) => {
    await requireAdmin(locals);
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'missing_id' });
    const admin = createAdminClient();
    const { error: err } = await admin
      .from('video_requests')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'requested');
    if (err) return fail(500, { error: err.message });
    return { started: id };
  },

  reject: async ({ request, locals }) => {
    await requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const note = String(form.get('note') ?? '').trim();
    if (!id) return fail(400, { error: 'missing_id' });
    const admin = createAdminClient();
    const { error: err } = await admin
      .from('video_requests')
      .update({ status: 'rejected', admin_note: note || null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .in('status', ['requested', 'in_progress']);
    if (err) return fail(500, { error: err.message });
    return { rejected: id };
  },

  // Step 1 of delivery: a signed upload URL so the browser sends the clip straight to Storage
  // (serverless request bodies cap out far below video sizes).
  uploadUrl: async ({ request, locals }) => {
    await requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const ext = (String(form.get('ext') ?? 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4').slice(0, 5);
    if (!id) return fail(400, { error: 'missing_id' });
    const admin = createAdminClient();
    const { data: req } = await admin.from('video_requests').select('id, requested_by').eq('id', id).maybeSingle();
    if (!req) return fail(404, { error: 'request_not_found' });
    // Keep the {userId}/… media-bucket convention (the requester "owns" the delivered asset).
    const path = `${req.requested_by}/founder/${crypto.randomUUID()}.${ext}`;
    const { data, error: err } = await admin.storage.from('media').createSignedUploadUrl(path);
    if (err || !data) return fail(500, { error: err?.message ?? 'sign_failed' });
    return { uploadPath: data.path, uploadToken: data.token, forId: id };
  },

  // Step 2: the clip is in Storage — turn it into a pending_user post on the brand and flip the
  // request to delivered. The user finds the video in Contenuti exactly like any generated post.
  deliver: async ({ request, locals }) => {
    await requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const path = String(form.get('path') ?? '');
    const caption = String(form.get('caption') ?? '').trim();
    if (!id || !path) return fail(400, { error: 'missing_fields' });
    const admin = createAdminClient();
    const { data: req } = await admin
      .from('video_requests')
      .select('id, brand_id, platform, brief, status')
      .eq('id', id)
      .maybeSingle();
    if (!req) return fail(404, { error: 'request_not_found' });
    if (req.status === 'delivered') return fail(400, { error: 'already_delivered' });

    const mediaUrl = admin.storage.from('media').getPublicUrl(path).data.publicUrl;
    const { data: post, error: postErr } = await admin
      .from('posts')
      .insert({
        brand_id: req.brand_id,
        platform: (req.platform as string | null) || 'instagram',
        content_type: 'generated_video',
        source: 'founder',
        caption: caption || null,
        media_url: mediaUrl,
        // ContentFormat enum value ('reel' is a legacy alias readers still normalise to 'video').
        format: 'video',
        status: 'pending_user'
      })
      .select('id')
      .single();
    if (postErr || !post) return fail(500, { error: postErr?.message ?? 'post_insert_failed' });

    const { error: reqErr } = await admin
      .from('video_requests')
      .update({
        status: 'delivered',
        delivered_media_url: mediaUrl,
        delivered_post_id: post.id,
        delivered_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id);
    if (reqErr) return fail(500, { error: reqErr.message });
    return { delivered: id };
  }
};
