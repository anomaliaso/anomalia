import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openOrgScope } from '$lib/server/cli-auth';
import { generateVideoWithoutBrand, listOrgMediaJobs } from '$lib/server/media-generate';
import { CHECK_MEDIA_JOB_READ, GENERATE_VIDEO, statusForFailure } from '@anomalia/api-contracts';

/**
 * Dove si ritrova un clip che nessuna libreria reclama.
 *
 * Un'immagine torna col file già in mano; un clip no — kie ci mette minuti e la richiesta è finita
 * da un pezzo quando atterra. Senza un brand non c'è una libreria in cui depositarlo, quindi il
 * risultato resta sulla riga della coda, che porta scritto chi paga: `media_url` è il clip.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  const { scope, error } = await openOrgScope(request);
  if (error) return error;

  const parsed = CHECK_MEDIA_JOB_READ.input.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  return json({ jobs: await listOrgMediaJobs(scope.supabase, scope.orgId, parsed.data.job_id) });
};

export const POST: RequestHandler = async ({ request }) => {
  const { scope, error } = await openOrgScope(request);
  if (error) return error;

  const parsed = GENERATE_VIDEO.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const result = await generateVideoWithoutBrand({
    orgId: scope.orgId,
    userId: scope.user.id,
    prompt: parsed.data.prompt,
    baseMediaId: parsed.data.base_media_id,
    durationSeconds: parsed.data.duration,
    aspectRatio: parsed.data.aspect_ratio,
    model: parsed.data.model
  });

  if (!result.ok) {
    // Il MOTIVO del fornitore risale fino a qui: un `render_failed` nudo dice che e' fallito e
    // nasconde l'unica cosa che serviva per decidere se riprovare.
    return json(
      {
        error: result.error,
        ...('allowed' in result ? { allowed: result.allowed } : {}),
        ...('reason' in result && result.reason ? { reason: result.reason } : {})
      },
      { status: statusForFailure(GENERATE_VIDEO, result.error) }
    );
  }

  return json({
    ok: true,
    status: 'rendering',
    job_id: result.jobId,
    model: result.model,
    duration_seconds: result.durationSeconds,
    organization: scope.organization
  });
};
