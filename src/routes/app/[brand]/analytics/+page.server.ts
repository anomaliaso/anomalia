import { swallow } from '$lib/server/swallow';
import type { PageServerLoad } from './$types';
import { ensureBrandHistory } from '$lib/server/scrapecreators';
import { createAdminClient } from '$lib/server/supabase-admin';
import { syncZernioAnalytics } from '$lib/server/zernio';
import { signKnowledgePaths } from '$lib/server/media-archive';
import {
  aggregateRecentEngagement,
  dedupeSocialHistory,
  historyDedupeKey,
  metricNum,
  type SocialHistoryRow
} from '$lib/server/social-history-metrics';
import { loadMediaReviewStats } from '$lib/server/media-review-stats';
import { cachedBrandPage } from '$lib/server/page-cache';

const HERO_SPARK_DAYS = 14;

// Real analytics from social_post_history (scrapecreators organic scrape + Zernio publish
// analytics synced by the autopilot flywheel). We do not invent engagement — zeros mean the
// platform did not report that metric (e.g. Instagram scrapecreators has likes but no views).

const ZERNIO_ANALYTICS_STALE_MS = 6 * 60 * 60 * 1000;

export type UpcomingPost = {
  id: string;
  platform: string | null;
  caption: string | null;
  scheduled_for_formatted: string;
  slot: string | null;
  media_url: string | null;
};

export type ActivityLog = {
  id: string;
  post_id: string | null;
  platform: string | null;
  status: string;
  caption: string | null;
  media_url: string | null;
  created_at: string;
  created_at_formatted: string;
  error: string | null;
};

// Format an ISO UTC instant as a short "Mon, 09:45" in the brand's timezone. Native Intl
// only — mirrors the no-date-library approach of src/lib/server/schedule.ts.
function formatInZone(iso: string | null, tz: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
}

// Short calendar date ("4 Jun 2026") for organic history posts.
function formatDate(iso: string | null, tz: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(d);
}

// The engagement metrics we aggregate across platforms. Each platform exposes a subset
// (e.g. YouTube only views), so a 0 total simply means that platform doesn't report it.
const METRIC_KEYS = ['views', 'likes', 'comments', 'shares'] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

export type SocialPerformance = {
  platform: string;
  posts: number;
  totals: Record<MetricKey, number>;
};

export type TopPost = {
  id: string;
  platform: string;
  caption: string | null;
  thumbnail_url: string | null;
  url: string | null;
  published_formatted: string;
  metrics: Partial<Record<MetricKey, number>>;
};

