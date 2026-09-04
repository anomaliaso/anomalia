import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { buildCreationKit } from '$lib/server/creation-kit';
import { GET_CREATION_KIT, statusForFailure } from '@anomalia/api-contracts';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const parsed = GET_CREATION_KIT.input.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const platforms = [
    ...new Set(
      parsed.data.platforms
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)
    )
  ];
  if (!platforms.length) {
    return json({ error: 'no_platforms' }, { status: statusForFailure(GET_CREATION_KIT, 'no_platforms') });
  }

  return json(await buildCreationKit(supabase, brand, { ...parsed.data, platforms }));
};
