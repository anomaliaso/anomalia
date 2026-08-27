import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { suggestBioUrl, validateBioUrl } from '$lib/server/post-links';

// Bio link manager: reads/writes social_accounts.bio_url (the "link in bio" destination, migration
// 0151) and surfaces the best short link to put there (suggestBioUrl: the post_links row with the
// most clicks in the last 7 days).
//
// The "copy in bio" step is MANUAL by design: Zernio does not expose bio updates through the
// publishing API, so Anomalia can never write the bio for you. This endpoint only STORES the value
// the user pastes by hand (PUT) and tells them what to paste (GET.suggested). An agent or the
// studio UI can read `suggested` and have the user apply it, then PUT the result back.

/** Resolve the account the bio lives on: the platform filter when given, else the first active one. */
async function bioAccount(supabase: SupabaseClient, brandId: string, platform?: string | null) {
  let q = supabase
    .from('social_accounts')
    .select('id, platform, bio_url')
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .order('connected_at', { ascending: true })
    .limit(1);
  if (platform) q = q.eq('platform', platform);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const platform = url.searchParams.get('platform');
  const account = await bioAccount(supabase, brand.id, platform);
  const suggested = await suggestBioUrl(supabase, brand.id).catch((error) => { swallow('suggest bio url', error); return null; });
  return json({ bioUrl: account?.bio_url ?? null, suggested });
};

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid body' }, { status: 400 });
  }
  const platform = typeof body.platform === 'string' && body.platform.trim() ? body.platform.trim() : null;
  const check = validateBioUrl(typeof body.bio_url === 'string' ? body.bio_url : null);
  if (!check.ok) return json({ error: check.error }, { status: 400 });
  const bioUrl = check.value;

  // Ownership: loadBrandForUser already scoped this brand to the caller; the account is resolved
  // and updated within that brand, so a caller can never touch another brand's bio.
  const account = await bioAccount(supabase, brand.id, platform);
  if (!account) return json({ error: 'No active social account' }, { status: 404 });

  const { error: updateError } = await supabase
    .from('social_accounts')
    .update({ bio_url: bioUrl })
    .eq('id', account.id);
  if (updateError) return json({ error: updateError.message }, { status: 500 });

  return json({ ok: true, bioUrl });
};
