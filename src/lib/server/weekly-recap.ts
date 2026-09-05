import { swallow } from '$lib/server/swallow';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import type { SupabaseClient } from '@supabase/supabase-js';
import { groundedText, structured } from './research';
import { syncZernioAnalytics } from './zernio';
import { ensureBrandHistory } from './scrapecreators';
import { analyzePostHistory, type HistoryPost } from './post-history-insights';
import { remaining, monthKey } from './usage';
import { buildMemoryContext, writeMemory, type MemoryCategory } from './brand-memory';
import { withBrandContext } from './ai-log';
import { loadGrowthReadiness, type GrowthReadiness } from './growth-readiness';
import { OWN_SOURCE } from './own-post-history';
import { buildWebKpis, type RankSnapshot, type WebKpis } from './rank-delta';
import type { GrowthCheckKey } from '$lib/growth-readiness';
import { assessEvidence, evidenceBlock, sampleVerdict } from '$lib/server/evidence-quality';

// Engagement metrics from social_post_history.metrics JSONB — OWN posts only (source='zernio').
export type EngagementMetrics = {
  likes: number;
  comments: number;
  shares: number;
  views: number;
  impressions: number;
  saves: number;
};

export type WeeklyRecap = {
  brandName: string;
  brandSlug: string;
  ownerEmail: string;
  ownerLocale: string;

  // Post activity
  postsPublished: number;
  postsPending: number;
  postsScheduled: number;
  prevPosts: number; // previous week published count
  topPost: { platform: string; caption: string | null; media_url: string | null } | null;

  // Engagement (aggregated from social_post_history — own published posts only)
  totalEngagement: EngagementMetrics;
  prevEngagement: EngagementMetrics; // previous week totals
  engagementDeltaPct: number | null; // null = no previous week data
  platformStats: { platform: string; postsPublished: number; totals: EngagementMetrics }[];

  // Connected accounts
  connectedAccounts: { platform: string; username: string | null }[];

  // Editorial plan
  editorialPlan: { id: string; status: string } | null;
  contentPlanStatus: string | null;

  // Scheduler activity
  schedulerRunsThisWeek: number;

  // Click path (post → measurable traffic): post_links clicks summed over the last 7 days.
  // redirect = /l/[code] 302 hits (noisy, crawlers included); landing = target-page beacon
  // (clean). Optional: the email shows the section only when > 0.
  linkClicks?: number;

  // Visual insights (P2 learning loop): last 2 windows of brand_visual_insights buckets
  // (n≥3, delta≠null), grouped per dimension, top 3 by |delta|. Optional: the email renders
  // the section only when present.
  visualInsights?: VisualInsightSummary[];

  // Web/rank KPIs (P4): active tracked keywords and their position movement over the window.
  // Optional: the email renders the section only when tracked > 0.
  webKpis?: WebKpis;

  // Quota
  quotaUsed: number;
  quotaTotal: number;
  quotaMonth: string;

  // Paid ads (optional — 0 when no Pro ads activity)
  adsProposed: number;
  adsSpend: number;

  // AI-generated
  trends: { topic: string; relevance: string; sourceUrl?: string; imageUrl?: string }[];
  suggestions: { type: string; message: string }[];
  actionItems: { label: string; url?: string }[];

  /** Organic-growth data gate — surfaced in the weekly email when incomplete. */
  growth: GrowthReadiness | null;
};


export type VisualInsightSummary = {
  dimension: string;
  value: string;
  n: number;
  /** Mean engagement rate in percent (4.2 = 4.2%), same scale as the source rows. */
  erAvg: number;
  /** Percentage points vs the brand mean (35 = +35% ER). */
  delta: number;
};

type PostHistoryRow = {
  platform: string;
  content: string | null;
  media_type: string | null;
  published_at: string | null;
  metrics: Record<string, number> | null;
};

function emptyEngagement(): EngagementMetrics {
  return { likes: 0, comments: 0, shares: 0, views: 0, impressions: 0, saves: 0 };
}

function sumEngagement(rows: PostHistoryRow[]): EngagementMetrics {
  const out = emptyEngagement();
  for (const r of rows) {
    const m = r.metrics ?? {};
    out.likes += m.likes ?? 0;
    out.comments += m.comments ?? 0;
    out.shares += m.shares ?? 0;
    out.views += m.views ?? 0;
    out.impressions += m.impressions ?? 0;
    out.saves += m.saves ?? 0;
  }
  return out;
}

function engTotal(e: EngagementMetrics): number {
  return e.likes + e.comments * 2 + e.shares * 3 + e.views * 0.01;
}

// ─── Data gathering ────────────────────────────────────────────────────────

