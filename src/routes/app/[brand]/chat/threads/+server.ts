import { json } from '@sveltejs/kit';
import {
  createThread,
  getThread,
  listThreads,
  listThreadSnippets,
  renameThread,
  deleteThread,
  setThreadAgent,
  setThreadCustomAgent,
  setThreadModel
} from '$lib/server/chat/persistence';
import { dmAgents } from '$lib/chat-dm';
import { turnModelFamily } from '$lib/chat-model-policy';
import { resolveAgentForPlan } from '$lib/server/chat/agents';
import {
  groupChatsEnabled,
  isRoomThread,
  parseRoomAgents,
  roomAvatars,
  roomRoster,
  setThreadRoomAgents
} from '$lib/server/chat/room';
import { listThreadAgentAvatars } from '$lib/server/custom-agents';
import { isUnread, loadLastReads, loadUnreadCounts, markThreadRead } from '$lib/server/chat/unread';
import { hasWebHub } from '$lib/server/plans';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import type { RequestHandler } from './$types';

// GET: list all threads for this brand+user
export const GET: RequestHandler = async ({ params, locals: { supabase, safeGetSession, locale: uiLocale } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data: brand } = await supabase.from('brands').select('id, plan').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  // Le DM fra agenti NON compaiono in sidebar: lì stanno solo le conversazioni in cui c'è
  // l'utente. Il thread privato resta raggiungibile dal chip "N messaggi con X" dentro il turno
  // che l'ha generato (e per url diretto): è un allegato di quel turno, non una chat sua pari.
  const threads = (await listThreads(supabase, brand.id, user.id)).filter(
    (t) => !dmAgents((t as { room_agents?: unknown }).room_agents)
  );
  const ids = threads.map((t) => t.id);
  // Custom agents that ran in each thread — the sidebar stacks their avatars.
  const avatars = await listThreadAgentAvatars(supabase, brand.id, ids);

  // Chat di gruppo: per una stanza la pila di avatar è LA STANZA — i membri, nell'ordine in cui
  // sono stati scelti — non chi ci ha girato dentro. Stessa forma di `listThreadAgentAvatars`,
  // quindi sidebar e `threadIdentity` non imparano niente di nuovo.
  // ponytail: una roster per thread-stanza. Le stanze sono poche e la query sui custom agent
  // parte solo se ce ne sono; se un giorno saranno tante, si accorpano in una query sola.
  const locale = bilingualNoticeLocale(uiLocale);
  const roomRows = threads.filter((t) => isRoomThread(t as { room_agents?: unknown }));
  const roomAvatarsByThread: Record<string, ReturnType<typeof roomAvatars>> = {};
  await Promise.all(
    roomRows.map(async (t) => {
      const members = await roomRoster(
        supabase,
        brand.id,
        parseRoomAgents((t as { room_agents?: unknown }).room_agents),
        locale
      );
      if (members.length >= 2) roomAvatarsByThread[t.id] = roomAvatars(members);
    })
  );
  // Query a parte (0207): se la tabella non c'è ancora torna vuota e nessun thread risulta non
  // letto, invece di far fallire la lista dei thread.
  // L'anteprima dell'ultimo messaggio è un'altra query a parte, per la stessa regola: la select
  // condivisa di listThreads non si allarga mai.
  const [reads, previews] = await Promise.all([
    loadLastReads(supabase, user.id, ids),
    listThreadSnippets(supabase, ids)
  ]);
  // Il NUMERO sul badge: un'altra query a parte, e solo per i thread già risultati non letti
  // (spesso nessuno, e allora non parte affatto). Sequenziale e non dentro la Promise.all qui
  // sopra perché ha bisogno delle soglie di lettura per sapere da dove contare.
  const unreadSince: Record<string, string> = {};
  for (const t of threads) {
    if (isUnread(t.updated_at, reads[t.id])) unreadSince[t.id] = reads[t.id];
  }
  const counts = await loadUnreadCounts(supabase, unreadSince);
  return json({
    threads: threads.map((t) => {
      const unread = t.id in unreadSince;
      return {
        ...t,
        agents: roomAvatarsByThread[t.id] ?? avatars[t.id] ?? [],
        unread,
        // Non letto ma senza conto (conteggio fallito, o `updated_at` mosso da qualcosa che non è
        // un messaggio): resta un badge da 1, mai una pillola vuota.
        unread_count: unread ? Math.max(1, counts[t.id] ?? 0) : 0,
        preview: previews[t.id] ?? null
      };
    })
  });
};

