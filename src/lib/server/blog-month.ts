/**
 * "Pianifica il mese" as a real background job (see 0128_blog_month_jobs.sql).
 *
 * The month plan produces ~28 dated topics. Writing them all and rendering ~84 images cannot happen
 * in one request (300s function cap, and a single article takes 1-2 minutes), so this module is a
 * state machine advanced one step per invocation by /api/v1/blog/month/work:
 *
 *     pending ──write texts + images (chunked)──▶ writing ──▶ translating ──▶ ready
 *
 * Le immagini si rendono in linea, dallo slot immagini come ogni altro render del prodotto. Prima
 * esisteva una seconda strada: la Batch API di Google, a metà prezzo con una SLA di 24 ore. Era
 * l'ultimo punto del prodotto che parlava con Google, e in produzione non l'ha percorsa nessuno —
 * `blog_month_jobs` non ha mai avuto una riga. Uno sconto su un traffico che non esiste non paga
 * un fornitore in più.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { withBrandContext } from '$lib/server/ai-log';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type BlogMonthStatus = 'pending' | 'writing' | 'translating' | 'ready' | 'failed';

export type BlogMonthJob = {
  id: string;
  brand_id: string;
  user_id: string | null;
  status: BlogMonthStatus;
  progress: {
    planned?: number;
    written?: number;
    translations?: number;
    /** Originals still to translate. Drained a chunk at a time, like the writing step. */
    translate_queue?: string[];
    // The articles THIS job produced. Accumulated as they're written, because the placeholder rows
    // are deleted and replaced by new ids — so the ids cannot be known when the month is planned.
    // Tracked explicitly rather than re-derived from a created_at window, which would also have
    // picked up articles the daily drip wrote in the same window.
    article_ids?: string[];
  };
  attempts: number;
  notified_at: string | null;
};

// How many article bodies to write per invocation. Each is a Gemini Flash call plus a humanize and
// an optimize pass, and now the images too; 3 resta dentro il budget di 300s.
const WRITE_CHUNK = 3;
// A step that has been 'processing' longer than this is treated as stalled and retried.
const STALL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;

/** Fire-and-forget nudge so a job starts moving without waiting for the next cron tick. */
export async function kickBlogMonthWork(origin: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (env.AUTOPILOT_SECRET) headers['x-autopilot-secret'] = env.AUTOPILOT_SECRET;
  else if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
  await fetch(`${origin}/api/v1/blog/month/work`, { method: 'POST', headers }).catch(swallow('fetch failed'));
}

/**
 * Plan the month and queue the job. Returns { jobId, planned } — planned is 0 when the brand's blog
 * cadence is paused, in which case no job is created.
 */
export async function startBlogMonthJob(
  admin: SupabaseClient,
  brand: AnyRec,
  userId: string | null
): Promise<{ jobId: string | null; planned: number }> {
  // One live job per brand: a second click while the first is still running would write the same
  // placeholders twice.
  const { data: live } = await admin
    .from('blog_month_jobs')
    .select('id')
    .eq('brand_id', brand.id)
    .in('status', ['pending', 'writing', 'translating'])
    .limit(1)
    .maybeSingle();
  if (live?.id) return { jobId: live.id as string, planned: 0 };

  const { planBlogMonth } = await import('$lib/server/blog-generate');
  const planned = await planBlogMonth(admin, brand);
  if (!planned) return { jobId: null, planned: 0 };

  const { data, error } = await admin
    .from('blog_month_jobs')
    .insert({
      brand_id: brand.id,
      user_id: userId,
      status: 'pending',
      progress: { planned, written: 0 },
      step_started_at: new Date().toISOString()
    })
    .select('id')
    .maybeSingle();
  if (error || !data?.id) return { jobId: null, planned };
  return { jobId: data.id as string, planned };
}

