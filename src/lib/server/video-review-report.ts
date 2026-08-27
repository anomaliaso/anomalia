import * as Sentry from '@sentry/sveltekit';
import { CreditsExhaustedError } from '$lib/server/credits';
import { sendEmail } from '$lib/server/email';
import { opsEmail } from '$lib/server/support-config';

const EMAIL_DEDUP_MS = 30 * 60 * 1000;
const recentEmails = new Map<string, number>();

export type MediaReviewErrorStage = 'review' | 'persist';

export type MediaReviewErrorContext = {
  brandId?: string | null;
  brandName?: string | null;
  brandSlug?: string | null;
  url?: string | null;
  postId?: string | null;
  standard?: string | null;
  reviewKind?: string | null;
  attempts?: number | null;
  stage?: MediaReviewErrorStage;
  /** 'sentry' skips the ops email (retries). Default: email on final fail / persist. */
  notify?: 'all' | 'sentry';
};

export function isCreditsExhaustedError(e: unknown): boolean {
  if (e instanceof CreditsExhaustedError) return true;
  return e instanceof Error && e.name === 'CreditsExhaustedError';
}

/**
 * Credits = quota, not ops. Intermediate review retries stay Sentry-only.
 * Final fail and persist errors go to the ops mailbox too.
 */
export function mediaReviewNotifyMode(opts: {
  stage: MediaReviewErrorStage;
  finalFailed?: boolean;
  error: unknown;
}): 'all' | 'sentry' | 'none' {
  if (isCreditsExhaustedError(opts.error)) return 'none';
  if (opts.stage === 'persist') return 'all';
  if (opts.finalFailed) return 'all';
  return 'sentry';
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

function recentlyEmailed(key: string): boolean {
  const now = Date.now();
  const prev = recentEmails.get(key);
  if (prev && now - prev < EMAIL_DEDUP_MS) return true;
  recentEmails.set(key, now);
  if (recentEmails.size > 200) {
    for (const [k, t] of recentEmails) {
      if (now - t >= EMAIL_DEDUP_MS) recentEmails.delete(k);
    }
  }
  return false;
}

/**
 * Best-effort Sentry + ops email. Never throws — reporting must not break the worker.
 */
export async function reportMediaReviewError(
  error: unknown,
  context: MediaReviewErrorContext = {}
): Promise<void> {
  const stage = context.stage ?? 'review';
  const inferred = mediaReviewNotifyMode({
    stage,
    finalFailed: context.notify !== 'sentry',
    error
  });
  const notify = context.notify ?? (inferred === 'none' ? 'sentry' : inferred);
  if (inferred === 'none') return;

  const message = errorMessage(error);
  console.error(`[media-review:${stage}]`, message, {
    brandId: context.brandId,
    url: context.url
  });

  try {
    Sentry.captureException(error instanceof Error ? error : new Error(message), {
      tags: {
        media_review: stage,
        media_review_kind: context.reviewKind ?? undefined,
        media_review_standard: context.standard ?? undefined
      },
      extra: { ...context, message }
    });
  } catch (sentryErr) {
    console.error('[media-review:report] Sentry failed:', sentryErr);
  }

  if (notify === 'sentry') return;

  const dedupKey = `${context.brandId ?? ''}:${context.url ?? ''}:${stage}:${message}`;
  if (recentlyEmailed(dedupKey)) return;

  try {
    const subject =
      stage === 'persist'
        ? `[Anomalia] Media review persist error`
        : `[Anomalia] Media review failed`;
    const lines = [
      `Stage: ${stage}`,
      `Message: ${message}`,
      `Brand: ${context.brandName ?? '—'} (${context.brandSlug ?? context.brandId ?? '—'})`,
      `URL: ${context.url ?? '—'}`,
      `Post: ${context.postId ?? '—'}`,
      `Kind: ${context.reviewKind ?? '—'}`,
      `Standard: ${context.standard ?? '—'}`,
      `Attempts: ${context.attempts ?? '—'}`,
      '',
      error instanceof Error && error.stack ? `Stack:\n${error.stack}` : ''
    ].filter(Boolean);

    await sendEmail({
      to: opsEmail(),
      subject,
      text: lines.join('\n'),
      html: `<pre style="font:13px/1.45 ui-monospace,monospace;white-space:pre-wrap">${lines
        .join('\n')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</pre>`
    });
  } catch (mailErr) {
    console.error('[media-review:report] ops email failed:', mailErr);
  }
}
