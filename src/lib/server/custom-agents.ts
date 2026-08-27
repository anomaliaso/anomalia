import type { SupabaseClient } from '@supabase/supabase-js';
import { createThread, getThread, setThreadAgent } from '$lib/server/chat/persistence';
import { enqueueQueuedChatTurn, kickChatQueueWork, threadHasActiveChatResponse } from '$lib/server/chat/queue';
import { resolveAgent } from '$lib/server/chat/agents';
import { nextScheduleRun, normalizeClockTime, normalizeDaysOfWeek } from '$lib/server/schedule';
import { scheduledWorkAllowed } from '$lib/server/job-roster';
import { getOrCreateTeamThread } from '$lib/server/team-ignition';
import { parseRoutineOwner, routineOwnerKey } from '$lib/agent-owners';
import { turnModelFamily } from '$lib/chat-model-policy';
import { getCustomAgent, getCustomAgentsByIds } from '$lib/server/custom-agents-read';
import {
  fallbackAvatarColor,
  fallbackAvatarFace,
  normalizeAvatarColor,
  normalizeAvatarFace,
  type AgentAvatarFace
} from '$lib/agent-avatars';

export const MAX_CUSTOM_AGENT_SCHEDULES = 25;
export const MAX_CUSTOM_AGENTS = 25;
export const MAX_TIMES_PER_DAY = 12;
export const MAX_PROMPT_LEN = 8000;
export const MAX_NAME_LEN = 80;

// ── L'AGENTE, SEPARATO DALLE SUE ROUTINE ────────────────────────────────────────────────────────
// Le LETTURE stanno in `custom-agents-read.ts` (modulo foglia: questo file importa la coda della
// chat, e la coda ha bisogno di leggere un custom agent — vedi il commento lassù). Qui restano le
// SCRITTURE e tutto ciò che tocca lo scheduler.
//
// `custom_agents` = CHI (nome, faccia, consegna permanente, se è in servizio).
// `custom_agent_schedules` = COSA FA OGNI TOT: una riga per routine, con la sua cadenza e il suo
// interruttore, legata al proprietario dalla colonna `agent` (`custom:<uuid>`).
// Prima erano la stessa riga: un custom agent aveva per forza esattamente una routine, e un solo
// interruttore per due decisioni diverse. Vedi 0210_custom_agents.sql.
export type { CustomAgentRow } from '$lib/server/custom-agents-read';
export { listCustomAgents, getCustomAgent, getCustomAgentsByIds } from '$lib/server/custom-agents-read';

export type CustomAgentInput = {
  name: string;
  prompt: string;
  agent: string | null;
  avatarFace: AgentAvatarFace;
  avatarColor: string;
  enabled: boolean;
  /**
   * Assente = non si tocca la colonna (un edit dal form che non la porta non deve cancellarla);
   * null = torna al default.
   */
  model?: unknown;
  templateSlug?: string | null;
};

/**
 * Il form dell'agente: le stesse regole del form della routine, meno la cadenza — che ora è di
 * qualcun altro. `agent` qui è solo lo SPECIALISTA che lo esegue: un agente non ha un
 * proprietario, quindi i prefissi `team:`/`custom:` non hanno senso e vengono rifiutati.
 */
