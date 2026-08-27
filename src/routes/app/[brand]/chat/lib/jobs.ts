import { reportChatError } from '$lib/server/chat/report-error';
import type { ChatErrorContext } from '$lib/server/chat/report-error';
import type { ModelMessage } from 'ai';
import { kickChatQueueWork } from '$lib/server/chat/queue';
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

/**
 * Il testo dell'ultimo messaggio dell'utente, letto direttamente dal body.
 * Serve allo smistatore della chat di gruppo PRIMA che il turno costruisca la sua history: lì il
 * testo esiste già (`textContent`), ma cento righe più in basso — e a quel punto prompt e tool
 * sono stati scelti su un agente che in una stanza potrebbe non essere quello che parla.
 */
export function lastUserText(messages: ModelMessage[] | undefined): string {
  const last = messages?.[messages.length - 1];
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (!Array.isArray(last.content)) return '';
  return (last.content as Array<{ type?: string; text?: string }>)
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');
}

export function scheduleQueueKick(platform: Platform, origin: string) {
  const kick = kickChatQueueWork(origin);
  if (platform?.context?.waitUntil) platform.context.waitUntil(kick);
  else void kick;
}

/**
 * Report a turn failure WITHOUT putting it in front of the recovery work.
 *
 * `reportChatError` makes two external round trips (PostHog, then the ops email through Resend).
 * On a teardown that starts near the function wall those seconds belong to salvaging the turn, not
 * to describing it — so the report goes to `waitUntil` and gets whatever time is left over.
 */
export function scheduleErrorReport(
  platform: Platform,
  supabase: SupabaseClient,
  error: unknown,
  context: ChatErrorContext
) {
  const report = reportChatError(supabase, error, context).catch((e) =>
    console.error('[Chat] error report failed:', e)
  );
  if (platform?.context?.waitUntil) platform.context.waitUntil(report);
  else void report;
}

/** Same-instance fast cancel; DB watcher covers cross-instance (serverless). */
export const jobAbortControllers = new Map<string, AbortController>();

/**
 * La firma del turno accodato: la chiave del membro che risponde in una stanza (o in un DM).
 * Esce sola da `input_params`, senza il resto del payload del job.
 */
export function speakerOf(params: unknown): string | null {
  const s = (params as { speaker?: unknown } | null)?.speaker;
  return typeof s === 'string' && s ? s : null;
}

export async function deletePendingChatJobOrReportFailure(
  supabase: SupabaseClient,
  jobId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('chat_jobs')
    .delete()
    .eq('id', jobId)
    .eq('status', 'pending')
    .select('id');
  if (error || !data?.length) {
    console.error(`[Chat queue] pending job delete removed no rows jobId=${jobId}`, error);
    return false;
  }
  return true;
}

export async function isJobCancelled(supabase: SupabaseClient, jobId: string | undefined): Promise<boolean> {
  if (!jobId) return false;
  const { data } = await supabase.from('chat_jobs').select('status').eq('id', jobId).maybeSingle();
  return data?.status === 'cancelled';
}
