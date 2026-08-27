// Google PageSpeed Insights — Core Web Vitals for the free tool.
//
// PSI returns two different things and they answer different questions:
//   FIELD (loadingExperience / CrUX) — what real Chrome users actually experienced over the last
//     28 days. This is what Google ranks on. Only exists once a site has enough traffic.
//   LAB (lighthouseResult) — one simulated load from Google's own machine. Always attempted, but
//     it can partially or entirely fail: a heavy site can come back with `score: null` and a
//     missing LCP audit (verified against nytimes.com). Never assume a field is present.
//
// The API is free but quota-limited (25k/day with a key), so the tool still goes through
// tool-guard — the quota is a shared resource we can exhaust for everyone at once.
import { env } from '$env/dynamic/private';
import { logAiCall } from '$lib/server/ai-log';

export const pagespeedConfigured = () => !!env.PAGESPEED_API_KEY;

export type Verdict = 'good' | 'needs-improvement' | 'poor' | 'unknown';

export type Metric = {
  id: string;
  /** Milliseconds, or an unitless score for CLS. Null when the metric didn't come back. */
  value: number | null;
  display: string;
  verdict: Verdict;
};

export type PageSpeedReport = {
  url: string;
  strategy: 'mobile' | 'desktop';
  score: number | null;
  /** Real-user data from CrUX. Null when the origin has too little traffic to qualify. */
  field: { overall: Verdict; metrics: Metric[] } | null;
  lab: Metric[];
  opportunities: Array<{ title: string; savingsMs: number }>;
};

// Google's own Core Web Vitals thresholds (web.dev/vitals). CLS is unitless; the rest are ms.
const THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800]
};

function verdictFor(id: string, value: number | null): Verdict {
  const t = THRESHOLDS[id];
  if (value == null || !t) return 'unknown';
  return value <= t[0] ? 'good' : value <= t[1] ? 'needs-improvement' : 'poor';
}

const fmtMs = (ms: number | null) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

// CrUX reports CLS ×100 as an integer (15 means 0.15), unlike Lighthouse which reports it raw.
const FIELD_METRICS: Array<{ key: string; id: string; cls?: boolean }> = [
  { key: 'LARGEST_CONTENTFUL_PAINT_MS', id: 'LCP' },
  { key: 'INTERACTION_TO_NEXT_PAINT', id: 'INP' },
  { key: 'CUMULATIVE_LAYOUT_SHIFT_SCORE', id: 'CLS', cls: true },
  { key: 'FIRST_CONTENTFUL_PAINT_MS', id: 'FCP' },
  { key: 'EXPERIMENTAL_TIME_TO_FIRST_BYTE', id: 'TTFB' }
];

const LAB_AUDITS: Array<{ key: string; id: string }> = [
  { key: 'largest-contentful-paint', id: 'LCP' },
  { key: 'first-contentful-paint', id: 'FCP' },
  { key: 'cumulative-layout-shift', id: 'CLS' },
  { key: 'total-blocking-time', id: 'TBT' },
  { key: 'speed-index', id: 'SI' }
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export async function fetchPageSpeed(url: string, strategy: 'mobile' | 'desktop' = 'mobile'): Promise<PageSpeedReport | null> {
  const key = env.PAGESPEED_API_KEY;
  if (!key) return null;

  const params = new URLSearchParams({ url, key, strategy, category: 'performance' });
  const t0 = Date.now();
  let json: AnyRec;
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
      // PSI genuinely takes 10-30s on a heavy page; anything tighter fails the slow sites that
      // most need the report.
      signal: AbortSignal.timeout(55_000)
    });
    json = await res.json();
    // Free API, but log it so the run shows up alongside every other external call.
    logAiCall({ label: 'pagespeed', provider: 'pagespeed', ms: Date.now() - t0, ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}`, context: strategy, flatCostUsd: 0 });
    if (!res.ok) return null;
  } catch {
    logAiCall({ label: 'pagespeed', provider: 'pagespeed', ms: Date.now() - t0, ok: false, error: 'network', context: strategy, flatCostUsd: 0 });
    return null;
  }
  if (json?.error) return null;

  const lr: AnyRec = json.lighthouseResult ?? {};
  const le: AnyRec = json.loadingExperience ?? {};

  const fieldMetrics: Metric[] = FIELD_METRICS.map(({ key: k, id, cls }) => {
    const m = le.metrics?.[k];
    if (!m || typeof m.percentile !== 'number') return null;
    const value = cls ? m.percentile / 100 : m.percentile;
    return { id, value, display: cls ? value.toFixed(3) : fmtMs(value), verdict: verdictFor(id, value) };
  }).filter(Boolean) as Metric[];

  const overallRaw = String(le.overall_category ?? '');
  const overall: Verdict =
    overallRaw === 'FAST' ? 'good' : overallRaw === 'AVERAGE' ? 'needs-improvement' : overallRaw === 'SLOW' ? 'poor' : 'unknown';

  const lab: Metric[] = LAB_AUDITS.map(({ key: k, id }) => {
    const a = lr.audits?.[k];
    if (!a) return null;
    // numericValue can be absent even when the audit object exists — that's a failed audit, and
    // reporting it as 0 would read as a perfect score.
    const value = typeof a.numericValue === 'number' ? a.numericValue : null;
    return { id, value, display: a.displayValue ?? '—', verdict: verdictFor(id, value) };
  }).filter(Boolean) as Metric[];

  const opportunities = (Object.values(lr.audits ?? {}) as AnyRec[])
    .filter((a: AnyRec) => a?.details?.type === 'opportunity' && Number(a.details.overallSavingsMs) > 0)
    .map((a: AnyRec) => ({ title: String(a.title ?? ''), savingsMs: Math.round(Number(a.details.overallSavingsMs)) }))
    .sort((a, b) => b.savingsMs - a.savingsMs)
    .slice(0, 6);

  // A response with neither field nor lab data is a failure, not a fast site.
  if (!fieldMetrics.length && !lab.length) return null;

  return {
    url: String(lr.finalUrl ?? json.id ?? url),
    strategy,
    score: typeof lr.categories?.performance?.score === 'number' ? Math.round(lr.categories.performance.score * 100) : null,
    field: fieldMetrics.length ? { overall, metrics: fieldMetrics } : null,
    lab,
    opportunities
  };
}