export function parseCustomAgent(raw: {
  name?: unknown;
  prompt?: unknown;
  agent?: unknown;
  avatarFace?: unknown;
  avatarColor?: unknown;
  enabled?: unknown;
  model?: unknown;
}): { ok: true; value: CustomAgentInput } | { ok: false; error: 'name' | 'prompt' | 'agent' | 'model' } {
  const name = String(raw.name ?? '').trim();
  if (!name || name.length > MAX_NAME_LEN) return { ok: false, error: 'name' };

  const prompt = String(raw.prompt ?? '').trim();
  if (!prompt || prompt.length > MAX_PROMPT_LEN) return { ok: false, error: 'prompt' };

  const agentRaw = String(raw.agent ?? '').trim();
  if (agentRaw.startsWith('team:') || agentRaw.startsWith('custom:')) return { ok: false, error: 'agent' };
  const agent = agentRaw && agentRaw !== 'auto' ? resolveAgent(agentRaw) : null;
  if (agentRaw && agentRaw !== 'auto' && !agent) return { ok: false, error: 'agent' };

  let model: unknown;
  if (raw.model !== undefined && raw.model !== null) {
    const policy = turnModelFamily(raw.model);
    if (!policy) return { ok: false, error: 'model' };
    model = policy;
  } else if (raw.model === null) {
    model = null;
  }

  return {
    ok: true,
    value: {
      name,
      prompt,
      agent,
      avatarFace: normalizeAvatarFace(raw.avatarFace),
      avatarColor: normalizeAvatarColor(raw.avatarColor),
      // Un agente nuovo nasce in servizio: è l'assenza di routine a tenerlo fermo, non un flag.
      enabled: raw.enabled === undefined ? true : truthy(raw.enabled),
      model
    }
  };
}

function truthy(v: unknown): boolean {
  return v === true || v === 'on' || v === 'true' || v === '1';
}

export async function createCustomAgent(
  supabase: SupabaseClient,
  opts: { brandId: string; userId: string; input: CustomAgentInput }
): Promise<{ ok: true; id: string } | { ok: false; error: 'limit' | 'db' }> {
  const { count } = await supabase
    .from('custom_agents')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', opts.brandId);
  if ((count ?? 0) >= MAX_CUSTOM_AGENTS) return { ok: false, error: 'limit' };

  const { data, error } = await supabase
    .from('custom_agents')
    .insert({
      brand_id: opts.brandId,
      user_id: opts.userId,
      name: opts.input.name,
      prompt: opts.input.prompt,
      agent: opts.input.agent,
      avatar_face: opts.input.avatarFace,
      avatar_color: opts.input.avatarColor,
      enabled: opts.input.enabled,
      ...(opts.input.model !== undefined ? { model: opts.input.model } : {}),
      ...(opts.input.templateSlug ? { template_slug: opts.input.templateSlug } : {})
    })
    .select('id')
    .maybeSingle();
  if (error || !data?.id) return { ok: false, error: 'db' };
  return { ok: true, id: data.id as string };
}

export async function updateCustomAgent(
  supabase: SupabaseClient,
  opts: { brandId: string; id: string; input: CustomAgentInput }
): Promise<{ ok: true } | { ok: false; error: 'missing' | 'db' }> {
  const { error, data } = await supabase
    .from('custom_agents')
    .update({
      name: opts.input.name,
      prompt: opts.input.prompt,
      agent: opts.input.agent,
      avatar_face: opts.input.avatarFace,
      avatar_color: opts.input.avatarColor,
      enabled: opts.input.enabled,
      ...(opts.input.model !== undefined ? { model: opts.input.model } : {}),
      updated_at: new Date().toISOString()
    })
    .eq('id', opts.id)
    .eq('brand_id', opts.brandId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: 'db' };
  if (!data) return { ok: false, error: 'missing' };
  return { ok: true };
}

/**
 * L'interruttore dell'AGENTE. Non tocca `enabled` delle sue routine: spegnerle una per una per poi
 * non saper più quali riaccendere è il modo di trasformare una pausa in una perdita. Il tick le
 * salta finché l'agente è fuori servizio (vedi `fireCustomAgentSchedule`).
 */
export async function setCustomAgentEnabled(
  supabase: SupabaseClient,
  opts: { brandId: string; id: string; enabled: boolean }
): Promise<boolean> {
  const { data, error } = await supabase
    .from('custom_agents')
    .update({ enabled: opts.enabled, updated_at: new Date().toISOString() })
    .eq('id', opts.id)
    .eq('brand_id', opts.brandId)
    .select('id')
    .maybeSingle();
  return !error && !!data;
}

/**
 * Licenziare un agente porta via anche i suoi incarichi: `custom_agent_schedules.agent` è testo,
 * non una foreign key, quindi senza questa riga le sue routine resterebbero a girare senza più
 * una card su cui comparire — invisibili e attive, il peggio dei due mondi.
 */
