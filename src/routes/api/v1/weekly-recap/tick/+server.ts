import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';
import { env as publicEnv } from '$env/dynamic/public';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { brandContacts } from '$lib/server/scheduler';
import { generateWeeklyRecap, runWeeklyReflection, type WeeklyRecap } from '$lib/server/weekly-recap';
import {
  weeklyRecapEmailSubject,
  weeklyRecapEmailHtml,
  weeklyRecapEmailText,
  calendarConflictEmailSubject,
  calendarConflictEmailHtml,
  calendarConflictEmailText,
  type RecapData
} from '$lib/server/email';
import { countCalendarConflicts } from '$lib/server/schedule';
import { emailLocale } from '$lib/server/email-i18n';
import { localeLanguageName } from '$lib/i18n/locale';
import { jobPausedForBrand } from '$lib/server/job-roster';
import { reportToAgentThread } from '$lib/server/team-ignition';
import { recordLoopTick } from '$lib/server/loop-ticks';

// Weekly recap tick: runs every Monday morning (08:00 UTC) for all active brands.
// Same auth pattern as the autopilot/tick endpoint.
// Supports ?brand=<slug> to test with a single brand.

export const config = { maxDuration: 300 };

function weekLabel(tz: string): string {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = new Intl.DateTimeFormat('it-IT', { timeZone: tz, day: 'numeric', month: 'short' });
  return `${fmt.format(start)} – ${fmt.format(now)}`;
}

