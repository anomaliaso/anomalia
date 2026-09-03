/**
 * Shared query functions for CLI API endpoints.
 * These can also be reused by +page.server.ts files to avoid duplication.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { redactJson } from '$lib/server/redact';

// ── Brand list ──────────────────────────────────────────────────────────

/** `onlyIds` scopes the list for API-key auth (service-role client, no RLS); null = RLS-scoped client. */
export async function getBrandsList(supabase: SupabaseClient, onlyIds: string[] | null = null) {
  if (onlyIds && !onlyIds.length) return [];
  let q = supabase
    .from('brands')
    .select('id, name, slug, plan, status, autopilot_enabled, autopilot_failure_count, last_autopilot_run_at, timezone');
  if (onlyIds) q = q.in('id', onlyIds);
  const { data: brands } = await q.order('name');

  if (!brands?.length) return [];

  const ids = brands.map(b => b.id);
  const { data: posts } = await supabase
    .from('posts').select('brand_id').in('brand_id', ids).eq('status', 'pending_user');

  const pendingCounts = new Map<string, number>();
  for (const p of posts ?? []) pendingCounts.set(p.brand_id, (pendingCounts.get(p.brand_id) ?? 0) + 1);

  return brands.map(b => ({
    ...b,
    pendingCount: pendingCounts.get(b.id) ?? 0,
  }));
}

// ── Brand detail ────────────────────────────────────────────────────────

export async function getBrandDetail(supabase: SupabaseClient, brandId: string) {
  const [pendingRes, runsRes, planRes, productsRes, accountsRes, postsStatusRes, gtmRes, contentPlansRes, historyRes, kitRes] = await Promise.all([
    supabase.from('posts').select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId).eq('status', 'pending_user'),
    supabase.from('scheduler_runs').select('status, posts_created, created_at, error')
      .eq('brand_id', brandId).order('created_at', { ascending: false }).limit(3),
    supabase.from('editorial_plans').select('id, status, cadence, weeks')
      .eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
    supabase.from('products').select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
    supabase.from('social_accounts').select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
    supabase.from('posts').select('status').eq('brand_id', brandId),
    supabase.from('gtm_plans').select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId).eq('status', 'active'),
    supabase.from('content_plans').select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
    supabase.from('social_post_history').select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
    supabase.from('brand_kit').select('about, brand_colors, logos, favicon_url')
      .eq('brand_id', brandId).maybeSingle(),
  ]);

  const statusCounts = new Map<string, number>();
  for (const row of postsStatusRes.data ?? []) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  }

  const kit = kitRes.data;
  const logos = (kit?.logos as Array<{ url?: string }> | null) ?? null;
  const logoUrl = logos?.find(l => l?.url)?.url ?? kit?.favicon_url ?? null;

  return {
    pendingCount: pendingRes.count ?? 0,
    runs: runsRes.data ?? [],
    plan: planRes.data,
    productCount: productsRes.count ?? 0,
    accountCount: accountsRes.count ?? 0,
    scheduledCount: statusCounts.get('scheduled') ?? 0,
    publishedCount: statusCounts.get('published') ?? 0,
    hasGtm: (gtmRes.count ?? 0) > 0,
    hasContentPlans: (contentPlansRes.count ?? 0) > 0,
    hasHistory: (historyRes.count ?? 0) > 0,
    kit: kit ? { about: kit.about, brand_colors: kit.brand_colors } : null,
    logoUrl,
  };
}

// ── Posts ───────────────────────────────────────────────────────────────

export async function getPosts(supabase: SupabaseClient, brandId: string, status?: string) {
  let query = supabase
    .from('posts')
    .select('id, brand_id, platform, platforms, caption, image_prompt, slot, media_url, status, content_type, scheduled_for, published_url, product_name, revisions_count, pillar, format, created_at')
    .eq('brand_id', brandId);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data } = await query.order('created_at', { ascending: false }).limit(50);
  return data ?? [];
}

// ── Editorial plan ──────────────────────────────────────────────────────

