import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import { founderVideoBudget, createVideoRequest } from '$lib/server/video-requests';
import { readUploadImage } from '$lib/server/raster-image';

// File a founder-video commission: brief + optional reference images, capped per month by the
// brand's plan tier (founderVideoQuota). No AI runs here — the request lands in the founders'
// /admin/videos queue and the finished clip comes back as a pending_user post on the brand.

const MAX_REFS = 3;
const MAX_REF_BYTES = 6_000_000;

export const POST: RequestHandler = async ({ params, request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, plan, timezone')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return json({ error: 'brand_not_found' }, { status: 404 });

  const budget = await founderVideoBudget(supabase, brand.id, brand.plan, brand.timezone);
  if (budget.quota <= 0) return json({ error: 'not_in_plan' }, { status: 400 });
  if (budget.remaining <= 0) return json({ error: 'quota' }, { status: 400 });

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'bad_request' }, { status: 400 });
  const platform = String(form.get('platform') ?? '').toLowerCase().trim();
  const brief = String(form.get('brief') ?? '').trim();
  if (!brief) return json({ error: 'missing_brief' }, { status: 400 });

  // Reference images → the public media bucket, so the founders see exactly what the user sees.
  const referenceUrls: string[] = [];
  for (const entry of form.getAll('refs').slice(0, MAX_REFS)) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    const img = await readUploadImage(entry, { maxOutBytes: MAX_REF_BYTES });
    if (!img.ok) continue;
    const ext = img.mime.includes('png') ? 'png' : 'jpg';
    const path = `${user.id}/requests/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from('media')
      .upload(path, img.bytes, { contentType: img.mime, upsert: false });
    if (!error) referenceUrls.push(supabase.storage.from('media').getPublicUrl(path).data.publicUrl);
  }

  const res = await createVideoRequest(supabase, {
    brandId: brand.id,
    userId: user.id,
    tz: brand.timezone,
    platform,
    brief,
    referenceUrls
  });
  if ('error' in res) return json({ error: res.error }, { status: 500 });
  return json({ ok: true, id: res.id, remaining: budget.remaining - 1 });
};
