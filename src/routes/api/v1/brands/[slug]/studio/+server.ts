import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { getStudio } from '$lib/server/cli-queries';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  // Solo `full` apre il rubinetto: qualsiasi altra cosa — inventata, vuota, assente — è `index`.
  const documents = url.searchParams.get('documents') === 'full' ? 'full' : 'index';

  const studio = await getStudio(supabase, brand.id, { documents });
  return json(studio);
};