export type BlogArticleViews = {
  id: string;
  title: string;
  slug: string;
  total: number;
  last7: number;
};

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const tz = brand.timezone;

    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Round 1 — independent reads fired together, plus history refresh so it overlaps DB work.
    const [
      // Posts overview: status + platform counts straight from our plan/posts table.
      { data: posts },
      // Upcoming scheduled posts in the next 7 days, soonest first, shown in brand timezone.
      { data: upcomingRows },
      // Recent publish activity: last 8 publish events, joined to their post for caption/thumb.
      { data: activityRows },
      { count: products },
      { count: accounts },
      { data: brandMeta },
      { data: lastZernioSync },
      _historyEnsured,
      mediaReviews
    ] = await Promise.all([
      supabase.from('posts').select('platform, status').eq('brand_id', brand.id),
      supabase
        .from('posts')
        .select('id, platform, caption, slot, media_url, scheduled_for')
        .eq('brand_id', brand.id)
        .eq('status', 'scheduled')
        .gte('scheduled_for', now.toISOString())
        .lte('scheduled_for', weekAhead.toISOString())
        .order('scheduled_for', { ascending: true }),
      supabase
        .from('publish_logs')
        .select('id, post_id, platform, status, error, created_at, posts ( caption, media_url )')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brand.id),
      supabase
        .from('social_accounts')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brand.id)
        .eq('status', 'active'),
      supabase.from('brands').select('zernio_profile_id').eq('id', brand.id).maybeSingle(),
      supabase
        .from('social_post_history')
        .select('synced_at')
        .eq('brand_id', brand.id)
        .eq('source', 'zernio')
        .order('synced_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      // Self-healing: brands whose handles were declared but never materialized (pre-strategy-era)
      // get their history pulled in on first visit — cache-first, so usually instant; without this
      // the organic section sat empty for brands with perfectly healthy socials. Must complete
      // BEFORE the social_post_history read below.
      ensureBrandHistory(supabase, brand.id, 1),
      loadMediaReviewStats(supabase, brand.id, { withCaptions: true })
    ]);

    // Soft-refresh Zernio publish analytics when stale so likes/views on Anomalia-published posts
    // are not frozen until the next autopilot run. Best-effort — never blocks the page on failure.
    const zernioProfileId = brandMeta?.zernio_profile_id ?? null;
    const lastSyncMs = lastZernioSync?.synced_at ? new Date(lastZernioSync.synced_at).getTime() : 0;
    if (zernioProfileId && Date.now() - lastSyncMs > ZERNIO_ANALYTICS_STALE_MS) {
      await syncZernioAnalytics(supabase, { id: brand.id, zernio_profile_id: zernioProfileId }).catch((error) => { swallow('sync zernio analytics', error); return 0; });
    }

    const list = posts ?? [];
    const count = (s: string) => list.filter((p) => p.status === s).length;

    const platforms: Record<string, number> = {};
    for (const p of list) {
      const k = (p.platform ?? 'other').toLowerCase();
      platforms[k] = (platforms[k] ?? 0) + 1;
    }

    const upcomingPosts: UpcomingPost[] = (upcomingRows ?? []).map((p) => ({
      id: p.id,
      platform: p.platform,
      caption: p.caption,
      scheduled_for_formatted: formatInZone(p.scheduled_for, tz),
      slot: p.slot,
      media_url: p.media_url
    }));

    const recentActivity: ActivityLog[] = (activityRows ?? []).map((r) => {
      // PostgREST returns the embedded relation as object or array depending on cardinality;
      // normalise to a single post record.
      const rel = (r as { posts?: unknown }).posts;
      const post = (Array.isArray(rel) ? rel[0] : rel) as
        | { caption: string | null; media_url: string | null }
        | undefined;
      const status = (r.status ?? 'unknown').toLowerCase();
      return {
        id: r.id,
        post_id: r.post_id,
        platform: r.platform,
        status,
        caption: post?.caption ?? null,
        media_url: post?.media_url ?? null,
        created_at: r.created_at,
        created_at_formatted: formatInZone(r.created_at, tz),
        // error only matters when something failed; otherwise keep it null for a clean UI.
        error: status === 'failed' ? (r.error ?? null) : null
      };
    });

    // Per-social engagement, from the organic post history we scrape into social_post_history
    // (likes/views/comments/shares). Zernio analytics are synced into this table via
    // syncZernioAnalytics; scrapecreators fills pre-connection history.
    // ensureBrandHistory runs in round 1 above so a fresh materialization is visible here.
    // Deduped: the same post often exists under both sources with different external ids.
    const { data: historyRows } = await supabase
      .from('social_post_history')
      .select(
        'id, source, platform, content, thumbnail_url, thumbnail_path, platform_post_url, published_at, metrics, synced_at'
      )
      .eq('brand_id', brand.id);

    let statsUpdatedAt: string | null = null;
    for (const r of historyRows ?? []) {
      const s = r.synced_at ? String(r.synced_at) : null;
      if (s && (!statsUpdatedAt || s > statsUpdatedAt)) statsUpdatedAt = s;
    }

    const statsByPlatform = new Map<string, SocialPerformance>();
    const scored: { post: TopPost; score: number; thumbnail_path: string | null }[] = [];
    for (const r of dedupeSocialHistory((historyRows ?? []) as SocialHistoryRow[])) {
      const k = (r.platform ?? 'other').toLowerCase();
      let s = statsByPlatform.get(k);
      if (!s) {
        s = { platform: k, posts: 0, totals: { views: 0, likes: 0, comments: 0, shares: 0 } };
        statsByPlatform.set(k, s);
      }
      s.posts += 1;
      const m = (r.metrics ?? {}) as Record<string, unknown>;
      const present: Partial<Record<MetricKey, number>> = {};
      for (const key of METRIC_KEYS) {
        const v = metricNum(m[key]);
        s.totals[key] += v;
        if (v > 0) present[key] = v;
      }
      // Rank by weighted engagement — direct interactions count more than raw views.
      const score =
        (present.likes ?? 0) +
        (present.comments ?? 0) * 2 +
        (present.shares ?? 0) * 3 +
        (present.views ?? 0) * 0.01;
      scored.push({
        score,
        thumbnail_path: r.thumbnail_path ? String(r.thumbnail_path) : null,
        post: {
          id: String(r.id ?? historyDedupeKey(r)),
          platform: k,
          caption: r.content ?? null,
          thumbnail_url: r.thumbnail_url ?? null,
          url: r.platform_post_url ?? null,
          published_formatted: formatDate(r.published_at ?? null, tz),
          metrics: present
        }
      });
    }
    // Engagement series for the page hero charts (publish-day buckets — metrics are snapshots).
    const engagementAgg = aggregateRecentEngagement((historyRows ?? []) as SocialHistoryRow[], {
      sparkDays: HERO_SPARK_DAYS,
      now
    });

    // Blog article views, from the anonymous beacon counters (article_views — service-role only,
    // so read with the admin client, scoped to this brand's published articles).
    const { data: pubArts } = await supabase
      .from('brand_articles')
      .select('id, title, slug')
      .eq('brand_id', brand.id)
      .eq('status', 'published');
    let blogViews: BlogArticleViews[] = [];
    const blogViewsByDay = Array.from({ length: HERO_SPARK_DAYS }, () => 0);
    if (pubArts?.length) {
      const { data: viewRows } = await createAdminClient()
        .from('article_views')
        .select('article_id, day, count')
        .in('article_id', pubArts.map((a) => a.id));
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const dayKeys = Array.from({ length: HERO_SPARK_DAYS }, (_, i) => {
        const d = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (HERO_SPARK_DAYS - 1 - i))
        );
        return d.toISOString().slice(0, 10);
      });
      const dayIndex = new Map(dayKeys.map((k, i) => [k, i]));
      const byArticle = new Map<string, { total: number; last7: number }>();
      for (const v of viewRows ?? []) {
        const agg = byArticle.get(v.article_id) ?? { total: 0, last7: 0 };
        agg.total += v.count;
        if (v.day >= weekAgo) agg.last7 += v.count;
        byArticle.set(v.article_id, agg);
        const idx = dayIndex.get(v.day);
        if (idx != null) blogViewsByDay[idx] += v.count;
      }
      blogViews = pubArts
        .map((a) => ({ id: a.id, title: a.title, slug: a.slug, ...(byArticle.get(a.id) ?? { total: 0, last7: 0 }) }))
        .sort((a, b) => b.total - a.total);
    }

    const socialPerformance = [...statsByPlatform.values()].sort((a, b) => b.posts - a.posts);
    const topScored = scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    // Prefer archived brand-knowledge thumbs (CDN links expire); fall back to posts.media_url
    // for Anomalia-published rows that never got a scrapecreators twin with a thumbnail.
    const thumbPaths = topScored.map((x) => x.thumbnail_path).filter((p): p is string => !!p);
    const signedThumbs = thumbPaths.length
      ? await signKnowledgePaths(supabase, thumbPaths).catch((error) => { swallow('sign media urls', error); return new Map<string, string>(); })
      : new Map<string, string>();

    const needPostMedia = topScored.some(
      (x) => !(x.thumbnail_path && signedThumbs.get(x.thumbnail_path)) && !x.post.thumbnail_url
    );
    const mediaByUrl = new Map<string, string>();
    if (needPostMedia) {
      const { data: postMedia } = await supabase
        .from('posts')
        .select('media_url, published_url')
        .eq('brand_id', brand.id)
        .not('media_url', 'is', null)
        .limit(120);
      for (const p of postMedia ?? []) {
        const url = p.published_url ? String(p.published_url).trim() : '';
        const media = p.media_url ? String(p.media_url).trim() : '';
        if (url && media) mediaByUrl.set(url, media);
      }
    }

    const topPosts = topScored.map((x) => {
      const signed = x.thumbnail_path ? signedThumbs.get(x.thumbnail_path) : undefined;
      const fromPost = x.post.url ? mediaByUrl.get(x.post.url) : undefined;
      return {
        ...x.post,
        thumbnail_url: signed ?? x.post.thumbnail_url ?? fromPost ?? null
      };
    });

    let paid: {
      totals: { spend: number; impressions: number; clicks: number; active: number; proposed: number };
      campaigns: {
        id: string;
        name: string;
        status: string;
        platform: string;
        spend: number;
        /** Why the numbers moved — see `ads-fatigue.ts`. Null until there is enough history. */
        fatigue: { id: string; label: string; action: string } | null;
      }[];
    } | null = null;
    try {
      const { adsAvailable, getPaidSummary } = await import('$lib/server/ads');
      if (adsAvailable(brand.plan)) {
        const summary = await getPaidSummary(supabase, brand.id);
        paid = {
          totals: summary.totals,
          campaigns: summary.campaigns.slice(0, 5).map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            platform: c.platform,
            spend: Number(c.metrics?.spend) || 0,
            // Only surface a diagnosis that says something. 'healthy' and 'insufficient_data' are
            // correct answers but they are not news, and a badge on every row trains people to
            // ignore the badge.
            fatigue:
              c.fatigue && c.fatigue.id !== 'healthy' && c.fatigue.id !== 'insufficient_data'
                ? { id: c.fatigue.id, label: c.fatigue.label, action: c.fatigue.action }
                : null
          }))
        };
      }
    } catch {
      paid = null;
    }

    return {
      total: list.length,
      scheduled: count('scheduled'),
      pending: count('pending_user'),
      failed: count('failed'),
      platforms: Object.entries(platforms).sort((a, b) => b[1] - a[1]),
      upcomingPosts,
      recentActivity,
      socialPerformance,
      topPosts,
      blogViews,
      blogViewsByDay,
      engagement: {
        viewsByDay: engagementAgg.viewsByDay,
        likesByDay: engagementAgg.likesByDay,
        viewsPeriod: engagementAgg.viewsByDay.reduce((n, v) => n + v, 0),
        likesPeriod: engagementAgg.likesByDay.reduce((n, v) => n + v, 0),
        comments: engagementAgg.comments,
        shares: engagementAgg.shares,
        sparkDays: HERO_SPARK_DAYS
      },
      products: products ?? 0,
      accounts: accounts ?? 0,
      paid,
      statsUpdatedAt,
      mediaReviews
    };
  });
};