export async function deleteCustomAgent(
  supabase: SupabaseClient,
  opts: { brandId: string; id: string }
): Promise<boolean> {
  await supabase
    .from('custom_agent_schedules')
    .delete()
    .eq('brand_id', opts.brandId)
    .eq('agent', `custom:${opts.id}`);
  const { error } = await supabase
    .from('custom_agents')
    .delete()
    .eq('id', opts.id)
    .eq('brand_id', opts.brandId);
  return !error;
}

/**
 * ASSUMERE + DARE IL PRIMO INCARICO, in un colpo solo.
 *
 * Un agente nuovo che nasce senza niente da fare è un collega assunto e mai chiamato: ogni strada
 * che crea un custom agent da zero (la libreria, il tool della chat, la conferma di una proposta)
 * crea anche la sua prima routine. Se la seconda scrittura fallisce si torna indietro sulla prima,
 * o resterebbe una card vuota che nessuno ha chiesto.
 */
export async function hireCustomAgent(
  supabase: SupabaseClient,
  opts: {
    brandId: string;
    userId: string;
    timezone: string;
    agent: CustomAgentInput;
    routine: CustomAgentScheduleInput;
  }
): Promise<{ ok: true; agentId: string; scheduleId: string } | { ok: false; error: 'limit' | 'db' }> {
  const hired = await createCustomAgent(supabase, {
    brandId: opts.brandId,
    userId: opts.userId,
    input: opts.agent
  });
  if (!hired.ok) return hired;

  const routine = await createCustomAgentSchedule(supabase, {
    brandId: opts.brandId,
    userId: opts.userId,
    timezone: opts.timezone,
    input: { ...opts.routine, agent: `custom:${hired.id}` }
  });
  if (!routine.ok) {
    await deleteCustomAgent(supabase, { brandId: opts.brandId, id: hired.id });
    return routine;
  }
  return { ok: true, agentId: hired.id, scheduleId: routine.id };
}

