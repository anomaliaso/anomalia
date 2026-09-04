import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { generateBrandMedia, listMediaJobs } from '$lib/server/media-generate';
import { CHECK_MEDIA_JOB, GENERATE_MEDIA, statusForFailure } from '@anomalia/api-contracts';

// Quattro immagini di fila stanno sotto il minuto, ma non sotto il default.
export const config = { maxDuration: 300 };

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const parsed = CHECK_MEDIA_JOB.input.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  return json({ jobs: await listMediaJobs(supabase, brand.id, parsed.data.job_id) });
};

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  // Prima il gate, poi il corpo: una chiave di sola lettura e un brand senza crediti si fermano
  // qui, prima che qualcosa costi.
  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  const parsed = GENERATE_MEDIA.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const result = await generateBrandMedia(supabase, {
    // Il brand è quello risolto dallo slug, mai un id che arriva dal corpo: è il confine fra
    // inquilini, e passa da qui una volta sola.
    brandId: brand.id,
    userId: user.id,
    prompt: parsed.data.prompt,
    kind: parsed.data.kind,
    count: parsed.data.count,
    aspectRatio: parsed.data.aspect_ratio,
    model: parsed.data.model,
    title: parsed.data.title
  });

  if (!result.ok) {
    return json(
      { error: result.error, ...('allowed' in result ? { allowed: result.allowed } : {}) },
      { status: statusForFailure(GENERATE_MEDIA, result.error) }
    );
  }

  return json({
    ok: true,
    status: result.status,
    media: result.media,
    job_id: result.jobId,
    model: result.model
  });
};