export async function getEditorialPlan(supabase: SupabaseClient, brandId: string) {
  const [activeRes, proposedRes, usageRes] = await Promise.all([
    supabase.from('editorial_plans')
      .select('id, status, strategy, voice, cadence, platform_mix, gtm, weeks, parent_id, revision_feedback, changes_summary, source, created_at, activated_at')
      .eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
    supabase.from('editorial_plans')
      .select('id, status, strategy, voice, cadence, platform_mix, gtm, weeks, parent_id, revision_feedback, changes_summary, source, created_at, activated_at')
      .eq('brand_id', brandId).eq('status', 'proposed')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('brand_usage').select('posts_count')
      .eq('brand_id', brandId).order('month', { ascending: false }).limit(1),
  ]);

  const usage = usageRes.data?.[0];
  const plan = activeRes.data;

  // Compute current week index + posts quota (single brands fetch)
  let currentWeek: number | null = null;
  const { data: brandMeta } = await supabase.from('brands').select('timezone, plan').eq('id', brandId).maybeSingle();
  if (plan?.weeks && brandMeta) {
    try {
      const { currentWeekIndex } = await import('$lib/server/editorial-plan');
      currentWeek = currentWeekIndex(plan as any, brandMeta.timezone);
    } catch (error) { swallow('compute current editorial week', error); }
  }

  const postsQuota = await import('$lib/server/plans').then((m) => m.postQuota(brandMeta?.plan));

  return {
    plan: activeRes.data,
    proposed: proposedRes.data,
    proposedFeedback: proposedRes.data?.revision_feedback ?? null,
    currentWeek,
    quota: {
      used: usage?.posts_count ?? 0,
      remaining: Math.max(postsQuota - (usage?.posts_count ?? 0), 0),
    },
  };
}

// ── Weekly plan ─────────────────────────────────────────────────────────

export async function getWeeklyPlan(supabase: SupabaseClient, brandId: string, brandTimezone: string, brandPlan: string | null) {
  const [planRes, contentPlansRes, postsRes, usageRes] = await Promise.all([
    supabase.from('editorial_plans').select('status, cadence, weeks, platform_mix, strategy')
      .eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
    supabase.from('content_plans').select('id, title, seeds, editorial_week, status, editorial_plan_id')
      .eq('brand_id', brandId).order('created_at', { ascending: false }).limit(5),
    supabase.from('posts').select('id, platform, platforms, caption, status, slot, scheduled_for, published_at, pillar, format, content_type, plan_id')
      .eq('brand_id', brandId)
      .in('status', ['pending_user', 'approved', 'scheduled', 'published', 'failed'])
      .order('slot', { ascending: true, nullsFirst: false }).limit(50),
    supabase.from('brand_usage').select('posts_count, videos_count')
      .eq('brand_id', brandId).order('month', { ascending: false }).limit(1),
  ]);

  const plan = planRes.data;
  const contentPlans = contentPlansRes.data ?? [];
  const posts = postsRes.data ?? [];
  const usage = usageRes.data?.[0];

  let currentWeekIdx: number | null = null;
  if (plan) {
    try {
      const { currentWeekIndex } = await import('$lib/server/editorial-plan');
      currentWeekIdx = currentWeekIndex(plan as any, brandTimezone);
    } catch (error) { swallow('compute current editorial week', error); }
  }

  const weeks = (plan?.weeks ?? []) as Record<string, unknown>[];
  const activeContentPlan = contentPlans.find(cp => cp.status === 'draft');
  const quotaMax = brandPlan === 'pro' ? 30 : 12;

  return {
    plan: plan ? {
      cadence: plan.cadence,
      weeks: weeks.map((w, i) => ({
        index: i,
        theme: String(w.theme ?? w.title ?? ''),
        status: String(w.status ?? 'planned'),
      })),
      platform_mix: plan.platform_mix,
      strategy: plan.strategy,
    } : null,
    currentWeekIdx,
    posts: posts.map(p => ({
      id: p.id,
      platform: p.platform,
      caption: p.caption,
      status: p.status,
      slot: p.slot,
      scheduled_for: p.scheduled_for,
      pillar: p.pillar,
      format: p.format,
    })),
    seeds: activeContentPlan ? {
      id: activeContentPlan.id,
      seeds: activeContentPlan.seeds,
      editorial_week: activeContentPlan.editorial_week,
    } : null,
    quota: {
      used: usage?.posts_count ?? 0,
      max: quotaMax,
    },
  };
}

// ── GTM ─────────────────────────────────────────────────────────────────

