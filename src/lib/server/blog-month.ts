/**
 * "Pianifica il mese" as a real background job (see 0128_blog_month_jobs.sql).
 *
 * The month plan produces ~28 dated topics. Writing them all and rendering ~84 images cannot happen
 * in one request (300s function cap, and a single article takes 1-2 minutes), so this module is a
 * state machine advanced one step per invocation by /api/v1/blog/month/work:
 *
 *     pending ──write texts (chunked)──▶ writing ──submit ONE image batch──▶ imaging ──▶ ready
 *
 * WHY BATCH THE IMAGES: measured live 2026-08-04, the Gemini Batch API accepts Nano Banana 2 with
 * imageConfig.aspectRatio AND inline base64 reference images, and returned a 2-request job in ~3
 * minutes. It bills at 50% of interactive, on top of Nano Banana 2 already being half of Nano Banana
 * Pro — so ~4x cheaper per image than rendering synchronously. The published SLA is 24h, which is
 * why the UI promises 12-24h and the owner gets an email instead of watching a spinner.
 *
 * 'fast' mode (top plan) skips the batch and renders inline: minutes instead of hours, full price.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { googleGenaiClient } from '$lib/server/gemini';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { withBrandContext } from '$lib/server/ai-log';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type BlogMonthMode = 'batch' | 'fast';
export type BlogMonthStatus = 'pending' | 'writing' | 'imaging' | 'translating' | 'ready' | 'failed';

export type BlogMonthJob = {
  id: string;
  brand_id: string;
  user_id: string | null;
  status: BlogMonthStatus;
  mode: BlogMonthMode;
  progress: {
    planned?: number;
    written?: number;
    images_expected?: number;
    images_applied?: number;
    translations?: number;
    /** Originals still to translate. Drained a chunk at a time, like the writing step. */
    translate_queue?: string[];
    // The articles THIS job produced. Accumulated as they're written, because the placeholder rows
    // are deleted and replaced by new ids — so the ids cannot be known when the month is planned.
    // Tracked explicitly rather than re-derived from a created_at window, which would also have
    // picked up articles the daily drip wrote in the same window.
    article_ids?: string[];
  };
  batch_name: string | null;
  manifest: Array<{ articleId: string; kind: 'cover' | 'section'; heading?: string }>;
  attempts: number;
  notified_at: string | null;
};

// How many article bodies to write per invocation. Each is a Gemini Flash call plus a humanize and
// an optimize pass; 3 fits comfortably inside the 300s budget with room for the image submit.
const WRITE_CHUNK = 3;
// A step that has been 'processing' longer than this is treated as stalled and retried.
const STALL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function client() {
  return googleGenaiClient();
}

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
  userId: string | null,
  mode: BlogMonthMode = 'batch'
): Promise<{ jobId: string | null; planned: number }> {
  // One live job per brand: a second click while the first is still running would write the same
  // placeholders twice and submit two image batches for them.
  const { data: live } = await admin
    .from('blog_month_jobs')
    .select('id')
    .eq('brand_id', brand.id)
    .in('status', ['pending', 'writing', 'imaging', 'translating'])
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
      mode,
      progress: { planned, written: 0, images_expected: 0, images_applied: 0 },
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
    .select('id, brand_id, user_id, status, mode, progress, batch_name, manifest, attempts, notified_at')
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
    .select('id, brand_id, user_id, status, mode, progress, batch_name, manifest, attempts, notified_at')
    .in('status', ['pending', 'writing', 'imaging', 'translating'])
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
      if (job.status === 'imaging') return await stepCollectImages(admin, job, brand);
      if (job.status === 'translating') return await stepTranslate(admin, job, brand);
      return false;
    });
  } catch (e) {
    await fail(admin, job, e);
    return false;
  }
}

/**
 * Write up to WRITE_CHUNK article bodies from the month's 'planned' placeholders. When the last one
 * is written, submit the image batch (or, in fast mode, finish — images were rendered inline).
 */