async function gatherRecapData(
  supabase: SupabaseClient,
  brandId: string
): Promise<Omit<WeeklyRecap, 'trends' | 'suggestions' | 'actionItems' | 'growth'>> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Load brand + owner. Each link can legitimately be missing (deleted brand/org, orphaned
  // profile) — fail with a clear error instead of crashing on a null property read.
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, slug, org_id, plan, timezone')
    .eq('id', brandId)
    .single();
  if (!brand) throw new Error(`weekly-recap: brand ${brandId} not found`);

  const { data: org } = await supabase
    .from('organizations')
    .select('owner_id')
    .eq('id', brand.org_id)
    .single();
  if (!org) throw new Error(`weekly-recap: org ${brand.org_id} not found`);

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, locale')
    .eq('id', org.owner_id)
    .single();
  if (!profile) throw new Error(`weekly-recap: owner profile ${org.owner_id} not found`);

  // Posts this week
  const { data: weekPosts } = await supabase
    .from('posts')
    .select('id, platform, status, caption, media_url, created_at')
    .eq('brand_id', brandId)
    .gte('created_at', weekAgo.toISOString());

  const published = (weekPosts ?? []).filter(p => p.status === 'published');
  const pending = (weekPosts ?? []).filter(p => p.status === 'pending_user');
  const scheduled = (weekPosts ?? []).filter(p => p.status === 'scheduled');

  // Previous week published count
  const { count: prevPostsCount } = await supabase
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('status', 'published')
    .gte('created_at', twoWeeksAgo.toISOString())
    .lt('created_at', weekAgo.toISOString());

  // Top post (most recent published)
  const topPost = published.length > 0
    ? { platform: published[0].platform, caption: published[0].caption, media_url: published[0].media_url }
    : null;

  // Engagement from social_post_history — OWN posts ONLY (source='zernio'). Scraped rows
  // ('scrapecreators') are pre-app/competitor data, not the brand's current performance: when the
  // brand has no own rows yet the engagement section stays empty instead of aggregating scrapes.
  const { data: thisWeekHistory } = await supabase
    .from('social_post_history')
    .select('platform, content, media_type, published_at, metrics')
    .eq('brand_id', brandId)
    .eq('source', OWN_SOURCE)
    .gte('published_at', weekAgo.toISOString())
    .order('published_at', { ascending: false });

  const { data: prevWeekHistory } = await supabase
    .from('social_post_history')
    .select('platform, metrics')
    .eq('brand_id', brandId)
    .eq('source', OWN_SOURCE)
    .gte('published_at', twoWeeksAgo.toISOString())
    .lt('published_at', weekAgo.toISOString());

  const totalEngagement = sumEngagement((thisWeekHistory ?? []) as PostHistoryRow[]);
  const prevEngagement = sumEngagement((prevWeekHistory ?? []) as PostHistoryRow[]);

  const thisTotal = engTotal(totalEngagement);
  const prevTotal = engTotal(prevEngagement);
  const engagementDeltaPct = prevTotal > 0
    ? Math.round(((thisTotal - prevTotal) / prevTotal) * 100)
    : null;

  // Platform breakdown
  const byPlatform = new Map<string, { postsPublished: number; totals: EngagementMetrics }>();
  for (const row of (thisWeekHistory as PostHistoryRow[] ?? [])) {
    const p = row.platform ?? 'unknown';
    const m = row.metrics ?? {};
    const existing = byPlatform.get(p) ?? { postsPublished: 0, totals: emptyEngagement() };
    existing.postsPublished += 1;
    existing.totals.likes += m.likes ?? 0;
    existing.totals.comments += m.comments ?? 0;
    existing.totals.shares += m.shares ?? 0;
    existing.totals.views += m.views ?? 0;
    existing.totals.impressions += m.impressions ?? 0;
    existing.totals.saves += m.saves ?? 0;
    byPlatform.set(p, existing);
  }
  const platformStats = [...byPlatform.entries()]
    .map(([platform, data]) => ({ platform, ...data }))
    .sort((a, b) => engTotal(b.totals) - engTotal(a.totals));

  // Connected accounts
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('platform, username')
    .eq('brand_id', brandId);

  // Editorial plan
  const { data: plans } = await supabase
    .from('editorial_plans')
    .select('id, status')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(1);

  // Content plans
  const { data: contentPlans } = await supabase
    .from('content_plans')
    .select('status')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(1);

  // Scheduler runs this week
  const { count: schedulerRuns } = await supabase
    .from('scheduler_runs')
    .select('*', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .gte('created_at', weekAgo.toISOString());

  // Quota
  const quota = await remaining(supabase, brandId, brand.plan, brand.timezone);

  // Click path: post_links rows created in the last 7 days (created_at is the persist time of
  // the CTA link — post_id can be null for pre-insert enrichment, so the window keys off the
  // link row, not the post join). Sum of both counters: redirect (noisy) + landing (clean).
  let linkClicks = 0;
  try {
    const { data: linkRows } = await supabase
      .from('post_links')
      .select('clicks_redirect, clicks_landing')
      .eq('brand_id', brandId)
      .gte('created_at', weekAgo.toISOString());
    linkClicks = (linkRows ?? []).reduce(
      (s, r) => s + (r.clicks_redirect ?? 0) + (r.clicks_landing ?? 0),
      0
    );
  } catch (e) {
    // post_links is new (0151); a pre-migration DB must not fail the recap.
    console.warn('[weekly-recap] post_links query failed:', e instanceof Error ? e.message : e);
  }

  // Paid ads summary (best-effort; tables may be empty pre-migration). Stays at 0 while
  // FEATURE_ADS is off, so the recap email never mentions a surface the user cannot open.
  let adsProposed = 0;
  let adsSpend = 0;
  const { adsFeatureEnabled } = await import('$lib/server/ads');
  if (adsFeatureEnabled()) {
    try {
      const { count } = await supabase
        .from('ad_campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('status', 'proposed');
      adsProposed = count ?? 0;
      const { data: metrics } = await supabase
        .from('ad_metrics')
        .select('spend')
        .eq('brand_id', brandId)
        .gte('period_end', weekAgo.toISOString().slice(0, 10));
      adsSpend = (metrics ?? []).reduce((s, m) => s + Number(m.spend || 0), 0);
    } catch (error) { swallow('sum ads spend', error); }
  }

  // Visual insights (P2 learning loop): last 2 weeks of brand_visual_insights buckets (n≥3,
  // delta≠null), deduped per (dimension, value) keeping the most recent window, grouped per
  // dimension, top 3 by |delta|. Best-effort — a pre-0154 DB must not fail the recap.
  let visualInsights: VisualInsightSummary[] = [];
  try {
    const { data: viRows } = await supabase
      .from('brand_visual_insights')
      .select('window_start, dimension, value, n, er_avg, delta')
      .eq('brand_id', brandId)
      .gte('window_start', twoWeeksAgo.toISOString().slice(0, 10))
      .order('window_start', { ascending: false });
    const seen = new Set<string>();
    const rows: VisualInsightSummary[] = [];
    for (const r of viRows ?? []) {
      if (Number(r.n) < 3 || r.delta == null) continue;
      const key = `${r.dimension}:${r.value}`;
      if (seen.has(key)) continue; // same bucket across windows → keep the most recent
      seen.add(key);
      rows.push({
        dimension: r.dimension,
        value: r.value,
        n: Number(r.n),
        erAvg: Number(r.er_avg ?? 0),
        delta: Number(r.delta)
      });
    }
    const byDim = new Map<string, VisualInsightSummary[]>();
    for (const r of rows) byDim.set(r.dimension, [...(byDim.get(r.dimension) ?? []), r]);
    visualInsights = [...byDim.values()]
      .flatMap((group) =>
        [...group].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3)
      )
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  } catch (e) {
    console.warn('[weekly-recap] visual insights query failed:', e instanceof Error ? e.message : e);
  }

  // Web/rank KPIs (P4): active tracked keywords + snapshots from the last 45 days. PostgREST
  // has no per-group LIMIT, so fetch the whole window (max ~200 keywords × ~7 weekly rows) and
  // aggregate in JS — computeRankDelta only needs each keyword's first & last snapshot anyway.
  let webKpis: WebKpis | undefined;
  try {
    const { data: kws } = await supabase
      .from('brand_tracked_keywords')
      .select('id, keyword')
      .eq('brand_id', brandId)
      .eq('active', true);
    if ((kws ?? []).length > 0) {
      const since45 = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();
      const { data: snaps } = await supabase
        .from('brand_rank_snapshots')
        .select('tracked_keyword_id, position, checked_at')
        .eq('brand_id', brandId)
        .gte('checked_at', since45);
      const byKw = new Map<string, RankSnapshot[]>();
      for (const s of snaps ?? []) {
        byKw.set(s.tracked_keyword_id, [...(byKw.get(s.tracked_keyword_id) ?? []), s]);
      }
      webKpis = buildWebKpis(
        (kws ?? []).map((k) => ({
          tracked_keyword_id: k.id,
          keyword: k.keyword,
          snapshots: byKw.get(k.id) ?? []
        }))
      );
    }
  } catch (e) {
    console.warn('[weekly-recap] rank snapshot query failed:', e instanceof Error ? e.message : e);
  }

  return {
    brandName: brand.name,
    brandSlug: brand.slug,
    ownerEmail: profile.email,
    ownerLocale: profile.locale ?? 'en',
    postsPublished: published.length,
    postsPending: pending.length,
    postsScheduled: scheduled.length,
    prevPosts: prevPostsCount ?? 0,
    topPost,
    totalEngagement,
    prevEngagement,
    engagementDeltaPct,
    platformStats,
    connectedAccounts: (accounts ?? []).map(a => ({ platform: a.platform, username: a.username })),
    editorialPlan: plans?.[0] ?? null,
    contentPlanStatus: contentPlans?.[0]?.status ?? null,
    schedulerRunsThisWeek: schedulerRuns ?? 0,
    // postsUsed/postsQuota, NOT posts (= remaining) — the old values made the "quota almost
    // used" action item compare remaining against undefined, so the warning never fired.
    quotaUsed: quota.postsUsed,
    quotaTotal: quota.postsQuota,
    quotaMonth: monthKey(brand.timezone),
    adsProposed,
    adsSpend,
    linkClicks,
    visualInsights,
    webKpis
  };
}

// ─── AI generation ─────────────────────────────────────────────────────────

// The formats we are willing to re-serve from our own public bucket, and the name we give each one.
// The remote server's header decides nothing beyond which row it selects: forwarding it is how an
// `image/svg+xml` ended up on a public URL of ours, and how a `;charset=` parameter ended up in a
// stored content type. One table, so the next format is a row and not a fourth ternary.
const HOSTED_IMAGE_TYPES: Record<string, { ext: string; contentType: string }> = {
  'image/png': { ext: 'png', contentType: 'image/png' },
  'image/webp': { ext: 'webp', contentType: 'image/webp' },
  'image/jpeg': { ext: 'jpg', contentType: 'image/jpeg' },
  'image/jpg': { ext: 'jpg', contentType: 'image/jpeg' },
  'image/gif': { ext: 'gif', contentType: 'image/gif' }
};

export function hostedImageType(header: string): { ext: string; contentType: string } | null {
  return HOSTED_IMAGE_TYPES[header.split(';')[0].trim().toLowerCase()] ?? null;
}

// Fetch an image from a URL and host it on Supabase Storage for email embedding.
// Tries OG image first, then falls back to the first large image on the page.
async function fetchAndHostOgImage(supabase: SupabaseClient, url: string): Promise<string | null> {
  try {
    const { fetchPage } = await import('./brand-analysis');
    const html = await fetchPage(url);
    if (!html) return null;

    // Try OG / twitter:image
    let imgUrl = html.match(/<meta[^>]+(?:og:image|twitter:image)[^>]+content=["']([^"']+)["']/i)?.[1];
    // Fallback: first <img> with a reasonable src
    if (!imgUrl) {
      const imgMatch = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*?)["']/i);
      imgUrl = imgMatch?.[1];
    }
    if (!imgUrl) return null;

    const absoluteUrl = new URL(imgUrl, url).href;
    const imgRes = await fetch(absoluteUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok) return null;
    const hosted = hostedImageType(imgRes.headers.get('content-type') ?? '');
    if (!hosted) return null;
    const buf = await imgRes.arrayBuffer();
    if (buf.byteLength > 2_000_000) return null;

    const path = `trends/${crypto.randomUUID()}.${hosted.ext}`;
    const { error } = await supabase.storage.from('email-assets').upload(path, Buffer.from(buf), {
      contentType: hosted.contentType,
      upsert: false
    });
    if (error) return null;
    const { data: publicUrl } = supabase.storage.from('email-assets').getPublicUrl(path);
    return publicUrl?.publicUrl ?? null;
  } catch {
    return null;
  }
}

async function generateTrends(brandName: string, brandContext: string, outputLanguage = 'Italian'): Promise<{ topic: string; relevance: string; sourceUrl?: string }[]> {
  try {
    // Use groundedText to get real web results + citations
    const grounded = await groundedText(
      `What are the trending topics and news this week relevant to a brand called "${brandName}"? Context: ${brandContext}. Find 3-5 specific, actionable trends. For each, explain why it matters to this brand. When you find a trend, note the exact URL of the source article you found it from.`,
      `You are a social media trends analyst. Be specific and actionable. Write in ${outputLanguage}.`
    );

    // Use structured() to force valid JSON from the grounded text
    const schema = {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          topic: { type: 'string' as const },
          relevance: { type: 'string' as const },
          sourceUrl: { type: 'string' as const, description: 'The URL of the source article, or empty string if unknown' }
        },
        required: ['topic', 'relevance', 'sourceUrl']
      }
    };

    const raw = await structured<{ topic: string; relevance: string; sourceUrl?: string }[]>(
      `From this analysis, extract 3-5 trends as a JSON array. Each trend must have topic, relevance, and sourceUrl (the actual URL of the source, or "" if not available). Write topic and relevance in ${outputLanguage}.\n\nANALYSIS:\n${grounded.text}`,
      schema,
      undefined,
      { label: 'recapTrends' }
    );
    const parsed = Array.isArray(raw) ? raw : [];

    // Merge: prefer the model's sourceUrl, fall back to grounding citations
    const citUrls = (grounded.citations ?? []).map((c) => c.uri).filter(Boolean) as string[];
    let citIdx = 0;

    return parsed
      .filter((t) => t?.topic && t?.relevance)
      .map((t) => ({
        topic: String(t.topic).trim(),
        relevance: String(t.relevance).trim(),
        sourceUrl: (t.sourceUrl && t.sourceUrl.startsWith('http'))
          ? t.sourceUrl.trim()
          : citUrls[citIdx++] ?? citUrls[citUrls.length - 1]
      }))
      .slice(0, 5);
  } catch {
    return [];
  }
}

