// Viste pubbliche: un link che consegna UNO snapshot a un visitatore anonimo, mai un brand.
//
//   creazione (autenticata)                lettura (anonima)
//   brand vivo ──allowlist──> snapshot ──> riga ──> pagina /share/<token>
//
// Lo snapshot si costruisce QUI, campo per campo, e la lettura pubblica non torna mai indietro
// sulle tabelle vive: una colonna aggiunta domani a `posts` non può uscire da un link di ieri.
// Il token è casuale e ne resta solo l'impronta: un dump del database non produce link
// funzionanti. Revocato, scaduto e mai esistito passano tutti da `liveShare` e valgono `null`,
// così la risposta è identica e non conferma nemmeno che il brand esista.
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type SharedViewType } from '@anomalia/api-contracts';
import { getCalendar } from './cli-queries';
import { dedupeSocialHistory, metricNum, type SocialHistoryRow } from './social-history-metrics';
import { monthKey } from './usage';

export const SHARE_SNAPSHOT_VERSION = 1;

const TOKEN_BYTES = 32;
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);
const MIGRATION_FILE = '20260904120000_shared_views.sql';
const TOP_POSTS = 5;
const UPCOMING_SHOWN = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

export const METRIC_FIELDS = ['views', 'likes', 'comments', 'shares'] as const;

export const CALENDAR_POST_FIELDS = ['platform', 'caption', 'media_url', 'scheduled_for', 'slot', 'status'] as const;
export const CALENDAR_SNAPSHOT_FIELDS = ['brand_name', 'timezone', 'month', 'month_label', 'posts'] as const;

export const DASHBOARD_SNAPSHOT_FIELDS = ['brand_name', 'timezone', 'month', 'month_label', 'published', 'planned', 'reach', 'upcoming'] as const;

export const REPORT_POST_FIELDS = ['platform', 'caption', 'thumbnail_url', 'url', 'published_at', ...METRIC_FIELDS] as const;
export const REPORT_SNAPSHOT_FIELDS = ['brand_name', 'timezone', 'month', 'month_label', 'published', 'totals', 'platforms', 'top_posts'] as const;

export const STRATEGY_GOAL_FIELDS = ['kpi', 'target'] as const;
export const STRATEGY_PHASE_FIELDS = ['name', 'objective', 'goals'] as const;
export const STRATEGY_WEEK_FIELDS = ['week_start', 'theme', 'focus', 'status'] as const;
export const STRATEGY_PLATFORM_FIELDS = ['platform', 'share', 'role'] as const;
export const STRATEGY_SNAPSHOT_FIELDS = [
  'brand_name',
  'timezone',
  'month',
  'month_label',
  'statement',
  'cadence',
  'platforms',
  'weeks',
  'objective',
  'horizon',
  'phase'
] as const;

export const WORKSPACE_SNAPSHOT_FIELDS = ['brand_name', 'timezone', 'month', 'month_label', 'dashboard', 'calendar', 'report', 'strategy'] as const;

export class SharedViewsNotMigrated extends Error {
  constructor() {
    super(`shared_views is missing — apply supabase/migrations/${MIGRATION_FILE} before using public client links`);
    this.name = 'SharedViewsNotMigrated';
  }
}

/** La tabella dei guasti che una rotta deve saper raccontare. Ogni altro errore resta un 500 muto. */
export function shareFailure(e: unknown): { error: string; details: string } | null {
  if (e instanceof SharedViewsNotMigrated) return { error: 'shares_not_migrated', details: e.message };
  return null;
}

export type SharedViewBrand = {
  id: string;
  name: string;
  timezone: string;
  content_prefs?: Record<string, unknown> | null;
};

export type SharedViewSnapshot = Record<string, unknown>;

export type SharedViewListing = {
  id: string;
  view: SharedViewType;
  month: string | null;
  status: 'live' | 'revoked' | 'expired';
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

type ShareRow = {
  view_type: SharedViewType;
  snapshot: SharedViewSnapshot;
  snapshot_version: number;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function mintShareToken(): { token: string; token_hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, token_hash: hashShareToken(token) };
}

export function currentShareMonth(timezone: string, now = new Date()): string {
  return monthKey(timezone, now).slice(0, 7);
}

function raise(error: unknown): never {
  const code = (error as { code?: string } | null)?.code;
  if (code && MISSING_TABLE_CODES.has(code)) throw new SharedViewsNotMigrated();
  throw error;
}

/** L'unico posto dove un link smette di valere. Tre motivi, una risposta sola: `null`. */
function liveShare(row: ShareRow | null, now: Date): ShareRow | null {
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && Date.parse(row.expires_at) <= now.getTime()) return null;
  return row;
}

