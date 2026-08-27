import { json } from '@sveltejs/kit';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import type { RequestHandler } from './$types';

/** DELETE — revoke an API key */
export const DELETE: RequestHandler = async ({ request, params }) => {
  const auth = await authenticate(request);
  if (auth.error) return auth.error;

  const { brand, error: brandError } = await loadBrandForUser(auth.supabase, params.slug, auth.apiKey);
  if (brandError) return brandError;

  // Own keys only: the API-key path is service-role, so RLS is not doing this for us. And the key
  // must actually belong to THIS brand (same filter GET lists with): on user_id alone, a key
  // scoped to brand A could revoke the keys of brand B under the same owner.
  const { data: key } = await auth.supabase
    .from('api_keys')
    .select('id, permissions')
    .eq('id', params.id)
    .eq('user_id', auth.user.id)
    .maybeSingle();
  const brandIds = (key?.permissions as { brand_ids?: string[] | '*' } | null)?.brand_ids;
  if (!key || !(brandIds === '*' || (Array.isArray(brandIds) && brandIds.includes(brand.id)))) {
    return json({ error: 'API key not found' }, { status: 404 });
  }

  const { error } = await auth.supabase
    .from('api_keys')
    .delete()
    .eq('id', params.id)
    .eq('user_id', auth.user.id);

  if (error) return json({ error: error.message }, { status: 500 });

  return json({ deleted: true });
};