async function generateSuggestions(data: Omit<WeeklyRecap, 'trends' | 'suggestions' | 'actionItems' | 'growth'>, outputLanguage = 'Italian'): Promise<{ type: string; message: string }[]> {
  // No own published-post metrics (source='zernio') in the window → the engagement section is
  // genuinely empty. Say so explicitly instead of letting the model infer performance from zeros.
  const noOwnHistory =
    data.platformStats.length === 0 &&
    data.totalEngagement.likes === 0 &&
    data.totalEngagement.comments === 0 &&
    data.totalEngagement.views === 0;

  // Deterministic, data-driven suggestions (P2 visual + P4 rank KPIs) — always appended to the
  // model's output so the email never depends on the model to notice the signal.
  const isIt = outputLanguage === 'Italian';
  const extra: { type: string; message: string }[] = [];
  if (data.visualInsights?.length) {
    const top = [...data.visualInsights]
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 2);
    for (const v of top) {
      const pct = Math.round(v.delta);
      const label = `${v.value} (${v.dimension})`;
      // The insight floor is n>=3, which is far under the noise ceiling. Telling someone to "keep
      // producing these" off three posts is regression to the mean dressed as a recommendation —
      // and next week's three posts will point somewhere else. The finding still goes in the email,
      // because the user should see it; what changes is the verb and the confidence attached.
      const strength = sampleVerdict(v.n);
      const hedged = strength === 'insufficient';
      extra.push(
        pct > 0
          ? {
              type: 'content_strategy',
              message: isIt
                ? hedged
                  ? `I post ${label} rendono +${pct}% ER rispetto alla media, ma su ${v.n} post: è un indizio, non un pattern. Vale la pena provarne un altro per vedere se regge.`
                  : `I post ${label} rendono +${pct}% ER rispetto alla media (n=${v.n}) — continua a produrli.`
                : hedged
                  ? `${label} posts get +${pct}% ER vs avg, but on ${v.n} posts: a hint, not a pattern. Worth one more to see if it holds.`
                  : `${label} posts get +${pct}% ER vs avg (n=${v.n}) — keep producing them.`
            }
          : {
              type: 'content_strategy',
              message: isIt
                ? hedged
                  ? `I post ${label} rendono ${pct}% ER rispetto alla media, ma su ${v.n} post: troppo poco per sospenderli. Tienili d'occhio.`
                  : `I post ${label} rendono ${pct}% ER rispetto alla media (n=${v.n}) — rivedi l'approccio o sospendili.`
                : hedged
                  ? `${label} posts get ${pct}% ER vs avg, but on ${v.n} posts: too little to drop them. Keep an eye on it.`
                  : `${label} posts get ${pct}% ER vs avg (n=${v.n}) — reconsider or adjust.`
            }
      );
    }
  }
  if (data.webKpis && data.webKpis.worsened > 0) {
    extra.push({
      type: 'general',
      message: isIt
        ? `${data.webKpis.worsened} keyword tracciate sono peggiorate — rivedi e aggiorna gli articoli target.`
        : `${data.webKpis.worsened} tracked keyword(s) dropped — review and refresh the target articles.`
    });
  }
  // WHAT I COULD NOT DETERMINE. Deterministic, so it appears whether or not the model remembers to
  // write it: a recap that never says what it could not see reads as complete, and the week a user
  // discovers the gap they discount every recap that came before it too.
  const unknowns: string[] = [];
  if (noOwnHistory) unknowns.push(isIt ? 'la performance reale dei post (analytics non ancora sincronizzate)' : 'real post performance (analytics not synced yet)');
  else if (sampleVerdict(data.postsPublished) === 'insufficient') {
    unknowns.push(
      isIt
        ? `quale formato o orario funzioni meglio: ${data.postsPublished} post pubblicati non bastano per distinguerlo dal caso`
        : `which format or slot performs best: ${data.postsPublished} posts is not enough to tell it from chance`
    );
  }
  if (!data.webKpis || data.webKpis.tracked === 0) {
    unknowns.push(isIt ? "l'andamento sulle ricerche (nessuna keyword tracciata)" : 'search performance (no tracked keywords)');
  }
  if (!data.adsSpend) unknowns.push(isIt ? "l'effetto del paid (nessuna spesa nel periodo)" : 'paid impact (no spend in the window)');
  if (unknowns.length) {
    extra.push({
      type: 'general',
      message: isIt
        ? `Cosa NON sono riuscito a determinare questa settimana: ${unknowns.join('; ')}.`
        : `What I could NOT determine this week: ${unknowns.join('; ')}.`
    });
  }

  const visualLines = (data.visualInsights ?? [])
    .slice(0, 3)
    .map((v) => `${v.value} (${v.dimension}): ${Math.round(v.delta)}% ER vs avg (n=${v.n})`)
    .join('; ');

  try {
    const result = await structured(
      `Based on this weekly social media performance data, suggest 3-5 specific, actionable improvements:

Brand: ${data.brandName}
Posts published this week: ${data.postsPublished}
Posts pending approval: ${data.postsPending}
Posts previous week: ${data.prevPosts}
Total engagement: ${Math.round(engTotal(data.totalEngagement))}
Previous week engagement: ${Math.round(engTotal(data.prevEngagement))}
Engagement change: ${data.engagementDeltaPct !== null ? data.engagementDeltaPct + '%' : 'no previous data'}
Platform breakdown: ${data.platformStats.map(p => `${p.platform}: ${p.postsPublished} posts, ${Math.round(engTotal(p.totals))} engagement`).join(', ') || 'none'}
${noOwnHistory ? 'NOTE: the brand has NO own published-post engagement data in this window (Zernio analytics not synced yet). Do NOT invent engagement figures, do NOT imply poor/absent performance from this, and do NOT base suggestions on competitor data — focus on cadence, approvals and setup instead.\n' : ''}Connected accounts: ${data.connectedAccounts.map(a => a.platform).join(', ') || 'none'}
Paid ads spend (last week metrics): ${data.adsSpend.toFixed(2)}; pending ads proposals: ${data.adsProposed}
Editorial plan: ${data.editorialPlan?.status ?? 'none'}
Scheduler runs this week: ${data.schedulerRunsThisWeek}
${visualLines ? `Visual insights (own posts, % ER vs brand mean): ${visualLines}\n` : ''}${data.webKpis && data.webKpis.tracked > 0 ? `Rank tracking: ${data.webKpis.tracked} keywords tracked, ${data.webKpis.improved} improved, ${data.webKpis.worsened} worsened\n` : ''}
${evidenceBlock(
        assessEvidence({
          // Week over week on whatever happened to be published: nothing randomised, several things
          // changed at once. That is a trend, and calling it anything stronger would be a lie the
          // user then acts on.
          design: 'trend',
          sample: data.postsPublished,
          unit: isIt ? 'post pubblicati' : 'published posts',
          window: isIt ? 'ultimi 7 giorni vs 7 precedenti' : 'last 7 days vs previous 7',
          survivorsOnly: true,
          vanityMetric: true,
          reversible: true
        })
      )}

EVIDENCE RULES — these bind every suggestion you write:
- Never name a winner or a loser the sample cannot support. Under the floor, write the observation and say plainly it is
  directional, then name what would settle it.
- A format that dropped after a strong week is partly regression to the mean, not proof it stopped working.
- Impressions and views are the algorithm's distribution decision. Judge on replies, saves, profile visits, DMs.
- Never state a precision the inputs do not have: "circa il triplo" is honest, "2,94x" from noisy inputs is theatre.
- If the data cannot support a suggestion, say what to run next week to get the answer. That is a real deliverable.

Respond with a JSON array of {type, message} objects. type can be: posting_frequency, content_strategy, engagement, platform_specific, general. Write all "message" text in ${outputLanguage}.`,
      {
        type: 'object',
        properties: {
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                message: { type: 'string' }
              },
              required: ['type', 'message']
            }
          }
        },
        required: ['suggestions']
      }
    );
    const aiSuggestions = (result as { suggestions: { type: string; message: string }[] }).suggestions ?? [];
    return [...extra, ...aiSuggestions];
  } catch {
    return extra;
  }
}