export type CustomAgentScheduleRow = {
  id: string;
  brand_id: string;
  user_id: string;
  name: string;
  prompt: string;
  agent: string | null;
  avatar_face: string | null;
  avatar_color: string | null;
  enabled: boolean;
  days_of_week: number[];
  times: string[];
  reuse_thread: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_thread_id: string | null;
  last_job_id: string | null;
  last_error: string | null;
  /** Library agent this row was installed from (null = written from scratch). */
  template_slug: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomAgentScheduleInput = {
  name: string;
  prompt: string;
  agent: string | null;
  avatarFace: AgentAvatarFace;
  avatarColor: string;
  daysOfWeek: number[];
  times: string[];
  enabled: boolean;
  reuseThread: boolean;
  /** Set only when installing from the Agent Library; an edit never carries it. */
  templateSlug?: string | null;
};

export type ParseScheduleError =
  | 'name'
  | 'prompt'
  | 'days'
  | 'times'
  | 'agent';

export function parseCustomAgentSchedule(raw: {
  name?: unknown;
  prompt?: unknown;
  agent?: unknown;
  avatarFace?: unknown;
  avatarColor?: unknown;
  days?: unknown;
  times?: unknown;
  enabled?: unknown;
  reuseThread?: unknown;
}): { ok: true; value: CustomAgentScheduleInput } | { ok: false; error: ParseScheduleError } {
  const name = String(raw.name ?? '').trim();
  if (!name || name.length > MAX_NAME_LEN) return { ok: false, error: 'name' };

  const prompt = String(raw.prompt ?? '').trim();
  if (!prompt || prompt.length > MAX_PROMPT_LEN) return { ok: false, error: 'prompt' };

  const daysRaw = Array.isArray(raw.days) ? raw.days : raw.days != null ? [raw.days] : [];
  const daysOfWeek = normalizeDaysOfWeek(daysRaw);
  if (!daysOfWeek.length) return { ok: false, error: 'days' };

  const timesRaw = Array.isArray(raw.times) ? raw.times : raw.times != null ? [raw.times] : [];
  const times = [
    ...new Set(
      timesRaw
        .map((t) => normalizeClockTime(String(t ?? '')))
        .filter((t): t is string => !!t)
    )
  ].sort();
  if (!times.length || times.length > MAX_TIMES_PER_DAY) return { ok: false, error: 'times' };

  // `agent` porta due cose diverse, e la differenza è tutta nel prefisso (agent-owners.ts):
  // `team:<id>` / `custom:<uuid>` = il PROPRIETARIO della routine (conservato tale e quale, è
  // quello che la fa comparire sulla card giusta e atterrare nel diario giusto); un id nudo =
  // solo chi la esegue, cioè il custom agent classico com'è sempre stato.
  const agentRaw = String(raw.agent ?? '').trim();
  const owner = parseRoutineOwner(agentRaw);
  let agent: string | null;
  if (owner) {
    agent = routineOwnerKey(owner);
  } else {
    // Un prefisso riconoscibile ma non valido (`custom:` con un id inventato, `team:pippo`) non
    // deve degradare in silenzio a "nessun proprietario": la routine finirebbe su una card sua.
    if (agentRaw.startsWith('team:') || agentRaw.startsWith('custom:')) return { ok: false, error: 'agent' };
    agent = agentRaw && agentRaw !== 'auto' ? resolveAgent(agentRaw) : null;
    if (agentRaw && agentRaw !== 'auto' && !agent) return { ok: false, error: 'agent' };
  }

  // Unknown / missing avatars fall back to the defaults instead of failing the save.
  const avatarFace = normalizeAvatarFace(raw.avatarFace);
  const avatarColor = normalizeAvatarColor(raw.avatarColor);

  const enabled =
    raw.enabled === true || raw.enabled === 'on' || raw.enabled === 'true' || raw.enabled === '1';
  const reuseThread =
    raw.reuseThread === true ||
    raw.reuseThread === 'on' ||
    raw.reuseThread === 'true' ||
    raw.reuseThread === '1';

  return {
    ok: true,
    value: { name, prompt, agent, avatarFace, avatarColor, daysOfWeek, times, enabled, reuseThread }
  };
}

export function formDataToScheduleRaw(fd: FormData) {
  return {
    name: fd.get('name'),
    prompt: fd.get('prompt'),
    agent: fd.get('agent'),
    avatarFace: fd.get('avatar_face'),
    avatarColor: fd.get('avatar_color'),
    days: fd.getAll('days'),
    times: fd.getAll('times'),
    enabled: fd.get('enabled'),
    reuseThread: fd.get('reuse_thread')
  };
}

function rowToInsert(
  brandId: string,
  userId: string,
  input: CustomAgentScheduleInput,
  timezone: string,
  now = new Date()
) {
  return {
    brand_id: brandId,
    user_id: userId,
    name: input.name,
    prompt: input.prompt,
    agent: input.agent,
    avatar_face: input.avatarFace,
    avatar_color: input.avatarColor,
    // Only written on install: leaving the key out keeps an edit from wiping the provenance.
    ...(input.templateSlug ? { template_slug: input.templateSlug } : {}),
    enabled: input.enabled,
    days_of_week: input.daysOfWeek,
    times: input.times,
    reuse_thread: input.reuseThread,
    next_run_at: input.enabled
      ? nextScheduleRun(input.daysOfWeek, input.times, timezone, now)
      : null,
    updated_at: now.toISOString()
  };
}

export async function listCustomAgentSchedules(
  supabase: SupabaseClient,
  brandId: string
): Promise<CustomAgentScheduleRow[]> {
  const { data } = await supabase
    .from('custom_agent_schedules')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });
  return (data ?? []) as CustomAgentScheduleRow[];
}

export async function createCustomAgentSchedule(
  supabase: SupabaseClient,
  opts: {
    brandId: string;
    userId: string;
    timezone: string;
    input: CustomAgentScheduleInput;
  }
): Promise<{ ok: true; id: string } | { ok: false; error: 'limit' | 'db' }> {
  const { count } = await supabase
    .from('custom_agent_schedules')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', opts.brandId);
  if ((count ?? 0) >= MAX_CUSTOM_AGENT_SCHEDULES) return { ok: false, error: 'limit' };

  const { data, error } = await supabase
    .from('custom_agent_schedules')
    .insert(rowToInsert(opts.brandId, opts.userId, opts.input, opts.timezone))
    .select('id')
    .maybeSingle();
  if (error || !data?.id) return { ok: false, error: 'db' };
  return { ok: true, id: data.id as string };
}