/** The brand's current job, for the UI banner. Null when there's nothing in flight or just-ready. */
export async function currentBlogMonthJob(
  supabase: SupabaseClient,
  brandId: string
): Promise<BlogMonthJob | null> {
  const { data } = await supabase
    .from('blog_month_jobs')
    .select('id, brand_id, user_id, status, progress, attempts, notified_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return data as unknown as BlogMonthJob;
}

/** Claim advanceable jobs: queued, or stalled mid-step. */
export async function claimBlogMonthJobs(admin: SupabaseClient, limit = 2): Promise<BlogMonthJob[]> {
  const stallIso = new Date(Date.now() - STALL_MS).toISOString();
  const { data } = await admin
    .from('blog_month_jobs')
    .select('id, brand_id, user_id, status, progress, attempts, notified_at')
    .in('status', ['pending', 'writing', 'translating'])
    .or(`step_started_at.is.null,step_started_at.lt.${stallIso}`)
    .order('created_at', { ascending: true })
    .limit(limit);
  const jobs = (data ?? []) as unknown as BlogMonthJob[];
  if (jobs.length) {
    await admin
      .from('blog_month_jobs')
      .update({ step_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in('id', jobs.map((j) => j.id));
  }
  return jobs;
}

async function patch(admin: SupabaseClient, jobId: string, fields: AnyRec): Promise<void> {
  await admin.from('blog_month_jobs').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', jobId);
}

async function fail(admin: SupabaseClient, job: BlogMonthJob, e: unknown): Promise<void> {
  const message = e instanceof Error ? e.message : String(e);
  const attempts = (job.attempts ?? 0) + 1;
  console.error(`[blog-month] job ${job.id} step '${job.status}' failed (attempt ${attempts}):`, message);
  await patch(admin, job.id, {
    attempts,
    error: message.slice(0, 2000),
    // Give up after MAX_ATTEMPTS so a permanently broken job stops burning cron budget.
    ...(attempts >= MAX_ATTEMPTS ? { status: 'failed' } : {}),
    step_started_at: null
  });
}

/**
 * Advance ONE job by one step. Returns true when the job still has work left (so the caller can
 * self-chain instead of waiting for the next cron tick).
 */
export async function advanceBlogMonthJob(admin: SupabaseClient, job: BlogMonthJob): Promise<boolean> {
  const { data: brand } = await admin
    .from('brands')
    .select('id, slug, name, org_id, plan, timezone, website, content_prefs, blog_config')
    .eq('id', job.brand_id)
    .maybeSingle();
  if (!brand) {
    await patch(admin, job.id, { status: 'failed', error: 'brand not found' });
    return false;
  }

  try {
    // Everything below bills to this brand's credits.
    return await withBrandContext(brand.id as string, async () => {
      if (job.status === 'pending' || job.status === 'writing') return await stepWrite(admin, job, brand);
      if (job.status === 'translating') return await stepTranslate(admin, job, brand);
      return false;
    });
  } catch (e) {
    await fail(admin, job, e);
    return false;
  }
}

/**
 * Write up to WRITE_CHUNK article bodies from the month's 'planned' placeholders, images included.
 * When the last one is written the job moves on to the translations.
 */
async function stepWrite(admin: SupabaseClient, job: BlogMonthJob, brand: AnyRec): Promise<boolean> {
  const { data: planned } = await admin
    .from('brand_articles')
    .select('id')
    .eq('brand_id', brand.id)
    .eq('status', 'planned')
    .order('scheduled_for', { ascending: true })
    .limit(WRITE_CHUNK);

  if (!planned?.length) return await enterTranslateOrFinish(admin, job, brand);

  const { generatePlannedArticle } = await import('$lib/server/blog-generate');
  let written = job.progress?.written ?? 0;
  const articleIds = [...(job.progress?.article_ids ?? [])];
  for (const p of planned) {
    const id = await generatePlannedArticle(admin, brand, p.id as string, { skipNotify: true });
    if (id) {
      written++;
      articleIds.push(id);
    }
  }
  await patch(admin, job.id, {
    status: 'writing',
    progress: { ...job.progress, written, article_ids: articleIds },
    attempts: 0,
    error: null,
    step_started_at: null
  });
  return true;
}

/**
 * Queue translations if the blog is configured for extra locales, otherwise finish.
 * Translations run LAST on purpose: they copy the finished body, so translating before the optimize
 * pass and the images would have shipped every language a worse article with no pictures.
 */
async function enterTranslateOrFinish(
  admin: SupabaseClient,
  job: BlogMonthJob,
  brand: AnyRec,
  warning?: string
): Promise<boolean> {
  const { resolveBlogLocales } = await import('$lib/server/blog-locales');
  const { extraLocales } = resolveBlogLocales(
    brand.blog_config as Record<string, unknown> | null,
    brand.plan as string | null,
    (brand.content_prefs as AnyRec)?.language as string | null
  );
  const ids = job.progress?.article_ids ?? [];
  if (!extraLocales.length || !ids.length) {
    await markReady(admin, job, brand, warning);
    return false;
  }
  await patch(admin, job.id, {
    status: 'translating',
    progress: { ...job.progress, translate_queue: ids, translations: job.progress?.translations ?? 0 },
    attempts: 0,
    error: null,
    step_started_at: null
  });
  return true;
}

// Articles translated per invocation. Each is one Gemini Flash call per extra locale over a full
// article body, so 2 originals × up to 3 locales keeps a step well inside the function budget.
const TRANSLATE_CHUNK = 2;

/** Translate a chunk of the job's originals into every configured extra locale. */
async function stepTranslate(admin: SupabaseClient, job: BlogMonthJob, brand: AnyRec): Promise<boolean> {
  const { resolveBlogLocales } = await import('$lib/server/blog-locales');
  const { extraLocales } = resolveBlogLocales(
    brand.blog_config as Record<string, unknown> | null,
    brand.plan as string | null,
    (brand.content_prefs as AnyRec)?.language as string | null
  );
  const queue = [...(job.progress?.translate_queue ?? [])];
  if (!extraLocales.length || !queue.length) {
    await markReady(admin, job, brand);
    return false;
  }

  const { translateArticleToBlogLocales } = await import('$lib/server/blog-translate');
  const chunk = queue.splice(0, TRANSLATE_CHUNK);
  let translations = job.progress?.translations ?? 0;
  for (const articleId of chunk) {
    translations += await translateArticleToBlogLocales(admin, brand, articleId, extraLocales);
  }

  const progress = { ...job.progress, translate_queue: queue, translations };
  if (!queue.length) {
    await patch(admin, job.id, { progress });
    await markReady(admin, { ...job, progress }, brand);
    return false;
  }
  await patch(admin, job.id, { progress, attempts: 0, error: null, step_started_at: null });
  return true;
}

/** Finish the job and email the owner exactly once. */
async function markReady(admin: SupabaseClient, job: BlogMonthJob, brand: AnyRec, warning?: string): Promise<void> {
  await patch(admin, job.id, { status: 'ready', error: warning ?? null, attempts: 0, step_started_at: null });
  if (job.notified_at) return;
  const articles = job.progress?.article_ids?.length ?? job.progress?.written ?? 0;
  const translations = job.progress?.translations ?? 0;
  await notifyMonthReady(admin, brand, articles, translations).catch((e) => console.error('[blog-month] email failed:', e));
  await patch(admin, job.id, { notified_at: new Date().toISOString() });
}

async function notifyMonthReady(admin: SupabaseClient, brand: AnyRec, articles: number, translations = 0): Promise<void> {
  const { brandContacts } = await import('$lib/server/scheduler');
  if (!brand.org_id) return;
  const contacts = await brandContacts(admin, brand.org_id as string, brand.id as string);
  if (!contacts.length) return;
  const appUrl = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const manage = `${appUrl}/app/${brand.slug}/site`;
  const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:sans-serif;max-width:520px;">
    <h2 style="margin:0 0 8px;">🗓️ Il tuo mese di articoli è pronto</h2>
    <p style="color:#444;">Abbiamo scritto e illustrato <b>${articles}</b> articoli per <b>${esc(String(brand.name ?? ''))}</b>.</p>
    <p style="color:#444;">Ognuno ha testo e SEO, immagine di copertina e immagini nel testo, link interni e fonti esterne citate. Sono <b>bozze</b>: rivedile e programmale quando vuoi.</p>
    ${translations ? `<p style="color:#444;">Abbiamo anche prodotto <b>${translations} traduzioni</b> nelle altre lingue del tuo blog.</p>` : ''}
    <p style="margin:22px 0;">
      <a href="${manage}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Rivedi gli articoli</a>
    </p>
  </div>`;
  const text = `Il tuo mese di articoli è pronto: ${articles} bozze per ${brand.name}, con immagini, link interni e fonti citate.${translations ? ` Più ${translations} traduzioni.` : ''}\nRivedile: ${manage}`;
  const { notifyBrandContacts } = await import('$lib/server/brand-notify');
  await notifyBrandContacts(admin, contacts, {
    logPrefix: '[blog-month]',
    buildEmail: (_locale, to) => ({
      to,
      subject: `🗓️ ${articles} articoli pronti da rivedere — ${brand.name ?? ''}`,
      html,
      text
    }),
    push: { url: manage, tag: `blog-month-${brand.id}` }
  });
}
