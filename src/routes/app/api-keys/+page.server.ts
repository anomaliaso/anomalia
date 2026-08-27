import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { generateApiKey } from '$lib/server/cli-auth';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw redirect(303, '/login');

  const { data: keys } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, permissions, created_at, last_used_at')
    .order('created_at', { ascending: false });

  // Load brand names for display
  const { data: brands } = await supabase
    .from('brands')
    .select('id, name, slug');

  const brandMap = new Map((brands ?? []).map((b) => [b.id, b]));

  // Enrich keys with brand names
  const enriched = (keys ?? []).map((k: any) => {
    const bids = k.permissions?.brand_ids;
    const brandNames = bids === '*'
      ? null // means "all"
      : Array.isArray(bids)
        ? bids.map((id: string) => brandMap.get(id)?.name ?? id)
        : [];
    return { ...k, brandNames };
  });

  return { keys: enriched, brands: brands ?? [] };
};

export const actions: Actions = {
  createApiKey: async ({ request, locals: { supabase } }) => {
    const data = await request.formData();
    const name = String(data.get('key_name') ?? '').trim() || 'API Key';
    const writeAccess = String(data.get('write') ?? '') === 'true';
    const allBrands = String(data.get('all_brands') ?? '') === 'true';
    const selectedBrands = data.getAll('brand_ids').map(String);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail(401, { apiKeyError: 'Not authenticated' });

    const { raw, hash, prefix } = await generateApiKey();

    const permissions = {
      brand_ids: allBrands ? '*' : selectedBrands,
      scopes: writeAccess ? ['read', 'write'] : ['read']
    };

    const { error } = await supabase
      .from('api_keys')
      .insert({ user_id: user.id, name, key_hash: hash, key_prefix: prefix, permissions });

    if (error) return fail(500, { apiKeyError: error.message });

    return { apiKeyCreated: true, apiKeyRaw: raw, apiKeyName: name };
  },

  revokeApiKey: async ({ request, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('key_id') ?? '');
    if (!id) return fail(400, { apiKeyError: 'Missing key ID' });

    const { error } = await supabase.from('api_keys').delete().eq('id', id);
    if (error) return fail(500, { apiKeyError: error.message });

    return { apiKeyRevoked: true };
  }
};