export async function getGtm(supabase: SupabaseClient, brandId: string) {
  const [activeRes, proposedRes] = await Promise.all([
    supabase.from('gtm_plans')
      .select('id, status, horizon, objective, phases, parent_id, revision_feedback, reply, changes_summary, source, created_at, activated_at')
      .eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
    supabase.from('gtm_plans')
      .select('id, status, horizon, objective, phases, parent_id, revision_feedback, reply, changes_summary, source, created_at, activated_at')
      .eq('brand_id', brandId).eq('status', 'proposed')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const now = new Date();
  const gtm = activeRes.data;
  const phases = (gtm?.phases ?? []) as Record<string, unknown>[];

  // Compute phase statuses
  const phaseStatuses = phases.map((ph) => {
    const sd = ph.start_date ? new Date(ph.start_date as string) : null;
    const ed = ph.end_date ? new Date(ph.end_date as string) : null;
    if (ed && ed < now) return 'done' as const;
    if (sd && sd <= now && (!ed || ed >= now)) return 'now' as const;
    return 'next' as const;
  });

  const currentPhase = phaseStatuses.findIndex(s => s === 'now');

  // Studio completeness
  const [kitRes, prodRes, histRes, docsRes] = await Promise.all([
    supabase.from('brand_kit').select('about, target_audience, logos, brand_colors, ai_character').eq('brand_id', brandId).maybeSingle(),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('social_post_history').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('brand_documents').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
  ]);
  const kit = kitRes.data;
  const checks = [
    (prodRes.count ?? 0) > 0,
    (histRes.count ?? 0) > 0,
    !!kit?.ai_character,
    !!kit?.about,
    !!kit?.target_audience,
    !!(kit?.logos as unknown[])?.length,
    !!kit?.brand_colors,
    (docsRes.count ?? 0) > 0,
  ];
  const studioPct = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return {
    gtm: activeRes.data,
    proposed: proposedRes.data,
    proposedFeedback: proposedRes.data?.revision_feedback ?? null,
    currentPhase: currentPhase >= 0 ? currentPhase : null,
    phaseStatuses,
    horizons: ['90d', '6m', '1y', '2y'] as const,
    studioPct,
  };
}

// ── Analytics ───────────────────────────────────────────────────────────

export async function getAnalytics(supabase: SupabaseClient, brandId: string, brandTimezone: string) {
  const [postsRes, upcomingRes, logsRes, historyRes, productsRes, accountsRes] = await Promise.all([
    supabase.from('posts').select('platform, status').eq('brand_id', brandId),
    supabase.from('posts').select('id, platform, caption, slot, media_url, scheduled_for')
      .eq('brand_id', brandId).eq('status', 'scheduled')
      .gte('scheduled_for', new Date().toISOString())
      .lte('scheduled_for', new Date(Date.now() + 7 * 86400000).toISOString())
      .order('scheduled_for', { ascending: true }).limit(10),
    supabase.from('publish_logs')
      .select('id, post_id, platform, status, error, created_at, posts ( caption, media_url )')
      .eq('brand_id', brandId).order('created_at', { ascending: false }).limit(8),
    supabase.from('social_post_history')
      .select('id, platform, content, thumbnail_url, platform_post_url, published_at, metrics')
      .eq('brand_id', brandId).order('published_at', { ascending: false }).limit(200),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('social_accounts').select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId).eq('status', 'active'),
  ]);

  // Status counts
  const statusCounts = new Map<string, number>();
  for (const row of postsRes.data ?? []) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);

  // Platform counts
  const platformCounts = new Map<string, number>();
  for (const row of postsRes.data ?? []) {
    if (row.platform) platformCounts.set(row.platform, (platformCounts.get(row.platform) ?? 0) + 1);
  }

  // Social performance per platform
  const byPlat = new Map<string, { views: number; likes: number; comments: number; shares: number; count: number }>();
  for (const p of historyRes.data ?? []) {
    const m = (p.metrics ?? {}) as Record<string, number>;
    const cur = byPlat.get(p.platform ?? '') ?? { views: 0, likes: 0, comments: 0, shares: 0, count: 0 };
    byPlat.set(p.platform ?? '', {
      views: cur.views + (m.views ?? 0),
      likes: cur.likes + (m.likes ?? 0),
      comments: cur.comments + (m.comments ?? 0),
      shares: cur.shares + (m.shares ?? 0),
      count: cur.count + 1,
    });
  }

  // Top posts by weighted engagement
  const topPosts = [...(historyRes.data ?? [])]
    .map(p => {
      const m = (p.metrics ?? {}) as Record<string, number>;
      return {
        id: p.id,
        platform: p.platform,
        content: p.content,
        thumbnail_url: p.thumbnail_url,
        url: p.platform_post_url,
        published_at: p.published_at,
        metrics: m,
        score: (m.likes ?? 0) + (m.comments ?? 0) * 2 + (m.shares ?? 0) * 3 + (m.views ?? 0) * 0.01,
      };
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return {
    total: (postsRes.data ?? []).length,
    scheduled: statusCounts.get('scheduled') ?? 0,
    pending: statusCounts.get('pending_user') ?? 0,
    failed: statusCounts.get('failed') ?? 0,
    platforms: [...platformCounts.entries()].sort((a, b) => b[1] - a[1]),
    upcomingPosts: (upcomingRes.data ?? []).map(p => ({
      id: p.id,
      platform: p.platform,
      caption: p.caption,
      scheduled_for: p.scheduled_for,
      slot: p.slot,
    })),
    recentActivity: (logsRes.data ?? []).map(l => ({
      id: l.id,
      post_id: l.post_id,
      platform: l.platform,
      status: l.status,
      caption: (l.posts as any)?.caption ?? null,
      error: l.error,
      created_at: l.created_at,
    })),
    socialPerformance: [...byPlat.entries()].map(([platform, d]) => ({
      platform,
      posts: d.count,
      totals: { views: d.views, likes: d.likes, comments: d.comments, shares: d.shares },
    })).sort((a, b) => b.posts - a.posts),
    topPosts: topPosts.map(p => ({
      id: p.id,
      platform: p.platform,
      caption: p.content,
      thumbnail_url: p.thumbnail_url,
      url: p.url,
      published_at: p.published_at,
      metrics: p.metrics,
    })),
    products: productsRes.count ?? 0,
    accounts: accountsRes.count ?? 0,
  };
}

// ── Studio ──────────────────────────────────────────────────────────────

export async function getStudio(supabase: SupabaseClient, brandId: string) {
  const [kitRes, productsRes, docsRes, historyRes, competitorsRes, brandRes, peopleRes] = await Promise.all([
    supabase.from('brand_kit').select('category, about, brand_style, target_audience, brand_colors, theme_color, favicon_url, fonts, logos, ai_character, ai_context, ai_context_updated_at, visual_style, visual_style_locked, content_pillars, site_type, images')
      .eq('brand_id', brandId).maybeSingle(),
    supabase.from('products').select('id, title, pricing, images, featured')
      .eq('brand_id', brandId),
    supabase.from('brand_documents').select('id, kind, title, content_text, file_url, file_name, mime_type, created_at')
      .eq('brand_id', brandId),
    supabase.from('social_post_history').select('id, platform, content, thumbnail_url, platform_post_url, metrics, published_at')
      .eq('brand_id', brandId).limit(60),
    supabase.from('competitors').select('id, name, website, kind, rationale, source, created_at')
      .eq('brand_id', brandId),
    supabase.from('brands').select('content_prefs, target_platforms').eq('id', brandId).maybeSingle(),
    supabase.from('people').select('id, name, role, kind, description, images, consent, created_at')
      .eq('brand_id', brandId),
  ]);

  const kit = kitRes.data;
  const prefs = (brandRes.data?.content_prefs ?? {}) as Record<string, unknown>;

  // Completeness score
  const checks = [
    (productsRes.data?.length ?? 0) > 0,
    (historyRes.data?.length ?? 0) > 0,
    !!kit?.ai_character,
    !!kit?.about,
    !!kit?.target_audience,
    !!(kit?.logos as unknown[])?.length,
    !!kit?.brand_colors,
    (docsRes.data?.length ?? 0) > 0,
  ];
  const studioPct = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return {
    kit,
    products: productsRes.data ?? [],
    documents: docsRes.data ?? [],
    history: historyRes.data ?? [],
    people: (peopleRes.data ?? []).map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      kind: p.kind,
      description: p.description,
      consent: p.consent,
      imageCount: Array.isArray(p.images) ? p.images.length : 0,
    })),
    competitors: competitorsRes.data ?? [],
    targetPlatforms: (brandRes.data?.target_platforms as string[]) ?? [],
    platformInstructions: (prefs.platformInstructions as Record<string, string>) ?? {},
    language: String(prefs.language ?? ''),
    studioPct,
  };
}

