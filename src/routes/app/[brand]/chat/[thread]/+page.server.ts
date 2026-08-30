import { error, fail } from '@sveltejs/kit';
import { getThread, loadThreadUiHistory } from '$lib/server/chat/persistence';
import { loadLiveRun } from '$lib/server/chat/live-run';
import { agentDesktopEnabled } from '$lib/server/agent-desktop';
import { listThreadArtifacts } from '$lib/server/chat/artifacts';
import { chatJobFreshSince, reapStaleChatJobs } from '$lib/server/chat/job-cancel';
import { loadLastReads } from '$lib/server/chat/unread';
import {
  ROSTER_JOBS,
  brandJobOptOuts,
  setJobEnabled,
  translatableReason
} from '$lib/server/job-roster';
import { getCustomAgent, setCustomAgentScheduleEnabled } from '$lib/server/custom-agents';
import { createAdminClient } from '$lib/server/supabase-admin';
import { formatInZone } from '$lib/server/schedule';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Actions, PageServerLoad } from './$types';

// ── Il computer dell'agente ─────────────────────────────────────────────────────────────────────
// I dati del pannello a destra della chat. Tutto in letture piccole e già esistenti altrove:
// loop_ticks (stesso vocabolario di /agents), la riga di custom_agent_schedules del thread, e i
// render video attivi. Ogni lettura degrada a null/vuoto: una migration non applicata (0207/0208)
// o una tabella assente non deve rompere la pagina del thread — il pannello mostra meno, non erra.

type AgentPanelData = {
  job: {
    key: string;
    cadence: string;
    enabled: boolean;
    ticks: Array<{ outcome: string; reason: string | null; at: string }>;
  } | null;
  custom: {
    id: string;
    name: string;
    agent: string | null;
    avatar_face: string | null;
    avatar_color: string | null;
    enabled: boolean;
    days_of_week: number[];
    times: string[];
    next_run_label: string | null;
    last_run_label: string | null;
    last_error: string | null;
  } | null;
  renders: Array<{ id: string; post_id: string | null; status: string; submitted_at: string }>;
};