export async function updateCustomAgentSchedule(
  supabase: SupabaseClient,
  opts: {
    brandId: string;
    id: string;
    timezone: string;
    input: CustomAgentScheduleInput;
  }
): Promise<{ ok: true } | { ok: false; error: 'missing' | 'db' }> {
  const { data: existing } = await supabase
    .from('custom_agent_schedules')
    .select('id')
    .eq('id', opts.id)
    .eq('brand_id', opts.brandId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'missing' };

  const patch = rowToInsert(opts.brandId, '', opts.input, opts.timezone);
  delete (patch as { brand_id?: string }).brand_id;
  delete (patch as { user_id?: string }).user_id;

  const { error } = await supabase
    .from('custom_agent_schedules')
    .update(patch)
    .eq('id', opts.id)
    .eq('brand_id', opts.brandId);
  if (error) return { ok: false, error: 'db' };
  return { ok: true };
}

export async function setCustomAgentScheduleEnabled(
  supabase: SupabaseClient,
  opts: { brandId: string; id: string; enabled: boolean; timezone: string }
): Promise<boolean> {
  const { data: row } = await supabase
    .from('custom_agent_schedules')
    .select('days_of_week, times')
    .eq('id', opts.id)
    .eq('brand_id', opts.brandId)
    .maybeSingle();
  if (!row) return false;
  const next = opts.enabled
    ? nextScheduleRun(row.days_of_week as number[], row.times as string[], opts.timezone)
    : null;
  const { error } = await supabase
    .from('custom_agent_schedules')
    .update({ enabled: opts.enabled, next_run_at: next, updated_at: new Date().toISOString() })
    .eq('id', opts.id)
    .eq('brand_id', opts.brandId);
  return !error;
}

export async function deleteCustomAgentSchedule(
  supabase: SupabaseClient,
  opts: { brandId: string; id: string }
): Promise<boolean> {
  const { error } = await supabase
    .from('custom_agent_schedules')
    .delete()
    .eq('id', opts.id)
    .eq('brand_id', opts.brandId);
  return !error;
}

async function localeForUser(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from('profiles').select('locale').eq('id', userId).maybeSingle();
  const loc = String(data?.locale ?? '');
  return loc.toLowerCase().startsWith('en') ? 'en' : 'it';
}

/**
 * DOVE ATTERRA UN GIRO. Una routine con un proprietario scrive nel DIARIO del proprietario —
 * lo stesso thread `surface='team'` in cui il proprietario lascia già i resoconti delle sue altre
 * routine (team-ignition.ts) — invece di aprirsi un thread nuovo ogni volta. È il punto di tutto
 * il lavoro: se il "Recap del lunedì" dell'Analyst finisse in una chat sua, l'utente avrebbe di
 * nuovo due interlocutori per lo stesso mestiere.
 *
 * Il thread può appartenere a un UTENTE DIVERSO da `row.user_id` (il diario di squadra è
 * dell'owner del brand): per questo la funzione restituisce anche lo userId — il turno va accodato
 * per il proprietario del thread, o i messaggi finirebbero scritti a nome di qualcuno che quel
 * thread non lo legge.
 *
 * Senza proprietario tutto resta com'era: il custom agent classico, thread suoi.
 */
