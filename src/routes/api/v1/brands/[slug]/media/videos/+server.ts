import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { generateBrandVideo } from '$lib/server/media-generate';
import { GENERATE_VIDEO, statusForFailure } from '@anomalia/api-contracts';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const parsed = GENERATE_VIDEO.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const result = await generateBrandVideo({
    brandId: brand.id,
    userId: user.id,
    kind: 'video',
    prompt: parsed.data.prompt,
    baseMediaId: parsed.data.base_media_id,
    durationSeconds: parsed.data.duration,
    aspectRatio: parsed.data.aspect_ratio,
    model: parsed.data.model,
    title: parsed.data.title
  });

  if (!result.ok) {
    return json(
      { error: result.error, ...('allowed' in result ? { allowed: result.allowed } : {}) },
      { status: statusForFailure(GENERATE_VIDEO, result.error) }
    );
  }

  // Un clip non torna mai pronto: la coda lo finisce e check_media_job dice quando e' atterrato.
  return json({ ok: true, status: 'rendering', job_id: result.jobId, model: result.model });
};