async function stepWrite(admin: SupabaseClient, job: BlogMonthJob, brand: AnyRec): Promise<boolean> {
  const { data: planned } = await admin
    .from('brand_articles')
    .select('id')
    .eq('brand_id', brand.id)
    .eq('status', 'planned')
    .order('scheduled_for', { ascending: true })
    .limit(WRITE_CHUNK);

  if (!planned?.length) {
    // All bodies written → hand the images to the batch API (or wrap up in fast mode).
    // Fast mode rendered its images inline while writing, so it skips straight to translations.
    if (job.mode === 'fast') return await enterTranslateOrFinish(admin, job, brand);
    return await submitImageBatch(admin, job, brand);
  }

  const { generatePlannedArticle } = await import('$lib/server/blog-generate');
  let written = job.progress?.written ?? 0;
  const articleIds = [...(job.progress?.article_ids ?? [])];
  for (const p of planned) {
    // In batch mode the images come later, so skip the inline render: withImages=false. In fast mode
    // generatePlannedArticle's normal path renders them now.
    const id = await generatePlannedArticle(admin, brand, p.id as string, {
      skipNotify: true,
      skipImages: job.mode === 'batch'
    });
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

/** Build every image request for the month's articles and submit them as ONE batch job. */
async function submitImageBatch(admin: SupabaseClient, job: BlogMonthJob, brand: AnyRec): Promise<boolean> {
  const ids = job.progress?.article_ids ?? [];
  if (!ids.length) {
    await markReady(admin, job, brand, 'no articles were written');
    return false;
  }
  const { data: articles } = await admin
    .from('brand_articles')
    .select('id, title, body_md, meta_description, cover_image')
    .eq('brand_id', brand.id)
    .in('id', ids);

  const todo = (articles ?? []).filter((a) => a.body_md);
  if (!todo.length) {
    await markReady(admin, job, brand);
    return false;
  }

  const { buildArticleImageRequests, BLOG_IMAGE_MODEL } = await import('$lib/server/content-preview');
  const requests: AnyRec[] = [];
  const manifest: BlogMonthJob['manifest'] = [];
  for (const a of todo) {
    const built = await buildArticleImageRequests(admin, brand, {
      articleId: a.id as string,
      title: String(a.title ?? ''),
      bodyMd: String(a.body_md ?? ''),
      summary: (a.meta_description as string | null) ?? undefined,
      needCover: !a.cover_image,
      max: 2
    });
    for (const b of built) {
      // The batch job carries ONE model; buildImageRequest sets it per request, so drop it here and
      // keep only contents+config (a per-request model would be ignored anyway).
      requests.push({ contents: b.request.contents, config: b.request.config });
      manifest.push(b.dest);
    }
  }
  if (!requests.length) {
    await markReady(admin, job, brand);
    return false;
  }

  const batch = await client().batches.create({ model: BLOG_IMAGE_MODEL, src: requests });
  console.log(`[blog-month] job ${job.id}: submitted ${requests.length} images as ${batch.name}`);
  await patch(admin, job.id, {
    status: 'imaging',
    batch_name: batch.name,
    manifest,
    progress: { ...job.progress, images_expected: requests.length, images_applied: 0 },
    attempts: 0,
    error: null,
    step_started_at: null
  });
  return false; // nothing to do until the provider finishes
}

/** Poll the image batch; when it's done, upload each image and apply it to its article. */
async function stepCollectImages(admin: SupabaseClient, job: BlogMonthJob, brand: AnyRec): Promise<boolean> {
  if (!job.batch_name) {
    await markReady(admin, job, brand);
    return false;
  }
  const batch = await client().batches.get({ name: job.batch_name });
  const state = String(batch.state ?? '');
  if (state.endsWith('PENDING') || state.endsWith('RUNNING')) {
    console.log(`[blog-month] job ${job.id}: batch ${state}`);
    await patch(admin, job.id, { step_started_at: null }); // re-arm for the next tick
    return false;
  }
  if (!state.endsWith('SUCCEEDED')) {
    // FAILED / CANCELLED / EXPIRED — the articles keep their text, they just stay imageless.
    console.warn(`[blog-month] job ${job.id}: batch ended ${state}`);
    await markReady(admin, job, brand, `image batch ended ${state}`);
    return false;
  }

  const { uploadPostImage, imageFromResponse, spliceImageUnderHeading } = await import('$lib/server/content-preview');
  const responses = batch.dest?.inlinedResponses ?? [];
  // Group by article so each body is read and written once, not once per image.
  const byArticle = new Map<string, Array<{ dest: BlogMonthJob['manifest'][number]; dataUrl: string }>>();
  job.manifest.forEach((dest, i) => {
    const dataUrl = imageFromResponse((responses[i]?.response ?? {}) as never);
    if (!dataUrl) return;
    byArticle.set(dest.articleId, [...(byArticle.get(dest.articleId) ?? []), { dest, dataUrl }]);
  });

  let applied = 0;
  for (const [articleId, items] of byArticle) {
    const { data: a } = await admin
      .from('brand_articles')
      .select('body_md, cover_image')
      .eq('id', articleId)
      .eq('brand_id', brand.id)
      .maybeSingle();
    if (!a) continue;
    let bodyMd = String(a.body_md ?? '');
    let cover = (a.cover_image as string | null) ?? null;
    for (const { dest, dataUrl } of items) {
      const url = await uploadPostImage(admin, brand.id as string, dataUrl, '16:9').catch((error) => { swallow('upload post image', error); return undefined; });
      if (!url) continue;
      if (dest.kind === 'cover') cover = cover ?? url;
      else if (dest.heading) bodyMd = spliceImageUnderHeading(bodyMd, dest.heading, url);
      applied++;
    }
    await admin
      .from('brand_articles')
      .update({ body_md: bodyMd, cover_image: cover, updated_at: new Date().toISOString() })
      .eq('id', articleId)
      .eq('brand_id', brand.id);
  }

  console.log(`[blog-month] job ${job.id}: applied ${applied}/${job.manifest.length} images`);
  await patch(admin, job.id, { progress: { ...job.progress, images_applied: applied } });
  return await enterTranslateOrFinish(
    admin,
    { ...job, progress: { ...job.progress, images_applied: applied } },
    brand,
    applied ? undefined : 'no images returned'
  );
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
