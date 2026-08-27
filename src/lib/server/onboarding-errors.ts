import * as Sentry from '@sentry/sveltekit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '$lib/server/email';
import { opsEmail } from '$lib/server/support-config';

/** Steps that are noisy / non-user-facing — Sentry + DB only, no ops mailbox spam. */
const SENTRY_ONLY_STEPS = new Set(['draft_save']);

export type OnboardingErrorOpts = {
  /**
   * 'sentry' skips the ops email. Default: email for user-visible funnel failures,
   * Sentry-only for noisy steps like draft autosave.
   */
  notify?: 'all' | 'sentry';
};

// Persist an onboarding generation failure to `onboarding_errors` so it's visible for post-mortem
// debugging (the client mirrors the same failures to PostHog as `onboarding_error`). Best-effort:
// logging must never break the response that's reporting the error to the user.
export async function logOnboardingError(
  supabase: SupabaseClient | null,
  userId: string,
  step: string,
  e: unknown,
  context?: Record<string, unknown>,
  opts: OnboardingErrorOpts = {}
) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[onboarding:${step}]`, e);
  // These errors are CAUGHT (converted to a {type:'error'} stream message), so the global
  // handleErrorWithSentry never sees them — report them explicitly, with the step + context.
  Sentry.captureException(e instanceof Error ? e : new Error(`[onboarding:${step}] ${message}`), {
    tags: { onboarding_step: step },
    user: { id: userId },
    extra: context
  });
  if (supabase) {
    try {
      // Dedup: client trackError + server catch often report the same failure seconds apart.
      const since = new Date(Date.now() - 5 * 60_000).toISOString();
      const { data: recent } = await supabase
        .from('onboarding_errors')
        .select('id')
        .eq('user_id', userId)
        .eq('step', step)
        .eq('message', message.slice(0, 2000))
        .gte('created_at', since)
        .limit(1)
        .maybeSingle();
      if (recent?.id) return;

      const { error } = await supabase
        .from('onboarding_errors')
        .insert({ user_id: userId, step, message: message.slice(0, 2000), context: context ?? null });
      if (error) console.error(`[onboarding:${step}] failed to persist error log:`, error.message);
    } catch (logErr) {
      console.error(`[onboarding:${step}] failed to persist error log:`, logErr);
    }
  }

  const notify =
    opts.notify ?? (SENTRY_ONLY_STEPS.has(step) ? 'sentry' : 'all');
  if (notify === 'sentry') return;

  try {
    const lines = [
      `Step: ${step}`,
      `Message: ${message}`,
      `User: ${userId || '—'}`,
      ...(context
        ? Object.entries(context).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        : []),
      '',
      e instanceof Error && e.stack ? `Stack:\n${e.stack}` : ''
    ].filter(Boolean);

    await sendEmail({
      to: opsEmail(),
      subject: `[Anomalia] Onboarding error: ${step}`,
      text: lines.join('\n'),
      html: `<pre style="font:13px/1.45 ui-monospace,monospace;white-space:pre-wrap">${lines
        .join('\n')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</pre>`
    });
  } catch (mailErr) {
    console.error(`[onboarding:${step}] ops email failed:`, mailErr);
  }
}