function shareStatus(row: { expires_at: string | null; revoked_at: string | null }, now: Date): SharedViewListing['status'] {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && Date.parse(row.expires_at) <= now.getTime()) return 'expired';
  return 'live';
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function monthBounds(month: string): { start: string; end: string } {
  const [year, index] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, index - 1, 1)).toISOString(),
    end: new Date(Date.UTC(year, index, 1)).toISOString()
  };
}

/** Lo stato che un cliente può leggere. Il workflow interno (failed, pending_user) resta dentro. */
function clientStatus(status: unknown): 'planned' | 'published' {
  return status === 'published' ? 'published' : 'planned';
}

async function buildCalendar(
  supabase: SupabaseClient,
  brand: SharedViewBrand,
  month: string
): Promise<SharedViewSnapshot> {
  const [year, index] = month.split('-').map(Number);
  const language = (brand.content_prefs?.language as string | undefined) ?? null;
  const calendar = await getCalendar(supabase, brand.id, brand.timezone, year, index, language);

  const posts = (calendar.posts as Record<string, unknown>[])
    .filter((post) => post.scheduled_for || post.slot)
    .map((post) => ({
      platform: (post.platform as string | null) ?? null,
      caption: (post.caption as string | null) ?? null,
      media_url: (post.media_url as string | null) ?? null,
      scheduled_for: (post.scheduled_for as string | null) ?? null,
      slot: (post.slot as string | null) ?? null,
      status: clientStatus(post.status)
    }))
    .sort((a, b) => String(a.scheduled_for ?? a.slot).localeCompare(String(b.scheduled_for ?? b.slot)));

  return {
    brand_name: brand.name,
    timezone: calendar.timezone,
    month,
    month_label: calendar.monthLabel,
    posts
  };
}

type ShareMetrics = Record<(typeof METRIC_FIELDS)[number], number>;

function emptyTotals(): ShareMetrics {
  return { views: 0, likes: 0, comments: 0, shares: 0 };
}

function metricsOf(row: SocialHistoryRow): ShareMetrics {
  const totals = emptyTotals();
  for (const field of METRIC_FIELDS) totals[field] = metricNum(row.metrics?.[field]);
  return totals;
}

function addMetrics(into: ShareMetrics, from: ShareMetrics) {
  for (const field of METRIC_FIELDS) into[field] += from[field];
}

const engagementScore = (m: ShareMetrics) => m.likes + m.comments * 2 + m.shares * 3 + m.views * 0.01;

async function buildMonthlyReport(
  supabase: SupabaseClient,
  brand: SharedViewBrand,
  month: string
): Promise<SharedViewSnapshot> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase
    .from('social_post_history')
    .select('source, platform, content, platform_post_url, thumbnail_url, published_at, metrics')
    .eq('brand_id', brand.id)
    .gte('published_at', start)
    .lt('published_at', end)
    .order('published_at', { ascending: false })
    .limit(500);

  if (error) raise(error);

  const rows = dedupeSocialHistory((data ?? []) as SocialHistoryRow[]);
  const totals = emptyTotals();
  const byPlatform = new Map<string, { platform: string; published: number } & ShareMetrics>();

  for (const row of rows) {
    const metrics = metricsOf(row);
    addMetrics(totals, metrics);

    const platform = (row.platform ?? 'other').toLowerCase();
    const bucket = byPlatform.get(platform) ?? { platform, published: 0, ...emptyTotals() };
    bucket.published += 1;
    addMetrics(bucket, metrics);
    byPlatform.set(platform, bucket);
  }

  const top_posts = rows
    .map((row) => ({
      platform: (row.platform ?? null) as string | null,
      caption: (row.content ?? null) as string | null,
      thumbnail_url: (row.thumbnail_url ?? null) as string | null,
      url: (row.platform_post_url ?? null) as string | null,
      published_at: (row.published_at ?? null) as string | null,
      ...metricsOf(row)
    }))
    .sort((a, b) => engagementScore(b) - engagementScore(a))
    .slice(0, TOP_POSTS);

  return {
    brand_name: brand.name,
    timezone: brand.timezone,
    month,
    month_label: monthLabel(month),
    published: rows.length,
    totals,
    platforms: [...byPlatform.values()].sort((a, b) => b.published - a.published),
    top_posts
  };
}

/**
 * La dashboard che il cliente apre: le tre cifre del mese e le prossime uscite, niente altro.
 *
 * Si compone dei due builder che esistono già invece di fare query proprie — il calendario sa
 * cosa esce, il report mensile sa cosa è uscito e quanto ha coperto. Una terza allowlist qui
 * sarebbe una terza cosa da tenere allineata a `posts`.
 */
