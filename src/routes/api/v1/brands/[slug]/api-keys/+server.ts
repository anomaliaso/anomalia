import { json } from '@sveltejs/kit';
import { authenticate, loadBrandForUser, generateApiKey, checkApiKeyBrandAccess } from '$lib/server/cli-auth';
import type { RequestHandler } from './$types';

/** GET — list API keys for the brand (never returns raw keys) */
export const GET: RequestHandler = async ({ request, params }) => {
  const auth = await authenticate(request);
  if (auth.error) return auth.error;

  const { brand, error: brandError } = await loadBrandForUser(auth.supabase, params.slug, auth.apiKey);
  if (brandError) return brandError;

  const brandAccess = checkApiKeyBrandAccess(auth.apiKey, brand.id);
  if (brandAccess) return brandAccess;

  // Own keys only — the API-key path runs as service-role, so the user filter can't be left to RLS.
  const { data: keys, error } = await auth.supabase
    .from('api_keys')
    .select('id, name, key_prefix, permissions, created_at, last_used_at')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false });

  if (error) return json({ error: error.message }, { status: 500 });

  // Filter to keys that have access to this brand
  const filtered = (keys ?? []).filter((k: any) => {
    const brandIds = k.permissions?.brand_ids;
    return brandIds === '*' || (Array.isArray(brandIds) && brandIds.includes(brand.id));
  });

  return json({ keys: filtered });
};

/** POST — create a new API key. Returns the raw key once. */
export const POST: RequestHandler = async ({ request, params }) => {
  const auth = await authenticate(request);
  if (auth.error) return auth.error;

  // Minting requires a full session. Clamping a key-minted key to its parent's boundaries is not
  // enough: the child is an independent row, so it outlives the revocation of the parent and a
  // stolen key becomes permanent. No mint chain — a human session is the only way to create keys.
  if (auth.apiKey) {
    return json({ error: 'API keys cannot create API keys — sign in with the CLI' }, { status: 403 });
  }

  const { brand, error: brandError } = await loadBrandForUser(auth.supabase, params.slug, auth.apiKey);
  if (brandError) return brandError;

  const body = await request.json().catch(() => ({}));
  const name: string = (body.name || '').trim() || 'API Key';
  const requestedScopes: string[] = Array.isArray(body.scopes) ? body.scopes : ['read'];
  const allBrands: boolean = body.all_brands === true;

  // Validate scopes
  const validScopes = requestedScopes.filter((s) => s === 'read' || s === 'write');
  if (!validScopes.includes('read')) validScopes.push('read');

  const { raw, hash, prefix } = await generateApiKey();

  // API-key requests are always brand-scoped to this brand — which is within the key's own scope
  // because loadBrandForUser just verified access.
  const permissions = {
    brand_ids: allBrands ? '*' : [brand.id],
    scopes: validScopes
  };

  const { data, error } = await auth.supabase
    .from('api_keys')
    .insert({
      user_id: auth.user.id,
      name,
      key_hash: hash,
      key_prefix: prefix,
      permissions
    })
    .select('id, name, key_prefix, permissions, created_at')
    .single();

  if (error) return json({ error: error.message }, { status: 500 });

  return json({
    key: { ...data, raw },
    message: 'Copy this key now — you will not be able to see it again.'
  }, { status: 201 });
};
