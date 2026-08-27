import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRasterImageSource } from '$lib/raster-image';
import { readUploadImage } from '$lib/server/raster-image';

// POST (multipart): the onboarding materials upload. Stores the user's photos/videos in the private
// brand-knowledge bucket and records them as brand_documents — exactly where the content renderer
// later picks up the brand's own reference shots. Server-side upload (user-scoped client, same RLS
// path as the Studio upload) so the chat UI doesn't need the browser Supabase client.
export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  const form = await request.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return json({ error: 'No files' }, { status: 400 });

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const file of files.slice(0, 20)) {
    const isVideo = file.type.startsWith('video/');
    const isImage = !isVideo && isRasterImageSource({ mime: file.type, filename: file.name });
    if (!isImage && !isVideo) { skipped++; continue; }
    if (isVideo) {
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().slice(0, 5);
      const path = `${user.id}/${brand.id}/onboarding/${crypto.randomUUID()}.${ext}`;
      const buf = Buffer.from(await file.arrayBuffer());
      const { error: upErr } = await supabase.storage.from('brand-knowledge').upload(path, buf, { contentType: file.type || 'video/mp4', upsert: false });
      if (upErr) { skipped++; continue; }
      rows.push({
        brand_id: brand.id,
        kind: 'document',
        title: file.name,
        file_url: path,
        file_name: file.name,
        mime_type: file.type
      });
      continue;
    }
    const img = await readUploadImage(file);
    if (!img.ok) { skipped++; continue; }
    const ext = img.mime.includes('png') ? 'png' : 'jpg';
    const path = `${user.id}/${brand.id}/onboarding/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('brand-knowledge').upload(path, img.bytes, { contentType: img.mime, upsert: false });
    if (upErr) { skipped++; continue; }
    rows.push({
      brand_id: brand.id,
      kind: 'image',
      title: img.filename,
      file_url: path,
      file_name: img.filename,
      mime_type: img.mime
    });
  }

  if (rows.length) {
    const { error } = await supabase.from('brand_documents').insert(rows);
    if (error) return json({ error: error.message }, { status: 500 });
  }

  return json({ uploaded: rows.length, skipped });
};