const GROWTH_FIX_LABELS: Record<GrowthCheckKey, { en: string; it: string }> = {
  about: {
    en: 'Add a clear brand About in Studio — produce is blocked without it.',
    it: 'Aggiungi un About chiaro in Studio — senza, la production è bloccata.'
  },
  voice: {
    en: 'Define voice/personality (approve an editorial plan, or set tone in Studio Brand).',
    it: 'Definisci voce/personalità (approva un piano editoriale, o imposta il tono in Studio Brand).'
  },
  history: {
    en: 'Connect social accounts and sync history — need at least 5 past posts with metrics.',
    it: 'Collega i social e sincronizza lo storico — servono almeno 5 post passati con metriche.'
  },
  historyDepth: {
    en: 'Sync more past posts (aim for 12+) so winning patterns are reliable.',
    it: 'Sincronizza più post passati (punta a 12+) così i pattern vincenti sono affidabili.'
  },
  competitors: {
    en: 'Add at least one competitor so market formats can steer the batch.',
    it: 'Aggiungi almeno un competitor così i formati di mercato possono guidare il batch.'
  },
  audience: {
    en: 'Define the target audience in Studio Brand.',
    it: 'Definisci il pubblico target in Studio Brand.'
  },
  products: {
    en: 'Add offerings in Studio Products so posts feature real things.',
    it: 'Aggiungi prodotti/servizi in Studio Products così i post parlano di cose reali.'
  },
  visual: {
    en: 'Set visual style in Studio Brand so images stay on-brand.',
    it: 'Imposta lo stile visuale in Studio Brand così le immagini restano on-brand.'
  },
  knowledge: {
    en: 'Add Studio Knowledge notes or docs — concrete facts beat generic claims.',
    it: 'Aggiungi note o documenti in Studio Knowledge — i fatti battono le frasi generiche.'
  },
  plan: {
    en: 'Approve an editorial plan with a one-line personality — it leads every caption.',
    it: 'Approva un piano editoriale con una personalità in una riga — guida ogni caption.'
  },
  web: {
    en: 'Connect a website or blog — organic search is where content compounds.',
    it: 'Collega un sito o un blog — la ricerca organica è dove i contenuti si accumulano.'
  },
  gsc: {
    en: 'Connect Google Search Console so rankings and queries feed the plan.',
    it: 'Collega Google Search Console così posizioni e query alimentano il piano.'
  },
  social_connect: {
    en: 'Connect at least one social account — posts need a platform to publish to.',
    it: 'Connetti almeno un account social per pubblicare.'
  }
};

