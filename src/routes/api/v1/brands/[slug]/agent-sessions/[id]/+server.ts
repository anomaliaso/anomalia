import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { getAgentSession } from '$lib/server/cli-queries';

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const session = await getAgentSession(supabase, brand.id, params.id);
  if (!session) return json({ error: 'Session not found' }, { status: 404 });
  return json({ session });
};
