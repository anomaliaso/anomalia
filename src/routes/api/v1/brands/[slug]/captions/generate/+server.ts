import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { brandVoice, writeCaptions } from '$lib/server/caption-writer';
import { GENERATE_CAPTIONS, TARGET_PLATFORMS, statusForFailure } from '@anomalia/api-contracts';
import { billedUsdInScope, withBrandContext } from '$lib/server/ai-log';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const parsed = GENERATE_CAPTIONS.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const platforms = parsed.data.platforms ?? [...TARGET_PLATFORMS];
  const { captions, costUsd } = await withBrandContext(brand.id, async () => {
    const written = await writeCaptions({
      topic: parsed.data.topic,
      platforms,
      format: parsed.data.format ?? 'single',
      voice: await brandVoice(supabase, brand.id)
    });

    return { captions: written, costUsd: billedUsdInScope() ?? null };
  });

  if (!captions.length) {
    return json({ error: 'no_captions' }, { status: statusForFailure(GENERATE_CAPTIONS, 'no_captions') });
  }

  return json({ ok: true, captions, cost_usd: costUsd });
};
