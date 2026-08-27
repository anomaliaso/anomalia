import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readUploadImage } from '$lib/server/raster-image';

// Inline image upload for the article editor: stores to the public media bucket and returns the URL
// so the editor can insert a Markdown ![](url) at the cursor.
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');
  const file = (await request.formData()).get('file');
  if (!(file instanceof File) || file.size === 0) throw error(400, 'No file');
  const img = await readUploadImage(file, { maxOutBytes: 5_000_000 });
  if (!img.ok) throw error(400, img.error === 'too_large' ? 'Too large' : 'Not an image');
  const ext = img.mime.includes('png') ? 'png' : 'jpg';
  const path = `${user.id}/blog/inline-${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from('media').upload(path, img.bytes, { contentType: img.mime, upsert: false });
  if (up.error) throw error(400, up.error.message);
  return json({ url: supabase.storage.from('media').getPublicUrl(path).data.publicUrl });
};