// ── Voice ───────────────────────────────────────────────────────────────

export async function getVoice(supabase: SupabaseClient, brandId: string) {
  const { data: brand } = await supabase
    .from('brands').select('target_platforms, content_prefs').eq('id', brandId).maybeSingle();

  const prefs = (brand?.content_prefs ?? {}) as Record<string, unknown>;

  // Studio completeness
  const [kitRes, prodRes, histRes, docsRes] = await Promise.all([
    supabase.from('brand_kit').select('ai_character').eq('brand_id', brandId).maybeSingle(),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('social_post_history').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('brand_documents').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
  ]);
  const checks = [
    (prodRes.count ?? 0) > 0, (histRes.count ?? 0) > 0, !!kitRes.data?.ai_character,
    false, false, false, false, (docsRes.count ?? 0) > 0,
  ];
  const studioPct = Math.round((checks.filter(Boolean).length / 8) * 100);

  return {
    platforms: (brand?.target_platforms as string[]) ?? [],
    voiceMode: String(prefs.voiceMode ?? 'auto'),
    voiceFramework: (prefs.voiceFramework ?? {}) as Record<string, unknown>,
    platformRules: (prefs.platformRules ?? {}) as Record<string, Record<string, unknown>>,
    avoid: Array.isArray(prefs.avoid) ? prefs.avoid : typeof prefs.avoid === 'string' ? prefs.avoid.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
    platformInstructions: (prefs.platformInstructions ?? {}) as Record<string, string>,
    studioPct,
  };
}

