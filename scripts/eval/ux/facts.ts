import type { SupabaseClient } from '@supabase/supabase-js';
import { dmAgents } from '$lib/chat-dm';

export type BrandRef = { id: string; slug: string; name: string };

export type ChatFacts = {
  threadCount: number;
  assistantMessages: number;
  userMessages: number;
  firstAssistantLatencyMs: number | null;
};

export async function brandForUser(admin: SupabaseClient, userId: string): Promise<BrandRef | null> {
  const { data: orgs } = await admin.from('organizations').select('id').eq('owner_id', userId);
  const orgIds = (orgs ?? []).map((o) => o.id);
  if (!orgIds.length) return null;
  const { data: brands } = await admin.from('brands').select('id, slug, name').in('org_id', orgIds);
  return brands?.[0] ?? null;
}

export async function chatFacts(admin: SupabaseClient, brandId: string): Promise<ChatFacts> {
  const { data: threads } = await admin.from('chat_threads').select('id').eq('brand_id', brandId);
  const threadIds = (threads ?? []).map((t) => t.id);
  if (!threadIds.length) {
    return { threadCount: 0, assistantMessages: 0, userMessages: 0, firstAssistantLatencyMs: null };
  }
  const { data: messages } = await admin
    .from('chat_messages')
    .select('role, content, created_at, thread_id')
    .in('thread_id', threadIds)
    .order('created_at', { ascending: true });
  const rows = messages ?? [];
  const firstUser = rows.find((m) => m.role === 'user');
  const firstAssistant = rows.find((m) => m.role === 'assistant');
  const latency =
    firstUser && firstAssistant
      ? new Date(firstAssistant.created_at).getTime() - new Date(firstUser.created_at).getTime()
      : null;
  return {
    threadCount: threadIds.length,
    assistantMessages: rows.filter((m) => m.role === 'assistant').length,
    userMessages: rows.filter((m) => m.role === 'user').length,
    firstAssistantLatencyMs: latency
  };
}

export type PlanFacts = { editorialPlans: number; newsSources: number };

/**
 * Gli specialisti che hanno davvero contattato l'utente: thread di squadra (`surface='team'`)
 * con almeno un messaggio assistente FIRMATO (`chat_messages.name`). La firma distingue il primo
 * contatto dal seed statico del diario, che non ha mittente.
 */
export async function teamContactFacts(admin: SupabaseClient, brandId: string): Promise<{ agents: string[] }> {
  const { data: threads } = await admin
    .from('chat_threads')
    .select('id')
    .eq('brand_id', brandId)
    .eq('surface', 'team');
  const threadIds = (threads ?? []).map((t) => t.id);
  if (!threadIds.length) return { agents: [] };
  const { data: messages } = await admin
    .from('chat_messages')
    .select('name')
    .in('thread_id', threadIds)
    .eq('role', 'assistant')
    .not('name', 'is', null);
  return { agents: [...new Set((messages ?? []).map((m) => String(m.name)))] };
}

/**
 * La delega tra agenti misurata sui fatti: i DM agente-agente (marcatore `room_agents.dm`)
 * che hanno almeno un messaggio. Nessun DM = nessuno ha mai delegato nulla a un collega.
 */
export async function delegationFacts(admin: SupabaseClient, brandId: string): Promise<{ dmThreads: number; dmMessages: number }> {
  const { data: threads } = await admin
    .from('chat_threads')
    .select('id, room_agents')
    .eq('brand_id', brandId)
    .not('room_agents', 'is', null);
  const dmIds = (threads ?? [])
    .filter((t) => dmAgents((t.room_agents as Record<string, unknown> | null) ?? null))
    .map((t) => String(t.id));
  if (!dmIds.length) return { dmThreads: 0, dmMessages: 0 };
  const { count } = await admin
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .in('thread_id', dmIds);
  return { dmThreads: dmIds.length, dmMessages: count ?? 0 };
}

export async function waitForDelegation(
  admin: SupabaseClient,
  brandId: string,
  deadlineMs: number,
  pollIntervalMs = 15_000
): Promise<{ dmThreads: number; dmMessages: number }> {
  const deadline = Date.now() + deadlineMs;
  let facts = { dmThreads: 0, dmMessages: 0 };
  while (Date.now() < deadline) {
    facts = await delegationFacts(admin, brandId);
    if (facts.dmThreads > 0) return facts;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return facts;
}

export async function waitForTeamContact(
  admin: SupabaseClient,
  brandId: string,
  deadlineMs: number,
  pollIntervalMs = 15_000
): Promise<{ agents: string[] }> {
  const deadline = Date.now() + deadlineMs;
  let contacts = { agents: [] as string[] };
  while (Date.now() < deadline) {
    contacts = await teamContactFacts(admin, brandId);
    if (contacts.agents.length >= 2) return contacts;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return contacts;
}

export async function planFacts(admin: SupabaseClient, brandId: string): Promise<PlanFacts> {
  const [{ count: editorialPlans }, { count: newsSources }] = await Promise.all([
    admin.from('editorial_plans').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    admin
      .from('brand_news_sources')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('active', true)
  ]);
  return { editorialPlans: editorialPlans ?? 0, newsSources: newsSources ?? 0 };
}

export async function waitForAssistantReply(
  admin: SupabaseClient,
  brandId: string,
  deadlineMs: number,
  pollIntervalMs = 10_000
): Promise<{ replied: boolean; facts: ChatFacts }> {
  const deadline = Date.now() + deadlineMs;
  let facts: ChatFacts = {
    threadCount: 0,
    assistantMessages: 0,
    userMessages: 0,
    firstAssistantLatencyMs: null
  };
  while (Date.now() < deadline) {
    facts = await chatFacts(admin, brandId);
    if (facts.assistantMessages > 0) return { replied: true, facts };
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return { replied: false, facts };
}
