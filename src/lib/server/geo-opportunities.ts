// GEO closed loop — citation opportunities → apply (live URL) → multi-reprobe → causal win/loss.
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runCitationAudit, type CitationResult } from '$lib/server/geo';
import { isGeoPublishApplyEnabled, isGeoCausalWinEnabled } from '$lib/server/feature-flags';

type AnyRec = Record<string, unknown>;

/** Max reprobe attempts before marking lost. Schedule: day 3 / 7 / 14 from applied_at. */
export const GEO_REPROBE_MAX_ATTEMPTS = 3;
export const GEO_REPROBE_SCHEDULE_DAYS = [3, 7, 14] as const;

export function canApplyGeoLoop(plan: string | null | undefined): boolean {
  return plan === 'starter' || plan === 'pro' || plan === 'scale';
}

export { isGeoPublishApplyEnabled, isGeoCausalWinEnabled };

export type ReprobeLogEntry = {
  at: string;
  attempt: number;
  engine: string;
  mentioned: boolean;
  sources: string[];
  error?: string | null;
  targetCited: boolean;
};

export function hostOf(urlOrHost: string): string {
  const raw = String(urlOrHost ?? '').trim();
  if (!raw) return '';
  try {
    const withProto = raw.includes('://') ? raw : `https://${raw}`;
    return new URL(withProto).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return raw.replace(/^www\./i, '').toLowerCase();
  }
}

/** True when any cited source domain matches the target URL host and/or brand website host. */
export function sourceCitesTarget(
  sources: string[],
  targetUrl: string | null | undefined,
  brandHost: string | null | undefined
): boolean {
  const hosts = (sources ?? []).map(hostOf).filter(Boolean);
  if (!hosts.length) return false;

  const matchHost = (want: string | null | undefined) => {
    const h = want ? hostOf(want) : '';
    if (!h) return false;
    return hosts.some((s) => s === h || s.endsWith(`.${h}`) || h.endsWith(`.${s}`));
  };

  return matchHost(targetUrl) || matchHost(brandHost);
}

/**
 * Causal win: citation must implicate our published URL (or brand host) on an engine
 * that was missing at baseline — not merely “brand named somewhere later”.
 */
export function isCausalWin(opts: {
  baselineEngines: string[];
  results: Array<{
    engine: string;
    brandMentioned: boolean;
    sources: string[];
    error?: string | null;
  }>;
  targetUrl: string | null | undefined;
  brandHost: string | null | undefined;
}): { won: boolean; deferred: boolean; targetCited: boolean; mentionedOnBaseline: boolean } {
  const results = opts.results ?? [];
  const probed = results.filter((r) => !r.error);
  if (!results.length || probed.length === 0) {
    return { won: false, deferred: true, targetCited: false, mentionedOnBaseline: false };
  }

  const baseline = new Set((opts.baselineEngines ?? []).map(String).filter(Boolean));
  const onBaseline = (engine: string) => baseline.size === 0 || baseline.has(engine);
  const pool = probed.filter((r) => onBaseline(r.engine));
  const use = pool.length ? pool : probed;

  let targetCited = false;
  let mentionedOnBaseline = false;
  for (const r of use) {
    const citesTarget = sourceCitesTarget(r.sources, opts.targetUrl, null);
    const citesBrand = sourceCitesTarget(r.sources, null, opts.brandHost);
    if (citesTarget || citesBrand) targetCited = true;
    if (r.brandMentioned && onBaseline(r.engine)) mentionedOnBaseline = true;
  }

  // Preferred: target URL host appears in sources on a baseline-absent engine
  const preferred = use.some(
    (r) => onBaseline(r.engine) && sourceCitesTarget(r.sources, opts.targetUrl, null)
  );

  // Fallback: brand mentioned on baseline-absent engine AND (target or brand host) in sources
  const fallback =
    mentionedOnBaseline &&
    use.some(
      (r) =>
        r.brandMentioned &&
        onBaseline(r.engine) &&
        sourceCitesTarget(r.sources, opts.targetUrl, opts.brandHost)
    );

  return {
    won: preferred || fallback,
    deferred: false,
    targetCited,
    mentionedOnBaseline
  };
}