async function loadAgentPanel(
  supabase: SupabaseClient,
  brand: { id: string; timezone?: string | null },
  thread: { agent?: string | null; custom_agent_id?: string | null }
): Promise<AgentPanelData> {
  const out: AgentPanelData = { job: null, custom: null, renders: [] };
  const agent = thread.agent ?? null;
  try {
    const admin = createAdminClient();

    if (agent?.startsWith('job:')) {
      const key = agent.slice('job:'.length);
      const roster = ROSTER_JOBS.find((j) => j.key === key);
      if (roster) {
        const [off, ticks] = await Promise.all([
          brandJobOptOuts(brand.id, admin),
          admin
            .from('loop_ticks')
            .select('outcome, reason, created_at')
            .eq('brand_id', brand.id)
            .eq('loop', key)
            .order('created_at', { ascending: false })
            .limit(8)
            .then(
              ({ data }) => data ?? [],
              () => [] as Array<{ outcome: unknown; reason: unknown; created_at: unknown }>
            )
        ]);
        out.job = {
          key,
          cadence: roster.cadence,
          enabled: !off.has(key),
          // Come su /agents: un tick `user_off` è il riflesso di uno spegnimento, non un giro.
          ticks: ticks
            .filter((t) => String(t.reason ?? '') !== 'user_off')
            .slice(0, 5)
            .map((t) => ({
              outcome: String(t.outcome),
              reason: translatableReason(t.reason == null ? null : String(t.reason)),
              at: String(t.created_at)
            }))
        };
      }
    } else if (thread.custom_agent_id) {
      // Client utente, non admin: la riga è del brand e la RLS è il controllo di accesso.
      // L'IDENTITÀ viene da `custom_agents`; la cadenza mostrata è quella della PROSSIMA routine
      // di quell'agente — dalla 0210 un agente può averne più d'una, e il pannello è un colpo
      // d'occhio, non l'elenco completo (quello sta su /agents).
      const row = await getCustomAgent(supabase, brand.id, thread.custom_agent_id);
      if (row) {
        const tz = brand.timezone || 'Europe/Rome';
        const { data: next } = await supabase
          .from('custom_agent_schedules')
          .select('days_of_week, times, next_run_at, last_run_at, last_error')
          .eq('brand_id', brand.id)
          .eq('agent', `custom:${row.id}`)
          .eq('enabled', true)
          .order('next_run_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        out.custom = {
          id: row.id,
          name: row.name,
          agent: row.agent,
          avatar_face: row.avatar_face,
          avatar_color: row.avatar_color,
          enabled: row.enabled,
          days_of_week: Array.isArray(next?.days_of_week) ? (next.days_of_week as number[]) : [],
          times: Array.isArray(next?.times) ? (next.times as string[]) : [],
          next_run_label: next?.next_run_at ? formatInZone(String(next.next_run_at), tz) : null,
          last_run_label: next?.last_run_at ? formatInZone(String(next.last_run_at), tz) : null,
          last_error: (next?.last_error as string | null) ?? null
        };
      }
    }

    // Il lavoro "nella VM": i render video ancora in corso per questo brand. Solo lettura,
    // stessa tabella che il cron dei render drena — se non c'è ancora, il pannello tace.
    const { data: renders } = await admin
      .from('video_renders')
      .select('id, post_id, thread_id, status, submitted_at')
      .eq('brand_id', brand.id)
      .in('status', ['rendering', 'finishing'])
      .order('submitted_at', { ascending: false })
      .limit(3);
    out.renders = (renders ?? []).map((r) => ({
      id: String(r.id),
      post_id: (r.post_id as string | null) ?? null,
      status: String(r.status),
      submitted_at: String(r.submitted_at)
    }));
  } catch (e) {
    console.warn('[agent-panel] load degraded:', e instanceof Error ? e.message.slice(0, 160) : e);
  }
  return out;
}

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, slug, plan, timezone')
    .eq('slug', params.brand)
    .maybeSingle();

  if (!brand) throw error(404, 'Brand not found');

  // Independent reads (both scoped to brand+user+thread) — fetched together; the 404 below still
  // fires before anything is returned when the thread doesn't exist.
  // Close out dead rows before asking what is in flight, so a thread unblocks itself on open.
  await reapStaleChatJobs(supabase, { userId: user.id, threadId: params.thread, limit: 10 });

  const [thread, threadHistory, liveRun, artifacts, activeJobResult, failedJobResult, pendingToolsResult, approvalRowsResult, sessionMemoryResult, lastReads] = await Promise.all([
    getThread(supabase, params.thread, brand.id, user.id),
    loadThreadUiHistory(supabase, brand.id, user.id, params.thread),
    // Il run vivo arriva col primo render: seminato solo dal client, la bolla del lavoro in
    // corso non esisteva finché il poll non rispondeva, e il testo che il log aveva già non
    // aveva dove essere disegnato.
    loadLiveRun(supabase, params.thread).catch((e) => {
      console.error('[page] loadLiveRun', e);
      return null;
    }),
    // Stessa consegna di GET /chat?thread=: i fotogrammi di motion_stills / render_stills
    // vivono in chat_artifacts, non nel testo del messaggio. Senza questa load la pagina
    // del thread non ha niente da disegnare e l'utente vede la chip a vuoto.
    listThreadArtifacts(supabase, params.thread, brand.id).catch(() => []),
    supabase
      .from('chat_jobs')
      // `input_params` porta la firma della voce (chat di gruppo): serve al primo paint, o una
      // pagina aperta mentre parla la seconda voce mostrerebbe il volto di chi ha già finito.
      .select('id, status, created_at, input_params')
      .eq('thread_id', params.thread)
      .eq('user_id', user.id)
      .eq('tool_name', 'chat_response')
      .in('status', ['pending', 'running'])
      // A job older than the route's own limit is dead, not in flight: without this the page shows
      // the thread as "generating" forever and its composer stays locked.
      .gte('created_at', chatJobFreshSince())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // L'ultimo turno FALLITO di recente: se è l'ultima cosa successa sul thread, la pagina deve
    // dirlo (banner + riprova) — non un "Thinking" infinito né un thread che tace. È il caso dei
    // turni uccisi dal reaper (heartbeat perso) che non hanno lasciato nessuna risposta.
    supabase
      .from('chat_jobs')
      .select('id, status, error, created_at')
      .eq('thread_id', params.thread)
      .eq('user_id', user.id)
      .eq('tool_name', 'chat_response')
      .eq('status', 'failed')
      .gte('created_at', new Date(Date.now() - 6 * 3600_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('chat_jobs')
      .select('id, tool_name, status, created_at')
      .eq('thread_id', params.thread)
      .eq('user_id', user.id)
      .neq('tool_name', 'chat_response')
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('agent_kit_approval_requests')
      .select('id, harness_approval_id, status')
      .eq('thread_id', params.thread),
    supabase
      .from('brand_memory')
      .select('id, key, value, category')
      .eq('brand_id', brand.id)
      .eq('layer', 'session')
      .eq('thread_id', params.thread)
      .order('confidence', { ascending: false })
      .limit(40),
    // Il segnalibro di lettura (0207), letto QUI e non dal client: è la fotografia di "fin dove
    // era arrivato" scattata prima che l'apertura della pagina lo sposti in avanti. Da questo
    // valore, e da nient'altro, nasce il divisore "Nuovi messaggi" — la stessa soglia che conta
    // il badge in sidebar. Degrada a `{}` se la migration non c'è: nessun divisore, nessun errore.
    loadLastReads(supabase, user.id, [params.thread])
  ]);
  if (!thread) throw error(404, 'Thread not found');

  const approvalStatuses = Object.fromEntries(
    ((approvalRowsResult.data ?? []) as Array<{ id: string; harness_approval_id?: string | null; status: string }>).flatMap((row) => [
      [row.id, row.status],
      ...(row.harness_approval_id ? [[row.harness_approval_id, row.status]] : [])
    ])
  );

  // Dopo il 404: il pannello dipende da agent/custom_agent_id del thread risolto.
  const agentPanel = await loadAgentPanel(supabase, brand, thread);

  return {
    thread,
    agentPanel,
    agentDesktopEnabled: agentDesktopEnabled(),
    messages: threadHistory.messages,
    liveProgress: threadHistory.liveProgress,
    eventCursor: threadHistory.eventCursor,
    liveRun,
    approvalStatuses,
    artifacts,
    brandSlug: brand.slug,
    brandId: brand.id,
    // Congelato per tutta la visita: `reloadMessages` rinfresca i messaggi ma non `data`, quindi
    // il divisore resta dov'era anche se arrivano risposte mentre l'utente è dentro.
    lastReadAt: lastReads[params.thread] ?? null,
    activeJob: activeJobResult.data
      ? {
          id: activeJobResult.data.id,
          status: activeJobResult.data.status,
          created_at: activeJobResult.data.created_at,
          speaker:
            typeof (activeJobResult.data.input_params as { speaker?: unknown } | null)?.speaker === 'string'
              ? ((activeJobResult.data.input_params as { speaker: string }).speaker)
              : null
        }
      : null,
    // Solo quando NON c'è niente in volo: un turno vivo rende il fallimento vecchio irrilevante.
    failedJob: activeJobResult.data ? null : (failedJobResult.data ?? null),
    pendingToolJobs: pendingToolsResult.data ?? [],
    sessionMemory: sessionMemoryResult.data ?? []
  };
};

// Gli interruttori del pannello. NON una seconda logica: le stesse funzioni condivise che usa la
// pagina /agents (setJobEnabled → brand_job_optouts, setCustomAgentScheduleEnabled → la riga
// dell'agente custom), così spegnere da qui e da lì è per costruzione lo stesso gesto.
export const actions: Actions = {
  toggleJob: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'auth' });
    // La lettura via client utente È il controllo di accesso (RLS): senza brand, niente toggle.
    const { data: brand } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return fail(404, { error: 'missing' });
    const fd = await request.formData();
    const res = await setJobEnabled(createAdminClient(), {
      brandId: brand.id,
      jobKey: String(fd.get('job') ?? ''),
      enabled: String(fd.get('enabled') ?? '') === 'on',
      userId: user.id
    });
    if (!res.ok) return fail(res.error === 'unknown_job' ? 400 : 500, { error: res.error });
    return { ok: true };
  },

  toggleRoutine: async ({ request, params, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'auth' });
    const { data: brand } = await supabase
      .from('brands')
      .select('id, timezone')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return fail(404, { error: 'missing' });
    const fd = await request.formData();
    const ok = await setCustomAgentScheduleEnabled(supabase, {
      brandId: brand.id,
      id: String(fd.get('id') ?? ''),
      enabled: String(fd.get('enabled') ?? '') === 'on',
      timezone: brand.timezone || 'Europe/Rome'
    });
    if (!ok) return fail(404, { error: 'missing' });
    return { ok: true };
  }
};
