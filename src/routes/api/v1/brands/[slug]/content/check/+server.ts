import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { checkContent } from '$lib/server/content-check';
import { CHECK_CONTENT } from '@anomalia/api-contracts';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const parsed = CHECK_CONTENT.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  return json(
    await checkContent({
      supabase,
      brandId: brand.id,
      timezone: (brand.timezone as string) ?? 'Europe/Rome',
      spec: {
        platforms: input.platforms,
        caption: input.caption,
        platformCaptions: input.platform_captions,
        mediaIds: input.media_ids,
        title: input.title,
        scheduledFor: input.scheduled_for
      }
    })
  );
};
