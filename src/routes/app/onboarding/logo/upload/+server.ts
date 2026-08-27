import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { logOnboardingError } from '$lib/server/onboarding-errors';
import { readUploadImage } from '$lib/server/raster-image';

// Upload a brand logo during onboarding (the "Ecco il tuo brand" step lets the user replace the
// detected logo). Unlike people photos, the logo goes to the PUBLIC media bucket: brand_kit.logos
// stores plain URLs (the detected ones come straight from the site), and the image renderer
// fetches the logo as a long-lived reference — a signed URL would expire under it.
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const fd = await request.formData();
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return new Response('No file', { status: 400 });
  const img = await readUploadImage(file, { maxOutBytes: 4_000_000 });
  if (!img.ok) return new Response(img.error === 'too_large' ? 'Too large' : 'Not an image', { status: 400 });

  const ext = img.mime.includes('png') ? 'png' : 'jpg';
  const path = `${user.id}/onboarding/logo-${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage
    .from('media')
    .upload(path, img.bytes, { contentType: img.mime, upsert: false });
  if (up.error) {
    await logOnboardingError(supabase, user.id, 'logo_upload', up.error.message, { size: file.size, type: file.type });
    return new Response(up.error.message, { status: 400 });
  }

  const url = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
  return new Response(JSON.stringify({ url }), { headers: { 'content-type': 'application/json' } });
};
