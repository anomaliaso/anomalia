import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logOnboardingError } from '$lib/server/onboarding-errors';

/**
 * Client-caught onboarding failures (early_create timeout, analyze stream errors, …) never hit
 * handleErrorWithSentry — the UI swallows them and shows "Analisi fallita". This endpoint is how
 * those land in Sentry + the ops inbox + `onboarding_errors`.
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });

  let body: { step?: unknown; message?: unknown; context?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const step = typeof body.step === 'string' && body.step.trim() ? body.step.trim().slice(0, 80) : '';
  const message =
    typeof body.message === 'string' && body.message.trim()
      ? body.message.trim().slice(0, 2000)
      : '';
  if (!step || !message) return new Response('Missing step/message', { status: 400 });

  const context =
    body.context && typeof body.context === 'object' && !Array.isArray(body.context)
      ? (body.context as Record<string, unknown>)
      : undefined;

  await logOnboardingError(supabase, user.id, step, message, {
    ...context,
    source: 'client'
  });

  return json({ ok: true });
};
