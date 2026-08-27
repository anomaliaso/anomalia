import { swallow } from '$lib/server/swallow';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { insertMediaGeneratorItem } from '$lib/server/media-generator/persist';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

/**
 * Put an image the user already has into the Media generation history, so it can be reused as a
 * reference exactly like a generated one. Takes the same downscaled data URL the chat composer
 * builds for attachments — no new upload pipeline, no multipart parsing.
 */
export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  let body: { dataUrl?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON');
  }

  const [header, base64] = String(body.dataUrl ?? '').split(',');
  const mime = header?.match(/^data:(image\/[a-z+]+);base64$/i)?.[1];
  if (!mime || !base64) throw error(400, 'Expected an image data URL');

  const bytes = Buffer.from(base64, 'base64');
  // 12MB after the client-side downscale means something is off — refuse rather than fill storage.
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw error(413, 'Image too large');

  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const path = `${user.id}/media-generator/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from('media').upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) {
    console.error('[media-generator/import] upload failed:', up.error.message);
    throw error(500, 'Upload failed');
  }

  const url = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
  const res = await insertMediaGeneratorItem(supabase, {
    brandId: brand.id,
    userId: user.id,
    kind: 'image',
    url,
    // The history keys off `prompt`; for an import the file name is the only honest label.
    prompt: String(body.name ?? '').slice(0, 200) || 'Imported image'
  });
  if ('error' in res) {
    await supabase.storage.from('media').remove([path]).catch(swallow('remove failed'));
    throw error(500, res.error);
  }

  return json({ ok: true, item: res.row });
};
