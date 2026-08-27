import * as Sentry from '@sentry/sveltekit';
import { env as publicEnv } from '$env/dynamic/public';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '$lib/server/email';
import { opsEmail } from '$lib/server/support-config';

export type ChatErrorContext = {
  brandId?: string | null;
  brandSlug?: string | null;
  userId?: string | null;
  threadId?: string | null;
  jobId?: string | null;
  tier?: string | null;
  provider?: string | null;
  model?: string | null;
  /** Overrides the inferred bucket — lets turn deaths group apart from provider errors. */
  kind?: string | null;
  /** Free-text line for the ops mail / Sentry extra (what was salvaged, which step, …). */
  detail?: string | null;
  /**
   * 'sentry' skips the ops email. One incident can kill dozens of turns at once; Sentry groups
   * them, a mailbox does not, so a batch reporter mails the first few and downgrades the rest.
   */
  notify?: 'all' | 'sentry';
};

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

function isBalanceError(e: unknown): boolean {
  const msg = errorMessage(e).toLowerCase();
  const status =
    typeof e === 'object' && e && 'statusCode' in e
      ? Number((e as { statusCode?: number }).statusCode)
      : undefined;
  return (
    status === 402 ||
    msg.includes('insufficient balance') ||
    msg.includes('insufficient_quota') ||
    msg.includes('billing') ||
    msg.includes('payment required')
  );
}

/** Generic client-facing copy — never leak provider billing details. */
export const CHAT_USER_ERROR = 'An error occurred.';

/**
 * Best-effort: mark job failed, Sentry, PostHog, ops email.
 * Never throws — reporting must not break the chat stream teardown.
 */
export async function reportChatError(
  supabase: SupabaseClient | null,
  error: unknown,
  context: ChatErrorContext = {}
): Promise<void> {
  const message = errorMessage(error);
  const balance = isBalanceError(error);
  const kind = context.kind ?? (balance ? 'provider_balance' : 'chat_stream');

  console.error(`[chat:${kind}]`, message, context);

  Sentry.captureException(error instanceof Error ? error : new Error(message), {
    tags: {
      chat_error: kind,
      chat_tier: context.tier ?? undefined,
      chat_provider: context.provider ?? undefined
    },
    user: context.userId ? { id: context.userId } : undefined,
    extra: {
      ...context,
      balance,
      statusCode:
        typeof error === 'object' && error && 'statusCode' in error
          ? (error as { statusCode?: number }).statusCode
          : undefined,
      responseBody:
        typeof error === 'object' && error && 'responseBody' in error
          ? String((error as { responseBody?: unknown }).responseBody ?? '').slice(0, 2000)
          : undefined
    }
  });

  if (supabase && context.jobId) {
    try {
      await supabase
        .from('chat_jobs')
        .update({
          status: 'failed',
          error: message.slice(0, 2000),
          completed_at: new Date().toISOString()
        })
        .eq('id', context.jobId)
        .in('status', ['pending', 'running']);
    } catch (dbErr) {
      console.error('[chat:report] failed to update chat_jobs:', dbErr);
    }
  }

  // Server-side PostHog capture (same project key as the browser SDK).
  try {
    const key = publicEnv.PUBLIC_POSTHOG_KEY;
    if (key) {
      await fetch('https://eu.i.posthog.com/capture/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // An analytics capture must never outlive the thing it is describing: this runs on turn
        // teardown, sometimes seconds from the function wall, and a hung capture would starve the
        // recovery work queued behind it.
        signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({
          api_key: key,
          event: 'chat_error',
          distinct_id: context.userId || 'server',
          properties: {
            kind,
            balance,
            message: message.slice(0, 500),
            brand_id: context.brandId,
            brand_slug: context.brandSlug,
            thread_id: context.threadId,
            job_id: context.jobId,
            tier: context.tier,
            provider: context.provider,
            model: context.model,
            $exception_type: error instanceof Error ? error.name : 'Error'
          }
        })
      });
    }
  } catch (phErr) {
    console.error('[chat:report] PostHog capture failed:', phErr);
  }

  if (context.notify === 'sentry') return;

  try {
    const subject = balance
      ? `[Anomalia] Chat provider balance / billing error`
      : kind === 'chat_stream'
        ? `[Anomalia] Chat stream error`
        : `[Anomalia] ${kind.replace(/_/g, ' ')}`;
    const lines = [
      `Kind: ${kind}`,
      `Message: ${message}`,
      ...(context.detail ? [`Detail: ${context.detail}`] : []),
      `Brand: ${context.brandSlug ?? '—'} (${context.brandId ?? '—'})`,
      `User: ${context.userId ?? '—'}`,
      `Thread: ${context.threadId ?? '—'}`,
      `Job: ${context.jobId ?? '—'}`,
      `Tier: ${context.tier ?? '—'}`,
      `Provider: ${context.provider ?? '—'}`,
      `Model: ${context.model ?? '—'}`,
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
    console.error('[chat:report] ops email failed:', mailErr);
  }
}