/** Open opportunities from a citation audit: prompts missing on ≥2 engines (or any if single engine). */
export async function openGeoOpportunities(
  admin: SupabaseClient,
  brandId: string,
  citations: CitationResult[],
  auditId?: string | null
): Promise<number> {
  const byPrompt = new Map<string, CitationResult[]>();
  for (const c of citations) {
    // Skip pure probe failures when opening — don't create opportunities from outages
    if (c.error) continue;
    const list = byPrompt.get(c.prompt) ?? [];
    list.push(c);
    byPrompt.set(c.prompt, list);
  }

  let opened = 0;
  for (const [prompt, rows] of byPrompt) {
    const absent = rows.filter((r) => !r.brandMentioned);
    const threshold = rows.length >= 2 ? 2 : 1;
    if (absent.length < threshold) continue;

    const { data: existing } = await admin
      .from('brand_geo_opportunities')
      .select('id')
      .eq('brand_id', brandId)
      .eq('prompt', prompt)
      .in('status', ['open', 'in_progress', 'applied'])
      .limit(1);
    if (existing?.length) continue;

    const baselineEngines = absent.map((r) => r.engine);
    const { error } = await admin.from('brand_geo_opportunities').insert({
      brand_id: brandId,
      prompt,
      engine: baselineEngines.join(','),
      baseline_engines: baselineEngines,
      status: 'open',
      baseline_cited: false,
      baseline_audit_id: auditId ?? null,
      action: 'new_article',
      reprobe_log: []
    });
    if (!error) opened++;
  }
  return opened;
}

/**
 * Hook fired after an article goes live via the GEO apply path (publishArticleLive).
 * Proposes a 0-credit SFB listing draft — non-fatal, mirrors the blog-publish trigger.
 */
export async function onArticlePublishedLive(
  admin: SupabaseClient,
  brand: AnyRec,
  articleId: string
): Promise<void> {
  try {
    const { proposeBacklinkOrder } = await import('./backlink-external');
    await proposeBacklinkOrder(admin, String(brand.id), articleId);
  } catch (error) { swallow('propose backlink order', error); }
}

async function publishArticleLive(
  admin: SupabaseClient,
  brand: AnyRec,
  articleId: string
): Promise<{ url: string; slug: string } | null> {
  const { data: article } = await admin
    .from('brand_articles')
    .select('id, slug, status')
    .eq('id', articleId)
    .eq('brand_id', brand.id)
    .maybeSingle();
  if (!article?.slug) return null;

  const wasPublished = article.status === 'published';
  if (!wasPublished) {
    const { error } = await admin
      .from('brand_articles')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', articleId)
      .eq('brand_id', brand.id);
    if (error) throw new Error(error.message);
    try {
      const { markPlacementsPublished } = await import('./backlink-network');
      await markPlacementsPublished(admin, articleId);
    } catch (error) { swallow('mark placements published', error); }
    try {
      const { syncArticlesToCMS } = await import('./cms-sync');
      await syncArticlesToCMS(admin, String(brand.id), [articleId]);
    } catch (error) { swallow('sync articles to cms', error); }
  }

  const { publicArticleUrl } = await import('./backlink-network');
  const url = await publicArticleUrl(admin, String(brand.id), article.slug);
  if (!url) {
    if (!wasPublished) {
      await admin
        .from('brand_articles')
        .update({ status: 'draft', published_at: null })
        .eq('id', articleId)
        .eq('brand_id', brand.id);
    }
    return null;
  }

  const { isPublishVerifyEnabled } = await import('$lib/server/feature-flags');
  if (isPublishVerifyEnabled()) {
    const { assertPublicUrlLive } = await import('./site-pages');
    const live = await assertPublicUrlLive(url, { softDbOk: true });
    if (!live.ok) {
      if (!wasPublished) {
        await admin
          .from('brand_articles')
          .update({ status: 'draft', published_at: null })
          .eq('id', articleId)
          .eq('brand_id', brand.id);
      }
      throw new Error(`Article URL is not reachable (${live.error ?? 'unknown'}): ${url}`);
    }
  }

  await onArticlePublishedLive(admin, brand, articleId);

  return { url, slug: article.slug };
}