function composeDashboard(calendar: SharedViewSnapshot, report: SharedViewSnapshot): SharedViewSnapshot {
  const posts = calendar.posts as { status: string }[];
  const planned = posts.filter((post) => post.status !== 'published');

  return {
    brand_name: calendar.brand_name,
    timezone: calendar.timezone,
    month: calendar.month,
    month_label: calendar.month_label,
    published: report.published,
    planned: planned.length,
    reach: (report.totals as Record<string, number>).views,
    upcoming: planned.slice(0, UPCOMING_SHOWN)
  };
}

async function buildDashboard(
  supabase: SupabaseClient,
  brand: SharedViewBrand,
  month: string
): Promise<SharedViewSnapshot> {
  const [calendar, report] = await Promise.all([
    buildCalendar(supabase, brand, month),
    buildMonthlyReport(supabase, brand, month)
  ]);

  return composeDashboard(calendar, report);
}

type PlanPhase = {
  name?: string;
  objective?: string;
  start_date?: string | null;
  end_date?: string | null;
  goals?: { kpi?: string; target?: string }[];
};

/**
 * La fase che governa il mese CHIESTO, non quella di oggi.
 *
 *   fasi:  |── giugno..agosto ──|── settembre..novembre ──|
 *   mese chiesto: 2026-09  ────────────────▲  questa
 *
 * Presa dall'orologio, uno snapshot congelato a settembre mostrerebbe la fase di dicembre a chi
 * apre il link a dicembre — tranne che lo snapshot è congelato, quindi mostrerebbe una fase decisa
 * dal momento della creazione e non dal mese di cui parla il link. Dal mese, invece, è la stessa
 * risposta per chiunque, sempre, e si prova senza toccare il clock.
 */
function phaseForMonth(phases: PlanPhase[], month: string): PlanPhase | null {
  const reference = Date.parse(`${month}-01T00:00:00Z`);

  return (
    phases.find((phase) => {
      if (!phase.start_date) return false;
      if (Date.parse(`${phase.start_date}T00:00:00Z`) > reference) return false;
      return !phase.end_date || Date.parse(`${phase.end_date}T23:59:59Z`) >= reference;
    }) ?? null
  );
}

/**
 * Il lavoro concordato: cosa facciamo, con che ritmo, su quali piattaforme e verso quale obiettivo.
 *
 * Solo i piani ATTIVI. Una proposta è una conversazione ancora aperta fra noi e chi decide, non
 * qualcosa da consegnare a un cliente — e `revision_feedback` è letteralmente il testo di quella
 * conversazione. Restano fuori anche `rationale`, `brief` e `products` di ogni settimana: sono
 * gli appunti di chi pianifica, non il piano.
 */
async function buildStrategy(
  supabase: SupabaseClient,
  brand: SharedViewBrand,
  month: string
): Promise<SharedViewSnapshot> {
  const [editorial, gtm] = await Promise.all([
    supabase
      .from('editorial_plans')
      .select('strategy, cadence, platform_mix, weeks')
      .eq('brand_id', brand.id)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('gtm_plans')
      .select('objective, horizon, phases')
      .eq('brand_id', brand.id)
      .eq('status', 'active')
      .maybeSingle()
  ]);

  if (editorial.error) raise(editorial.error);
  if (gtm.error) raise(gtm.error);

  const plan = (editorial.data ?? {}) as Record<string, unknown>;
  const gtmPlan = (gtm.data ?? {}) as Record<string, unknown>;

  const weeks = (Array.isArray(plan.weeks) ? plan.weeks : []) as Record<string, unknown>[];
  const mix = (Array.isArray(plan.platform_mix) ? plan.platform_mix : []) as Record<string, unknown>[];
  const phase = phaseForMonth((Array.isArray(gtmPlan.phases) ? gtmPlan.phases : []) as PlanPhase[], month);

  return {
    brand_name: brand.name,
    timezone: brand.timezone,
    month,
    month_label: monthLabel(month),
    statement: (plan.strategy as string | null) ?? null,
    cadence: (plan.cadence as string | null) ?? null,
    platforms: mix.map((entry) => ({
      platform: (entry.platform as string | null) ?? null,
      share: (entry.share as string | null) ?? null,
      role: (entry.role as string | null) ?? null
    })),
    weeks: weeks.map((week) => ({
      week_start: (week.week_start as string | null) ?? null,
      theme: (week.theme as string | null) ?? null,
      focus: (week.focus as string | null) ?? null,
      status: (week.status as string | null) ?? null
    })),
    objective: (gtmPlan.objective as string | null) ?? null,
    horizon: (gtmPlan.horizon as string | null) ?? null,
    phase: phase
      ? {
          name: phase.name ?? null,
          objective: phase.objective ?? null,
          goals: (phase.goals ?? []).map((goal) => ({ kpi: goal.kpi ?? null, target: goal.target ?? null }))
        }
      : null
  };
}

