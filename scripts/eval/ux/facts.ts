import type { SupabaseClient } from '@supabase/supabase-js';
import { dmAgents } from '$lib/chat-dm';
import { teamContactsForPlan } from '$lib/server/onboarding-team';

export type BrandRef = { id: string; slug: string; name: string };

export type ChatFacts = {
  threadCount: number;
  assistantMessages: number;
  setupAssistantMessages: number;
  userMessages: number;
  firstAssistantLatencyMs: number | null;
  setupRunStates: string[];
};

export function setupTurnCompleted(assistantMessages: number, runStates: string[]): boolean {
  return assistantMessages > 0 && runStates.includes('done');
}

export async function brandForUser(admin: SupabaseClient, userId: string): Promise<BrandRef | null> {
  const { data: orgs } = await admin.from('organizations').select('id').eq('owner_id', userId);
  const orgIds = (orgs ?? []).map((o) => o.id);
  if (!orgIds.length) return null;
  const { data: brands } = await admin.from('brands').select('id, slug, name').in('org_id', orgIds);
  return brands?.[0] ?? null;
}

export async function chatFacts(admin: SupabaseClient, brandId: string): Promise<ChatFacts> {
  const { data: threads } = await admin.from('chat_threads').select('id, surface').eq('brand_id', brandId);
  const threadIds = (threads ?? []).map((t) => t.id);
  const setupThreadIds = (threads ?? []).filter((t) => t.surface === 'onboarding').map((t) => t.id);
  if (!threadIds.length) {
    return {
      threadCount: 0,
      assistantMessages: 0,
      setupAssistantMessages: 0,
      userMessages: 0,
      firstAssistantLatencyMs: null,
      setupRunStates: []
    };
  }
  const { data: messages } = await admin
    .from('chat_messages')
    .select('role, content, created_at, thread_id')
    .in('thread_id', threadIds)
    .order('created_at', { ascending: true });
  const rows = messages ?? [];
  const setupMessages = rows.filter((m) => setupThreadIds.includes(m.thread_id));
  const firstUser = rows.find((m) => m.role === 'user');
  const firstAssistant = rows.find((m) => m.role === 'assistant');
  const latency =
    firstUser && firstAssistant
      ? new Date(firstAssistant.created_at).getTime() - new Date(firstUser.created_at).getTime()
      : null;
  const { data: runs } = setupThreadIds.length
    ? await admin.from('agent_kit_runs').select('state').in('thread_id', setupThreadIds)
    : { data: [] };
  return {
    threadCount: threadIds.length,
    assistantMessages: rows.filter((m) => m.role === 'assistant').length,
    setupAssistantMessages: setupMessages.filter((m) => m.role === 'assistant').length,
    userMessages: rows.filter((m) => m.role === 'user').length,
    firstAssistantLatencyMs: latency,
    setupRunStates: (runs ?? []).map((r) => String(r.state))
  };
}

export type PlanFacts = { editorialPlans: number; newsSources: number };

/**
 * Gli specialisti che hanno davvero contattato l'utente: thread di squadra (`surface='team'`)
 * con almeno un messaggio assistente FIRMATO (`chat_messages.name`). La firma distingue il primo
 * contatto dal seed statico del diario, che non ha mittente.
 */
export async function teamContactFacts(
  admin: SupabaseClient,
  brandId: string
): Promise<{ agents: string[]; expectedAgents: string[] }> {
  const [{ data: brand }, { data: threads }] = await Promise.all([
    admin.from('brands').select('plan').eq('id', brandId).maybeSingle(),
    admin.from('chat_threads').select('id').eq('brand_id', brandId).eq('surface', 'team')
  ]);
  const expectedAgents = [...teamContactsForPlan(brand?.plan as string | null | undefined)];
  const threadIds = (threads ?? []).map((t) => t.id);
  if (!threadIds.length) return { agents: [], expectedAgents };
  const { data: messages } = await admin
    .from('chat_messages')
    .select('name')
    .in('thread_id', threadIds)
    .eq('role', 'assistant')
    .not('name', 'is', null);
  return { agents: [...new Set((messages ?? []).map((m) => String(m.name)))], expectedAgents };
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
  let contacts = { agents: [] as string[], expectedAgents: [] as string[] };
  while (Date.now() < deadline) {
    contacts = await teamContactFacts(admin, brandId);
    if (contacts.expectedAgents.every((agent) => contacts.agents.includes(agent))) return contacts;
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
    setupAssistantMessages: 0,
    userMessages: 0,
    firstAssistantLatencyMs: null,
    setupRunStates: []
  };
  while (Date.now() < deadline) {
    facts = await chatFacts(admin, brandId);
    if (setupTurnCompleted(facts.setupAssistantMessages, facts.setupRunStates)) return { replied: true, facts };
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return { replied: false, facts };
}
