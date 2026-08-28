import type { SupabaseClient } from '@supabase/supabase-js';

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