async function resolveThread(
  admin: SupabaseClient,
  row: CustomAgentScheduleRow
): Promise<{ threadId: string; userId: string } | null> {
  const owner = parseRoutineOwner(row.agent);
  if (owner?.kind === 'builtin') {
    const t = await getOrCreateTeamThread(admin, row.brand_id, owner.agentId);
    return t ? { threadId: t.threadId, userId: t.userId } : null;
  }
  if (owner?.kind === 'custom') {
    const t = await customAgentThread(admin, row.brand_id, owner.scheduleId);
    if (t) return t;
    // Il proprietario non esiste più (cancellato): meglio un thread proprio che nessun giro.
  }

  if (row.reuse_thread && row.last_thread_id) {
    const existing = await getThread(admin, row.last_thread_id, row.brand_id, row.user_id);
    if (existing) {
      if ((existing.agent ?? null) !== (row.agent ?? null)) {
        await setThreadAgent(admin, existing.id, row.brand_id, row.user_id, row.agent);
      }
      return { threadId: existing.id, userId: row.user_id };
    }
  }
  const thread = await createThread(admin, row.brand_id, row.user_id, row.name, null, row.agent);
  return thread?.id ? { threadId: thread.id, userId: row.user_id } : null;
}

/**
 * Il diario di UN custom agent: stessa coppia (`surface='team'`, `surface_key`) dei diari della
 * squadra di default, con `custom:<uuid>` come chiave. L'indice unico su
 * (brand, user, surface, surface_key) fa il get-or-create senza gare, esattamente come per i
 * builtin — nessuna colonna nuova.
 */
export async function customAgentThread(
  admin: SupabaseClient,
  brandId: string,
  scheduleId: string
): Promise<{ threadId: string; userId: string } | null> {
  const owner = await getCustomAgent(admin, brandId, scheduleId);
  if (!owner) return null;

  const key = `custom:${owner.id}`;
  const { data: existing } = await admin
    .from('chat_threads')
    .select('id')
    .eq('brand_id', brandId)
    .eq('user_id', owner.user_id as string)
    .eq('surface', 'team')
    .eq('surface_key', key)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return { threadId: existing.id as string, userId: owner.user_id as string };

  const thread = await createThread(
    admin,
    brandId,
    owner.user_id as string,
    owner.name || 'Agent',
    null,
    resolveAgent(owner.agent),
    'team',
    key
  );
  if (!thread?.id) return null;
  // Il persona del custom agent vale per ogni turno che gira in questo thread: senza, un giro
  // scritto nel diario di "Watcher" risponderebbe con la voce del generalista.
  await admin.from('chat_threads').update({ custom_agent_id: owner.id }).eq('id', thread.id);
  return { threadId: thread.id as string, userId: owner.user_id as string };
}

export async function fireCustomAgentSchedule(
  admin: SupabaseClient,
  row: CustomAgentScheduleRow,
  origin: string
): Promise<{ ok: true; threadId: string; jobId: string } | { ok: false; error: string }> {
  // L'AGENTE FUORI SERVIZIO SOSPENDE LE SUE ROUTINE. Il gate sta QUI e non nel tick perché anche
  // "Esegui ora" passa di qui: un interruttore che il pulsante accanto scavalca non è spento.
  // La routine tiene il suo `enabled`: quando l'agente torna in servizio riparte com'era.
  const ownerAgent = parseRoutineOwner(row.agent);
  if (ownerAgent?.kind === 'custom') {
    const boss = await getCustomAgent(admin, row.brand_id, ownerAgent.scheduleId);
    if (boss && !boss.enabled) return { ok: false, error: 'agent_paused' };
  }

  if (row.last_job_id) {
    const { data: prev } = await admin
      .from('chat_jobs')
      .select('status')
      .eq('id', row.last_job_id)
      .maybeSingle();
    if (prev?.status === 'pending' || prev?.status === 'running') {
      return { ok: false, error: 'previous_run_active' };
    }
  }

  const target = await resolveThread(admin, row);
  if (!target) return { ok: false, error: 'thread_create_failed' };
  // Il diario di squadra è dell'owner del brand, che può non essere chi ha scritto la routine.
  const { threadId, userId } = target;

  const busy = await threadHasActiveChatResponse(admin, {
    userId,
    threadId
  });
  if (busy) return { ok: false, error: 'thread_busy' };

  const locale = await localeForUser(admin, userId);
  const jobId = await enqueueQueuedChatTurn(admin, {
    brandId: row.brand_id,
    userId,
    threadId,
    userMessage: row.prompt,
    locale,
    origin,
    scheduled: true
  });
  if (!jobId) return { ok: false, error: 'enqueue_failed' };

  const firedAt = new Date().toISOString();
  await admin
    .from('custom_agent_schedules')
    .update({
      last_thread_id: threadId,
      last_job_id: jobId,
      last_error: null,
      last_run_at: firedAt,
      updated_at: firedAt
    })
    .eq('id', row.id);

  await recordThreadRun(admin, row, threadId);

  void kickChatQueueWork(origin);
  return { ok: true, threadId, jobId };
}