function buildActionItems(
  data: Omit<WeeklyRecap, 'trends' | 'suggestions' | 'actionItems' | 'growth'>,
  locale = 'en',
  growth: GrowthReadiness | null = null
): { label: string; url?: string }[] {
  const items: { label: string; url?: string }[] = [];
  // Normalizzazione unica del brand: it/it-IT/it-CH → italiano, tutto il resto (incluso
  // profilo senza locale) → inglese. Lo stretto `=== 'it' || 'it-IT'` perdeva `it-CH`.
  const isIt = bilingualNoticeLocale(locale) === 'it';

  if (growth && (!growth.ready || growth.warnings.length > 0)) {
    const pending = [...growth.blocking, ...growth.warnings];
    for (const c of pending) {
      const copy = GROWTH_FIX_LABELS[c.key];
      items.push({
        label: isIt ? copy.it : copy.en,
        url: c.fix
      });
    }
  }

  if (data.postsPending > 0) {
    items.push({ label: isIt
      ? `Hai ${data.postsPending} post in attesa di approvazione. Rivedili e approvali per mantenere il calendario dei contenuti.`
      : `You have ${data.postsPending} post${data.postsPending > 1 ? 's' : ''} waiting for approval. Review and approve them to keep your content schedule on track.`
    });
  }

  if (data.connectedAccounts.length === 0) {
    items.push({ label: isIt
      ? `Nessun account social connesso. Connetti Instagram, X o TikTok per pubblicare e tracciare l'engagement.`
      : `No social accounts connected yet. Connect your Instagram, X, or TikTok accounts to start publishing and tracking engagement.`
    });
  }

  if (data.editorialPlan?.status === 'expired' || data.editorialPlan?.status === 'superseded') {
    items.push({ label: isIt
      ? `Il tuo piano editoriale è scaduto. Generane uno nuovo per continuare a pubblicare.`
      : `Your editorial plan has expired. Generate a new one to keep content flowing.`
    });
  }

  if (data.postsPublished === 0 && data.postsScheduled === 0) {
    items.push({ label: isIt
      ? `Nessun post pubblicato o programmato questa settimana. Approva i contenuti in sospeso o genera nuovi post.`
      : `No posts published or scheduled this week. Consider approving pending content or generating new posts.`
    });
  }

  if (data.quotaUsed >= data.quotaTotal * 0.8) {
    items.push({ label: isIt
      ? `Hai usato ${data.quotaUsed} di ${data.quotaTotal} post questo mese (${data.quotaMonth}). Valuta un upgrade se hai bisogno di più contenuti.`
      : `You've used ${data.quotaUsed} of ${data.quotaTotal} posts this month (${data.quotaMonth}). Consider upgrading if you need more.`
    });
  }

  if (data.adsProposed > 0) {
    const n = data.adsProposed;
    items.push({
      label: isIt
        ? `Hai ${n} proposta/e ads in attesa. Rivedile su Ads e approva solo i budget che vuoi spendere.`
        : `You have ${n} ads proposal(s) waiting. Review them on Ads and approve only the budgets you want to spend.`,
      url: `/app/${data.brandSlug}/ads`
    });
  }

  return items;
}

