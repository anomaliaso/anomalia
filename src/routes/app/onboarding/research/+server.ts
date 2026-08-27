import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { localeLanguageName } from '$lib/i18n/locale';
import {
  startOnboardingStepJob,
  getOnboardingStepJob,
  kickOnboardingStepWork
} from '$lib/server/onboarding-steps';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

// Stages B→K: enqueue deep research + editorial plan. The page polls GET ?job= for progress and
// partial results (report / personas / plan) so leaving the tab no longer cancels the work.
export const POST: RequestHandler = async ({
  request,
  url,
  platform,
  locals: { supabase, safeGetSession, locale }
}) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const body = await request.json().catch(() => ({}));
  const brandId = typeof body?.brandId === 'string' ? body.brandId : null;
  if (!brandId) return new Response('Missing brandId', { status: 400 });

  const draftId = typeof body?.draftId === 'string' ? body.draftId : null;
  const force = !!body?.force;
  const profile = body?.profile ?? body;
  const platforms: string[] = Array.isArray(body?.platforms) ? body.platforms : [];
  const planTier = typeof body?.plan === 'string' ? body.plan : null;
  const handles = body?.handles;
  const competitors = body?.competitors;
  const additionalContext =
    typeof body?.additionalContext === 'string' ? body.additionalContext.trim() : '';
  const people = Array.isArray(body?.people) ? body.people : [];
  const outputLanguage = localeLanguageName(locale);

  const { jobId, reused } = await startOnboardingStepJob(supabase, {
    kind: 'research',
    userId: user.id,
    brandId,
    draftId,
    input: {
      profile,
      platforms,
      planTier,
      handles,
      competitors,
      additionalContext,
      people,
      outputLanguage
    },
    force
  });

  const kick = kickOnboardingStepWork(url.origin);
  const p = platform as Platform;
  if (p?.context?.waitUntil) p.context.waitUntil(kick);
  else void kick;

  return json({ jobId, reused });
};

export const GET: RequestHandler = async ({ url, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });

  const jobId = url.searchParams.get('job');
  if (!jobId) return new Response('Missing job', { status: 400 });

  const job = await getOnboardingStepJob(supabase, user.id, jobId);
  if (!job) return json({ found: false }, { status: 404 });

  return json({
    found: true,
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress ?? {},
    // Partial results while running so the timeline fills in as stages complete.
    result: job.result,
    error: job.status === 'failed' ? job.error : null
  });
};
