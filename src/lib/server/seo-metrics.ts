// Derive SEO trend panels from stored GEO audits + nested DataForSEO histories.
// Histories live inside `search.history` / `backlinks.history` (written by geoTick); this module
// only shapes them for the SEO page and hub overview — no extra API calls on read.
import {
  normalizeDomainRank,
  type BacklinkHistoryMonth,
  type BacklinkSummary,
  type HistoricalSearchMonth,
  type SearchPerformance
} from './dataforseo';

export type SeoTrendPoint = {
  label: string; // "2026-03" or audit date
  traffic: number | null;
  organicKeywords: number | null;
  keywordsTop10: number | null;
  keywordsNew: number | null;
  keywordsLost: number | null;
  domainRating: number | null;
  referringDomains: number | null;
  backlinks: number | null;
};

export type KeywordDelta = {
  keyword: string;
  position: number;
  volume: number;
  /** Present in the latest top-10 but not in the previous audit's top-10. */
  isNew: boolean;
};

export type SeoMetrics = {
  domainRating: number | null;
  traffic: number | null;
  organicKeywords: number | null;
  keywordsTop10: number | null;
  /** New ranking keywords in the latest historical month (DataForSEO is_new). */
  keywordsNew: number | null;
  keywordsLost: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  spamScore: number | null;
  dofollow: number | null;
  nofollow: number | null;
  referringPages: number | null;
  topTlds: Array<{ tld: string; count: number }>;
  /** Sparkline-ready series (oldest → newest). Prefer DFS monthly history; fall back to audits. */
  trend: SeoTrendPoint[];
  /** Top keywords that appeared since the previous local audit. */
  newTopKeywords: KeywordDelta[];
  backlinkSummary: BacklinkSummary | null;
  search: SearchPerformance | null;
};

type AuditRow = {
  search?: unknown;
  backlinks?: unknown;
  created_at?: string | null;
};

function asSearch(raw: unknown): SearchPerformance | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as SearchPerformance;
}

function asBacklinks(raw: unknown): BacklinkSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const bl = raw as BacklinkSummary;
  return { ...bl, rank: normalizeDomainRank(bl.rank) };
}

function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function fromSearchHistory(history: HistoricalSearchMonth[]): SeoTrendPoint[] {
  return history.map((h) => ({
    label: monthLabel(h.year, h.month),
    traffic: h.estMonthlyTraffic,
    organicKeywords: h.organicKeywords,
    keywordsTop10: h.keywordsTop10,
    keywordsNew: h.keywordsNew,
    keywordsLost: h.keywordsLost,
    domainRating: null,
    referringDomains: null,
    backlinks: null
  }));
}

function fromBacklinkHistory(history: BacklinkHistoryMonth[]): SeoTrendPoint[] {
  return history.map((h) => ({
    label: h.date.slice(0, 7),
    traffic: null,
    organicKeywords: null,
    keywordsTop10: null,
    keywordsNew: null,
    keywordsLost: null,
    domainRating: normalizeDomainRank(h.rank),
    referringDomains: h.referringDomains,
    backlinks: h.backlinks
  }));
}

/** Merge search + backlink monthly series on the same label (yyyy-mm). */
function mergeTrends(search: SeoTrendPoint[], backlinks: SeoTrendPoint[]): SeoTrendPoint[] {
  const map = new Map<string, SeoTrendPoint>();
  for (const p of search) map.set(p.label, { ...p });
  for (const p of backlinks) {
    const cur = map.get(p.label);
    if (!cur) {
      map.set(p.label, { ...p });
      continue;
    }
    map.set(p.label, {
      ...cur,
      domainRating: p.domainRating ?? cur.domainRating,
      referringDomains: p.referringDomains ?? cur.referringDomains,
      backlinks: p.backlinks ?? cur.backlinks
    });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function fromAuditRows(rows: AuditRow[]): SeoTrendPoint[] {
  // Oldest → newest so sparklines read left-to-right.
  const ordered = [...rows].reverse();
  return ordered
    .map((r) => {
      const search = asSearch(r.search);
      const bl = asBacklinks(r.backlinks);
      if (!search && !bl) return null;
      const created = String(r.created_at ?? '').slice(0, 10);
      return {
        label: created.slice(0, 7) || created,
        traffic: search?.estMonthlyTraffic ?? null,
        organicKeywords: search?.organicKeywords ?? null,
        keywordsTop10: search?.keywordsTop10 ?? null,
        keywordsNew: null,
        keywordsLost: null,
        domainRating: bl ? normalizeDomainRank(bl.rank) : null,
        referringDomains: bl?.referringDomains ?? null,
        backlinks: bl?.backlinks ?? null
      } satisfies SeoTrendPoint;
    })
    .filter((p): p is SeoTrendPoint => !!p);
}

function computeNewTopKeywords(latest: SearchPerformance | null, previous: SearchPerformance | null): KeywordDelta[] {
  if (!latest?.topKeywords?.length) return [];
  const prev = new Set((previous?.topKeywords ?? []).map((k) => k.keyword.toLowerCase()));
  return latest.topKeywords
    .filter((k) => k.keyword && !prev.has(k.keyword.toLowerCase()))
    .map((k) => ({
      keyword: k.keyword,
      position: k.position,
      volume: k.volume,
      isNew: true
    }));
}

/**
 * Build the SEO metrics panel from the newest audits (newest-first, as returned by Supabase).
 * Prefers nested DataForSEO monthly histories when present; otherwise falls back to audit points.
 */
export function buildSeoMetrics(auditRows: AuditRow[]): SeoMetrics {
  const rows = auditRows ?? [];
  const latestWithSearch = rows.find((r) => r.search != null) ?? null;
  const latestWithBl = rows.find((r) => r.backlinks != null) ?? null;
  const search = asSearch(latestWithSearch?.search);
  const backlinks = asBacklinks(latestWithBl?.backlinks);

  const prevSearchRow = rows.filter((r) => r.search != null)[1] ?? null;
  const previousSearch = asSearch(prevSearchRow?.search);

  const searchHist = search?.history?.length ? fromSearchHistory(search.history) : [];
  const blHist = backlinks?.history?.length ? fromBacklinkHistory(backlinks.history) : [];
  let trend = mergeTrends(searchHist, blHist);
  if (trend.length < 2) {
    const fromAudits = fromAuditRows(rows);
    trend = trend.length ? mergeTrends(trend, fromAudits) : fromAudits;
  }

  const latestHistMonth = search?.history?.length
    ? search.history[search.history.length - 1]
    : null;

  return {
    domainRating: backlinks ? normalizeDomainRank(backlinks.rank) : null,
    traffic: search?.estMonthlyTraffic ?? null,
    organicKeywords: search?.organicKeywords ?? null,
    keywordsTop10: search?.keywordsTop10 ?? null,
    keywordsNew: latestHistMonth?.keywordsNew ?? null,
    keywordsLost: latestHistMonth?.keywordsLost ?? null,
    referringDomains: backlinks?.referringDomains ?? null,
    backlinks: backlinks?.backlinks ?? null,
    spamScore: backlinks?.spamScore ?? null,
    dofollow: backlinks?.dofollow ?? null,
    nofollow: backlinks?.nofollow ?? null,
    referringPages: backlinks?.referringPages ?? null,
    topTlds: backlinks?.topTlds ?? [],
    trend,
    newTopKeywords: computeNewTopKeywords(search, previousSearch),
    backlinkSummary: backlinks,
    search
  };
}