// ─── Weekly reflection (the agent that looks back) ──────────────────────────
//
// The Director judges one batch; this judges the SYSTEM over the last two weeks: image-QC verdicts
// (now persisted on posts.qc), the Director's attention flags, the user's caption-edit lessons and
// the Radar's acceptance signal — distilled into 0-3 GENERALIZABLE memories that every future
// prompt reads (via buildMemoryContext). This is how the machine course-corrects weekly instead of
// repeating the same mistakes. Runs inside the Monday recap tick; best-effort, never throws.

const REFLECTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    insights: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          key: { type: 'string' as const, description: 'Short snake_case key, stable across weeks so repeated lessons REINFORCE instead of duplicating.' },
          value: { type: 'string' as const, description: 'One imperative sentence the content pipeline should follow from now on.' },
          category: { type: 'string' as const, enum: ['voice', 'preference', 'constraint', 'insight'] as const },
          confidence: { type: 'number' as const }
        },
        required: ['key', 'value', 'category', 'confidence']
      }
    }
  },
  required: ['insights']
};

// Credits: called from the weekly-recap cron outside any request scope — set the brand context.
export async function runWeeklyReflection(supabase: SupabaseClient, brandId: string): Promise<number> {
  return withBrandContext(brandId, () => runWeeklyReflectionInner(supabase, brandId));
}

