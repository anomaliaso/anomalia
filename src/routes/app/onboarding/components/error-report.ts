import * as Sentry from '@sentry/sveltekit';
import { track } from '$lib/analytics';

export type ErrorPageCtx = {
  url?: string;
  brandName?: string;
  brandId?: string | null;
  draftId?: string | null;
  phase: string;
};

export function reportOnboardingError(
  step: string,
  message: unknown,
  pageCtx: ErrorPageCtx,
  context?: Record<string, unknown>
) {
  const msg = String(message ?? 'unknown').slice(0, 500);
  track('onboarding_error', { step, message: msg });
  try {
    Sentry.captureException(new Error(`[onboarding:${step}] ${msg}`), {
      tags: { onboarding_step: step },
      extra: context
    });
  } catch {
    // Sentry può non essere ancora avviato in un passaggio a freddo marketing→app
  }
  void fetch('/app/onboarding/report-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      step,
      message: msg,
      context: { ...pageCtx, ...context }
    })
  }).catch(() => {});
}
