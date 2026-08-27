import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
// Dynamic (not static) public env: PUBLIC_APP_URL may be unset in some environments (e.g. the
// CI type-check), and $env/static/public would fail the build if the var isn't exported. Dynamic
// reads it at runtime and lets us fall back gracefully when it's missing.
import { env as publicEnv } from '$env/dynamic/public';
import {
  generatePreview,
  planWeekStrategy,
  executeWeekStrategy,
  renderPreviewImages,
  normalizeWeeklyStrategy,
  attachBrandMoodImages,
  enrichCtaWithUtm,
  loadPlannerMarketSignals,
  isProduceApproved,
  carouselMaxPerBatch,
  postQcPayload,
  type ContentPrefs,
  type PreviewPost,
  type PastWinner
} from './content-preview';
import { attachBrandPeople } from './people';
import { attachBrandPages } from './content-library';
import { rebuildBrandContext } from './brand-context';
import { enrichProfileWithMemory } from './brand-memory';
import { runDirector } from './director';
import {
  loadActivePlan,
  currentWeekIndex,
  weekStrategyBrief,
  postsForWeek,
  setWeekStatus,
  proposePlan,
  activatePlan,
  cadenceAllowed,
  selectFeaturableProducts
} from './editorial-plan';
import {
  activeGtmBrief,
  loadActiveGtm,
  currentPhaseIndex,
  proposeGtmDual
} from './gtm';
import { generateWeeklyRecap } from './weekly-recap';
import { genaiClient } from './research';
import { countForFrequency, blogArticlesPerWeek, blogArticlesPerWeekMax, isExportOnlyPlan } from './plans';
import { localeLanguageName } from '$lib/i18n/locale';
import { syncZernioAnalytics } from './zernio';
import { remaining, addUsage, monthKey } from './usage';
import { signApproveToken } from './token';
import { withBrandContext } from '$lib/server/ai-log';
import {
  sendEmail,
  schedulerApprovalEmailHtml,
  schedulerApprovalEmailText,
  schedulerEmailSubject,
  weeklyRecapEmailSubject,
  weeklyRecapEmailHtml,
  weeklyRecapEmailText
} from './email';
import { emailLocale } from './email-i18n';
import { startOfWeek, wallClockToUtc } from './schedule';
import { normalizeContentFormat } from '$lib/content-formats';
import { loadApprovedRubrics } from './rubrics';
import {
  jobPausedForBrand,
  jobEnabledForBrand,
  scheduledWorkAllowed,
  recordSystemJobOptOut
} from './job-roster';
import { recordLoopTick } from './loop-ticks';

// Recurring autopilot core. runAutopilotForBrand() is the per-brand unit the daily tick
// endpoint (/api/v1/autopilot/tick) calls for every due brand. It mirrors the MANUAL content
// generate endpoint's logic (same planner, same quota gate, same video guardrail, same
// post shape) but adds the recurring concerns: an auditable scheduler_run row, auto-publish
// for flagged accounts, and ONE one-tap approval email for the rest. It runs under the
// service-role client (no user session), so all DB access here must be explicit and
// brand-scoped — there is no RLS to lean on.

// The brand fields runAutopilotForBrand needs. Kept loose (string for plan/timezone) to
// match what the tick endpoint and the [brand] layout already select.
export type AutopilotBrand = {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  timezone: string;
  target_platforms: unknown;
  content_prefs: unknown;
  autopilot_failure_count: number;
  last_autopilot_run_at: string | null;
  activated_at: string | null;
  org_id: string;
  // Zernio profile id — used by the flywheel to pull this brand's published-post analytics.
  zernio_profile_id: string | null;
  // jsonb — gates + configures the blog's weekly article budget (see STEP 4 below).
  blog_config: unknown;
};

// After this many CONSECUTIVE failed runs we auto-disable autopilot. A persistently broken
// brand kit (or a revoked API key) would otherwise keep failing — and, worse, keep emailing —
// every tick. Re-enabling is a deliberate manual action in Settings.
const MAX_CONSECUTIVE_FAILURES = 3;

// ── Lo Stratega promosso ────────────────────────────────────────────────────
// Il turno pieno parte al massimo una volta ogni ~6 giorni per brand (il cron passa ogni giorno):
// un giorno di slack sotto la settimana, così un tick in ritardo non fa saltare la cadenza.
const STRATEGIST_MIN_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Il brief server-side del turno dello Stratega (inglese, come i blurb del roster: traduce il
 * modello). Gli incarichi cambiano giro per giro; la cornice — lavora dai numeri veri, applica
 * con i tool, niente domande — è fissa.
 */
function strategistBrief(tasks: string[]): string {
  return `## SCHEDULED STRATEGY REVIEW (server-side brief)
You are this brand's strategist on your recurring unattended review, in your own persistent thread. Nobody is present this turn: work autonomously and post ONE short, concrete report here (what you looked at, what you changed, why — no filler).

Due this run:
${tasks.map((t) => `- ${t}`).join('\n')}

How to work: read the real numbers first (read_strategy, read_editorial_plan, post/analytics history tools — delegate research if useful) and compare them with what the GTM plan and the editorial plan promised. Apply prudent, clearly-motivated changes directly with your tools (update_gtm_plan, update_editorial_plan, update_voice, propose_next_cycle). Use notify_user only for what the owner must see, linking /gtm or /editorial. Never invent data; if the signal is too thin to justify a change, say so and stop.`;
}

// ── Pending-backlog cap ────────────────────────────────────────────────────
// When a brand's approval gate is the bottleneck (more than CAP stale pending_user posts, each
// older than AGE), producing more posts would only deepen the pile — runAutopilotForBrand skips
// production for that run and records a once-per-day incident (kind 'pending_backlog'). The cap
// NEVER blocks approving/publishing existing posts.
// Le due soglie vivono in autopilot-thresholds.ts perché anche il `doctor` deve dire all'utente a
// che numero la produzione riparte, e una soglia raccontata in due posti ne diventa due.
import { PENDING_BACKLOG_CAP, PENDING_BACKLOG_AGE_MS } from './autopilot-thresholds';

// Two-step autopilot review window: how long a drafted week waits for the user before the next
// tick produces it as proposed. DELIBERATELY short (~one daily tick, with jitter headroom) and
// decoupled from the cadence window — a full cadence window here would halve the publishing
// cadence (plan one window, produce the next) and lose whole weeks. Exported for the tick's
// "due" check.
export const REVIEW_GRACE_MS = 20 * 60 * 60 * 1000;

// Rank a brand's post history into "recent winners" for the planner: prefer posts from the last
// ~90 days, ordered by engagement (engagementRate, else likes + 2·comments). Top 8. Pure + testable.
// Callers pre-filter the pool to the brand's OWN posts (source 'zernio') — competitor/archival
// rows (scrapecreators) must never shape what the brand learns from. Empty pool → empty winners.
const RECENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HistoryRow = { content: string | null; platform: string | null; metrics: any; published_at?: string | null };
export function rankRecentWinners(posts: HistoryRow[], now = Date.now()): PastWinner[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const score = (m: any): number => {
    if (!m) return 0;
    if (typeof m.engagementRate === 'number' && m.engagementRate > 0) return m.engagementRate;
    return (m.likes ?? 0) + (m.comments ?? 0) * 2;
  };
  const recent = posts.filter((p) => p.published_at && now - Date.parse(p.published_at) <= RECENT_WINDOW_MS);
  const pool = recent.length >= 3 ? recent : posts;
  return [...pool]
    .sort((a, b) => score(b.metrics) - score(a.metrics))
    .slice(0, 8)
    .map((p) => ({ content: p.content, platform: p.platform, metrics: p.metrics }));
}

export type AutopilotResult = {
  ran: boolean; // false when skipped (autopilot off or no quota) — not an error
  reason?: string; // why it was skipped
  resetDate?: string; // when credits replenish (set with reason 'credits_exhausted')
  runId?: string; // the scheduler_run row, when one was created
  postsCreated?: number;
  emailed?: boolean; // whether an approval email was sent for the rest
  // Two-step autopilot: this run only PLANNED the week's rows (draft + review email) — nothing
  // was produced. The next due run produces them unless the user acted from /plan first.
  planned?: boolean;
  // Full autopilot: strategy & plan intelligence
  recapSent?: boolean;     // weekly recap email was sent
  gtmReviewed?: boolean;   // reviewPhase ran against real performance
  gtmAdjusted?: boolean;   // GTM verdict was 'adjust' — a proposed revision was saved
  planGenerated?: boolean; // editorial plan was auto-generated (proposePlan)
};

