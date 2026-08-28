/**
 * IL WORKER DEI SUB-AGENT ASYNC — l'equivalente di designer-work.ts per le deleghe.
 *
 * Il turno che chiama delegate_task / run_task_pipeline / run_parallel_tasks accoda una riga
 * `chat_jobs` con tool_name `subagent_run` (vedi subagents.ts, mode `queued`) e si spegne. Questo
 * modulo la reclama e la esegue FUORI da ogni turno: deadline propria, heartbeat già garantito da
 * processNextPendingToolJob, e il partial in tempo reale riscritto sulla riga con lo stesso
 * meccanismo del mirror del designer (flush immediato sui tool, throttle sul testo, payload
 * troncati con toolsForMirror).
 *
 * Il risultato rientra nel thread come nuovo turno (tool-job-report.ts): chi parla con l'utente
 * resta uno solo. Il perimetro dei tool del sotto-agente è derivato FUORI dal turno chiamante —
 * dal set pieno del brand filtrato per ruolo e hub (subagentToolNames), mai da un chiamante che
 * quando il job gira potrebbe non esistere più.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasWebHub } from '$lib/server/plans';
import { resolveChatModel } from '$lib/server/chat/model';
import { createChatTools } from '$lib/server/chat/tools';
import { stripWebHubTools } from '$lib/server/chat/agents';
import { agentStickerColor } from '$lib/chat-expression';
import type { AgentId } from '$lib/server/chat/agents';
import { chatTurnDeadline, CHAT_MAX_DURATION_MS } from '$lib/server/chat/turn-limits';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import {
  runSubagentRun,
  runTaskPipelinePhases,
  runParallelTasks,
  type SubagentRunCtx,
  type SubagentSharedCache
} from '$lib/server/chat/subagents';
import { isChatJobCancelledError, type JobCancellation } from '$lib/server/chat/job-cancel';
import { createJobPartialMirror } from '$lib/server/chat/job-partial-mirror';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Il set di tool del brand, come lo monta un turno in coda: è il TETTO dei sotto-agenti. */
async function buildToolset(admin: SupabaseClient, brand: AnyRec, job: AnyRec, locale: string) {
  const webHubEnabled = hasWebHub(brand.plan);
  let tools = createChatTools(
    admin,
    brand.id,
    brand.timezone ?? 'Europe/Rome',
    String(job.user_id ?? ''),
    String(job.origin ?? ''),
    locale,
    job.thread_id ?? undefined,
    '',
    [],
    [],
    agentStickerColor(String(job.agent ?? '')),
    undefined,
    null
  );
  if (!webHubEnabled) tools = stripWebHubTools(tools) as typeof tools;
  return { tools, webHubEnabled, locale };
}

/**
 * Esegue una riga `subagent_run` reclamata. Chiamato da executeChatToolJob dentro il claim del
 * drain: il heartbeat e la chiusura della riga li fa il chiamante.
 */
export async function runSubagentJob(
  admin: SupabaseClient,
  job: { id: string; brand_id: string; user_id: string; thread_id?: string | null },
  params: AnyRec,
  cancel: JobCancellation
): Promise<AnyRec> {
  const { data: brand } = await admin
    .from('brands')
    .select('id, name, slug, website, timezone, plan')
    .eq('id', job.brand_id)
    .maybeSingle();
  if (!brand) return { error: 'Brand not found' };

  await cancel.assertActive();
  const locale = bilingualNoticeLocale(String(params.report_locale ?? 'en'));
  const { tools, webHubEnabled } = await buildToolset(admin, brand, {
    user_id: job.user_id,
    thread_id: job.thread_id,
    origin: params.report_origin,
    agent: params.agent
  }, locale);

  // La deadline è DEL JOB, non di un turno: qui non c'è un chiamante che aspetta. L'abort parte
  // dal cancel del job (Stop in chat) e dal muro duro, come nel designer-work.
  const deadline = chatTurnDeadline(Date.now());
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), CHAT_MAX_DURATION_MS);
  const onAbort = () => controller.abort();
  cancel.signal?.addEventListener('abort', onAbort);

  const spec = (params.subagent ?? {}) as AnyRec;
  const ctx: SubagentRunCtx = {
    supabase: admin,
    brandId: job.brand_id,
    tools: tools as Record<string, unknown>,
    model: resolveChatModel('auto', undefined, { agentId: (params.agent as AgentId) ?? undefined }),
    locale,
    userId: job.user_id,
    threadId: job.thread_id ?? undefined,
    webHubEnabled,
    defaultAgent: (spec.defaultAgent as AgentId | null) ?? null,
    remainingMs: () => (deadline.reached() ? -1 : Number.POSITIVE_INFINITY),
    onProgress: undefined
  };
  const shared: SubagentSharedCache = { brandRow: brand as AnyRec, systemCache: new Map(), volatile: null };

  const mirror = createJobPartialMirror(admin, job.id);
  const stopMirrorHeartbeat = mirror.startHeartbeat();
  // Il flush va sullo stesso loop: runSubagentRun chiama onProgress a ogni piega.
  ctx.onProgress = (state, force) => mirror.push(state, force);
  try {
    await cancel.assertActive();
    const kind = String(params.kind ?? 'single');

    if (kind === 'pipeline') {
      const res = await runTaskPipelinePhases(
        ctx,
        params as unknown as Parameters<typeof runTaskPipelinePhases>[1],
        { left: () => Number.POSITIVE_INFINITY, spend: () => {} },
        shared
      );
      await cancel.assertActive();
      return res;
    }

    if (kind === 'parallel') {
      const res = await runParallelTasks(ctx, params as unknown as Parameters<typeof runParallelTasks>[1]);
      await cancel.assertActive();
      return res;
    }

    const res = await runSubagentRun(ctx, {
      role: params.role,
      agent: (params.agent as AgentId | null) ?? ctx.defaultAgent ?? null,
      title: String(params.title ?? 'Sub-agent'),
      brief: String(params.brief ?? ''),
      context: typeof params.context === 'string' ? params.context : undefined,
      successCriteria: typeof params.success_criteria === 'string' ? params.success_criteria : undefined,
      maxSteps: typeof params.max_steps === 'number' ? params.max_steps : undefined,
      network: params.network,
      brandData: params.brand_data,
      abortSignal: controller.signal,
      shared
    });
    await cancel.assertActive();
    return res;
  } catch (e) {
    if (isChatJobCancelledError(e) || (e instanceof Error && e.name === 'AbortError')) throw e;
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(abortTimer);
    cancel.signal?.removeEventListener('abort', onAbort);
    await mirror.flushLatest();
    stopMirrorHeartbeat();
  }
}