// ── Calendar ────────────────────────────────────────────────────────────

export async function getCalendar(supabase: SupabaseClient, brandId: string, brandTimezone: string, year: number, month: number, brandLanguage: string | null = null) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startStr = firstDay.toISOString().slice(0, 10);
  const endStr = lastDay.toISOString().slice(0, 10);

  const [schedRes, slotRes, draftRes] = await Promise.all([
    supabase.from('posts')
      .select('id, platform, caption, media_url, scheduled_for, status, slot')
      .eq('brand_id', brandId)
      .not('scheduled_for', 'is', null)
      .gte('scheduled_for', `${startStr}T00:00:00`).lte('scheduled_for', `${endStr}T23:59:59`)
      .order('scheduled_for', { ascending: true }).limit(100),
    supabase.from('posts')
      .select('id, platform, caption, media_url, scheduled_for, status, slot')
      .eq('brand_id', brandId).not('status', 'eq', 'pending_user')
      .not('slot', 'is', null)
      .gte('slot', startStr).lte('slot', endStr)
      .order('slot', { ascending: true }).limit(100),
    supabase.from('posts')
      .select('id, platform, caption, media_url, scheduled_for, status, slot')
      .eq('brand_id', brandId).eq('status', 'pending_user')
      .is('scheduled_for', null)
      .limit(50),
  ]);

  // Merge and deduplicate
  const allMap = new Map<string, Record<string, unknown>>();
  for (const p of schedRes.data ?? []) allMap.set(p.id, p as Record<string, unknown>);
  for (const p of slotRes.data ?? []) if (!allMap.has(p.id)) allMap.set(p.id, p as Record<string, unknown>);
  for (const p of draftRes.data ?? []) allMap.set(p.id, { ...p, isDraft: true } as Record<string, unknown>);

  const monthLabel = new Date(year, month - 1).toLocaleDateString(localeForLanguage(brandLanguage), { month: 'long', year: 'numeric' });

  const prevDate = new Date(year, month - 2, 1);
  const nextDate = new Date(year, month, 1);

  return {
    posts: [...allMap.values()],
    year,
    month,
    monthLabel,
    prevYM: `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`,
    nextYM: `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`,
    timezone: brandTimezone,
  };
}

/** Map a brand language (e.g. "it", "en-US") to a date-fns-style locale tag for toLocaleDateString. */
function localeForLanguage(language: string | null): string {
  const base = (language ?? '').split('-')[0].toLowerCase();
  const locales: Record<string, string> = {
    it: 'it-IT',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    pt: 'pt-PT'
  };
  return locales[base] ?? 'en-US';
}

// ── Approve ─────────────────────────────────────────────────────────────