// Run one recurring batch for a brand. Returns a structured result (never throws) so the tick
// endpoint can iterate many brands and keep going; failures are recorded on the scheduler_run
// row and the brand's failure counter.
export async function runAutopilotForBrand(
  supabase: SupabaseClient,
  brand: AutopilotBrand
): Promise<AutopilotResult> {
  // Guard 1: il producer è un lavoro del roster (chiave 'autopilot'), non più il booleano
  // `brands.autopilot_enabled` — quel flag restava false per mesi e nessuno se ne accorgeva.
  // Regola del lavoro schedulato (stessa riga di codice di tutti gli altri): senza piano a
  // pagamento non si parte. E l'opt-out del roster — dell'utente o del watchdog — vince su tutto.
  // I gate stanno QUI e non solo nel tick perché runAutopilotForBrand deve restare sicuro da
  // chiamare direttamente (per-brand tick, CLI); il tick registra l'esito in loop_ticks dal
  // `reason` che torniamo, quindi qui non si scrive nessun tick (niente doppie righe).
  if (!scheduledWorkAllowed(brand.plan)) {
    return { ran: false, reason: 'no_plan' };
  }
  if (!(await jobEnabledForBrand(brand.id, 'autopilot', supabase))) {
    return { ran: false, reason: 'user_off' };
  }

  // Guard 2: respect the hard monthly post quota. videoCap headroom (the invisible per-plan
  // video guardrail) comes from the same remaining() call the manual path uses.
  const budget = await remaining(supabase, brand.id, brand.plan, brand.timezone);
  if (budget.posts <= 0) {
    return { ran: false, reason: 'quota_reached' };
  }

  if (budget.credits.remaining <= 0) {
    return { ran: false, reason: 'credits_exhausted', resetDate: budget.credits.periodEnd.toISOString() };
  }

  // Create the audit row up front in 'pending' so an in-flight run is visible (the tick uses
  // a pending row as a cheap overlap guard) and so a crash mid-run still leaves a trace.
  const { data: run, error: runErr } = await supabase
    .from('scheduler_runs')
    .insert({ brand_id: brand.id, status: 'pending', posts_created: 0 })
    .select('id')
    .single();
  if (runErr || !run) {
    return { ran: false, reason: runErr?.message ?? 'could_not_create_run' };
  }
  const runId = run.id as string;

  return withBrandContext(brand.id, async () => {
    try {
    // FLYWHEEL: before planning, pull this brand's published-post performance from Zernio (free,
    // profile-scoped) into social_post_history, then rebuild its context from the freshened history
    // (ai_context + visual_style + history-mining + visual-playbook). So every recurring batch
    // learns from what Anomalia's OWN posts recently achieved. Best-effort — never blocks the run.
    try {
      await syncZernioAnalytics(supabase, { id: brand.id, zernio_profile_id: brand.zernio_profile_id });
      // Paid ads flywheel (Pro+): sync ad accounts + metrics when the brand has ads enabled.
      try {
        const { adsAvailable } = await import('$lib/server/ads');
        if (adsAvailable(brand.plan)) {
          const { syncAdAccounts, syncAdMetrics } = await import('$lib/server/ads');
          await syncAdAccounts(supabase, brand);
          await syncAdMetrics(supabase, brand.id);
        }
      } catch (adsErr) {
        console.warn('[autopilot] ads sync failed (continuing):', adsErr instanceof Error ? adsErr.message : adsErr);
      }
      await rebuildBrandContext(supabase, brand.id);
    } catch (e) {
      console.warn('[autopilot] flywheel refresh failed (continuing):', e instanceof Error ? e.message : e);
    }

    // ACCOUNT HEALTH: surface persistently-failing connected accounts as incidents for THIS brand.
    // Best-effort — never blocks the run.
    try {
      const { checkAccountHealth, recordAccountIncidents } = await import('./account-health');
      const { failing } = await checkAccountHealth(supabase, brand.id);
      if (failing.length > 0) {
        console.warn(`[autopilot] ${failing.length} failing social account(s) for brand=${brand.slug}`, failing);
        await recordAccountIncidents(supabase, failing);
      }
    } catch (e) {
      console.warn('[autopilot] account health check failed (continuing):', e instanceof Error ? e.message : e);
    }

    // Refuse to burn quota on generic wallpaper — owner must remediate Studio data first.
    {
      const { loadGrowthReadiness, growthReadinessMessage } = await import('$lib/server/growth-readiness');
      const growth = await loadGrowthReadiness(supabase, brand.id);
      if (!growth.ready) {
        const message = growthReadinessMessage(growth);
        console.warn(`[autopilot] growth_data_incomplete brand=${brand.id}: ${message}`);
        await supabase
          .from('scheduler_runs')
          .update({ status: 'failed', error: message.slice(0, 1800) })
          .eq('id', runId);
        return { ran: false, reason: 'growth_data_incomplete', runId };
      }
    }

    // Assemble the planner profile from STORED data only (brand_kit + products) — no website
    // re-fetch. Mirrors the manual generate endpoint so autopilot has the FULL context
    // (ai_context/visual_style/site_type/pillars/logos/fonts), not the old narrow subset.
    const { data: kit } = await supabase
      .from('brand_kit')
      .select(
        'category, about, target_audience, brand_colors, ai_character, ai_context, visual_style, site_type, content_pillars, logos, fonts, theme_color'
      )
      .eq('brand_id', brand.id)
      .maybeSingle();

    // Load ALL products, then pick the substantial, photogenic heroes spread across categories.
    const { data: rawProducts } = await supabase
      .from('products')
      .select('title, description, kind, pricing, images')
      .eq('brand_id', brand.id);

    const products = selectFeaturableProducts(rawProducts ?? [], 40);

    const profile = {
      name: brand.name,
      category: kit?.category ?? '',
      about: kit?.about ?? '',
      target_audience: kit?.target_audience ?? '',
      brand_colors: kit?.brand_colors ?? [],
      ai_character: kit?.ai_character ?? {},
      ai_context: kit?.ai_context ?? '',
      visual_style: kit?.visual_style ?? '',
      site_type: kit?.site_type ?? 'generic',
      content_pillars: kit?.content_pillars ?? [],
      logos: kit?.logos ?? [],
      fonts: kit?.fonts ?? [],
      theme_color: kit?.theme_color ?? null,
      // planStrategy reads `.name` off each offering; map title → name and carry kind.
      products: (products ?? []).map((p) => ({
        name: p.title,
        description: p.description,
        kind: p.kind,
        pricing: p.pricing,
        images: p.images
      }))
    };

    // Attach the brand's people (signed photo URLs) so recurring runs can feature them too.
    await attachBrandPeople(profile, supabase, brand.id);

    // Attach linkable site pages (content library) so Reddit link posts use real URLs, not guesses.
    await attachBrandPages(profile, supabase, brand.id).catch(swallow('attach brand pages'));

    // Enrich ai_context with structured memory entries (shared across all AI subsystems).
    await enrichProfileWithMemory(supabase, brand.id, profile);

    // Recent winners: rank the brand's OWN posts (incl. the just-synced Anomalia ones) by engagement,
    // biased to the last ~90 days, so the strategist learns from what's working NOW. Only 'zernio'
    // rows are the brand's own published content — 'scrapecreators' rows are competitor/archival data
    // the brand must NOT learn from (93% of the pool). A brand without zernio rows gets an empty
    // winner list instead of borrowing competitors' wins.
    const { data: histPool } = await supabase
      .from('social_post_history')
      .select('content, platform, metrics, published_at')
      .eq('brand_id', brand.id)
      .eq('source', 'zernio')
      .limit(200);
    const topPosts: PastWinner[] = rankRecentWinners(histPool ?? []);

    const prefs: ContentPrefs = (brand.content_prefs as ContentPrefs) ?? {};
    const platforms: string[] = Array.isArray(brand.target_platforms)
      ? (brand.target_platforms as string[])
      : [];

    // Recipients (owner + shared-brand collaborators), fetched once — every notification email
    // below fans out to all of them, each rendered in the recipient's own language.
    const contacts = await brandContacts(supabase, brand.org_id, brand.id);
    const owner = contacts[0] ?? null;
    const ownerLocale = emailLocale(owner?.locale);
    const appBase = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
    // One email per recipient (+ optional Web Push mirror). Email failures never block siblings;
    // push failures never affect the email count (handled inside notifyBrandContacts).
    const emailAll = async (
      build: (locale: ReturnType<typeof emailLocale>, to: string) => Parameters<typeof sendEmail>[0],
      push?: { url: string; tag: string; title?: string; body?: string | ((locale: ReturnType<typeof emailLocale>) => string) }
    ): Promise<number> => {
      const { notifyBrandContacts } = await import('$lib/server/brand-notify');
      return notifyBrandContacts(supabase, contacts, {
        buildEmail: build,
        push: push?.url ? { url: push.url, tag: push.tag, title: push.title, body: push.body } : undefined,
        logPrefix: `[autopilot] ${brand.slug}:`
      });
    };

    // ── FULL AUTOPILOT: recap → GTM review → plan bootstrap ────────────────
    // These three steps run once per week (guarded) before content production.
    // They turn the autopilot from a content machine into a self-learning loop.

    let recapSent = false;
    let gtmReviewed = false;
    let gtmAdjusted = false;
    let planGenerated = false;

    // STEP 0 — INACTIVITY REMINDER: if the brand was activated but never published anything,
    // send a gentle nudge. Guard: max one reminder per 3 days (tracked via scheduler_runs).
    if (brand.activated_at && owner?.email && appBase) {
      try {
        const { count: postCount } = await supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('brand_id', brand.id)
          .in('status', ['published', 'scheduled', 'pending_user']);
        if ((postCount ?? 0) === 0) {
          // Check if we already sent a reminder recently
          const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
          const { data: recentReminders } = await supabase
            .from('scheduler_runs')
            .select('id')
            .eq('brand_id', brand.id)
            .eq('status', 'reminder_sent')
            .gte('created_at', threeDaysAgo)
            .limit(1);
          if (!recentReminders?.length) {
            // Check what's missing to give actionable advice
            const { count: accountCount } = await supabase
              .from('social_accounts')
              .select('id', { count: 'exact', head: true })
              .eq('brand_id', brand.id)
              .eq('status', 'active');
            const hasAccounts = (accountCount ?? 0) > 0;
            await emailAll(
              (l, to) => inactivityReminderEmail(l, brand.name, brand.slug, hasAccounts, appBase, to),
              {
                url: hasAccounts ? `${appBase}/app/${brand.slug}` : `${appBase}/app/${brand.slug}/settings`,
                tag: `inactivity-${brand.id}`
              }
            );
            // Record the reminder as a scheduler run so we don't spam
            await supabase.from('scheduler_runs').insert({ brand_id: brand.id, status: 'reminder_sent', posts_created: 0 });
            console.log(`[autopilot] ${brand.slug}: inactivity reminder sent`);
          }
        }
      } catch (e) {
        console.warn('[autopilot] inactivity reminder failed (continuing):', e instanceof Error ? e.message : e);
      }
    }

    // STEP 1 — WEEKLY RECAP: generate the performance snapshot and email it.
    // Guard: only once per week (skip if last run was < 6 days ago).
    const lastRun = brand.last_autopilot_run_at ? Date.parse(brand.last_autopilot_run_at) : 0;
    const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
    const shouldRecap = !lastRun || (Date.now() - lastRun > sixDaysMs);
    if (shouldRecap && owner?.email && appBase) {
      try {
        const outputLanguage = localeLanguageName(ownerLocale);
        const recap = await generateWeeklyRecap(supabase, brand.id, outputLanguage);
        if (recap) {
          // Convert WeeklyRecap → RecapData (same logic as weekly-recap/tick)
          const eng = recap.totalEngagement;
          const prevEng = recap.prevEngagement;
          const totalEng = (eng.likes ?? 0) + (eng.comments ?? 0) + (eng.shares ?? 0);
          const totalImp = (eng.impressions ?? 0) + (eng.views ?? 0);
          const prevEngTotal = (prevEng.likes ?? 0) + (prevEng.comments ?? 0) + (prevEng.shares ?? 0);
          const prevImpTotal = (prevEng.impressions ?? 0) + (prevEng.views ?? 0);
          const weekFmt = new Intl.DateTimeFormat('it-IT', { timeZone: brand.timezone, day: 'numeric', month: 'short' });
          const now = new Date();
          const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          const abs = (url?: string) => {
            if (!url) return undefined;
            if (/^https?:\/\//i.test(url)) return url;
            return `${appBase}${url.startsWith('/') ? url : `/${url}`}`;
          };
          const growthFixes =
            recap.growth && (!recap.growth.ready || recap.growth.warnings.length)
              ? [...recap.growth.blocking, ...recap.growth.warnings].map((c) => ({
                  key: c.key,
                  blocking: c.blocking,
                  url: abs(c.fix)
                }))
              : [];
          const recapData = {
            brandName: recap.brandName,
            brandSlug: recap.brandSlug,
            weekLabel: `${weekFmt.format(weekStart)} – ${weekFmt.format(now)}`,
            postsPublished: recap.postsPublished,
            postsPending: recap.postsPending,
            postsScheduled: recap.postsScheduled,
            totalEngagement: totalEng,
            totalImpressions: totalImp,
            totalSaves: eng.saves ?? 0,
            engagementDeltaPct: recap.engagementDeltaPct,
            prevEngagement: prevEngTotal,
            prevImpressions: prevImpTotal,
            prevPosts: recap.prevPosts,
            topPostCaption: recap.topPost?.caption ?? null,
            topPostPlatform: recap.topPost?.platform ?? null,
            platformStats: recap.platformStats.map((p) => ({
              platform: p.platform,
              posts: p.postsPublished,
              engagement: Object.values(p.totals).reduce((a, b) => a + b, 0)
            })),
            trends: recap.trends,
            suggestions: recap.suggestions.map((s) => ({ type: s.type, message: s.message })),
            actionItems: recap.actionItems.map((a) => ({ label: a.label, url: abs(a.url) })),
            dashboardUrl: `${appBase}/app/${recap.brandSlug}`,
            connectedAccounts: recap.connectedAccounts,
            visualInsights: recap.visualInsights,
            webKpis: recap.webKpis,
            weakReviews: recap.weakReviews?.map((w) => ({
              ...w,
              postUrl: abs(`/app/${recap.brandSlug}/posts/${w.postId}/edit`)
            })),
            growth:
              growthFixes.length > 0
                ? {
                    ready: !!recap.growth?.ready,
                    blockingCount: recap.growth?.blocking.length ?? 0,
                    warningCount: recap.growth?.warnings.length ?? 0,
                    fixes: growthFixes
                  }
                : null
          };
          recapSent = (await emailAll(
            (l, to) => ({
              to,
              subject: weeklyRecapEmailSubject(l, brand.name, recapData.weekLabel),
              html: weeklyRecapEmailHtml(l, recapData),
              text: weeklyRecapEmailText(l, recapData)
            }),
            { url: recapData.dashboardUrl || `${appBase}/app/${brand.slug}`, tag: `recap-${brand.id}` }
          )) > 0;
          console.log(`[autopilot] ${brand.slug}: recap email sent`);
        }
      } catch (e) {
        console.warn('[autopilot] weekly recap failed (continuing):', e instanceof Error ? e.message : e);
      }
    }

    // ROSTER — LO STRATEGA. Il primo controllo dei due blocchi che rivedono i piani (STEP 2, il
    // ripasso del GTM; e il ROLLOVER, il rinnovo del piano editoriale): stanno dietro UNA sola
    // chiave perché nel roster sono UNA card sola. Si legge qui, una volta per giro: chiamarlo due
    // volte scriverebbe due righe `user_off` in `loop_ticks` per lo stesso spegnimento, e il brand
    // doctor le conterebbe come due lavori fermi invece di uno.
    // Nel dubbio (tabella assente, errore) `jobPausedForBrand` risponde "non è in pausa": il
    // default resta acceso, come per gli altri sette.
    const strategistPaused = await jobPausedForBrand('strategy_review', brand.id);
    // PROMOZIONE — lo Stratega è un TURNO PIENO di chat, non più due chiamate AI inline. Qui si
    // raccolgono solo gli incarichi maturati in questo giro (ripasso GTM, rollover): UN enqueue
    // solo, in fondo, nel thread `job:strategy_review` — due enqueue nello stesso giro si
    // bloccherebbero a vicenda sul thread occupato.
    const strategistTasks: string[] = [];

    // STEP 2 — GTM REVIEW, promosso: il confronto piano-vs-realtà non si fa più qui con una
    // chiamata inline a reviewPhase — è il PRIMO incarico del turno pieno dello Stratega (enqueue
    // in fondo, dopo il rollover). Il dedupe settimanale sta nell'enqueue (minIntervalMs), perché
    // il vecchio guard su gtm_plans.source='autopilot_review' non vede cosa scrive un turno che
    // aggiorna il piano ATTIVO con update_gtm_plan. Il BOOTSTRAP (nessun GTM) resta deterministico:
    // su un brand appena nato non c'è niente da "rileggere contro i numeri", e il piano deve
    // esistere prima che qualunque stratega possa rivederlo.
    try {
      // Il gate PRIMA della query: spento vuol dire che qui non si legge e non si spende niente.
      const gtmPlan = strategistPaused ? null : await loadActiveGtm(supabase, brand.id);
      if (gtmPlan) {
        const phaseIdx = currentPhaseIndex(gtmPlan, brand.timezone);
        if (phaseIdx != null) {
          strategistTasks.push(
            'GTM REVIEW: reread the current GTM phase against what actually happened (published posts and their real metrics since the phase started). If plan and reality have diverged, apply prudent, clearly-motivated adjustments with update_gtm_plan; if the plan is on track, say so briefly and change nothing.'
          );
          gtmReviewed = true;
        }
      } else if (!strategistPaused) {
        // `!strategistPaused` e non solo `else`: con lo stratega spento `gtmPlan` è null per
        // scelta, non perché il brand non abbia una strategia — senza questa condizione lo
        // spegnimento farebbe partire il bootstrap, cioè proprio la chiamata AI che doveva evitare.
        // NO GTM exists — bootstrap one
        const { data: existingProposals } = await supabase
          .from('gtm_plans')
          .select('id')
          .eq('brand_id', brand.id)
          .eq('status', 'proposed')
          .limit(1);
        if (!existingProposals?.length) {
          try {
            const newGtm = await proposeGtmDual(genaiClient(), profile, {
              platforms,
              outputLanguage: localeLanguageName(ownerLocale),
              topPosts,
              supabase,
              brandId: brand.id,
              timezone: brand.timezone
            });
            await supabase.from('gtm_plans').insert({
              brand_id: brand.id,
              status: 'proposed',
              horizon: '6m',
              objective: newGtm.objective || null,
              phases: { horizon_90d: newGtm.phases_90d ?? [], horizon_6m: newGtm.phases_6m ?? newGtm.phases },
              funnel: newGtm.funnel ?? null,
              source: 'autopilot'
            });
            if (owner?.email && appBase) {
              const gtmUrl = `${appBase}/app/${brand.slug}/gtm`;
              await emailAll(
                (l, to) => gtmProposedEmail(l, brand.name, gtmUrl, to),
                { url: gtmUrl, tag: `gtm-proposed-${brand.id}` }
              );
            }
            console.log(`[autopilot] ${brand.slug}: GTM proposed (first time)`);
          } catch (e) {
            console.warn('[autopilot] GTM bootstrap failed (continuing):', e instanceof Error ? e.message : e);
          }
        }
      }
    } catch (e) {
      console.warn('[autopilot] GTM review failed (continuing):', e instanceof Error ? e.message : e);
    }

    // The brand's APPROVED rubrics (recurring series), loaded once per run and threaded into
    // every planner below. [] for brands that haven't adopted rubrics → every prompt/schema is
    // exactly the pre-rubric one (the whole layer is opt-in).
    const rubrics = await loadApprovedRubrics(supabase, brand.id).catch((error) => { swallow('load approved rubrics', error); return []; });

    // STEP 3 — EDITORIAL PLAN BOOTSTRAP: if no active plan, generate one.
    // Also auto-activate lapsed proposals older than the review grace window.
    try {
      const existingPlan = await loadActivePlan(supabase, brand.id);
      if (!existingPlan) {
        // Check for a proposed plan that might be ready to auto-activate
        const { data: proposedPlanRows } = await supabase
          .from('editorial_plans')
          .select('id, created_at')
          .eq('brand_id', brand.id)
          .eq('status', 'proposed')
          .order('created_at', { ascending: false })
          .limit(1);
        const proposedPlan = proposedPlanRows?.[0];
        if (proposedPlan) {
          const age = Date.now() - Date.parse(String(proposedPlan.created_at ?? ''));
          if (Number.isFinite(age) && age > REVIEW_GRACE_MS) {
            await activatePlan(supabase, brand.id, proposedPlan.id as string, brand.timezone);
            console.log(`[autopilot] ${brand.slug}: lapsed editorial proposal auto-activated`);
          }
        } else {
          // No active, no proposed — generate a fresh plan
          const gtmBriefForPlan = await activeGtmBrief(supabase, brand.id, brand.timezone).catch((error) => { swallow('load gtm brief', error); return ''; });
          const newPlan = await proposePlan(genaiClient(), profile, {
            platforms,
            allowedCadences: cadenceAllowed(brand.plan),
            outputLanguage: localeLanguageName(ownerLocale),
            strategyBrief: gtmBriefForPlan,
            topPosts,
            rubrics,
            supabase,
            brandId: brand.id,
            planTier: brand.plan,
            timezone: brand.timezone
          });
          await supabase.from('editorial_plans').insert({
            brand_id: brand.id,
            status: 'proposed',
            strategy: newPlan.strategy || null,
            voice: newPlan.voice,
            cadence: newPlan.cadence,
            platform_mix: newPlan.platform_mix,
            gtm: newPlan.gtm,
            weeks: newPlan.weeks,
            source: 'autopilot'
          });
          planGenerated = true;
          if (owner?.email && appBase) {
            const planUrl = `${appBase}/app/${brand.slug}/editorial`;
            await emailAll(
              (l, to) => editorialPlanProposedEmail(l, brand.name, planUrl, to),
              { url: planUrl, tag: `plan-proposed-${brand.id}` }
            );
          }
          console.log(`[autopilot] ${brand.slug}: editorial plan proposed`);
        }
      }
    } catch (e) {
      console.warn('[autopilot] editorial plan bootstrap failed (continuing):', e instanceof Error ? e.message : e);
    }

    // GTM inheritance: the roadmap's current phase (weights, pillars, targets) steers the batch
    // on top of the editorial week. '' for brands without a GTM plan.
    const gtmBrief = await activeGtmBrief(supabase, brand.id, brand.timezone).catch((error) => { swallow('load gtm brief', error); return ''; });

    // Style/mood references for the renders (Studio uploads, or the archived post/site imagery) and
    // the competitor anti-moodboard for the strategist — same anchors the onboarding batch gets, so
    // recurring weeks don't drift off the brand's visual identity.
    await attachBrandMoodImages(profile, supabase, brand.id).catch(swallow('attach mood images'));
    const { attachBrandLibraryMedia } = await import('$lib/server/brand-media');
    await attachBrandLibraryMedia(profile, supabase, brand.id).catch(swallow('attach library media'));
    const { marketBrief, competitorThumbUrls } = await loadPlannerMarketSignals(supabase, brand.id);

    // EDITORIAL PLAN: when the brand has an approved (active) plan, this batch executes the
    // CURRENT week of it — the week's theme/focus/brief becomes the planner's strategyBrief, so
    // recurring generation follows the document the user signed off on instead of improvising.
    // Brands without a plan (legacy) keep the pre-plan behaviour bit-for-bit.
    let editorialPlan = await loadActivePlan(supabase, brand.id);
    let weekIdx = editorialPlan ? currentWeekIndex(editorialPlan, brand.timezone) : null;

    // ROLLOVER: keep the plan rolling without ever stalling, while giving the user a real
    // approval window. In the FINAL week we propose the next 4-week cycle (ample advance) and
    // email the owner; if the cycle lapses with the proposal still unanswered, we auto-activate
    // it (with a notice) so autopilot continues — the user can revise it after the fact.
    // Best-effort: a rollover failure never blocks the batch.
    try {
      if (editorialPlan?.id) {
        const { data: proposedRows } = await supabase
          .from('editorial_plans')
          .select('id')
          .eq('brand_id', brand.id)
          .eq('status', 'proposed')
          .limit(1);
        const proposalId = proposedRows?.[0]?.id as string | undefined;
        const lastWeek = editorialPlan.weeks.length - 1;

        const proposeRollover = async () => {
          // ROSTER — lo stratega, stesso interruttore del ripasso GTM qui sopra. Il gate sta
          // DENTRO `proposeRollover` e non attorno al blocco per una ragione precisa: qui sotto
          // c'è anche l'ATTIVAZIONE di una proposta già scaduta, e quella non è revisione, è
          // consegna. Spegnendo tutto il blocco un brand con il ciclo scaduto resterebbe senza
          // settimana attiva e smetterebbe di produrre — cioè l'interruttore spegnerebbe la
          // pubblicazione, che è esattamente ciò che il roster non deve poter fare.
          //
          // PROMOZIONE: la PROPOSTA del prossimo ciclo non è più una chiamata inline a
          // proposeNextCycle — è un incarico del turno pieno dello Stratega, che la consegna col
          // tool `propose_next_cycle` (stessa scrittura: status proposed, source rollover) e
          // avvisa l'owner con notify_user. L'ATTIVAZIONE della proposta scaduta resta QUI sotto,
          // deterministica: è consegna, e spostarla in un turno lascerebbe un brand senza
          // settimana attiva se il turno fallisse.
          if (strategistPaused) return;
          strategistTasks.push(
            'EDITORIAL ROLLOVER: the current 4-week editorial cycle is in its final week (or has lapsed with nothing proposed). Propose the next cycle with the propose_next_cycle tool — evolve it from what actually performed, do not repeat the previous themes — then notify the owner (notify_user) with the /editorial link so they can review before it activates.'
          );
        };

        if (weekIdx === lastWeek && !proposalId) {
          await proposeRollover();
        } else if (weekIdx == null) {
          if (proposalId) {
            const activated = await activatePlan(supabase, brand.id, proposalId, brand.timezone);
            if (activated) {
              editorialPlan = await loadActivePlan(supabase, brand.id);
              weekIdx = editorialPlan ? currentWeekIndex(editorialPlan, brand.timezone) : null;
              if (owner?.email && appBase) {
                const url = `${appBase}/app/${brand.slug}/editorial`;
                await emailAll(
                  (l, to) => rolloverActivatedEmail(l, brand.name, url, to),
                  { url, tag: `rollover-activated-${brand.id}` }
                );
              }
            }
          } else {
            // Lapsed with nothing proposed (e.g. autopilot was off during week 4): propose now;
            // this batch proceeds on GTM + brand voice, the proposal awaits the user.
            await proposeRollover();
          }
        }
      }
    } catch (e) {
      console.warn('[autopilot] editorial rollover failed (continuing):', e instanceof Error ? e.message : e);
    }

    // ROSTER — LO STRATEGA, il turno. Gli incarichi maturati sopra partono come UN turno pieno di
    // chat nel thread persistente `job:strategy_review`: stesso runtime degli agenti custom
    // schedulati (coda chat_jobs → registry intero, deleghe, Composio, sandbox), con il perimetro
    // non presidiato di unattended.ts. Il dedupe (minIntervalMs) è il gate di freschezza: il cron
    // passa ogni giorno, il turno parte al massimo una volta ogni ~6 giorni. Import dinamico per
    // non trascinare il grafo della coda dentro chi importa lo scheduler (test compresi).
    if (!strategistPaused && strategistTasks.length > 0) {
      try {
        const { enqueueAgentJobTurn } = await import('./agent-turns');
        const turn = await enqueueAgentJobTurn(supabase, {
          brandId: brand.id,
          jobKey: 'strategy_review',
          brief: strategistBrief(strategistTasks),
          visible: {
            it: 'Revisione settimanale della strategia',
            en: 'Weekly strategy review'
          },
          origin: appBase || undefined,
          minIntervalMs: STRATEGIST_MIN_INTERVAL_MS
        });
        if (turn.ok) {
          recordLoopTick({ loop: 'strategy_review', brandId: brand.id, outcome: 'ok' });
          console.log(`[autopilot] ${brand.slug}: strategist turn enqueued (${strategistTasks.length} task/s)`);
        } else if (turn.reason === 'fresh' || turn.reason === 'thread_busy') {
          // thread_busy = il giro precedente sta ancora lavorando: non è un guasto, è il posto tenuto.
          recordLoopTick({ loop: 'strategy_review', brandId: brand.id, outcome: 'skipped', reason: 'fresh' });
        } else {
          recordLoopTick({ loop: 'strategy_review', brandId: brand.id, outcome: 'failed', reason: turn.reason });
        }
      } catch (e) {
        console.warn('[autopilot] strategist enqueue failed (continuing):', e instanceof Error ? e.message : e);
      }
    }

    // STEP 4 — BLOG ARTICLE DRIP: keep the blog topped up to the brand's weekly article quota
    // (default by plan tier: Starter 2/week, Pro daily) via the same "propose from the plan" pipeline as the manual site
    // page — at most ONE article per tick, skipped once today already has one. Drafts only — the
    // user still approves/schedules before anything publishes (publishDueArticles only flips
    // 'approved' articles). Runs HERE, before the week-production branching, so the early returns
    // below (week_already_produced / awaiting_review / plan-only) can't starve the blog.
    // Best-effort: never fails the batch.
    // ponytail: front-loaded week (perWeek=3 → Mon/Tue/Wed) — deliberate; spreading evenly across
    // the week is the upgrade path if owners ask for it.
    try {
      const blogCfg = brand.blog_config as { articlesPerWeek?: unknown; enabled?: unknown } | null;
      if (blogCfg?.enabled === true && editorialPlan) {
        // Unset → plan-tier default; clamp any stored value to 0..plan max (0 = paused).
        const weekMax = blogArticlesPerWeekMax(brand.plan);
        const articlesPerWeek =
          blogCfg.articlesPerWeek == null
            ? blogArticlesPerWeek(brand.plan)
            : Math.max(0, Math.min(weekMax, Number(blogCfg.articlesPerWeek) || 0));
        // The monthly ceiling bounds the drip too, not just the month planner — otherwise a daily
        // cadence would quietly exceed the plan's allowance one article at a time.
        const { blogMonthlyUsage } = await import('./blog-generate');
        const monthly = await blogMonthlyUsage(supabase, brand.id, brand.plan).catch((error) => { swallow('blog monthly usage', error); return null; });
        if (monthly && monthly.remaining <= 0) {
          console.log(`[autopilot] ${brand.slug}: monthly blog cap reached (${monthly.used}/${monthly.cap}) — skipping drip`);
        } else if (articlesPerWeek > 0) {
          const todayTz = new Intl.DateTimeFormat('en-CA', { timeZone: brand.timezone }).format(new Date()); // YYYY-MM-DD
          const weekStartIso = wallClockToUtc(startOfWeek(new Date().toISOString(), brand.timezone), '00:00', brand.timezone);
          const dayStartMs = Date.parse(wallClockToUtc(todayTz, '00:00', brand.timezone));
          const { data: weekArts } = await supabase
            .from('brand_articles')
            .select('created_at')
            .eq('brand_id', brand.id)
            .eq('source', 'plan')
            .neq('status', 'planned') // month-plan placeholders aren't produced articles yet
            .gte('created_at', weekStartIso);
          const missing = articlesPerWeek - (weekArts?.length ?? 0);
          const doneToday = (weekArts ?? []).some((a) => Date.parse(String(a.created_at)) >= dayStartMs);
          if (!doneToday) {
            // A month-plan placeholder due today (or overdue) drives the topic; only when the plan
            // has nothing pending does the drip invent one, as before.
            const { data: planned } = await supabase
              .from('brand_articles').select('id')
              .eq('brand_id', brand.id).eq('status', 'planned')
              .lte('scheduled_for', wallClockToUtc(todayTz, '23:59', brand.timezone))
              .order('scheduled_for', { ascending: true }).limit(1).maybeSingle();
            if (planned) {
              const { generatePlannedArticle } = await import('./blog-generate');
              const id = await generatePlannedArticle(supabase, brand, planned.id);
              console.log(`[autopilot] ${brand.slug}: month-plan article ${id ? 'generated' : 'FAILED'} (${planned.id})`);
            } else if (missing > 0) {
              const { generateBlogBatchFromPlan } = await import('./blog-generate');
              // Land on today's calendar: 10:00 brand-tz if still ahead, else 30 minutes from now.
              const ten = wallClockToUtc(todayTz, '10:00', brand.timezone);
              const slot = Date.parse(ten) > Date.now() ? ten : new Date(Date.now() + 30 * 60 * 1000).toISOString();
              const nArticles = await generateBlogBatchFromPlan(supabase, brand, 1, { source: 'plan', scheduledFor: [slot] });
              console.log(`[autopilot] ${brand.slug}: ${nArticles} blog article generated (daily drip, ${missing} left this week)`);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[autopilot] blog article drip failed (continuing):', e instanceof Error ? e.message : e);
    }

    let paidBrief = '';
    try {
      const { adsAvailable } = await import('$lib/server/ads');
      if (adsAvailable(brand.plan)) {
        const { formatPaidWinnersBrief } = await import('$lib/server/ads');
        paidBrief = await formatPaidWinnersBrief(supabase, brand.id);
      }
    } catch (error) { swallow('build paid winners brief', error); }

    const strategyBrief = [gtmBrief, editorialPlan && weekIdx != null ? weekStrategyBrief(editorialPlan, weekIdx, rubrics) : '', paidBrief]
      .filter(Boolean)
      .join('\n\n');

    // Propose remakes for pending posts that already scored poorly — flag only, never auto-rerender.
    // Runs before week_already_produced / backlog / no-accounts so weak drafts still surface.
    try {
      const { flagWeakPendingPosts } = await import('./autopilot-media-propose');
      const n = await flagWeakPendingPosts(supabase, brand.id);
      if (n) console.log(`[autopilot] ${brand.slug}: proposed remake on ${n} weak-media pending post(s)`);
    } catch (e) {
      console.warn('[autopilot] media remake propose failed (continuing):', e instanceof Error ? e.message : e);
    }

    // Batch size: the post count the user approved on the plan's week (content-mix sum) when a
    // plan drives this run, else the cadence default. Always clamped to the remaining quota.
    const desired = editorialPlan && weekIdx != null ? postsForWeek(editorialPlan, weekIdx) : countForFrequency(prefs.frequency);

    // THE WEEK/CYCLE IS ALREADY PRODUCED → do nothing (and send nothing). Without this guard every
    // due tick re-planned from scratch: duplicate batches and a review email per tick — the
    // "troppe email, generazioni ripetute" bug. For editorial-plan brands we count posts against
    // the current editorial week's batch containers; for brands WITHOUT a plan we check whether a
    // recent autopilot batch (within one cadence window) already has enough posts.
    let alreadyProduced = 0;
    if (editorialPlan?.id && weekIdx != null) {
      const { data: weekPlans } = await supabase
        .from('content_plans')
        .select('id')
        .eq('brand_id', brand.id)
        .eq('editorial_plan_id', editorialPlan.id)
        .eq('editorial_week', weekIdx)
        .neq('status', 'draft'); // drafts aren't produced posts yet — the draft flow handles them
      const ids = (weekPlans ?? []).map((p) => p.id as string);
      if (ids.length) {
        const { count: n } = await supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .in('plan_id', ids);
        alreadyProduced = n ?? 0;
      }
    } else {
      // No editorial plan: guard against re-planning within the same cadence cycle by checking the
      // most recent autopilot batch. If it was produced (non-draft, has posts) within one cadence
      // window, the cycle is done — skip silently instead of creating yet another draft + email.
      const freqWindow = prefs.frequency === 'daily' ? 1 * 24 * 60 * 60 * 1000
        : prefs.frequency === '5/week' ? 1.4 * 24 * 60 * 60 * 1000
        : prefs.frequency === '3/week' ? 3.5 * 24 * 60 * 60 * 1000
        : 6.5 * 24 * 60 * 60 * 1000;
      const since = new Date(Date.now() - freqWindow).toISOString();
      const { data: recentBatches } = await supabase
        .from('content_plans')
        .select('id')
        .eq('brand_id', brand.id)
        .in('source', ['scheduled_cron', 'rollover'])
        .neq('status', 'draft')
        .gte('created_at', since);
      const batchIds = (recentBatches ?? []).map((p) => p.id as string);
      if (batchIds.length) {
        const { count: n } = await supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .in('plan_id', batchIds);
        alreadyProduced = n ?? 0;
      }
    }
    if (alreadyProduced >= desired) {
      await supabase.from('scheduler_runs').update({ status: 'completed', posts_created: 0 }).eq('id', runId);
      await supabase
        .from('brands')
        .update({ last_autopilot_run_at: new Date().toISOString(), autopilot_failure_count: 0 })
        .eq('id', brand.id);
      return { ran: false, reason: 'week_already_produced', runId };
    }

    // PENDING BACKLOG CAP: a deep queue of stale pending_user posts (over the cap, each older than
    // a week) means the approval gate — not the generator — is the bottleneck. Producing more would
    // only deepen the pile, so skip THIS run's production. The flywheel sync and the weekly
    // recap/GTM/plan/rollover/blog steps above already ran; approving or publishing existing posts
    // is never blocked. One incident per day per brand (unique brand_id+kind+detected_on).
    const { count: pendingBacklog } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id)
      .eq('status', 'pending_user')
      .lt('created_at', new Date(Date.now() - PENDING_BACKLOG_AGE_MS).toISOString());
    if ((pendingBacklog ?? 0) > PENDING_BACKLOG_CAP) {
      // detected_on is GENERATED ALWAYS (migration 0084) — never send it in the payload,
      // or the upsert fails with 428C9 (and the swallowed error means no incident at all).
      await supabase.from('incidents').upsert(
        {
          brand_id: brand.id,
          kind: 'pending_backlog',
          severity: 'warning',
          details: { pending: pendingBacklog ?? 0, olderThanDays: 7 }
        },
        { onConflict: 'brand_id,kind,detected_on' }
      );
      console.warn(
        `[autopilot] ${brand.slug}: ${pendingBacklog} pending_user posts older than 7d (cap ${PENDING_BACKLOG_CAP}) — production skipped this run.`
      );
      await supabase.from('scheduler_runs').update({ status: 'completed', posts_created: 0 }).eq('id', runId);
      await supabase
        .from('brands')
        .update({ last_autopilot_run_at: new Date().toISOString(), autopilot_failure_count: 0 })
        .eq('id', brand.id);
      return { ran: false, reason: 'pending_backlog', runId };
    }

    // SOCIAL ACCOUNTS: the no-accounts produce gate below is the only thing that needs them.
    const { data: accounts } = await supabase
      .from('social_accounts')
      .select('platform')
      .eq('brand_id', brand.id)
      .eq('status', 'active');

    // NO ACTIVE SOCIAL ACCOUNT → every post this run produced would sit un-publishable in the
    // approval queue (publish has no account to push to). Skip production for THIS run with a
    // once-per-day incident, same pattern as the pending-backlog cap. Everything before this
    // point already ran — flywheel sync, recap, GTM, plan bootstrap/rollover and the blog drip
    // keep working; only draft/count/produce are gated. Manual produce and the CLI are NOT
    // affected.
    // The query above already filters status='active', and the select projects only platform —
    // so the presence of any row IS the check (never filter on a.status, which is not selected).
    //
    // ECCEZIONE: i piani "prepara ed esporta". Go è venduto con `socialsIncluded: 0` e la promessa
    // "You publish. We prepare." — 15 post al mese da esportare — quindi ha zero account *per
    // progetto*, non per dimenticanza. Senza questa riga il gate scattava a ogni run e un cliente
    // Go pagante non riceveva mai un post: la condizione che doveva proteggerlo dallo spreco gli
    // toglieva esattamente ciò che aveva comprato. Free e trial restano gated (nessuna promessa
    // pagata da mantenere, e produrre per chi non può né pubblicare né esportare è solo costo).
    if (!(accounts ?? []).length && !isExportOnlyPlan(brand.plan)) {
      // detected_on is GENERATED ALWAYS (migration 0084) — never send it in the payload,
      // or the upsert fails with 428C9 (and the swallowed error means no incident at all).
      await supabase.from('incidents').upsert(
        {
          brand_id: brand.id,
          kind: 'no_social_accounts',
          severity: 'warning',
          details: { accounts: 0 }
        },
        { onConflict: 'brand_id,kind,detected_on' }
      );
      console.warn(
        `[autopilot] ${brand.slug}: no active social accounts — production skipped this run (connect one in Settings → Connected accounts).`
      );
      await supabase.from('scheduler_runs').update({ status: 'completed', posts_created: 0 }).eq('id', runId);
      await supabase
        .from('brands')
        .update({ last_autopilot_run_at: new Date().toISOString(), autopilot_failure_count: 0 })
        .eq('id', brand.id);
      return { ran: false, reason: 'no_social_accounts', runId };
    }

    const count = Math.min(desired - alreadyProduced, budget.posts);
    // Internal video guardrail: cap the run's videos at the plan's remaining monthly video
    // headroom (videoCap − used, already clamped at 0), never more than the posts we generate.
    // This is why videoCap matters — a real clip costs ~25x an image, so an uncapped recurring
    // planner could quietly blow the per-plan cost budget. Invisible to the user.
    const maxVideos = Math.min(budget.videos, count);

    // TWO-STEP AUTOPILOT (pre-approval): the latest in-review draft of planned rows, if any —
    // created by a previous autopilot pass or by the user on /plan.
    const { data: draftRows } = await supabase
      .from('content_plans')
      .select('id, seeds, created_at')
      .eq('brand_id', brand.id)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1);
    const draft = draftRows?.[0] ?? null;

    // A draft still inside its review window: give the user their full grace period — the tick
    // re-invokes us (draft-age clause) the moment it expires. Mark the audit row and skip.
    if (draft) {
      const age = Date.now() - Date.parse(String(draft.created_at ?? ''));
      if (Number.isFinite(age) && age < REVIEW_GRACE_MS) {
        await supabase.from('scheduler_runs').update({ status: 'completed', posts_created: 0 }).eq('id', runId);
        return { ran: false, reason: 'awaiting_review', runId };
      }
    }

    // ── IL SEAM DEL PRODUTTORE (design, non ancora implementato) ─────────────
    // La promozione del Produttore a turno pieno passa ESATTAMENTE da qui: il ragionamento è i
    // due passi qui sotto (planWeekStrategy → executeWeekStrategy, cioè quello che in chat fa già
    // `produce_week`), la CONSEGNA è tutto il resto di questa funzione (quota, guardrail video,
    // scheduler_runs, approvazione/auto-publish, email, riconciliazione Zernio) e resta codice.
    // Il turno promosso chiamerebbe `produce_week` dal thread `job:autopilot`; i tool possiedono
    // già la consegna. Non si è tagliato ORA perché draft/grace/two-step qui sopra intrecciano
    // ragionamento e consegna nello stesso ramo — spostarli a metà è il mezzo-rewrite da evitare.
    if (!draft) {
      // STEP 1 — PLAN ONLY: draft the week's rows (pass 1, no captions/images, no quota) and
      // email the owner to review them on /plan. If they edit & approve there, production runs
      // immediately with their rows; if they don't act within the cadence window, the next due
      // run finds this draft and produces it (Anomalia's proposal = the default).
      const strategy = await planWeekStrategy(
        profile,
        {
          platforms,
          prefs,
          maxVideos,
          topPosts,
          strategyBrief,
          competitorThumbUrls,
          marketBrief,
          rubrics,
          supabase,
          brandId: brand.id,
          weekIndex: weekIdx ?? undefined,
          timezone: brand.timezone
        },
        count
      );
      const { error: draftErr } = await supabase.from('content_plans').insert({
        brand_id: brand.id,
        title: `Autopilot · ${new Date().toISOString().slice(0, 10)}`,
        source: 'scheduled_cron',
        status: 'draft',
        seeds: strategy,
        editorial_plan_id: editorialPlan && weekIdx != null ? (editorialPlan.id ?? null) : null,
        editorial_week: editorialPlan && weekIdx != null ? weekIdx : null
      });
      if (draftErr) throw new Error(draftErr.message);

      let emailed = false;
      if (owner?.email && appBase) {
        const url = `${appBase}/app/${brand.slug}/plan`;
        emailed = (await emailAll(
          (l, to) => weekReviewEmail(l, brand.name, strategy.seeds.length, url, to),
          { url, tag: `week-review-${brand.id}` }
        )) > 0;
      }

      await supabase.from('scheduler_runs').update({ status: 'completed', posts_created: 0 }).eq('id', runId);
      await supabase
        .from('brands')
        .update({ last_autopilot_run_at: new Date().toISOString(), autopilot_failure_count: 0 })
        .eq('id', brand.id);
      return { ran: true, runId, planned: true, postsCreated: 0, emailed };
    }

    // STEP 2 / FULL-AUTO — PRODUCE: the batch container is the approved/lapsed draft itself
    // (flipped to 'proposed' once production lands) or a fresh row for the full-auto path.
    let planId: string;
    if (draft) {
      planId = draft.id as string;
    } else {
      const title = `Autopilot · ${new Date().toISOString().slice(0, 10)}`;
      const { data: plan, error: planErr } = await supabase
        .from('content_plans')
        .insert({
          brand_id: brand.id,
          title,
          source: 'scheduled_cron',
          status: 'proposed',
          // Link the batch to the editorial week it executes (null for legacy/lapsed plans).
          editorial_plan_id: editorialPlan && weekIdx != null ? (editorialPlan.id ?? null) : null,
          editorial_week: editorialPlan && weekIdx != null ? weekIdx : null
        })
        .select('id')
        .single();
      if (planErr || !plan) throw new Error(planErr?.message ?? 'Could not start a plan');
      planId = plan.id as string;
    }

    // A post is a "video" for guardrail accounting when its FORMAT is reel/short/video — same
    // test content-preview uses to clamp. NOTE: autopilot does NOT render real clips (fal/video
    // rendering lives only in the manual generate endpoint); a video-format post here keeps its
    // cover image (content_type 'generated_image'). We deliberately still RESERVE video budget for
    // those format-tagged posts even though no clip is rendered — a conservative, cost-safe choice
    // that under-produces video rather than risk overspending the monthly ceiling. (This is
    // intentionally NOT parity with the manual path, which charges only for clips that rendered.)
    const isVideoFormat = (format: string | null | undefined) => normalizeContentFormat(format) === 'video';

    // Posts are COLLECTED as they render and persisted only after the Director's final review —
    // its rewrites/re-renders/flags must land on the rows, so persistence can't race the review.
    const produced: PreviewPost[] = [];
    let createdPosts = 0;
    let videoFormatPosts = 0;
    const createdPostIds: string[] = [];
    let queuedReviews = 0;

    const persist = async (post: PreviewPost) => {
      // Click path: turn an own-site CTA into a tracked short link (+UTM) BEFORE the row is
      // written, so caption and link_url ship the /l/<code> the weekly recap counts. Mutates the
      // post in place and never throws; a no-op for posts without a brand link. Every row here is
      // source 'plan' (never Radar), which is exactly the caller rule enrichCtaWithUtm documents.
      await enrichCtaWithUtm(supabase, { id: brand.id, slug: brand.slug }, post);
      // No real clip rendering in autopilot — cover image for video formats, image for the rest.
      const video = isVideoFormat(post.format);
      // 'uploaded_image' when the planner reused a library asset pixel-perfect (__fromLibrary):
      // it's the user's own photo, so publish must NOT tag it as AI-generated media.
      const contentType =
        post.media === 'text'
          ? 'text'
          : post.media === 'link'
            ? 'link'
            : // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (post as any).__fromLibrary
              ? 'uploaded_image'
              : 'generated_image';
      const { data: row } = await supabase
        .from('posts')
        .insert({
          brand_id: brand.id,
          plan_id: planId,
          platform: String(post.platform ?? '').toLowerCase() || null,
          // Cross-post target set (publish fans out to every active account in it).
          platforms: post.platforms && post.platforms.length > 1 ? post.platforms : null,
          content_type: contentType,
          source: 'plan',
          // The typed production format (ContentFormat enum) — persisted so the video intent and
          // (from the carousel work) the multi-image rendering survive on the row.
          format: post.format ?? null,
          caption: post.caption ?? null,
          title: post.title?.trim() || null,
          link_url: post.link_url || null,
          subreddit: post.subreddit?.trim() || null,
          image_prompt: post.image_prompt ?? null,
          // Carousel columns: slide prompts + ordered slide URLs; media_url stays the first
          // slide/cover so every single-image reader keeps working.
          image_prompts: post.image_prompts?.length ? post.image_prompts : null,
          media_url: post.imageUrl ?? null,
          media_urls: post.imageUrls && post.imageUrls.length > 1 ? post.imageUrls : null,
          product_name: post.product?.trim() || null,
          pillar: post.pillar?.trim() || null,
          rubric_id: post.rubricId ?? null,
          slot: [post.day, post.time].filter(Boolean).join(' ') || null,
          status: 'pending_user',
          scheduler_run_id: runId,
          // Confidence channel: image-QC verdict + deviazione di scena dichiarata + Director flag.
          qc: postQcPayload(post),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          needs_attention: !!(post as any).__attention,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          attention_reason: ((post as any).__attention as string | undefined) ?? null
        })
        .select('id')
        .single();
      if (row?.id) {
        createdPosts += 1;
        createdPostIds.push(row.id as string);
        // Visual metadata (P2 learning loop): deterministic, zero-cost, never blocks the post.
        try {
          const { writeVisualMeta } = await import('$lib/server/visual-meta');
          await writeVisualMeta(supabase, brand.id, { ...post, id: row.id as string });
        } catch (e) {
          console.warn('[scheduler] writeVisualMeta', e instanceof Error ? e.message : e);
        }
        // Count video-format posts only when persisted, capped by maxVideos — the planner
        // already downgraded excess videos to images, so this matches what we passed in.
        if (video && videoFormatPosts < maxVideos) videoFormatPosts += 1;
        if (post.knowledgeChunkIds?.length) {
          try {
            const { recordChunkUsedByPost } = await import('$lib/server/knowledge');
            await recordChunkUsedByPost(supabase, brand.id, row.id as string, post.knowledgeChunkIds);
          } catch (e) {
            console.warn('[scheduler] recordChunkUsedByPost', e instanceof Error ? e.message : e);
          }
        }
        if (post.imageUrl) {
          try {
            const { queueVideoReview } = await import('$lib/server/video-review-store');
            const ok = await queueVideoReview(supabase, {
              brandId: brand.id,
              url: post.imageUrl,
              postId: row.id as string
            });
            if (ok) queuedReviews += 1;
          } catch (e) {
            console.warn('[scheduler] queueVideoReview', e instanceof Error ? e.message : e);
          }
        }
      }
    };

    if (draft) {
      // Produce the DRAFT rows exactly as they stand (the user's edits from /plan, or Anomalia's own
      // proposal when the review window lapsed) — pass 2 + renders, never a re-plan. Clamped to
      // the remaining quota.
      const strategy = normalizeWeeklyStrategy(draft.seeds);
      const posts = await executeWeekStrategy(
        profile,
        { ...strategy, seeds: strategy.seeds.slice(0, Math.max(1, budget.posts)) },
        prefs,
        maxVideos,
        carouselMaxPerBatch(),
        {
          supabase,
          brandId: brand.id,
          userId: brand.id,
          timezone: brand.timezone,
          strategyBrief,
          topPosts,
          onProgress: () => {}
        }
      );
      await renderPreviewImages(profile, posts, {
        supabase,
        userId: brand.id,
        brandId: brand.id,
        onProgress: () => {},
        onPost: (post) => {
          produced.push(post);
        }
      });
    } else {
      await generatePreview(
        profile,
        {
          supabase,
          // Storage path prefix. We have no end-user session here, so anchor uploads under the
          // owner's id (brand.org_id resolves to one owner) — kept simple: use the brand id, which
          // is unique and brand-scoped, matching how the public 'media' bucket is partitioned.
          userId: brand.id,
          platforms,
          prefs,
          maxVideos,
          // Carousel budget for this batch (env CAROUSEL_MAX_PER_BATCH, default 1; 0 = off).
          maxCarousels: carouselMaxPerBatch(),
          // Approved rubrics constrain the seeds ([] = pre-rubric behaviour).
          rubrics,
          // Recent winners ground the strategy in what has performed for this brand (the flywheel).
          topPosts,
          // The current editorial-plan week (theme + focus + the user's brief) — '' for legacy brands.
          strategyBrief,
          // Competitor anti-moodboard: differentiate the batch's visuals from the field's clichés.
          competitorThumbUrls,
          // Weekly market format/hook catalog (empty until first Monday refresh).
          marketBrief,
          // No streaming consumer in the cron context; progress is a no-op.
          onProgress: () => {},
          onPost: (post) => {
            produced.push(post);
          }
        },
        count
      );
    }

    // Director: skip when produce agent already approved (single quality gate). Otherwise run
    // the multimodal batch review before persist. Best-effort.
    const directorLog =
      produced.length && !isProduceApproved(produced)
        ? await runDirector({
            supabase,
            userId: brand.id,
            brandId: brand.id,
            profile,
            posts: produced,
            brief: strategyBrief
          }).catch((error) => { swallow('director pass', error); return null; })
        : null;
    if (directorLog) await supabase.from('content_plans').update({ director_log: directorLog }).eq('id', planId);

    await Promise.all(produced.map((post) => persist(post)));

    if (queuedReviews > 0) {
      try {
        const { kickVideoReviewWork } = await import('$lib/server/video-review-store');
        await kickVideoReviewWork(appBase || undefined, brand.id);
      } catch (e) {
        console.warn('[scheduler] kickVideoReviewWork', e instanceof Error ? e.message : e);
      }
    }

    // The draft's rows are now real posts — flip the container into the normal approval flow.
    if (draft && createdPosts > 0) {
      await supabase.from('content_plans').update({ status: 'proposed' }).eq('id', planId);
    }

    // The editorial week now has a real batch against it — reflect that on the plan document.
    if (editorialPlan?.id && weekIdx != null && createdPosts > 0) {
      await setWeekStatus(supabase, editorialPlan.id, weekIdx, 'planned').catch(swallow('set week status'));
    }

    // Charge the month for what actually persisted (posts + the video-format posts we kept).
    await addUsage(supabase, brand.id, monthKey(brand.timezone), {
      posts: createdPosts,
      videos: videoFormatPosts
    });

    // Soft warning: email the brand owner if credits crossed 80% (once per billing period).
    const { getCreditsUsage, maybeSendCreditWarning } = await import('./credits');
    const creditUsage = await getCreditsUsage(supabase, { id: brand.id, plan: brand.plan, activated_at: null, status: 'active' });
    await maybeSendCreditWarning(supabase, { id: brand.id, name: brand.name, org_id: brand.org_id, plan: brand.plan, slug: brand.slug }, creditUsage);

    // ROUTING AFTER THE DIRECTOR — there is exactly one route: the approval queue.
    // The autopilot produces, it never publishes. Every post this run created stays 'pending_user'
    // until a person approves that specific post, from the Approvals page or the one-tap email.
    // This is the human review the AI Act's Art. 50(2) text exemption rests on (see
    // publishing-settings.ts) and the oversight Art. 14 / Art. 26 expect — so it is a property of
    // the code, not a setting. There is deliberately no branch here to add a bypass back to.
    const { data: freshPosts } = await supabase
      .from('posts')
      .select('id, brand_id, platform, platforms, caption, platform_captions, slot, media_url, media_urls, scheduled_for, content_type, title, link_url, subreddit, format, needs_attention, attention_reason, source_url, source, plan_row_id, angle')
      .eq('scheduler_run_id', runId)
      .eq('status', 'pending_user');

    const needsApproval = freshPosts ?? [];

    // ONE approval email for everything that still needs a human. Reuse the stateless signed
    // token + /approve/[token] flow (no DB row, 3-day expiry). The cron has no url.origin, so we
    // build the link from PUBLIC_APP_URL. Email is best-effort: a send failure must NOT fail the
    // whole run (the posts are safely persisted as pending_user and visible on the Approvals page).
    let emailed = false;
    const approvalCount = needsApproval?.length ?? 0;
    if (approvalCount > 0) {
      if (contacts.length && appBase) {
        const token = signApproveToken(brand.id);
        const approveUrl = `${appBase}/approve/${token}`;
        // Send failures are swallowed per-recipient inside emailAll — a bad address must NOT
        // fail the run (the posts are safely persisted as pending_user).
        emailed = (await emailAll(
          (l, to) => ({
            to,
            subject: schedulerEmailSubject(l, brand.name, approvalCount),
            html: schedulerApprovalEmailHtml(l, brand.name, approvalCount, approveUrl, appBase),
            text: schedulerApprovalEmailText(l, brand.name, approvalCount, approveUrl)
          }),
          { url: approveUrl, tag: `approval-${brand.id}` }
        )) > 0;
      } else {
        console.warn(
          `[autopilot] ${brand.slug}: ${approvalCount} posts need approval but ${
            !contacts.length ? 'no recipient email' : 'PUBLIC_APP_URL unset'
          } — left as pending_user.`
        );
      }
    }

    // Success: record the run, reset the failure streak, stamp the last-run time (this is what
    // the tick's "due" check reads next time).
    await supabase
      .from('scheduler_runs')
      .update({ status: 'completed', posts_created: createdPosts })
      .eq('id', runId);
    await supabase
      .from('brands')
      .update({ last_autopilot_run_at: new Date().toISOString(), autopilot_failure_count: 0 })
      .eq('id', brand.id);

    return { ran: true, runId, postsCreated: createdPosts, emailed, recapSent, gtmReviewed, gtmAdjusted, planGenerated };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Autopilot run failed';
    // Record the failure on the run row…
    await supabase.from('scheduler_runs').update({ status: 'failed', error: message }).eq('id', runId);
    // …and bump the brand's consecutive-failure counter, auto-disabling at the threshold so a
    // persistently broken brand never spams. We read-then-write (service role, no session); a
    // single brand never runs concurrently, so the race window is negligible.
    const nextCount = (brand.autopilot_failure_count ?? 0) + 1;
    const disable = nextCount >= MAX_CONSECUTIVE_FAILURES;
    await supabase
      .from('brands')
      .update({ autopilot_failure_count: nextCount })
      .eq('id', brand.id);
    // Il watchdog spegne scrivendo un opt-out VISIBILE sul roster (actor 'watchdog'), non più il
    // booleano invisibile: sulla pagina /agents il producer appare "off" e si riaccende da lì.
    if (disable) {
      await recordSystemJobOptOut(supabase, { brandId: brand.id, jobKey: 'autopilot', actor: 'watchdog' });
    }
    return { ran: false, reason: message, runId };
    }
  });
}

// ── Autopilot lifecycle emails (IT/EN, minimal HTML) ─────────────────────────
// Small, self-contained templates for the two-step autopilot + plan rollover. Kept local to the
// scheduler (the richer approval templates live in email.ts); locale follows the owner's UI
// language, tone stays confident and hype-free.

type MailPayload = { to: string; subject: string; html: string; text: string };

function mailShell(body: string, ctaLabel: string, url: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1d1d1f;">
  <p style="font-size:15px;line-height:1.6;">${body}</p>
  <p style="margin:24px 0;"><a href="${url}" style="background:#1d1d1f;color:#fff;text-decoration:none;border-radius:980px;padding:12px 22px;font-weight:600;font-size:14px;display:inline-block;">${ctaLabel}</a></p>
  <p style="font-size:12px;color:#86868b;">Anomalia</p>
</div>`;
}

// STEP 1 of the two-step autopilot: the week's rows are drafted and await review on /plan.
function weekReviewEmail(loc: string, brandName: string, rows: number, url: string, to: string): MailPayload {
  const it = loc === 'it';
  const subject = it
    ? `Anomalia — la settimana di ${brandName} è pronta da rivedere (${rows} contenuti)`
    : `Anomalia — ${brandName}'s week is ready for review (${rows} pieces)`;
  const body = it
    ? `Anomalia ha pianificato la prossima settimana di <b>${brandName}</b>: ${rows} contenuti come righe modificabili — quando, dove, con che angolo. Rivedile e approva: niente viene prodotto finché non confermi. Se non intervieni, Anomalia procederà con la sua proposta al prossimo ciclo.`
    : `Anomalia planned <b>${brandName}</b>'s next week: ${rows} pieces as editable rows — when, where, what angle. Review and approve: nothing is produced until you confirm. If you don't act, Anomalia proceeds with its proposal on the next cycle.`;
  const cta = it ? 'Rivedi la settimana' : 'Review the week';
  return { to, subject, html: mailShell(body, cta, url), text: `${body.replace(/<[^>]+>/g, '')}\n${url}` };
}

// The lapsed-cycle fallback fired: the proposed cycle was auto-activated to keep autopilot alive.
function rolloverActivatedEmail(loc: string, brandName: string, url: string, to: string): MailPayload {
  const it = loc === 'it';
  const subject = it
    ? `Anomalia — nuovo ciclo editoriale attivato per ${brandName}`
    : `Anomalia — new editorial cycle activated for ${brandName}`;
  const body = it
    ? `Il ciclo editoriale di <b>${brandName}</b> era scaduto e il nuovo non era ancora stato approvato: Anomalia ha attivato il ciclo proposto per non fermare la pubblicazione. Puoi rivederlo e chiedere modifiche in qualsiasi momento.`
    : `<b>${brandName}</b>'s editorial cycle had lapsed with the new one still unapproved: Anomalia activated the proposed cycle so publishing never stalls. You can review it and request changes anytime.`;
  const cta = it ? 'Rivedi il piano' : 'Review the plan';
  return { to, subject, html: mailShell(body, cta, url), text: `${body.replace(/<[^>]+>/g, '')}\n${url}` };
}

// GTM bootstrapped: no plan existed, Anomalia proposed one based on brand data.
function gtmProposedEmail(loc: string, brandName: string, url: string, to: string): MailPayload {
  const it = loc === 'it';
  const subject = it
    ? `Anomalia — strategia GTM proposta per ${brandName}`
    : `Anomalia — GTM strategy proposed for ${brandName}`;
  const body = it
    ? `Anomalia ha analizzato <b>${brandName}</b> e proposto una strategia GTM su 6 mesi — obiettivi, fasi, pilastri e mix piattaforme. Rivedila e attivala per orientare la produzione di contenuti.`
    : `Anomalia analyzed <b>${brandName}</b> and proposed a 6-month GTM strategy — objectives, phases, pillars, and platform mix. Review and activate it to steer content production.`;
  const cta = it ? 'Rivedi la strategia' : 'Review strategy';
  return { to, subject, html: mailShell(body, cta, url), text: `${body.replace(/<[^>]+>/g, '')}\n${url}` };
}

// Editorial plan bootstrapped: no plan existed, Anomalia generated one.
function editorialPlanProposedEmail(loc: string, brandName: string, url: string, to: string): MailPayload {
  const it = loc === 'it';
  const subject = it
    ? `Anomalia — piano editoriale proposto per ${brandName}`
    : `Anomalia — editorial plan proposed for ${brandName}`;
  const body = it
    ? `Anomalia ha generato un piano editoriale di 4 settimane per <b>${brandName}</b> — temi, focus, mix di contenuti e cadenza. Rivedilo e attivalo per iniziare la produzione automatica.`
    : `Anomalia generated a 4-week editorial plan for <b>${brandName}</b> — themes, focus, content mix, and cadence. Review and activate it to start automatic production.`;
  const cta = it ? 'Rivedi il piano' : 'Review plan';
  return { to, subject, html: mailShell(body, cta, url), text: `${body.replace(/<[^>]+>/g, '')}\n${url}` };
}

// Inactivity reminder: brand was activated but never published anything.
function inactivityReminderEmail(loc: string, brandName: string, brandSlug: string, hasAccounts: boolean, appBase: string, to: string): MailPayload {
  const it = loc === 'it';
  const subject = it
    ? `Anomalia — ${brandName} è pronto, inizia a pubblicare`
    : `Anomalia — ${brandName} is ready, start publishing`;
  const dashboardUrl = `${appBase}/app/${brandSlug}`;
  const connectUrl = `${appBase}/app/${brandSlug}/settings`;
  let body: string;
  if (it) {
    body = hasAccounts
      ? `Hai attivato <b>${brandName}</b> ma non hai ancora pubblicato nulla. Anomalia è pronto a generare e pubblicare contenuti automaticamente — basta un click.`
      : `Hai attivato <b>${brandName}</b> ma non hai ancora collegato nessun account social. Collegalo dalla dashboard per iniziare a pubblicare automaticamente.`;
  } else {
    body = hasAccounts
      ? `You activated <b>${brandName}</b> but haven't published anything yet. Anomalia is ready to generate and publish content automatically — it just takes one click.`
      : `You activated <b>${brandName}</b> but haven't connected any social accounts yet. Connect one from the dashboard to start publishing automatically.`;
  }
  const cta = it ? 'Vai alla dashboard' : 'Go to dashboard';
  return { to, subject, html: mailShell(body, cta, hasAccounts ? dashboardUrl : connectUrl), text: `${body.replace(/<[^>]+>/g, '')}\n${hasAccounts ? dashboardUrl : connectUrl}` };
}

// Resolve the brand owner's email + UI language for the approval send.
// brands → org → owner_id → profiles.{email,locale}. Runs under the service-role client
// (RLS bypassed) since there's no session in the cron context. locale drives the email language;
// it falls back to 'en' for rows predating the preference (handled by emailLocale at the call site).
export async function brandOwnerContact(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ userId: string; email: string; locale: string | null } | null> {
  const { data: org } = await supabase
    .from('organizations')
    .select('owner_id')
    .eq('id', orgId)
    .maybeSingle();
  if (!org?.owner_id) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, locale')
    .eq('id', org.owner_id)
    .maybeSingle();
  return profile?.email
    ? { userId: org.owner_id as string, email: profile.email, locale: profile.locale ?? null }
    : null;
}

// Everyone this brand's notification emails go to: the org owner + every brand_members
// collaborator (brand sharing, 0077), deduped by email, owner first — callers use [0] as the
// "owner" for choosing the content-generation language. Service-role context, like above.
export async function brandContacts(
  supabase: SupabaseClient,
  orgId: string,
  brandId: string
): Promise<{ userId: string; email: string; locale: string | null }[]> {
  const owner = await brandOwnerContact(supabase, orgId);
  const contacts = owner ? [owner] : [];
  const { data: members } = await supabase
    .from('brand_members')
    .select('user_id')
    .eq('brand_id', brandId);
  const ids = (members ?? []).map((m) => m.user_id as string).filter(Boolean);
  if (ids.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, email, locale').in('id', ids);
    for (const p of profiles ?? []) {
      if (p.email && !contacts.some((c) => c.email.toLowerCase() === p.email.toLowerCase())) {
        contacts.push({ userId: p.id as string, email: p.email, locale: p.locale ?? null });
      }
    }
  }
  return contacts;
}
