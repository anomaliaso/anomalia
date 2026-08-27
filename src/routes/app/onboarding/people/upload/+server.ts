import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { logOnboardingError } from '$lib/server/onboarding-errors';
import { readUploadImage } from '$lib/server/raster-image';

// Onboarding has no brand row yet, so a person's photos are uploaded here under the user's own
// folder in the private brand-knowledge bucket. Returns the storage path (persisted on the people
// row at completion) plus a short-lived signed URL the preview generator can fetch as a reference.
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const fd = await request.formData();
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return new Response('No file', { status: 400 });
  const img = await readUploadImage(file);
  if (!img.ok) return new Response(img.error === 'too_large' ? 'Too large' : 'Not an image', { status: 400 });

  const path = `${user.id}/onboarding/${crypto.randomUUID()}-${img.filename}`;
  const up = await supabase.storage
    .from('brand-knowledge')
    .upload(path, img.bytes, { contentType: img.mime, upsert: false });
  if (up.error) {
    await logOnboardingError(supabase, user.id, 'people_upload', up.error.message, { size: file.size, type: file.type });
    return new Response(up.error.message, { status: 400 });
  }

  const { data } = await supabase.storage.from('brand-knowledge').createSignedUrl(path, 60 * 60 * 2);
  return new Response(JSON.stringify({ path, url: data?.signedUrl ?? null }), {
    headers: { 'content-type': 'application/json' }
  });
};