async function publishLandingFallback(
  admin: SupabaseClient,
  brand: AnyRec,
  prompt: string
): Promise<{ url: string; pageId: string } | null> {
  const title = `Citation: ${String(prompt).slice(0, 100)}`;
  const bodyMd = `# ${title}\n\nThis page closes an AI citation gap for **${brand.name}** around: ${prompt}.\n\n## Answer\n\n${brand.name} addresses this topic with practical guidance grounded in its products and expertise.\n`;

  const { upsertSitePageFromAsset, publishSitePage } = await import('./site-pages');
  const page = await upsertSitePageFromAsset(admin, String(brand.id), {
    kind: 'landing_page',
    title,
    bodyMd,
    targetQuery: prompt,
    metaTitle: title.slice(0, 70),
    metaDescription: `How ${brand.name} answers: ${String(prompt).slice(0, 120)}`
  });
  const published = await publishSitePage(admin, brand, page.id);
  return { url: published.publicUrl, pageId: published.id };
}

export async function applyGeoOpportunity(
  admin: SupabaseClient,
  brand: AnyRec,
  opportunityId: string
): Promise<{ ok: boolean; error?: string; targetUrl?: string }> {
  if (!canApplyGeoLoop(brand.plan as string)) {
    return { ok: false, error: 'GEO apply requires Starter or above' };
  }

  const { data: opp } = await admin
    .from('brand_geo_opportunities')
    .select('*')
    .eq('id', opportunityId)
    .eq('brand_id', brand.id)
    .maybeSingle();
  if (!opp) return { ok: false, error: 'Opportunity not found' };
  if (!['open', 'in_progress'].includes(opp.status)) return { ok: false, error: 'Not actionable' };

  await admin
    .from('brand_geo_opportunities')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', opportunityId);

  try {
    const snapshot = {
      techScore: null,
      shareOfVoice: 0,
      issues: [{ id: 'no-faq-schema', severity: 'medium' as const, message: 'FAQ for citation gap' }],
      citations: [
        {
          engine: 'gemini' as const,
          prompt: opp.prompt,
          brandMentioned: false,
          rank: null,
          competitors: [],
          sources: []
        }
      ],
      search: null,
      backlinks: null,
      aiOverview: null
    };
    const { generateGeoArtifacts } = await import('$lib/server/geo-artifacts');
    await generateGeoArtifacts(admin, brand, snapshot).catch((error) => { swallow('generate geo artifacts', error); return null; });

    if (!isGeoPublishApplyEnabled()) {
      let articleId: string | null = null;
      try {
        const { generateArticleFromTopic } = await import('$lib/server/blog-generate');
        articleId = await generateArticleFromTopic(admin, brand, `Win AI citations: ${opp.prompt}`);
      } catch (error) { swallow('generate article from topic', error); }
      await admin
        .from('brand_geo_opportunities')
        .update({
          status: 'applied',
          action: articleId ? 'new_article' : 'artifact_faq',
          blog_article_id: articleId,
          applied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          delta_notes: articleId ? 'Draft article + FAQ artifact generated' : 'FAQ artifact generated'
        })
        .eq('id', opportunityId);
      return { ok: true };
    }

    let articleId: string | null = null;
    let targetUrl: string | null = null;
    let action = 'new_article';

    try {
      const { generateArticleFromTopic } = await import('$lib/server/blog-generate');
      articleId = await generateArticleFromTopic(admin, brand, `Win AI citations: ${opp.prompt}`);
    } catch {
      articleId = null;
    }

    if (articleId) {
      const live = await publishArticleLive(admin, brand, articleId);
      if (live) {
        targetUrl = live.url;
        action = 'new_article';
      }
    }

    if (!targetUrl) {
      const landing = await publishLandingFallback(admin, brand, String(opp.prompt));
      if (landing) {
        targetUrl = landing.url;
        action = 'landing_page';
        articleId = null;
      }
    }

    if (!targetUrl) {
      throw new Error('Could not publish a live URL for this opportunity — fix blog/site hosting and retry');
    }

    await admin
      .from('brand_geo_opportunities')
      .update({
        status: 'applied',
        action,
        blog_article_id: articleId,
        target_url: targetUrl,
        applied_at: new Date().toISOString(),
        reprobe_attempts: 0,
        updated_at: new Date().toISOString(),
        delta_notes: `Published live URL: ${targetUrl}`
      })
      .eq('id', opportunityId);

    return { ok: true, targetUrl };
  } catch (e) {
    await admin
      .from('brand_geo_opportunities')
      .update({
        status: 'open',
        updated_at: new Date().toISOString(),
        delta_notes: e instanceof Error ? e.message : String(e)
      })
      .eq('id', opportunityId);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Days from applied_at until the next reprobe is due for the given attempt index (0-based). */
export function reprobeDueAfterDays(attempts: number): number | null {
  if (attempts < 0 || attempts >= GEO_REPROBE_SCHEDULE_DAYS.length) return null;
  return GEO_REPROBE_SCHEDULE_DAYS[attempts];
}

/** Whether an applied opportunity is due for its next reprobe. */
export function isReprobeDue(opts: {
  appliedAt: string | null | undefined;
  attempts: number;
  now?: Date;
}): boolean {
  const days = reprobeDueAfterDays(opts.attempts);
  if (days == null || !opts.appliedAt) return false;
  const due = new Date(opts.appliedAt);
  due.setUTCDate(due.getUTCDate() + days);
  return (opts.now ?? new Date()) >= due;
}

function brandWebsiteHost(brand: AnyRec): string | null {
  const site = String(brand.website ?? '').trim();
  return site ? hostOf(site) : null;
}

/** Re-probe applied opportunities on the 3/7/14 day schedule (max 3 attempts). */
export async function reprobeGeoOpportunities(
  admin: SupabaseClient,
  brand: AnyRec,
  _minDays = 3
): Promise<{ reprobed: number; won: number; deferred: number }> {
  const { data: opps } = await admin
    .from('brand_geo_opportunities')
    .select('id, prompt, applied_at, reprobe_attempts, target_url, baseline_engines, engine, reprobe_log')
    .eq('brand_id', brand.id)
    .eq('status', 'applied')
    .limit(20);

  let reprobed = 0;
  let won = 0;
  let deferred = 0;
  const now = new Date();
  const brandHost = brandWebsiteHost(brand);
  const causal = isGeoCausalWinEnabled();

  for (const opp of opps ?? []) {
    const attempts = Number(opp.reprobe_attempts ?? 0);
    if (!isReprobeDue({ appliedAt: opp.applied_at, attempts, now })) continue;

    const audit = await runCitationAudit(String(brand.name), [{ prompt: opp.prompt }]);
    const baselineEngines: string[] = Array.isArray(opp.baseline_engines)
      ? opp.baseline_engines.map(String)
      : String(opp.engine ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    const logEntries: ReprobeLogEntry[] = audit.results.map((r) => ({
      at: now.toISOString(),
      attempt: attempts + 1,
      engine: r.engine,
      mentioned: !!r.brandMentioned,
      sources: r.sources ?? [],
      error: r.error ?? null,
      targetCited: sourceCitesTarget(r.sources ?? [], opp.target_url, brandHost)
    }));

    const prevLog = Array.isArray(opp.reprobe_log) ? (opp.reprobe_log as ReprobeLogEntry[]) : [];

    if (causal) {
      const verdict = isCausalWin({
        baselineEngines,
        results: audit.results,
        targetUrl: opp.target_url,
        brandHost
      });

      if (verdict.deferred) {
        await admin
          .from('brand_geo_opportunities')
          .update({
            reprobe_log: [...prevLog, ...logEntries],
            reprobe_at: now.toISOString(),
            updated_at: now.toISOString(),
            delta_notes: `reprobe_deferred_error (attempt ${attempts} unchanged) — all engines failed`
          })
          .eq('id', opp.id);
        deferred++;
        continue;
      }

      const nextAttempts = attempts + 1;
      const terminalLost = !verdict.won && nextAttempts >= GEO_REPROBE_MAX_ATTEMPTS;
      await admin
        .from('brand_geo_opportunities')
        .update({
          status: verdict.won ? 'won' : terminalLost ? 'lost' : 'applied',
          reprobe_cited: verdict.won,
          reprobe_at: now.toISOString(),
          reprobe_attempts: nextAttempts,
          reprobe_log: [...prevLog, ...logEntries],
          updated_at: now.toISOString(),
          delta_notes: verdict.won
            ? `Causal win (target/brand cited) on attempt ${nextAttempts}`
            : terminalLost
              ? `Still no causal citation after ${nextAttempts} reprobes`
              : `No causal citation on attempt ${nextAttempts}; next check scheduled`
        })
        .eq('id', opp.id);
      reprobed++;
      if (verdict.won) won++;
      continue;
    }

    // Legacy: any-engine mention
    const cited = audit.results.some((r) => r.brandMentioned && !r.error);
    const allFailed = audit.results.length > 0 && audit.results.every((r) => r.error);
    if (allFailed) {
      await admin
        .from('brand_geo_opportunities')
        .update({
          reprobe_log: [...prevLog, ...logEntries],
          reprobe_at: now.toISOString(),
          updated_at: now.toISOString(),
          delta_notes: `reprobe_deferred_error (attempt ${attempts} unchanged)`
        })
        .eq('id', opp.id);
      deferred++;
      continue;
    }

    const nextAttempts = attempts + 1;
    const terminalLost = !cited && nextAttempts >= GEO_REPROBE_MAX_ATTEMPTS;
    await admin
      .from('brand_geo_opportunities')
      .update({
        status: cited ? 'won' : terminalLost ? 'lost' : 'applied',
        reprobe_cited: cited,
        reprobe_at: now.toISOString(),
        reprobe_attempts: nextAttempts,
        reprobe_log: [...prevLog, ...logEntries],
        updated_at: now.toISOString(),
        delta_notes: cited
          ? `Cited after apply (attempt ${nextAttempts})`
          : terminalLost
            ? `Still not cited after ${nextAttempts} reprobes`
            : `Not cited on attempt ${nextAttempts}; next check scheduled`
      })
      .eq('id', opp.id);
    reprobed++;
    if (cited) won++;
  }
  return { reprobed, won, deferred };
}

export async function loadGeoOpportunities(admin: SupabaseClient, brandId: string) {
  const { data } = await admin
    .from('brand_geo_opportunities')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = data ?? [];
  const won = rows.filter((r) => r.status === 'won').length;
  const lost = rows.filter((r) => r.status === 'lost').length;
  const closed = won + lost;
  return {
    opportunities: rows,
    winRate: closed ? Math.round((won / closed) * 100) : null,
    openCount: rows.filter((r) => r.status === 'open').length
  };
}

export async function dismissGeoOpportunity(admin: SupabaseClient, brandId: string, id: string) {
  await admin
    .from('brand_geo_opportunities')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('brand_id', brandId);
}