/**
 * Remember that this agent ran in this thread, so the sidebar can stack the avatars.
 *
 * La pila mostra CHI ha lavorato lì, quindi si registra il proprietario, non la routine. Una
 * routine di un agente di default non ha un avatar custom da impilare: non si registra affatto.
 * Senza proprietario (prima della 0210) la routine È l'agente, e vale il suo stesso id.
 */
async function recordThreadRun(
  admin: SupabaseClient,
  row: CustomAgentScheduleRow,
  threadId: string
): Promise<void> {
  const owner = parseRoutineOwner(row.agent);
  if (owner?.kind === 'builtin') return;
  const agentId = owner?.kind === 'custom' ? owner.scheduleId : row.id;
  await touchThreadAgentRun(admin, { brandId: row.brand_id, threadId, scheduleId: agentId });
}


/** Record that a custom agent is working in this thread, so the sidebar stacks its avatar. */
export async function touchThreadAgentRun(
  supabase: SupabaseClient,
  opts: { brandId: string; threadId: string; scheduleId: string }
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('custom_agent_thread_runs')
    .select('runs')
    .eq('thread_id', opts.threadId)
    .eq('schedule_id', opts.scheduleId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from('custom_agent_thread_runs')
      .update({ last_run_at: now, runs: (existing.runs as number) + 1 })
      .eq('thread_id', opts.threadId)
      .eq('schedule_id', opts.scheduleId);
    return;
  }
  await supabase.from('custom_agent_thread_runs').insert({
    thread_id: opts.threadId,
    schedule_id: opts.scheduleId,
    brand_id: opts.brandId,
    first_run_at: now,
    last_run_at: now,
    runs: 1
  });
}

/** Avatar of one custom agent that has run in a thread. */
export type ThreadAgentAvatar = {
  id: string;
  name: string;
  face: string;
  color: string;
};

/**
 * Avatars of the custom agents that ran in each of `threadIds`, newest run first.
 * Threads no agent touched are simply absent from the map.
 */
export async function listThreadAgentAvatars(
  supabase: SupabaseClient,
  brandId: string,
  threadIds: string[]
): Promise<Record<string, ThreadAgentAvatar[]>> {
  const out: Record<string, ThreadAgentAvatar[]> = {};
  if (!threadIds.length) return out;

  const { data: runs } = await supabase
    .from('custom_agent_thread_runs')
    .select('thread_id, schedule_id, last_run_at')
    .eq('brand_id', brandId)
    .in('thread_id', threadIds)
    .order('last_run_at', { ascending: false });
  if (!runs?.length) return out;

  // La faccia è dell'AGENTE, non della routine che l'ha fatto lavorare: due routine dello stesso
  // agente devono impilare un avatar solo.
  const agents = await getCustomAgentsByIds(
    supabase,
    brandId,
    [...new Set(runs.map((r) => r.schedule_id as string))]
  );

  const byId = new Map(
    agents.map((s) => [
      s.id,
      {
        id: s.id,
        name: s.name ?? '',
        face: s.avatar_face ? normalizeAvatarFace(s.avatar_face) : fallbackAvatarFace(s.id),
        color: s.avatar_color ? normalizeAvatarColor(s.avatar_color) : fallbackAvatarColor(s.id)
      }
    ])
  );

  for (const run of runs) {
    const avatar = byId.get(run.schedule_id as string);
    if (!avatar) continue;
    const list = (out[run.thread_id as string] ??= []);
    if (!list.some((a) => a.id === avatar.id)) list.push(avatar);
  }
  return out;
}