async function runWeeklyReflectionInner(supabase: SupabaseClient, brandId: string): Promise<number> {
  try {
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const [{ data: posts }, { data: newsItems }, { data: userLessons }] = await Promise.all([
      supabase.from('posts')
        .select('status, source, qc, needs_attention, attention_reason')
        .eq('brand_id', brandId).gte('created_at', since).limit(150),
      supabase.from('brand_news_items')
        .select('status, relevance, urgency, skip_reason')
        .eq('brand_id', brandId).gte('created_at', since).limit(150),
      supabase.from('brand_memory')
        .select('value').eq('brand_id', brandId).eq('source', 'user').gte('updated_at', since).limit(10)
    ]);

    // Compact, honest digests — pure code, no model needed to summarise counts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qcRows = (posts ?? []).map((p) => p.qc as any).filter(Boolean);
    const qcScores = qcRows.map((q) => Number(q?.score) || 0).filter((s) => s > 0);
    const qcIssues = new Map<string, number>();
    for (const q of qcRows) for (const i of (Array.isArray(q?.issues) ? q.issues : [])) {
      const k = String(i).slice(0, 80);
      qcIssues.set(k, (qcIssues.get(k) ?? 0) + 1);
    }
    const flagged = (posts ?? []).filter((p) => p.needs_attention);
    const radarPosts = (posts ?? []).filter((p) => p.source === 'radar');
    // ponytail: rejected radar posts are deleted, so "still pending vs progressed" is the proxy for
    // acceptance; add an explicit rejected state if this signal ever needs to be exact.
    const radarAccepted = radarPosts.filter((p) => p.status !== 'pending_user').length;
    const proposedNews = (newsItems ?? []).filter((n) => n.status === 'proposed' || n.status === 'posted').length;

    const lines = [
      qcScores.length ? `Image QC (last 14d): ${qcScores.length} judged, avg ${(qcScores.reduce((a, b) => a + b, 0) / qcScores.length).toFixed(1)}/10. Recurring issues: ${[...qcIssues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `"${k}" ×${n}`).join('; ') || 'none'}` : '',
      flagged.length ? `Posts flagged for the owner: ${flagged.length} — reasons: ${flagged.slice(0, 5).map((p) => String(p.attention_reason ?? '').slice(0, 60)).filter(Boolean).join('; ')}` : '',
      (newsItems ?? []).length ? `Radar: ${(newsItems ?? []).length} news scanned, ${proposedNews} proposed, ${radarPosts.length} posts created, ${radarAccepted} acted on by the owner. Sample skip reasons: ${(newsItems ?? []).map((n) => n.skip_reason).filter(Boolean).slice(0, 3).join('; ')}` : '',
      (userLessons ?? []).length ? `Lessons already extracted from the owner's caption edits: ${(userLessons ?? []).map((l) => l.value).join(' | ')}` : ''
    ].filter(Boolean);
    if (!lines.length) return 0;

    const parsed = await structured<{ insights?: Array<{ key: string; value: string; category: MemoryCategory; confidence: number }> }>(
      `You are Anomalia's weekly retrospective for one brand's AI content system. Below is what actually happened over the last two weeks. Extract 0-3 GENERALIZABLE operating lessons the content pipeline should apply from now on — recurring quality failures to prevent, radar-filter calibrations, voice rules the owner's behaviour implies. Skip anything one-off. Reuse stable keys so repeated lessons reinforce.\n\n${lines.join('\n')}\n\nReturn JSON.`,
      REFLECTION_SCHEMA,
      'You distill operational retrospectives into terse, actionable rules. No filler; an empty list is a valid answer.'
    );

    let count = 0;
    for (const item of (parsed.insights ?? []).slice(0, 3)) {
      if (!item?.key || !item?.value || (item.confidence ?? 0) < 0.5) continue;
      await writeMemory(supabase, brandId, {
        key: item.key,
        value: item.value,
        category: item.category,
        confidence: Math.min(1, Math.max(0.6, item.confidence ?? 0.6)),
        source: 'analysis',
        layer: 'project'
      });
      count++;
    }
    return count;
  } catch (e) {
    console.error('[weekly-reflection] failed:', e instanceof Error ? e.message : e);
    return 0;
  }
}

