import { json } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getThread, loadAllHistoryForUI, loadHistoryForUI } from '$lib/server/chat/persistence';
import { listThreadArtifacts } from '$lib/server/chat/artifacts';
import { loadLastReads } from '$lib/server/chat/unread';
import { loadLatestGoal } from '$lib/server/chat/goal';
import { chatJobFreshSince, reapStaleChatJobs } from '$lib/server/chat/job-cancel';
import { KIT_RUN_WORKING_STATES, kitRunIsAlive } from '$lib/server/chat/turn-limits';
import { loadThreadEvents } from '$lib/server/chat/thread-events';
import { speakerOf } from './jobs';

export async function loadThreadState(
  supabase: SupabaseClient,
  safeGetSession: () => Promise<{ user: { id: string } | null }>,
  brandSlug: string,
  url: URL
): Promise<Response> {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, plan')
    .eq('slug', brandSlug)
    .maybeSingle();
  if (!brand) return json({ error: 'Brand not found', messages: [] }, { status: 404 });
  const brandPlan = (brand.plan as string | null) ?? null;

  // La risposta al poke `thread-seq`: il canale annuncia una sequenza, il client rilegge da qui
  // tutto ciò che sta oltre il cursore che ha già applicato. La lettura passa dal client
  // dell'utente, quindi la RLS di `thread_events` decide da sola cosa può uscire.
  const eventsAfter = url.searchParams.get('events_after');
  const eventsThreadId = url.searchParams.get('thread');
  if (eventsAfter !== null && eventsThreadId) {
    const cursor = Number.parseInt(eventsAfter, 10);
    if (!Number.isFinite(cursor) || cursor < 0) return json({ error: 'Bad cursor' }, { status: 400 });
    const events = await loadThreadEvents(supabase, eventsThreadId, cursor);
    if (!events) return json({ error: 'Event page unavailable' }, { status: 503 });
    return json({ events });
  }

  // Check job status if job_id is provided
  const jobId = url.searchParams.get('job_id');
  if (jobId) {
    // `partial` is the live stream snapshot — this is what lets a reconnected client keep
    // rendering the turn as it is produced instead of only learning that it finished.
    const { data: job } = await supabase
      .from('chat_jobs')
      .select('id, status, error, thread_id, completed_at, partial, input_params')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!job) return json({ error: 'Job not found' }, { status: 404 });
    // Solo la firma esce da `input_params`: al client serve sapere CHI sta scrivendo (l'avatar
    // della riga di caricamento), non rileggersi il brief e l'incarico del turno.
    const { input_params: jobParams, ...jobRow } = job;
    return json({ job: { ...jobRow, speaker: speakerOf(jobParams) } });
  }

  const threadId = url.searchParams.get('thread');

  // Active in-flight chat_response for a thread (resume after hard refresh)
  if (threadId && url.searchParams.get('active_job') === '1') {
    const { data: job } = await supabase
      .from('chat_jobs')
      .select('id, status, error, thread_id, completed_at, created_at, input_params')
      .eq('thread_id', threadId)
      .eq('user_id', user.id)
      .eq('tool_name', 'chat_response')
      .in('status', ['pending', 'running'])
      .gte('created_at', chatJobFreshSince())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!job) return json({ job: null });
    // È da qui che il client riaggancia la SECONDA voce di una stanza: senza la firma, la riga
    // di caricamento del turno accodato porterebbe ancora il volto di chi ha appena finito.
    const { input_params: activeParams, ...activeRow } = job;
    return json({ job: { ...activeRow, speaker: speakerOf(activeParams) } });
  }

  // L'obiettivo del thread, da solo. Lo chiede la chat mentre un turno sta girando: la checklist
  // si spunta durante il lavoro, e ricaricare l'intera cronologia ogni quattro secondi per due
  // righe di stato sarebbe sproporzionato.
  if (threadId && url.searchParams.get('goal') === '1') {
    const goal = await loadLatestGoal(supabase, threadId, {
      brandId: brand.id,
      userId: user.id
    }).catch(() => null);
    return json({ goal });
  }

  // Pending/running async TOOL jobs for a thread (strategy, plan, week, campaign, …)
  if (threadId && url.searchParams.get('pending_tools') === '1') {
    const { data: jobs } = await supabase
      .from('chat_jobs')
      // `partial` non e` di lusso: e` l'unico posto dove un lavoro lungo dice cosa sta facendo,
      // e senza di lui la riga «background job» sa solo QUANTI sono.
      .select('id, tool_name, status, created_at, partial')
      .eq('thread_id', threadId)
      .eq('user_id', user.id)
      .neq('tool_name', 'chat_response')
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(10);
    return json({ jobs: jobs ?? [] });
  }

  // Every conversation of this user's that is generating right now, for a client that just
  // connected: the Realtime channel only carries transitions, so a tab opened mid-turn would
  // otherwise show no activity at all until that turn happens to end. Tool jobs and kit runs
  // count too — the sidebar dot must say "working" without the user opening each thread.
  if (url.searchParams.get('running') === '1') {
    await reapStaleChatJobs(supabase, { userId: user.id, limit: 10 });
    const [{ data: jobs }, { data: kitRuns }] = await Promise.all([
      supabase
        .from('chat_jobs')
        .select('thread_id')
        .eq('brand_id', brand.id)
        .eq('user_id', user.id)
        .in('status', ['pending', 'running'])
        .limit(50),
      supabase
        .from('agent_kit_runs')
        .select('thread_id, state, heartbeat_at, created_at')
        .eq('brand_id', brand.id)
        .eq('user_id', user.id)
        .in('state', [...KIT_RUN_WORKING_STATES])
        .limit(50)
    ]);
    const ids = [
      ...(jobs ?? []).map((j) => j.thread_id as string),
      ...(kitRuns ?? [])
        .filter((r) => kitRunIsAlive(r))
        .map((r) => r.thread_id as string)
    ];
    const threadIds = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
    return json({ threadIds });
  }

  // Waiting user prompts queued behind the current turn.
  if (threadId && url.searchParams.get('pending_queue') === '1') {
    const { data: jobs } = await supabase
      .from('chat_jobs')
      .select('id, input_params, created_at')
      .eq('thread_id', threadId)
      .eq('user_id', user.id)
      .eq('tool_name', 'chat_response')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);
    const items = (jobs ?? []).map((j) => {
      const params = (j.input_params ?? {}) as Record<string, unknown>;
      return {
        id: j.id as string,
        text: String(params.user_message ?? ''),
        created_at: j.created_at as string,
        mode: typeof params.mode === 'string' ? params.mode : null,
        tier: typeof params.tier === 'string' ? params.tier : null
      };
    });
    return json({ items });
  }

  // "Is a reply being generated anywhere in this brand, and in which thread?" — on desktop the
  // open thread lives only in a memory store (the URL stays on the workbench), so after a reload
  // this is what tells the chat column which conversation to reopen and reattach to.
  if (url.searchParams.get('active_chat') === '1') {
    // Only a turn that could still plausibly be alive. Dead rows are closed out first, so they
    // stop reporting themselves as in-flight to every surface that asks.
    // Small limit: this is a user-facing GET, and the cron already carries the bulk sweep.
    await reapStaleChatJobs(supabase, { userId: user.id, limit: 10 });
    const { data: job } = await supabase
      .from('chat_jobs')
      .select('id, thread_id, status, created_at')
      .eq('brand_id', brand.id)
      .eq('user_id', user.id)
      .eq('tool_name', 'chat_response')
      .in('status', ['pending', 'running'])
      .gte('created_at', chatJobFreshSince())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return json({ job: job ?? null });
  }

  // If no thread specified, load ALL messages for the brand+user (overview page)
  if (!threadId) {
    const messages = await loadAllHistoryForUI(supabase, brand.id, user.id);
    return json({ messages });
  }

  const thread = await getThread(supabase, threadId, brand.id, user.id);
  if (!thread) return json({ messages: [], agent: null });

  // Salvage abandoned turns (promote partial → assistant) before reading history / active job.
  await reapStaleChatJobs(supabase, { userId: user.id, threadId, limit: 10 });

  // The reply still being generated for this thread, if any. sessionStorage only survives a reload
  // of the SAME tab, so this is the only way a reopened/duplicated tab can reattach to a turn that
  // is still running (the generation itself survives the disconnect — see consumeSseStream below).
  const [messages, artifacts, goal, { data: activeJob }, lastReads] = await Promise.all([
    loadHistoryForUI(supabase, brand.id, user.id, threadId),
    // Gli artefatti del thread arrivano firmati insieme alla cronologia: le card devono esserci al
    // primo paint, non dopo una seconda chiamata che a volte non parte.
    listThreadArtifacts(supabase, threadId, brand.id).catch(() => []),
    // L'ULTIMO obiettivo, non solo quello aperto: subito dopo la consegna la cosa che l'utente
    // vuole vedere è la checklist tutta spuntata, non uno spazio vuoto dove c'era.
    loadLatestGoal(supabase, threadId, { brandId: brand.id, userId: user.id }).catch(() => null),
    supabase
      .from('chat_jobs')
      .select('id, status, created_at, input_params')
      .eq('thread_id', threadId)
      .eq('user_id', user.id)
      .eq('tool_name', 'chat_response')
      .in('status', ['pending', 'running'])
      .gte('created_at', chatJobFreshSince())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Il segnalibro di lettura (0207) com'è ADESSO, prima che l'apertura del thread lo sposti.
    // È il confine del divisore "Nuovi messaggi", e viene dalla stessa soglia che conta il badge
    // in sidebar. `{}` se la tabella non c'è: nessun divisore, nessun errore.
    loadLastReads(supabase, user.id, [threadId])
  ]);
  return json({
    messages,
    artifacts,
    goal,
    last_read_at: lastReads[threadId] ?? null,
    agent: thread.agent ?? null,
    // DM fra agenti: il client lo legge con dmAgents/dmNames per footer view-only ed etichette.
    room_agents: thread.room_agents ?? null,
    // La firma viaggia con il job (non il resto di input_params): un ricaricamento mentre parla
    // la seconda voce di una stanza deve ridipingere il volto giusto, non quello del thread.
    activeJob: activeJob
      ? { id: activeJob.id, status: activeJob.status, created_at: activeJob.created_at, speaker: speakerOf(activeJob.input_params) }
      : null,
    summary: thread.summary ?? null,
    summary_upto: thread.summary_upto ?? null
  });
}
