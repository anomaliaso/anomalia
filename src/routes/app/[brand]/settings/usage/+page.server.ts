import type { PageServerLoad } from './$types';
import { getCreditsUsage } from '$lib/server/credits';
import { cachedBrandPage } from '$lib/server/page-cache';

const PAGE_SIZE = 25;
const CREDITS_PER_USD = 100;

export type UsageCallRow = {
  id: string;
  label: string;
  provider: string;
  model: string | null;
  ok: boolean;
  ms: number;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  thinking_tokens: number | null;
  grounding_queries: number | null;
  cost_usd: number | null;
  context: string | null;
  created_at: string;
};

export type UsageAgentRow = {
  id: string;
  agent: string;
  mode: string;
  status: string;
  finished_ok: boolean;
  cost_usd_estimate: number | null;
  created_at: string;
};

export type UsageSessionRow = {
  id: string;
  agent: string;
  mode: string;
  surface: string;
  status: string;
  model: string | null;
  provider: string | null;
  event_count: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export type DailyPoint = { date: string; costUsd: number; calls: number; credits: number };
export type ProviderPoint = { provider: string; costUsd: number; calls: number; credits: number };

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const url = event.url;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const requestedPage = Math.max(1, Number(url.searchParams.get('page')) || 1);

    const { data: brandBilling } = await supabase
      .from('brands')
      .select('id, plan, activated_at, status')
      .eq('id', brand.id)
      .maybeSingle();

    const billingBrand = brandBilling ?? {
      id: brand.id,
      plan: brand.plan,
      activated_at: null,
      status: brand.status
    };

    const credits = await getCreditsUsage(supabase, billingBrand);
    const periodStartIso = credits.periodStart.toISOString();
    const periodEndIso = credits.periodEnd.toISOString();

    // Count first so we can clamp the page before fetching the slice.
    const { count: totalCallsRaw } = await supabase
      .from('ai_calls')
      .select('id', { count: 'exact', head: true })
      // Gli eventi interni (provider 'internal': le letture di file degli agenti) non sono
      // chiamate AI e non costano: sulla pagina del conto sarebbero righe che diluiscono
      // esattamente ciò che si è venuti a leggere.
      .neq('provider', 'internal')
      .eq('brand_id', brand.id)
      .gte('created_at', periodStartIso)
      .lt('created_at', periodEndIso);

    const totalCalls = totalCallsRaw ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalCalls / PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const [
      { data: seriesRows, error: seriesError },
      { data: callRows, error: callsError },
      { data: agentRows, error: agentsError },
      { data: sessionRows, error: sessionsError }
    ] = await Promise.all([
      supabase
        .from('ai_calls')
        .select('created_at, cost_usd, provider, input_tokens, output_tokens, ok')
      // Gli eventi interni (provider 'internal': le letture di file degli agenti) non sono
      // chiamate AI e non costano: sulla pagina del conto sarebbero righe che diluiscono
      // esattamente ciò che si è venuti a leggere.
      .neq('provider', 'internal')
        .eq('brand_id', brand.id)
        .gte('created_at', periodStartIso)
        .lt('created_at', periodEndIso)
        .order('created_at', { ascending: true })
        .limit(10000),
      supabase
        .from('ai_calls')
        .select(
          'id, label, provider, model, ok, ms, error, input_tokens, output_tokens, cached_tokens, thinking_tokens, grounding_queries, cost_usd, context, created_at'
        )
      // Gli eventi interni (provider 'internal': le letture di file degli agenti) non sono
      // chiamate AI e non costano: sulla pagina del conto sarebbero righe che diluiscono
      // esattamente ciò che si è venuti a leggere.
      .neq('provider', 'internal')
        .eq('brand_id', brand.id)
        .gte('created_at', periodStartIso)
        .lt('created_at', periodEndIso)
        .order('created_at', { ascending: false })
        .range(from, to),
      supabase
        .from('agent_runs')
        .select('id, agent, mode, status, finished_ok, cost_usd_estimate, created_at')
        .eq('brand_id', brand.id)
        .gte('created_at', periodStartIso)
        .lt('created_at', periodEndIso)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('agent_sessions')
        .select(
          'id, agent, mode, surface, status, model, provider, event_count, error, created_at, finished_at'
        )
        .eq('brand_id', brand.id)
        .gte('created_at', periodStartIso)
        .lt('created_at', periodEndIso)
        .order('created_at', { ascending: false })
        .limit(50)
    ]);

    if (seriesError) console.warn('[usage] series query failed:', seriesError.message);
    if (callsError) console.warn('[usage] calls query failed:', callsError.message);
    if (agentsError) console.warn('[usage] agents query failed:', agentsError.message);
    if (sessionsError) console.warn('[usage] sessions query failed:', sessionsError.message);

    const rows = seriesRows ?? [];
    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let failedCalls = 0;

    const byDay = new Map<string, DailyPoint>();
    const byProvider = new Map<string, ProviderPoint>();

    // Fill every day in the billing window so the chart has continuous x-axis.
    const cursor = new Date(credits.periodStart);
    cursor.setUTCHours(0, 0, 0, 0);
    const endDay = new Date(credits.periodEnd);
    while (cursor < endDay) {
      const key = cursor.toISOString().slice(0, 10);
      byDay.set(key, { date: key, costUsd: 0, calls: 0, credits: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    for (const r of rows) {
      const cost = Number(r.cost_usd ?? 0);
      if (Number.isFinite(cost)) totalCostUsd += cost;
      totalInputTokens += Number(r.input_tokens ?? 0);
      totalOutputTokens += Number(r.output_tokens ?? 0);
      if (r.ok === false) failedCalls += 1;

      const day = String(r.created_at).slice(0, 10);
      const dayPoint = byDay.get(day) ?? { date: day, costUsd: 0, calls: 0, credits: 0 };
      dayPoint.calls += 1;
      dayPoint.costUsd += cost;
      dayPoint.credits = Math.round(dayPoint.costUsd * CREDITS_PER_USD * 100) / 100;
      byDay.set(day, dayPoint);

      const provider = (r.provider as string) || 'unknown';
      const prov = byProvider.get(provider) ?? { provider, costUsd: 0, calls: 0, credits: 0 };
      prov.calls += 1;
      prov.costUsd += cost;
      prov.credits = Math.round(prov.costUsd * CREDITS_PER_USD * 100) / 100;
      byProvider.set(provider, prov);
    }

    const daily: DailyPoint[] = [...byDay.values()].map((d) => ({
      ...d,
      costUsd: Math.round(d.costUsd * 1e6) / 1e6,
      credits: Math.round(d.costUsd * CREDITS_PER_USD * 100) / 100
    }));

    const byProviderList: ProviderPoint[] = [...byProvider.values()]
      .map((p) => ({
        ...p,
        costUsd: Math.round(p.costUsd * 1e6) / 1e6,
        credits: Math.round(p.costUsd * CREDITS_PER_USD * 100) / 100
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    const agents = (agentRows ?? []) as UsageAgentRow[];
    const agentCostUsd = agents.reduce((s, a) => s + Number(a.cost_usd_estimate ?? 0), 0);

    return {
      credits: {
        used: credits.used,
        quota: credits.quota,
        bonus: credits.bonus,
        remaining: credits.remaining,
        percent: credits.percent,
        periodStart: periodStartIso,
        periodEnd: periodEndIso
      },
      summary: {
        totalCalls,
        failedCalls,
        totalCostUsd: Math.round(totalCostUsd * 1e6) / 1e6,
        totalCredits: Math.round(totalCostUsd * CREDITS_PER_USD),
        totalInputTokens,
        totalOutputTokens,
        agentRuns: agents.length,
        agentCostUsd: Math.round(agentCostUsd * 1e6) / 1e6
      },
      daily,
      byProvider: byProviderList,
      calls: (callRows ?? []) as UsageCallRow[],
      agents,
      sessions: (sessionRows ?? []) as UsageSessionRow[],
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total: totalCalls,
        totalPages
      }
    };
  }, url.searchParams.get('page') ?? '');
};
