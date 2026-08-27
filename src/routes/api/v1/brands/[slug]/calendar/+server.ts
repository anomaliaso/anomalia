import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { getCalendar } from '$lib/server/cli-queries';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const monthParam = url.searchParams.get('month');
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  if (monthParam) {
    const match = monthParam.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      year = parseInt(match[1]);
      month = parseInt(match[2]);
    }
  }

  const language = (brand.content_prefs as Record<string, unknown> | null)?.language as string | undefined;
  const calendar = await getCalendar(supabase, brand.id, brand.timezone as string, year, month, language ?? null);
  return json(calendar);
};
