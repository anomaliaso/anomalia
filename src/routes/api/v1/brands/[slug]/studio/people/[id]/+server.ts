import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

export const DELETE: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  // Delete person and their images from storage
  const { data: person } = await supabase
    .from('people').select('images').eq('id', params.id).eq('brand_id', brand.id).maybeSingle();

  if (!person) return json({ error: 'Person not found' }, { status: 404 });

  // Remove images from storage (mirrors the web deletePerson action)
  if (Array.isArray(person.images) && person.images.length) {
    const paths = (person.images as Array<{ path?: string }>)
      .map((i) => i?.path)
      .filter((p): p is string => Boolean(p));
    if (paths.length) {
      await supabase.storage.from('brand-knowledge').remove(paths);
    }
  }

  const { error: deleteError } = await supabase
    .from('people').delete().eq('id', params.id);

  if (deleteError) return json({ error: deleteError.message }, { status: 500 });
  return json({ ok: true });
};
