import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { getVoice } from '$lib/server/cli-queries';

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const voice = await getVoice(supabase, brand.id);
  return json(voice);
};
