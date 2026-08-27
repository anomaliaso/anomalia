// Continuous rank tracking — tracked keyword set + weekly DataForSEO SERP snapshots.
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchSerpSnapshot, dataforseoConfigured } from '$lib/server/dataforseo';
import { isPaidPlan } from '$lib/plans';
import { withBrandContext } from '$lib/server/ai-log';

type AnyRec = Record<string, unknown>;

const CAP: Record<string, number> = { go: 25, starter: 75, pro: 200, scale: 200 };

/** Monthly DataForSEO spend cap per brand — rotation makes every keyword recur, so the
 *  weekly tick must not become an unbounded bill (errata P4#8). $0.013/snapshot. */
const MAX_DFS_USD_PER_MONTH = 15;

/** Wall-clock budgets: the tick route runs with maxDuration 300 and every SERP snapshot is a
 *  live call with a 45s timeout, so a plan cap of 200 keywords can never fit in one run. Stop
 *  on time instead — rotation (last_checked_at / last_rank_check_at) resumes where we left off. */
const TICK_BUDGET_MS = 240_000;
const BRAND_BUDGET_MS = 60_000;

export function trackedKeywordCap(plan: string | null | undefined): number {
  if (!plan || plan === 'free') return 10;
  return CAP[plan] ?? (isPaidPlan(plan) ? 75 : 10);
}

export type TrackedKeywordRow = {
  id: string;
  keyword: string;
  locale: string;
  device: string;
  source: string;
  active: boolean;
  position: number | null;
  prevPosition: number | null;
  delta: number | null;
  url: string | null;
  checkedAt: string | null;
  hasAiOverview: boolean;
};

function locationForLocale(locale: string): number {
  return locale.toLowerCase().startsWith('it') ? 2380 : 2840;
}

export async function ensureTrackedSet(
  admin: SupabaseClient,
  brand: AnyRec,
  extras: { keywords?: string[]; source?: string } = {}
): Promise<number> {
  const brandId = String(brand.id);
  const plan = (brand.plan as string) ?? null;
  const cap = trackedKeywordCap(plan);
  const locale = String((brand.content_prefs as AnyRec)?.language ?? 'en').slice(0, 5);
  const location_code = locationForLocale(locale);

  const { count } = await admin
    .from('brand_tracked_keywords')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('active', true);
  let remaining = Math.max(0, cap - (count ?? 0));
  if (remaining <= 0) return 0;

  const candidates: Array<{ keyword: string; source: string }> = [];

  if (extras.keywords?.length) {
    for (const k of extras.keywords) {
      const kw = k.trim().toLowerCase();
      if (kw) candidates.push({ keyword: kw, source: extras.source ?? 'manual' });
    }
  }

  // Seed from keyword strategy
  if (remaining > 0) {
    const { data: strat } = await admin
      .from('brand_seo_keyword_strategy')
      .select('strategy')
      .eq('brand_id', brandId)
      .maybeSingle();
    const opportunities = (strat?.strategy as AnyRec)?.opportunities as Array<AnyRec> | undefined;
    for (const o of opportunities ?? []) {
      const kw = String(o.keyword ?? o.query ?? '').trim().toLowerCase();
      if (kw) candidates.push({ keyword: kw, source: 'strategy' });
    }
  }

  // Seed from GSC top queries
  if (remaining > 0) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 28);
    const { data: gsc } = await admin
      .from('brand_gsc_metrics')
      .select('query, clicks')
      .eq('brand_id', brandId)
      .gte('date', since.toISOString().slice(0, 10))
      .order('clicks', { ascending: false })
      .limit(40);
    const qMap = new Map<string, number>();
    for (const r of gsc ?? []) {
      const q = String(r.query ?? '').trim().toLowerCase();
      if (!q) continue;
      qMap.set(q, (qMap.get(q) ?? 0) + Number(r.clicks || 0));
    }
    for (const [keyword] of [...qMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      candidates.push({ keyword, source: 'gsc' });
    }
  }

  const seen = new Set<string>();
  let added = 0;
  for (const c of candidates) {
    if (remaining <= 0) break;
    if (seen.has(c.keyword)) continue;
    seen.add(c.keyword);
    const { error } = await admin.from('brand_tracked_keywords').upsert(
      {
        brand_id: brandId,
        keyword: c.keyword,
        locale,
        location_code,
        device: 'desktop',
        source: c.source,
        active: true
      },
      { onConflict: 'brand_id,keyword,locale,device', ignoreDuplicates: true }
    );
    if (!error) {
      added++;
      remaining--;
    }
  }
  return added;
}

export async function checkKeyword(
  admin: SupabaseClient,
  brand: AnyRec,
  tracked: { id: string; keyword: string; locale: string }
): Promise<void> {
  if (!dataforseoConfigured()) return;
  const website = String(brand.website ?? '');
  const now = new Date().toISOString();
  const snap = await fetchSerpSnapshot(tracked.keyword, website, tracked.locale);
  // Stamp the rotation cursor even on failure (snap null) — otherwise a keyword whose
  // query fails stays first in line forever and burns a slot (and its $0.013) every tick.
  await admin
    .from('brand_tracked_keywords')
    .update({ last_checked_at: now })
    .eq('id', tracked.id);
  if (!snap) return;
  await admin.from('brand_rank_snapshots').insert({
    brand_id: brand.id,
    tracked_keyword_id: tracked.id,
    position: snap.yourPosition,
    url: snap.yourUrl ?? null,
    serp_features: {
      hasAiOverview: snap.hasAiOverview,
      aiOverviewSources: snap.aiOverviewSources?.slice(0, 8) ?? []
    },
    dfs_cost_usd: 0.013
  });
}