function toRecapData(recap: WeeklyRecap, tz: string): RecapData {
  const appBase = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const eng = recap.totalEngagement;
  const prevEng = recap.prevEngagement;
  const totalEngagement = (eng.likes ?? 0) + (eng.comments ?? 0) + (eng.shares ?? 0);
  const totalImpressions = (eng.impressions ?? 0) + (eng.views ?? 0);
  const totalSaves = eng.saves ?? 0;
  const prevEngTotal = (prevEng.likes ?? 0) + (prevEng.comments ?? 0) + (prevEng.shares ?? 0);
  const prevImpTotal = (prevEng.impressions ?? 0) + (prevEng.views ?? 0);

  const abs = (url?: string) => {
    if (!url) return undefined;
    if (/^https?:\/\//i.test(url)) return url;
    return appBase ? `${appBase}${url.startsWith('/') ? url : `/${url}`}` : url;
  };

  const growthFixes =
    recap.growth && (!recap.growth.ready || recap.growth.warnings.length)
      ? [...recap.growth.blocking, ...recap.growth.warnings].map((c) => ({
          key: c.key,
          blocking: c.blocking,
          url: abs(c.fix)
        }))
      : [];

  return {
    brandName: recap.brandName,
    brandSlug: recap.brandSlug,
    weekLabel: weekLabel(tz),
    postsPublished: recap.postsPublished,
    postsPending: recap.postsPending,
    postsScheduled: recap.postsScheduled,
    totalEngagement,
    totalImpressions,
    totalSaves,
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
    dashboardUrl: appBase ? `${appBase}/app/${recap.brandSlug}` : '',
    connectedAccounts: recap.connectedAccounts,
    visualInsights: recap.visualInsights,
    webKpis: recap.webKpis,
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
}

// Process a single brand: gather data, generate recap, send email.
async function processBrand(admin: Awaited<ReturnType<typeof createAdminClient>>, brand: { id: string; name: string; slug: string; org_id: string; timezone: string }): Promise<{ slug: string; sent: boolean; skipped: boolean; error?: string }> {
  // Roster: primo controllo di tutti. Sta PRIMA della riflessione settimanale, che è la spesa AI
  // più grossa di questo tick — spegnere il lavoro deve spegnere anche quella, non solo l'email.
  if (await jobPausedForBrand('weekly_recap', brand.id)) {
    return { slug: brand.slug, sent: false, skipped: true };
  }

  // Weekly reflection FIRST (even when the recap email gets skipped): distills the last two weeks'
  // QC verdicts, Director flags, user edits and Radar signal into brand memory. Best-effort.
  await runWeeklyReflection(admin, brand.id).catch(swallow('weekly reflection'));

  // Owner + shared-brand collaborators: everyone gets the recap, each in their own language.
  // The recap CONTENT (AI suggestions, trends) is generated once in the owner's language.
  const contacts = await brandContacts(admin, brand.org_id, brand.id);
  if (!contacts.length) {
    return { slug: brand.slug, sent: false, skipped: true };
  }

  const ownerLocale = emailLocale(contacts[0].locale);
  const outputLanguage = localeLanguageName(ownerLocale);

  // Calendar double-bookings: independent of the recap, so send it even if the recap gets skipped.
  // Weekly cadence is the dedup — the persistent in-app warning covers the urgent, real-time case.
  // ponytail: weekly is the ceiling; add a dedicated daily cron + a notified-at stamp if users need
  // to hear about a fresh clash sooner than the next Monday.
  const { data: livePosts } = await admin
    .from('posts')
    .select('scheduled_for, status, slot')
    .eq('brand_id', brand.id)
    .in('status', ['pending_user', 'approved', 'scheduled']);
  const conflicts = countCalendarConflicts(livePosts ?? [], brand.timezone);
  if (conflicts > 0) {
    const appBase = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
    const calendarUrl = appBase ? `${appBase}/app/${brand.slug}/calendar` : '';
    const { notifyBrandContacts } = await import('$lib/server/brand-notify');
    await notifyBrandContacts(admin, contacts, {
      logPrefix: '[weekly-recap tick]',
      buildEmail: (l, to) => ({
        to,
        subject: calendarConflictEmailSubject(l, brand.name, conflicts),
        html: calendarConflictEmailHtml(l, brand.name, conflicts, calendarUrl),
        text: calendarConflictEmailText(l, brand.name, conflicts, calendarUrl)
      }),
      push: calendarUrl ? { url: calendarUrl, tag: `calendar-conflict-${brand.id}` } : undefined
    });
  }

  const recap = await generateWeeklyRecap(admin, brand.id, outputLanguage);
  if (!recap) {
    return { slug: brand.slug, sent: false, skipped: true };
  }

  const data = toRecapData(recap, brand.timezone);

  const { notifyBrandContacts } = await import('$lib/server/brand-notify');
  const sent = await notifyBrandContacts(admin, contacts, {
    logPrefix: '[weekly-recap tick]',
    buildEmail: (l, to) => ({
      to,
      subject: weeklyRecapEmailSubject(l, brand.name, data.weekLabel),
      html: weeklyRecapEmailHtml(l, data),
      text: weeklyRecapEmailText(l, data)
    }),
    push: data.dashboardUrl
      ? { url: data.dashboardUrl, tag: `weekly-recap-${brand.id}` }
      : undefined
  });

  // Il resoconto nel thread dell'agente, solo quando il recap è partito davvero. Non alza mai.
  if (sent > 0) {
    // Il tick 'ok' che mancava: /agents legge SOLO loop_ticks, e senza questa riga un lavoro
    // che gira ogni lunedì resta "mai girato" per sempre sulla sua card.
    recordLoopTick({ loop: 'weekly_recap', brandId: brand.id, outcome: 'ok' });
    await reportToAgentThread(admin, brand.id, {
      job: 'weekly_recap',
      published: recap.postsPublished,
      pending: recap.postsPending,
      scheduled: recap.postsScheduled
    });
  }

  return { slug: brand.slug, sent: sent > 0, skipped: false };
}

async function runTick(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const admin = createAdminClient();
  const url = new URL(request.url);
  const brandSlug = url.searchParams.get('brand');

  // Load brands — either one specific brand or all active/trial
  let query = admin
    .from('brands')
    .select('id, name, slug, org_id, timezone');
  if (brandSlug) {
    query = query.eq('slug', brandSlug);
  } else {
    query = query.in('status', ['active', 'trial']);
  }
  const { data: brands, error } = await query;

  if (error) {
    console.error('[weekly-recap tick] could not load brands:', error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

  // Process all brands in parallel — each gets its own async job
  const results = await Promise.allSettled(
    (brands ?? []).map((brand) => processBrand(admin, brand))
  );

  let sent = 0;
  let skipped = 0;
  const errors: { brand: string; reason: string }[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      const v = r.value;
      if (v.sent) sent += 1;
      else if (v.skipped) skipped += 1;
      else if (v.error) errors.push({ brand: v.slug, reason: v.error });
    } else {
      errors.push({ brand: 'unknown', reason: r.reason?.message ?? 'rejected' });
    }
  }

  return new Response(JSON.stringify({ ok: true, total: brands?.length ?? 0, sent, skipped, errors }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = ({ request }) => runTick(request);
export const POST: RequestHandler = ({ request }) => runTick(request);
