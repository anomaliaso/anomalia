import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { getPublishingSettings } from '$lib/server/publishing-settings';

/**
 * Publishing policy — read-only, because there is nothing left to choose.
 *
 * Every post this product generates waits for a human to approve that specific post; the
 * `manual` / `auto_curated` / `auto_all` levels and the per-account auto-publish flag are gone.
 * See publishing-settings.ts for why (AI Act Art. 50(2) human-review exemption, Art. 14/26
 * oversight). PUT used to set the level and now answers 410 rather than 404, so an older CLI
 * gets told what changed instead of looking at a typo.
 *
 * GET /api/v1/brands/:slug/publishing → { policy: 'review_required', accounts: [{ id, platform }] }
 */
export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const settings = await getPublishingSettings(supabase, brand.id);
  return json(settings);
};

export const PUT: RequestHandler = async () =>
  json(
    {
      error:
        'Publishing levels have been removed. Every post now waits for human approval before it is published; there is no auto-publish mode to set.',
      policy: 'review_required'
    },
    { status: 410 }
  );