export async function checkBrandBatch(
  admin: SupabaseClient,
  brand: AnyRec,
  limit = 50,
  opts: { deadline?: number } = {}
): Promise<{ checked: number }> {
  await ensureTrackedSet(admin, brand);
  // Round-robin: least-recently-checked keywords first (nulls = never checked).
  const { data: kws } = await admin
    .from('brand_tracked_keywords')
    .select('id, keyword, locale')
    .eq('brand_id', brand.id)
    .eq('active', true)
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  let checked = 0;
  for (const kw of kws ?? []) {
    // Out of time: the rest keep their old last_checked_at, so the next run starts with them.
    if (opts.deadline && Date.now() >= opts.deadline) break;
    try {
      await checkKeyword(admin, brand, kw);
      checked++;
    } catch (e) {
      console.error('[rank-tracker]', brand.id, kw.keyword, e instanceof Error ? e.message : e);
    }
  }
  return { checked };
}

export async function loadRankBoard(admin: SupabaseClient, brandId: string): Promise<TrackedKeywordRow[]> {
  const { data: kws } = await admin
    .from('brand_tracked_keywords')
    .select('id, keyword, locale, device, source, active')
    .eq('brand_id', brandId)
    .eq('active', true)
    .order('created_at', { ascending: true });

  const out: TrackedKeywordRow[] = [];
  for (const kw of kws ?? []) {
    const { data: snaps } = await admin
      .from('brand_rank_snapshots')
      .select('position, url, checked_at, serp_features')
      .eq('tracked_keyword_id', kw.id)
      .order('checked_at', { ascending: false })
      .limit(2);
    const latest = snaps?.[0];
    const prev = snaps?.[1];
    const position = latest?.position ?? null;
    const prevPosition = prev?.position ?? null;
    let delta: number | null = null;
    if (position != null && prevPosition != null) delta = prevPosition - position; // positive = improved
    const feats = (latest?.serp_features ?? {}) as { hasAiOverview?: boolean };
    out.push({
      id: kw.id,
      keyword: kw.keyword,
      locale: kw.locale,
      device: kw.device,
      source: kw.source,
      active: kw.active,
      position,
      prevPosition,
      delta,
      url: latest?.url ?? null,
      checkedAt: latest?.checked_at ?? null,
      hasAiOverview: !!feats.hasAiOverview
    });
  }
  return out;
}

export async function ranksTickAll(
  admin: SupabaseClient,
  opts: { brandSlug?: string | null; maxBrands?: number } = {}
): Promise<{ brands: number; checked: number }> {
  // Round-robin across brands too: least-recently-checked first. Each brand runs inside
  // withBrandContext so DataForSEO costs land on the brand's ai_calls (was brand_id NULL).
  let q = admin
    .from('brands')
    .select('id, name, slug, website, plan, content_prefs')
    .eq('status', 'active')
    .order('last_rank_check_at', { ascending: true, nullsFirst: true });
  if (opts.brandSlug) q = q.eq('slug', opts.brandSlug);
  const { data: brands } = await q.limit(opts.maxBrands ?? 20);
  let checked = 0;
  let n = 0;
  const now = new Date().toISOString();
  const deadline = Date.now() + TICK_BUDGET_MS;
  const monthStart = now.slice(0, 7); // YYYY-MM — calendar-month budget (same anchor as credits fallback)
  for (const brand of brands ?? []) {
    if (Date.now() >= deadline) break;
    // Claim the brand BEFORE the batch: a timeout must still rotate the cursor, otherwise the
    // same brand stays first in line every Sunday and the rest never get checked.
    await admin.from('brands').update({ last_rank_check_at: now }).eq('id', brand.id);
    // Budget gate: skip brands that already spent their monthly DataForSEO cap. The spend is
    // now attributed (withBrandContext), so this reads real, billable numbers from ai_calls.
    // Summed in the DB (0158) — reading N rows and summing them in JS capped the total at the
    // page size and made the gate unreachable.
    const { data: spent, error: spendErr } = await admin.rpc('brand_provider_spend_usd', {
      p_brand_id: brand.id,
      p_provider: 'dataforseo',
      p_since: `${monthStart}-01T00:00:00Z`
    });
    // ponytail: fail-open on a missing/failed function (migration not applied yet) — loud log,
    // same behaviour as before the gate existed. Make it fail-closed if a bill ever surprises us.
    if (spendErr) console.error('[rank-tracker] spend gate unavailable:', spendErr.message);
    if (Number(spent ?? 0) >= MAX_DFS_USD_PER_MONTH) continue;
    const res = await withBrandContext(String(brand.id), () =>
      checkBrandBatch(admin, brand, trackedKeywordCap(brand.plan as string), {
        deadline: Math.min(deadline, Date.now() + BRAND_BUDGET_MS)
      })
    );
    checked += res.checked;
    n++;
  }
  return { brands: n, checked };
}