/**
 * Un link solo per tutto quello che il cliente può vedere, invece di quattro da tenere insieme.
 *
 * Non è una vista in più: è la somma esatta delle altre. Ogni sezione È lo snapshot che quella
 * vista consegnerebbe da sola, quindi il workspace non può mostrare un campo che uno dei link
 * singoli non mostrerebbe già — e un test lo verifica chiave per chiave. Le query si fanno una
 * volta e la dashboard si compone da calendario e report, che sono già qui.
 */
async function buildWorkspace(
  supabase: SupabaseClient,
  brand: SharedViewBrand,
  month: string
): Promise<SharedViewSnapshot> {
  const [calendar, report, strategy] = await Promise.all([
    buildCalendar(supabase, brand, month),
    buildMonthlyReport(supabase, brand, month),
    buildStrategy(supabase, brand, month)
  ]);

  return {
    brand_name: brand.name,
    timezone: calendar.timezone,
    month,
    month_label: calendar.month_label,
    dashboard: composeDashboard(calendar, report),
    calendar,
    report,
    strategy
  };
}

/** L'unica tabella dei tipi di vista: aggiungerne uno è una riga qui più il suo builder. */
const SNAPSHOT_BUILDERS: Record<
  SharedViewType,
  (supabase: SupabaseClient, brand: SharedViewBrand, month: string) => Promise<SharedViewSnapshot>
> = {
  calendar: buildCalendar,
  dashboard: buildDashboard,
  monthly_report: buildMonthlyReport,
  strategy: buildStrategy,
  workspace: buildWorkspace
};

export async function buildSnapshot(
  supabase: SupabaseClient,
  brand: SharedViewBrand,
  view: SharedViewType,
  month: string
): Promise<{ snapshot: SharedViewSnapshot; version: number }> {
  const snapshot = await SNAPSHOT_BUILDERS[view](supabase, brand, month);
  return { snapshot, version: SHARE_SNAPSHOT_VERSION };
}

export async function createSharedView(
  supabase: SupabaseClient,
  input: {
    brand: SharedViewBrand;
    authorId: string;
    view: SharedViewType;
    month: string;
    expiresInDays?: number;
    now?: Date;
  }
): Promise<{ id: string; token: string; view: SharedViewType; month: string; expires_at: string | null }> {
  const now = input.now ?? new Date();
  const { snapshot, version } = await buildSnapshot(supabase, input.brand, input.view, input.month);
  const { token, token_hash } = mintShareToken();
  const expires_at = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * DAY_MS).toISOString() : null;

  const { data, error } = await supabase
    .from('shared_views')
    .insert({
      brand_id: input.brand.id,
      author_id: input.authorId,
      view_type: input.view,
      snapshot,
      snapshot_version: version,
      token_hash,
      expires_at
    })
    .select('id')
    .single();

  if (error) raise(error);

  return { id: (data as { id: string }).id, token, view: input.view, month: input.month, expires_at };
}

export async function listSharedViews(
  supabase: SupabaseClient,
  brandId: string,
  now = new Date()
): Promise<SharedViewListing[]> {
  const { data, error } = await supabase
    .from('shared_views')
    .select('id, view_type, snapshot, created_at, expires_at, revoked_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) raise(error);

  return ((data ?? []) as (ShareRow & { id: string })[]).map((row) => ({
    id: row.id,
    view: row.view_type,
    month: (row.snapshot?.month as string | undefined) ?? null,
    status: shareStatus(row, now),
    created_at: row.created_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at
  }));
}

export async function revokeSharedView(
  supabase: SupabaseClient,
  brandId: string,
  id: string,
  now = new Date()
): Promise<{ id: string; revoked_at: string } | null> {
  const { data, error } = await supabase
    .from('shared_views')
    .update({ revoked_at: now.toISOString() })
    .eq('id', id)
    .eq('brand_id', brandId)
    .select('id, revoked_at')
    .maybeSingle();

  if (error) raise(error);
  if (!data) return null;

  return data as { id: string; revoked_at: string };
}

export async function readSharedView(
  admin: SupabaseClient,
  token: string,
  now = new Date()
): Promise<{ view: SharedViewType; version: number; snapshot: SharedViewSnapshot; created_at: string } | null> {
  const { data, error } = await admin
    .from('shared_views')
    .select('view_type, snapshot, snapshot_version, created_at, expires_at, revoked_at')
    .eq('token_hash', hashShareToken(token))
    .maybeSingle();

  if (error) raise(error);

  const row = liveShare(data as ShareRow | null, now);
  if (!row) return null;

  return {
    view: row.view_type,
    version: row.snapshot_version,
    snapshot: row.snapshot,
    created_at: row.created_at
  };
}
