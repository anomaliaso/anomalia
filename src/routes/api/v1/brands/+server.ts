import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, apiKeyBrandIds } from '$lib/server/cli-auth';
import { getBrandsList } from '$lib/server/cli-queries';

export const GET: RequestHandler = async ({ request }) => {
  const { supabase, error } = await authenticate(request);
  if (error) return error;

  const brands = await getBrandsList(supabase, await apiKeyBrandIds(supabase));
  return json(brands);
};
