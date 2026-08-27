// DataForSEO — real Google organic-search metrics for the GEO report's "Search performance" panel
// (the foundation AI engines pull from). Two DataForSEO Labs "live" calls per run: domain rank
// overview (organic keyword count, estimated traffic, top-10 count) + ranked keywords (the table).
// Basic-auth, plain fetch, no SDK. Best-effort: null on any failure or when creds aren't set.
import { swallow } from '$lib/server/swallow';
import { env } from '$env/dynamic/private';
import { logAiCall } from '$lib/server/ai-log';

export const dataforseoConfigured = () => !!(env.DATAFORSEO_USERNAME && env.DATAFORSEO_PASSWORD);

// DataForSEO Labs live pricing (dataforseo.com/pricing, verified 2026-07): $0.012 per task
// + $0.00012 per returned item. Our two calls return ≤10 items each → ~$0.013/call. Logged
// to ai_calls so the GEO search panel bills the brand's credits.
const DFS_CALL_COST_USD = 0.013;
// Historical Rank Overview: $0.12/task + $0.0012/month (~12 mo → ~$0.134).
const DFS_HIST_SEARCH_COST_USD = 0.134;
// Backlinks Summary / History: ~$0.024/request (+ tiny per-row fee).
const DFS_BACKLINKS_COST_USD = 0.024;

export type SearchPerformance = {
  domain: string;
  organicKeywords: number;    // total keywords the domain ranks for
  estMonthlyTraffic: number;  // estimated organic visits / month (ETV)
  keywordsTop10: number;      // keywords ranking in positions 1–10
  topKeywords: Array<{ keyword: string; position: number; volume: number; difficulty: number; intent: string }>;
  /** Monthly organic history from Labs Historical Rank Overview (nested into the audit JSON). */
  history?: HistoricalSearchMonth[];
};

/** One month of organic visibility — traffic, keyword counts, and new/lost deltas. */
export type HistoricalSearchMonth = {
  year: number;
  month: number;
  organicKeywords: number;
  estMonthlyTraffic: number;
  keywordsTop10: number;
  keywordsNew: number;
  keywordsLost: number;
  keywordsUp: number;
  keywordsDown: number;
};

export type BacklinkHistoryMonth = {
  date: string;           // yyyy-mm-dd
  rank: number;           // domain rating 0–100
  backlinks: number;
  referringDomains: number;
  newBacklinks: number;
  lostBacklinks: number;
  newReferringDomains: number;
  lostReferringDomains: number;
};

/**
 * DataForSEO Rank on the 0–100 scale (their Ahrefs-DR analogue). Legacy audits stored the
 * 0–1000 scale — convert those with the published sin formula so charts stay comparable.
 */
export function normalizeDomainRank(rank: number | null | undefined): number {
  const n = Number(rank) || 0;
  if (n <= 0) return 0;
  if (n <= 100) return Math.round(Math.min(100, n));
  return Math.max(0, Math.min(100, Math.round(Math.sin(n / 636.62) * 100)));
}

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - Math.max(1, months));
  return d.toISOString().slice(0, 10);
}

// it → Italy/Italian, anything else → US/English. ponytail: two markets cover our brands; add more
// location codes only when a brand needs one.
function market(lang?: string | null): { location_code: number; language_code: string } {
  return String(lang ?? '').toLowerCase().startsWith('it')
    ? { location_code: 2380, language_code: 'it' }
    : { location_code: 2840, language_code: 'en' };
}

