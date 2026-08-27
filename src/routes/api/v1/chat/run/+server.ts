import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import { buildToolJobSummary } from '$lib/server/chat/job-summaries';
import { executeChatToolJob } from '$lib/server/chat/job-executor';
import {
  createJobCancellation,
  isChatJobCancelledError,
  shouldPersistAsyncToolResult,
} from '$lib/server/chat/job-cancel';

export const config = { maxDuration: 300 };

/**
 * Legacy / resume runner for long chat tool jobs.
 * New chat turns await tools inline via runLongTool; this endpoint remains for
 * any pending jobs that still need processing (or manual re-runs).
 */

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { job_id } = (await request.json()) as { job_id: string };
  if (!job_id) return json({ error: 'Missing job_id' }, { status: 400 });

  const { data: job } = await supabase
    .from('chat_jobs')
    .select('*')
    .eq('id', job_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!job) return json({ error: 'Job not found' }, { status: 404 });
  if (job.status === 'cancelled') return json({ cancelled: true, job_id });
  if (job.status !== 'pending') return json({ error: 'Job already processed' }, { status: 400 });

  return withBrandContext(job.brand_id, async () => {
    const { data: claimed, error: claimError } = await supabase
      .from('chat_jobs')
      .update({ status: 'running' })
      .eq('id', job_id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (claimError || !claimed) {
      return json({ cancelled: true, job_id });
    }

    const cancel = createJobCancellation(supabase, job_id);

    try {
      const result = await executeChatToolJob(
        supabase,
        job.brand_id,
        job.user_id,
        job.tool_name,
        job.input_params ?? {},
        cancel
      );

      await cancel.assertActive();

      const summary = buildToolJobSummary(job.tool_name, result);
      await supabase.from('chat_messages').insert({
        brand_id: job.brand_id,
        user_id: job.user_id,
        thread_id: job.thread_id,
        role: 'assistant',
        content: summary
      });

      await supabase.from('chat_jobs').update({
        status: 'done',
        result,
        completed_at: new Date().toISOString()
      }).eq('id', job_id).eq('status', 'running');

      try {
        const { sendPushToUser } = await import('$lib/server/web-push');
        const { data: brandRow } = await supabase
          .from('brands')
          .select('slug')
          .eq('id', job.brand_id)
          .maybeSingle();
        const slug = (brandRow?.slug as string) || '';
        await sendPushToUser(supabase, job.user_id, {
          title: 'Anomalia',
          body: 'A background task finished',
          url: slug && job.thread_id ? `/app/${slug}/chat/${job.thread_id}` : '/',
          tag: `chat-job-${job_id}`,
          skipIfFocused: true
        });
      } catch (error) { swallow('send done push', error); }

      return json({ success: true, job_id });
    } catch (e) {
      if (isChatJobCancelledError(e) || (e instanceof Error && e.name === 'AbortError')) {
        return json({ cancelled: true, job_id });
      }

      const errorMsg = e instanceof Error ? e.message : String(e);

      const { data: latest } = await supabase
        .from('chat_jobs')
        .select('status')
        .eq('id', job_id)
        .maybeSingle();

      if (!shouldPersistAsyncToolResult(latest?.status)) {
        return json({ cancelled: true, job_id });
      }

      await supabase.from('chat_messages').insert({
        brand_id: job.brand_id,
        user_id: job.user_id,
        thread_id: job.thread_id,
        role: 'assistant',
        content: `❌ Errore durante ${job.tool_name}: ${errorMsg}`
      });

      await supabase.from('chat_jobs').update({
        status: 'failed',
        error: errorMsg,
        completed_at: new Date().toISOString()
      }).eq('id', job_id).eq('status', 'running');

      return json({ success: false, error: errorMsg });
    }
  });
};