// ─── Main function ─────────────────────────────────────────────────────────

export async function generateWeeklyRecap(
  supabase: SupabaseClient,
  brandId: string,
  outputLanguage?: string
): Promise<WeeklyRecap | null> {
  return withBrandContext(brandId, () => generateWeeklyRecapInner(supabase, brandId, outputLanguage));
}

async function generateWeeklyRecapInner(
  supabase: SupabaseClient,
  brandId: string,
  outputLanguage?: string
): Promise<WeeklyRecap | null> {
  // Sync fresh data from Zernio + scrapecreators
  const { data: brand } = await supabase
    .from('brands')
    .select('id, zernio_profile_id')
    .eq('id', brandId)
    .single();

  if (!brand) return null;

  await Promise.allSettled([
    syncZernioAnalytics(supabase, { id: brand.id, zernio_profile_id: brand.zernio_profile_id }),
    ensureBrandHistory(supabase, brandId),
  ]);

  // Gather all recap data
  const data = await gatherRecapData(supabase, brandId);

  // Growth readiness — same gate as /plan produce; surface gaps in the Monday email.
  let growth: GrowthReadiness | null = null;
  try {
    growth = await loadGrowthReadiness(supabase, brandId);
  } catch (e) {
    console.warn('[weekly-recap] growth readiness failed:', e instanceof Error ? e.message : e);
  }

  // Get brand context for trends
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('about, category, target_audience')
    .eq('brand_id', brandId)
    .single();

  const brandContext = [kit?.about, kit?.category, kit?.target_audience].filter(Boolean).join('. ');

  // Enrich with structured memory (constraints, preferences, insights from chat/research)
  const memoryContext = await buildMemoryContext(supabase, brandId);
  const enrichedContext = memoryContext ? `${brandContext}\n\n${memoryContext}` : brandContext;

  // Generate AI content in parallel
  const [trends, suggestions] = await Promise.allSettled([
    generateTrends(data.brandName, enrichedContext, outputLanguage),
    generateSuggestions(data, outputLanguage),
  ]);

  const trendResults = trends.status === 'fulfilled' ? trends.value : [];

  // Enrich trends with OG images from source URLs (best-effort, parallel)
  const enrichedTrends = await Promise.all(
    trendResults.map(async (t) => {
      if (!t.sourceUrl) return t;
      const imageUrl = await fetchAndHostOgImage(supabase, t.sourceUrl);
      return { ...t, imageUrl: imageUrl ?? undefined };
    })
  );

  return {
    ...data,
    growth,
    trends: enrichedTrends,
    suggestions: suggestions.status === 'fulfilled' ? suggestions.value : [],
    actionItems: buildActionItems(data, outputLanguage === 'Italian' ? 'it' : 'en', growth),
  };
}