async function post(path: string, body: unknown, costUsd = DFS_CALL_COST_USD): Promise<any> {
  const auth = Buffer.from(`${env.DATAFORSEO_USERNAME}:${env.DATAFORSEO_PASSWORD}`).toString('base64');
  const t0 = Date.now();
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([body]),
    signal: AbortSignal.timeout(45_000)
  });
  logAiCall({ label: 'searchMetrics', provider: 'dataforseo', ms: Date.now() - t0, ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}`, context: path.slice(0, 120), flatCostUsd: costUsd });
  if (!res.ok) throw new Error(`dataforseo ${path} ${res.status}`);
  const json = await res.json();
  return json?.tasks?.[0]?.result?.[0] ?? null;
}

// Strip to the bare registrable host — DataForSEO wants the bare domain, not a URL with scheme/path.
function hostOf(url: string): string {
  try { return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, ''); }
  catch { return url.trim().replace(/^www\./, ''); }
}

export async function fetchSearchPerformance(url: string, lang?: string | null): Promise<SearchPerformance | null> {
  if (!dataforseoConfigured()) return null;
  const domain = hostOf(url);
  if (!domain) return null;
  const m = market(lang);
  try {
    const [overview, ranked] = await Promise.all([
      post('dataforseo_labs/google/domain_rank_overview/live', { target: domain, ...m }).catch((error) => { swallow('dataforseo call', error); return null; }),
      post('dataforseo_labs/google/ranked_keywords/live', {
        target: domain, ...m, limit: 10,
        order_by: ['ranked_serp_element.serp_item.etv,desc']
      }).catch((error) => { swallow('dataforseo call', error); return null; })
    ]);

    const org = overview?.items?.[0]?.metrics?.organic ?? {};
    const topKeywords = (ranked?.items ?? []).slice(0, 10).map((it: any) => {
      const kd = it?.keyword_data ?? {};
      const serp = it?.ranked_serp_element?.serp_item ?? {};
      return {
        keyword: String(kd?.keyword ?? ''),
        position: Number(serp?.rank_absolute ?? serp?.rank_group ?? 0) || 0,
        volume: Number(kd?.keyword_info?.search_volume ?? 0) || 0,
        difficulty: Number(kd?.keyword_properties?.keyword_difficulty ?? 0) || 0,
        intent: String(kd?.search_intent_info?.main_intent ?? '')
      };
    }).filter((k: { keyword: string }) => k.keyword);

    // Both calls failed (creds/network) → no panel. If they answered but the domain simply doesn't
    // rank, keep the zeros: "you're invisible on Google" is exactly the diagnosis worth showing.
    if (!overview && !ranked) return null;

    const organicKeywords = Number(org?.count ?? 0) || 0;
    const estMonthlyTraffic = Math.round(Number(org?.etv ?? 0) || 0);
    const keywordsTop10 = (Number(org?.pos_1 ?? 0) || 0) + (Number(org?.pos_2_3 ?? 0) || 0) + (Number(org?.pos_4_10 ?? 0) || 0);

    return { domain, organicKeywords, estMonthlyTraffic, keywordsTop10, topKeywords };
  } catch {
    return null;
  }
}

export type KeywordMetrics = {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  competition: string | null;
  intent: string | null;
};

function mapKeywordItem(it: any): KeywordMetrics | null {
  const keyword = String(it?.keyword ?? '').trim();
  if (!keyword) return null;
  const info = it?.keyword_info ?? {};
  return {
    keyword,
    volume: Number(info?.search_volume ?? 0) || 0,
    difficulty: Number(it?.keyword_properties?.keyword_difficulty ?? 0) || 0,
    cpc: Number(info?.cpc ?? 0) || 0,
    competition: info?.competition_level ? String(info.competition_level) : null,
    intent: it?.search_intent_info?.main_intent ? String(it.search_intent_info.main_intent) : null
  };
}

/** Batch metrics for known keywords (up to 700). Used to enrich AI-discovered opportunities. */
export async function fetchKeywordOverview(
  keywords: string[],
  lang?: string | null
): Promise<KeywordMetrics[]> {
  if (!dataforseoConfigured() || !keywords.length) return [];
  const m = market(lang);
  const unique = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, 100);
  if (!unique.length) return [];
  try {
    const result = await post('dataforseo_labs/google/keyword_overview/live', {
      keywords: unique,
      ...m
    });
    return (result?.items ?? []).map(mapKeywordItem).filter(Boolean) as KeywordMetrics[];
  } catch {
    return [];
  }
}

/** Long-tail suggestions around a seed keyword, sorted by search volume. */
export async function fetchKeywordSuggestions(
  seed: string,
  lang?: string | null,
  limit = 20
): Promise<KeywordMetrics[]> {
  if (!dataforseoConfigured() || !seed.trim()) return [];
  const m = market(lang);
  try {
    const result = await post('dataforseo_labs/google/keyword_suggestions/live', {
      keyword: seed.trim().toLowerCase(),
      ...m,
      include_seed_keyword: true,
      ignore_synonyms: true,
      limit: Math.min(Math.max(limit, 1), 100),
      filters: ['keyword_info.search_volume', '>', 0],
      order_by: ['keyword_info.search_volume,desc']
    });
    return (result?.items ?? []).map(mapKeywordItem).filter(Boolean) as KeywordMetrics[];
  } catch {
    return [];
  }
}

/** Keywords a domain already ranks for — useful seed for free-tool URL research. */
export async function fetchDomainKeywords(
  url: string,
  lang?: string | null,
  limit = 20
): Promise<KeywordMetrics[]> {
  if (!dataforseoConfigured()) return [];
  const domain = hostOf(url);
  if (!domain) return [];
  const m = market(lang);
  try {
    const ranked = await post('dataforseo_labs/google/ranked_keywords/live', {
      target: domain,
      ...m,
      limit: Math.min(Math.max(limit, 1), 50),
      order_by: ['ranked_serp_element.serp_item.etv,desc']
    });
    return (ranked?.items ?? [])
      .map((it: any) => {
        const kd = it?.keyword_data ?? {};
        return mapKeywordItem({
          keyword: kd?.keyword,
          keyword_info: kd?.keyword_info,
          keyword_properties: kd?.keyword_properties,
          search_intent_info: kd?.search_intent_info
        });
      })
      .filter(Boolean) as KeywordMetrics[];
  } catch {
    return [];
  }
}

// ── Endpoints added for the public SEO tools ────────────────────────────────────────────────
// Everything below follows the same contract as the calls above: null/[] on any failure, never
// throw into a request handler, and every call goes through `post()` so it lands in ai_calls
// with its cost attached. Spend is capped upstream by tool-guard's per-tool daily ceiling.

export type DomainOverview = {
  domain: string;
  organicKeywords: number;
  estMonthlyTraffic: number;
  estTrafficCost: number;
  keywordsTop3: number;
  keywordsTop10: number;
};

/** Domain-level organic snapshot — the traffic-estimator tool. One Labs task. */
export async function fetchDomainOverview(url: string, lang?: string | null): Promise<DomainOverview | null> {
  if (!dataforseoConfigured()) return null;
  const domain = hostOf(url);
  if (!domain) return null;
  try {
    const overview = await post('dataforseo_labs/google/domain_rank_overview/live', { target: domain, ...market(lang) });
    const org = overview?.items?.[0]?.metrics?.organic;
    if (!org) return null;
    const pos1 = Number(org?.pos_1 ?? 0) || 0;
    const pos23 = Number(org?.pos_2_3 ?? 0) || 0;
    return {
      domain,
      organicKeywords: Number(org?.count ?? 0) || 0,
      estMonthlyTraffic: Math.round(Number(org?.etv ?? 0) || 0),
      estTrafficCost: Math.round(Number(org?.estimated_paid_traffic_cost ?? 0) || 0),
      keywordsTop3: pos1 + pos23,
      keywordsTop10: pos1 + pos23 + (Number(org?.pos_4_10 ?? 0) || 0)
    };
  } catch {
    return null;
  }
}

export type GapKeyword = KeywordMetrics & { yourPosition: number | null; theirPosition: number | null };

/**
 * Keywords two domains both have SERP presence for — the competitor-gap tool. DataForSEO returns
 * the intersection, and we keep the rows where the competitor outranks you (or you're absent),
 * which is the only half worth acting on.
 */
export async function fetchKeywordGap(
  yourUrl: string,
  competitorUrl: string,
  lang?: string | null,
  limit = 25
): Promise<GapKeyword[]> {
  if (!dataforseoConfigured()) return [];
  const target1 = hostOf(yourUrl);
  const target2 = hostOf(competitorUrl);
  if (!target1 || !target2 || target1 === target2) return [];
  try {
    const result = await post('dataforseo_labs/google/domain_intersection/live', {
      target1,
      target2,
      ...market(lang),
      intersections: true,
      limit: Math.min(Math.max(limit, 1), 50),
      order_by: ['keyword_data.keyword_info.search_volume,desc']
    });
    return (result?.items ?? [])
      .map((it: any) => {
        const base = mapKeywordItem(it?.keyword_data);
        if (!base) return null;
        const yours = Number(it?.first_domain_serp_element?.rank_absolute ?? 0) || null;
        const theirs = Number(it?.second_domain_serp_element?.rank_absolute ?? 0) || null;
        return { ...base, yourPosition: yours, theirPosition: theirs };
      })
      .filter((k: GapKeyword | null): k is GapKeyword => {
        if (!k) return false;
        // The gap = they rank and you either don't, or rank worse (higher number = worse).
        if (k.theirPosition == null) return false;
        return k.yourPosition == null || k.yourPosition > k.theirPosition;
      });
  } catch {
    return [];
  }
}

export type SerpSnapshot = {
  keyword: string;
  yourPosition: number | null;
  yourUrl: string | null;
  hasAiOverview: boolean;
  /** Domains cited inside the AI Overview block, when Google returned one. */
  aiOverviewSources: string[];
  topResults: Array<{ position: number; domain: string; title: string; url: string }>;
};

/**
 * One live Google SERP: where a domain ranks for a keyword, plus whether an AI Overview is
 * present and who it cites. Powers both the rank-checker and the AI-visibility tool — the same
 * call answers both questions, so they never cost two.
 */
export async function fetchSerpSnapshot(
  keyword: string,
  domainUrl: string | null,
  lang?: string | null
): Promise<SerpSnapshot | null> {
  if (!dataforseoConfigured() || !keyword.trim()) return null;
  const target = domainUrl ? hostOf(domainUrl) : null;
  try {
    const result = await post('serp/google/organic/live/advanced', {
      keyword: keyword.trim().slice(0, 700),
      ...market(lang),
      device: 'desktop',
      depth: 20
    });
    const items: any[] = result?.items ?? [];
    if (!items.length) return null;

    const organic = items.filter((i) => i?.type === 'organic');
    const aiBlock = items.find((i) => i?.type === 'ai_overview');
    const mine = target ? organic.find((i) => String(i?.domain ?? '').replace(/^www\./, '') === target) : null;

    // AI Overview citations live in `references`; older payloads nest them per-element instead.
    const refs: any[] = aiBlock?.references ?? [];
    const nested: any[] = (aiBlock?.items ?? []).flatMap((el: any) => el?.references ?? []);
    const aiOverviewSources = [...new Set([...refs, ...nested].map((r) => String(r?.domain ?? '').replace(/^www\./, '')).filter(Boolean))];

    return {
      keyword: keyword.trim(),
      yourPosition: mine ? Number(mine.rank_absolute ?? 0) || null : null,
      yourUrl: mine ? String(mine.url ?? '') || null : null,
      hasAiOverview: !!aiBlock,
      aiOverviewSources,
      topResults: organic.slice(0, 10).map((i) => ({
        position: Number(i?.rank_absolute ?? 0) || 0,
        domain: String(i?.domain ?? '').replace(/^www\./, ''),
        title: String(i?.title ?? ''),
        url: String(i?.url ?? '')
      }))
    };
  } catch {
    return null;
  }
}

export type BacklinkSummary = {
  domain: string;
  /** Domain rating / authority on a 0–100 scale (DataForSEO Rank). */
  rank: number;
  backlinks: number;
  referringDomains: number;
  referringPages: number;
  brokenBacklinks: number;
  spamScore: number;
  dofollow: number;
  nofollow: number;
  topTlds: Array<{ tld: string; count: number }>;
  /** Monthly backlink + domain-rating history (nested into the audit JSON). */
  history?: BacklinkHistoryMonth[];
};

/**
 * Backlink profile snapshot. NOTE: this is the Backlinks API, priced well above Labs — it is the
 * one tool where an unbounded free tier would actually hurt, so tool-guard gives it the tightest
 * daily ceiling of any tool.
 */
export async function fetchBacklinkSummary(url: string): Promise<BacklinkSummary | null> {
  if (!dataforseoConfigured()) return null;
  const domain = hostOf(url);
  if (!domain) return null;
  try {
    const r = await post('backlinks/summary/live', {
      target: domain,
      internal_list_limit: 5,
      backlinks_status_type: 'live',
      include_subdomains: true,
      // 0–100 matches how users read DA/DR; legacy rows on 0–1000 are normalised on read.
      rank_scale: 'one_hundred'
    }, DFS_BACKLINKS_COST_USD);
    if (!r) return null;
    const attrs = r?.referring_links_attributes ?? {};
    const total = Number(r?.backlinks ?? 0) || 0;
    // DataForSEO reports link attributes as counts keyed by attribute; anything not tagged
    // nofollow/sponsored/ugc is a followed link.
    const nofollow = (Number(attrs?.nofollow ?? 0) || 0) + (Number(attrs?.sponsored ?? 0) || 0) + (Number(attrs?.ugc ?? 0) || 0);
    return {
      domain,
      rank: normalizeDomainRank(r?.rank),
      backlinks: total,
      referringDomains: Number(r?.referring_domains ?? 0) || 0,
      referringPages: Number(r?.referring_pages ?? 0) || 0,
      brokenBacklinks: Number(r?.broken_backlinks ?? 0) || 0,
      spamScore: Number(r?.backlinks_spam_score ?? 0) || 0,
      nofollow,
      dofollow: Math.max(0, total - nofollow),
      topTlds: Object.entries(r?.referring_links_tld ?? {})
        .map(([tld, count]) => ({ tld, count: Number(count) || 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
    };
  } catch {
    return null;
  }
}

/**
 * ~12 months of organic traffic + keyword counts (incl. new/lost). ~$0.13/call — run once per
 * weekly GEO tick and nest into `search.history`, not on every page view.
 */
export async function fetchHistoricalRankOverview(
  url: string,
  lang?: string | null,
  months = 12
): Promise<HistoricalSearchMonth[] | null> {
  if (!dataforseoConfigured()) return null;
  const domain = hostOf(url);
  if (!domain) return null;
  try {
    const r = await post('dataforseo_labs/google/historical_rank_overview/live', {
      target: domain,
      ...market(lang),
      date_from: monthsAgoIso(months),
      correlate: true
    }, DFS_HIST_SEARCH_COST_USD);
    const items: any[] = r?.items ?? [];
    if (!items.length) return [];
    return items
      .map((it) => {
        const org = it?.metrics?.organic ?? {};
        const year = Number(it?.year) || 0;
        const month = Number(it?.month) || 0;
        if (!year || !month) return null;
        const top10 =
          (Number(org?.pos_1 ?? 0) || 0) +
          (Number(org?.pos_2_3 ?? 0) || 0) +
          (Number(org?.pos_4_10 ?? 0) || 0);
        return {
          year,
          month,
          organicKeywords: Number(org?.count ?? 0) || 0,
          estMonthlyTraffic: Math.round(Number(org?.etv ?? 0) || 0),
          keywordsTop10: top10,
          keywordsNew: Number(org?.is_new ?? 0) || 0,
          keywordsLost: Number(org?.is_lost ?? 0) || 0,
          keywordsUp: Number(org?.is_up ?? 0) || 0,
          keywordsDown: Number(org?.is_down ?? 0) || 0
        } satisfies HistoricalSearchMonth;
      })
      .filter((m): m is HistoricalSearchMonth => !!m)
      .sort((a, b) => a.year - b.year || a.month - b.month);
  } catch {
    return null;
  }
}

/**
 * Monthly backlink + domain-rating history. Same Backlinks API pricing band as summary.
 */
export async function fetchBacklinkHistory(
  url: string,
  months = 12
): Promise<BacklinkHistoryMonth[] | null> {
  if (!dataforseoConfigured()) return null;
  const domain = hostOf(url);
  if (!domain) return null;
  try {
    const r = await post('backlinks/history/live', {
      target: domain,
      date_from: monthsAgoIso(months),
      rank_scale: 'one_hundred'
    }, DFS_BACKLINKS_COST_USD);
    const items: any[] = r?.items ?? [];
    if (!items.length) return [];
    return items
      .map((it) => {
        const rawDate = String(it?.date ?? '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return null;
        return {
          date: rawDate,
          rank: normalizeDomainRank(it?.rank),
          backlinks: Number(it?.backlinks ?? 0) || 0,
          referringDomains: Number(it?.referring_domains ?? 0) || 0,
          newBacklinks: Number(it?.new_backlinks ?? 0) || 0,
          lostBacklinks: Number(it?.lost_backlinks ?? 0) || 0,
          newReferringDomains: Number(it?.new_referring_domains ?? 0) || 0,
          lostReferringDomains: Number(it?.lost_referring_domains ?? 0) || 0
        } satisfies BacklinkHistoryMonth;
      })
      .filter((m): m is BacklinkHistoryMonth => !!m)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return null;
  }
}