export async function approvePost(supabase: SupabaseClient, brandId: string, postId: string, brandTimezone: string, actorId?: string) {
  const { data: post, error } = await supabase
    .from('posts').select('*').eq('id', postId).eq('brand_id', brandId).maybeSingle();
  if (error || !post) return { error: 'Post not found' };

  if (post.status !== 'pending_user') return { error: `Post is ${post.status}, not pending_user` };

  // Import publish logic dynamically
  const { publishApprovedPost } = await import('$lib/server/publish');
  try {
    const res = await publishApprovedPost(supabase, post, brandTimezone, { by: actorId });
    // Nothing scheduled but something failed → over-limit caption or Zernio rejection. Surface the
    // reason instead of a false "published" so the CLI/AI don't think it worked.
    if (res.scheduled === 0 && res.failed > 0) {
      return { error: res.error ?? 'Publish failed — the post did not meet platform requirements.' };
    }
    // Nothing scheduled and nothing failed → no connected account for the post's platform. The post
    // stays 'approved', waiting for the connection: reporting 'published' here is a false success
    // the CLI/AI would repeat back to the user.
    if (res.noAccount) {
      return { ok: true, status: 'approved', noAccount: true, message: 'Approved, but not scheduled: no connected account for this platform yet.' };
    }
    return { ok: true, status: 'published' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Publish failed' };
  }
}

export async function approveAllPosts(supabase: SupabaseClient, brandId: string, brandTimezone: string, actorId?: string) {
  // Never bulk-publish Director-flagged posts (needs_attention) — same rule as the token page.
  const { data: pending } = await supabase
    .from('posts').select('*').eq('brand_id', brandId).eq('status', 'pending_user')
    .or('needs_attention.is.null,needs_attention.eq.false')
    .order('slot', { ascending: true, nullsFirst: false });

  if (!pending?.length) return { results: [], message: 'No pending posts' };

  const { publishApprovedPost } = await import('$lib/server/publish');
  const results: { id: string; ok: boolean; error?: string; noAccount?: boolean }[] = [];

  for (const post of pending) {
    try {
      const res = await publishApprovedPost(supabase, post, brandTimezone, { by: actorId });
      if (res.scheduled === 0 && res.failed > 0) {
        results.push({ id: post.id, ok: false, error: res.error ?? 'Did not meet platform requirements' });
      } else {
        // Same rule as approvePost: approved but unscheduled (no connected account) is not a publish.
        results.push({ id: post.id, ok: true, ...(res.noAccount ? { noAccount: true } : {}) });
      }
    } catch (e) {
      results.push({ id: post.id, ok: false, error: e instanceof Error ? e.message : 'Failed' });
    }
  }

  return { results };
}

// ── SEO / GEO / Keywords / Web ──────────────────────────────────────────
// Same reads the /app/[brand]/{seo,geo,keywords,web} pages do, minus the UI shaping.

/** Latest audit row that actually has tech data — the newest run can be citation-only. */
function pickAudit<T extends { tech?: unknown }>(rows: T[] | null): T | null {
  return (rows ?? []).find((r) => r.tech != null) ?? rows?.[0] ?? null;
}

export async function getSeo(supabase: SupabaseClient, brandId: string) {
  const [{ data: auditRows }, { data: artifacts }, { data: seoPlan }] = await Promise.all([
    supabase.from('brand_geo_audits').select('tech_score, tech, search, backlinks, created_at')
      .eq('brand_id', brandId).order('created_at', { ascending: false }).limit(12),
    supabase.from('brand_geo_artifacts').select('id, kind, title, format, target_path, source_finding')
      .eq('brand_id', brandId).eq('status', 'draft').order('created_at', { ascending: false }),
    supabase.from('brand_seo_plans').select('grade, evaluation, initiatives, created_at')
      .eq('brand_id', brandId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  ]);

  // Assets are tagged source_finding 'seo:<initiativeId>'; keep the newest per initiative.
  const assets: Record<string, unknown> = {};
  for (const a of artifacts ?? []) {
    const sf = String(a.source_finding ?? '');
    if (sf.startsWith('seo:') && !assets[sf.slice(4)]) assets[sf.slice(4)] = a;
  }

  const { buildSeoMetrics } = await import('./seo-metrics');
  return {
    audit: pickAudit(auditRows),
    plan: seoPlan ?? null,
    assets,
    metrics: buildSeoMetrics(auditRows ?? [])
  };
}

export async function getGeo(supabase: SupabaseClient, brandId: string) {
  const [{ data: auditRows }, { data: artifacts }] = await Promise.all([
    supabase.from('brand_geo_audits')
      .select('tech_score, tech, share_of_voice, citations, ai_overview, created_at')
      .eq('brand_id', brandId).order('created_at', { ascending: false }).limit(8),
    supabase.from('brand_geo_artifacts').select('id, kind, title, format, target_path, source_finding')
      .eq('brand_id', brandId).eq('status', 'draft').order('created_at', { ascending: false })
  ]);

  const audit = pickAudit(auditRows);
  // The citability panel lives inside the jsonb `tech` column (it landed without a migration), but
  // a client should not have to know that: it is the number that answers "will a model cite us",
  // where `tech_score` answers the much narrower "can a crawler reach us". See `geo-levers.ts`.
  const citability = ((audit?.tech ?? {}) as { citability?: unknown }).citability ?? null;

  return {
    audit,
    citability,
    // A citation-only run has no ai_overview — falling back to `audit` would blank it.
    aiOverview: (auditRows ?? []).find((r) => r.ai_overview != null)?.ai_overview ?? null,
    trend: (auditRows ?? []).map((r) => ({ techScore: r.tech_score, shareOfVoice: r.share_of_voice, at: r.created_at })).reverse(),
    artifacts: (artifacts ?? []).filter((a) => !String(a.source_finding ?? '').startsWith('seo:'))
  };
}

export async function getKeywords(supabase: SupabaseClient, brandId: string) {
  const { data } = await supabase.from('brand_seo_keyword_strategy')
    .select('strategy, citations, updated_at').eq('brand_id', brandId).maybeSingle();
  const { normalizeStrategy } = await import('./seo-keyword-strategy');
  return {
    strategy: normalizeStrategy(data?.strategy as never),
    citations: data?.citations ?? [],
    updatedAt: data?.updated_at ?? null
  };
}

/** Anomalia network backlinks — placements + open opportunities. */
export async function getBacklinks(supabase: SupabaseClient, brandId: string) {
  const { loadBacklinkNetworkSummary } = await import('./backlink-network');
  return loadBacklinkNetworkSummary(supabase, brandId);
}

/** Blog articles — drafts INCLUDED (unlike the headless /articles endpoint, which is published-only). */
export async function getWeb(supabase: SupabaseClient, brandId: string, status?: string) {
  let q = supabase.from('brand_articles')
    .select('id, slug, title, meta_title, meta_description, status, scheduled_for, published_at, source_initiative_id, created_at')
    .eq('brand_id', brandId).order('created_at', { ascending: false });
  if (status && status !== 'all') q = q.eq('status', status);
  const { data } = await q;
  return { articles: data ?? [] };
}

// ── Usage / Quota ───────────────────────────────────────────────────────

export async function getUsage(supabase: SupabaseClient, brandId: string) {
  const { data } = await supabase
    .from('brand_usage').select('posts_count, videos_count')
    .eq('brand_id', brandId).order('month', { ascending: false }).limit(1);

  return {
    postsUsed: data?.[0]?.posts_count ?? 0,
    videosUsed: data?.[0]?.videos_count ?? 0,
  };
}

/**
 * `system_prompt` NON è nell'elenco, ed è deliberato: contiene i dati del brand, l'email
 * dell'utente e lo `stripe_customer_id`, arriva a 148.295 caratteri, e `renderRunTrace` non l'ha
 * mai reso. Non è una questione di redazione — è che non serve a capire una run.
 *
 * `viewer` è il perimetro: nessuna traccia è più pubblica della conversazione che trascrive, e
 * `agent_sessions` (a differenza di `chat_messages`) non ha una policy per utente. Omettendolo si
 * torna al comportamento vecchio, quindi i chiamanti lo passano sempre.
 */
export async function getAgentSession(
  supabase: SupabaseClient,
  brandId: string,
  id: string,
  viewer?: { userId: string; isOwner?: boolean }
) {
  let q = supabase
    .from('agent_sessions')
    .select(
      'id, brand_id, user_id, thread_id, job_id, agent, mode, surface, status, model, provider, transcript, events, event_count, error, format_version, created_at, updated_at, finished_at'
    )
    .eq('brand_id', brandId)
    .eq('id', id);
  if (viewer) {
    q = viewer.isOwner ? q.or(`user_id.eq.${viewer.userId},user_id.is.null`) : q.eq('user_id', viewer.userId);
  }
  const { data, error } = await q.maybeSingle();
  if (error) {
    console.warn('[cli-queries] agent_session', error.message);
    return null;
  }
  // Cintura in lettura: le righe scritte prima del 22/8/2026 non sono redatte alla scrittura.
  return data ? (redactJson(data, brandId) ?? null) : null;
}