// POST: create a new thread
export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data: brand } = await supabase.from('brands').select('id, plan').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const title = (body.title as string) || 'Nuova chat';
  // Optional: bind the specialized agent right at creation (multi-agent chat).
  const agent = resolveAgentForPlan(body.agent, hasWebHub(brand.plan));

  const thread = await createThread(supabase, brand.id, user.id, title, null, agent);

  // Chat di gruppo: `agents` è la stanza, `agent` resta chi risponde se la stanza non regge
  // (feature spenta, migration non applicata, meno di due membri validi). Un update a parte e non
  // un parametro di createThread apposta: se fallisce, il thread è già nato ed è un thread normale.
  let room: string[] = [];
  if (thread && groupChatsEnabled() && Array.isArray(body.agents)) {
    room = await setThreadRoomAgents(supabase, thread.id, brand.id, user.id, body.agents);
  }
  return json({ thread: thread ? { ...thread, room_agents: room.length ? room : null } : thread }, { status: 201 });
};

// PATCH: rename a thread and/or set its specialized agent
export const PATCH: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data: brand } = await supabase.from('brands').select('id, plan').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  const body = await request.json();
  const { thread_id, title, agent, agents, custom_agent_id, read, model } = body as {
    thread_id: string;
    title?: string;
    agent?: string;
    /** Chat di gruppo: la stanza intera. Array vuoto = torna un thread a un agente solo. */
    agents?: unknown[];
    custom_agent_id?: string | null;
    read?: boolean;
    model?: unknown;
  };
  if (!thread_id) return json({ error: 'Missing thread_id' }, { status: 400 });

  // "L'ho aperto e l'ho guardato": lo manda la colonna di chat quando mostra questo thread, non la
  // sidebar che ne disegna l'anteprima.
  if (read) {
    await markThreadRead(supabase, thread_id, user.id);
    return json({ success: true });
  }

  // Un DM fra agenti non si riconfigura da fuori: né titolo, né agente, né stanza — basterebbe
  // un PATCH con `agents: []` per azzerare il marcatore e riaprire alla scrittura un thread che
  // il server dichiara view-only. Il segnalibro di lettura (sopra) resta libero.
  if (
    custom_agent_id !== undefined ||
    agents !== undefined ||
    agent !== undefined ||
    typeof title === 'string' ||
    model !== undefined
  ) {
    const t = await getThread(supabase, thread_id, brand.id, user.id);
    if (t && dmAgents(t.room_agents)) return json({ error: 'dm_view_only' }, { status: 403 });
  }

  if (model !== undefined) {
    const policy = model === null ? null : turnModelFamily(model);
    if (model !== null && !policy) return json({ error: 'invalid_model' }, { status: 400 });
    await setThreadModel(supabase, thread_id, brand.id, user.id, policy);
  }

  // null clears the binding; a string binds the thread to that custom agent.
  if (custom_agent_id !== undefined) {
    await setThreadCustomAgent(
      supabase,
      thread_id,
      brand.id,
      user.id,
      typeof custom_agent_id === 'string' && custom_agent_id ? custom_agent_id : null
    );
  }

  if (agents !== undefined && groupChatsEnabled()) {
    await setThreadRoomAgents(supabase, thread_id, brand.id, user.id, agents);
  }

  if (agent !== undefined) {
    await setThreadAgent(
      supabase,
      thread_id,
      brand.id,
      user.id,
      resolveAgentForPlan(agent, hasWebHub(brand.plan))
    );
  }
  if (typeof title === 'string' && title.trim()) {
    await renameThread(supabase, thread_id, brand.id, user.id, title.trim());
  } else if (
    agent === undefined &&
    agents === undefined &&
    custom_agent_id === undefined &&
    model === undefined
  ) {
    return json({ error: 'Missing title or agent' }, { status: 400 });
  }

  return json({ success: true });
};

// DELETE: delete a thread
export const DELETE: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data: brand } = await supabase.from('brands').select('id, plan').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  const body = await request.json();
  const { thread_id } = body as { thread_id: string };
  if (!thread_id) return json({ error: 'Missing thread_id' }, { status: 400 });

  await deleteThread(supabase, thread_id, brand.id, user.id);
  return json({ success: true });
};