export async function tickCustomAgentSchedules(
  admin: SupabaseClient,
  origin: string,
  now = new Date()
): Promise<{ due: number; fired: number; skipped: number; errors: number }> {
  const { data: due } = await admin
    .from('custom_agent_schedules')
    .select('*')
    .eq('enabled', true)
    .lte('next_run_at', now.toISOString())
    .order('next_run_at', { ascending: true })
    .limit(40);

  const result = { due: due?.length ?? 0, fired: 0, skipped: 0, errors: 0 };
  if (!due?.length) return result;

  const brandIds = [...new Set(due.map((r) => r.brand_id as string))];
  const { data: brands } = await admin
    .from('brands')
    .select('id, timezone, status, plan')
    .in('id', brandIds);
  const brandById = new Map((brands ?? []).map((b) => [b.id as string, b]));

  for (const raw of due) {
    const row = raw as CustomAgentScheduleRow;
    const brand = brandById.get(row.brand_id);
    // Il brand fermo si salta DOPO aver fatto avanzare next_run_at, non prima: uscendo qui la riga
    // restava con un next_run_at nel passato e la query è `order(next_run_at).limit(40)`, quindi le
    // schedulazioni dei brand decaduti si accumulavano in testa e affamavano quelle vive.
    const tz = (brand?.timezone as string) || 'Europe/Rome';
    let nextAt: string | null;
    try {
      nextAt = nextScheduleRun(row.days_of_week, row.times, tz, now);
    } catch (e) {
      await admin
        .from('custom_agent_schedules')
        .update({ last_error: 'invalid_timezone', updated_at: now.toISOString() })
        .eq('id', row.id);
      result.errors++;
      continue;
    }
    const { data: claimed } = await admin
      .from('custom_agent_schedules')
      .update({
        next_run_at: nextAt,
        updated_at: now.toISOString()
      })
      .eq('id', row.id)
      .eq('enabled', true)
      .eq('next_run_at', row.next_run_at)
      .select('id')
      .maybeSingle();
    if (!claimed) {
      result.skipped++;
      continue;
    }

    if (!brand || brand.status !== 'active') {
      await admin
        .from('custom_agent_schedules')
        .update({ last_error: 'brand_inactive', updated_at: now.toISOString() })
        .eq('id', row.id);
      result.skipped++;
      continue;
    }

    // Senza un piano a pagamento gli agenti schedulati non partono — stessa regola (e stessa
    // funzione) dei lavori del roster: `scheduledWorkAllowed` in job-roster.ts. Il salto avviene
    // DOPO la CAS che ha già fatto avanzare next_run_at, così la riga non si accumula in testa
    // alla coda (stesso ordine del salto brand_inactive qui sopra). `plan_required` ha la sua
    // chiave i18n su /agents, scritta come "fai l'upgrade per avviarlo", non come un guasto.
    if (!scheduledWorkAllowed((brand as { plan?: string | null }).plan)) {
      await admin
        .from('custom_agent_schedules')
        .update({ last_error: 'plan_required', updated_at: now.toISOString() })
        .eq('id', row.id);
      result.skipped++;
      continue;
    }

    const fired = await fireCustomAgentSchedule(admin, row, origin);
    if (fired.ok) {
      result.fired++;
    } else if (fired.error === 'agent_paused') {
      // Il proprietario è fuori servizio: la finestra si salta e basta. NON si rimette indietro
      // next_run_at (la routine tornerebbe subito in testa alla coda a ogni tick, per niente).
      await admin
        .from('custom_agent_schedules')
        .update({ last_error: 'agent_paused', updated_at: now.toISOString() })
        .eq('id', row.id);
      result.skipped++;
    } else if (fired.error === 'previous_run_active' || fired.error === 'thread_busy') {
      // Put the slot back so the next tick retries instead of skipping the window.
      await admin
        .from('custom_agent_schedules')
        .update({ next_run_at: row.next_run_at, last_error: fired.error, updated_at: now.toISOString() })
        .eq('id', row.id);
      result.skipped++;
    } else {
      await admin
        .from('custom_agent_schedules')
        .update({ last_error: fired.error, updated_at: now.toISOString() })
        .eq('id', row.id);
      result.errors++;
    }
  }
  return result;
}
