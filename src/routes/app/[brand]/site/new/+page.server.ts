import { swallow } from '$lib/server/swallow';
import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { isTopPlan, blogTranslationLanguages } from '$lib/server/plans';
import { brandBySlug } from '$lib/server/blog-settings';
import { blogMonthlyUsage } from '$lib/server/blog-generate';
import { estimateBlogMonth } from '$lib/server/blog-cost';
import { getCreditsUsage, type Brand } from '$lib/server/credits';
import { currentBlogMonthJob, kickBlogMonthWork, startBlogMonthJob } from '$lib/server/blog-month';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

/** Credits left for this brand in the current billing period. */
async function creditsRemaining(brandId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('brands')
    .select('id, plan, activated_at, status')
    .eq('id', brandId)
    .maybeSingle();
  if (!data) return 0;
  return (await getCreditsUsage(admin, data as Brand)).remaining;
}

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand } = await parent();
  // Fast generation renders images inline instead of via the (cheaper, slower) batch API, so it's
  // the top tier's perk — below it the button becomes an upgrade CTA.
  const fastAvailable = isTopPlan(brand.plan);
  const [job, usage, credits] = await Promise.all([
    currentBlogMonthJob(supabase, brand.id).catch((error) => { swallow('current month job', error); return null; }),
    blogMonthlyUsage(createAdminClient(), brand.id, brand.plan).catch((error) => { swallow('createAdminClient failed', error); return ({ cap: 0, used: 0, remaining: 0 }); }),
    creditsRemaining(brand.id).catch((error) => { swallow('remaining credits', error); return 0; })
  ]);
  // Quote the month the user would actually get — the REMAINING allowance, not the full cap.
  const translationsPerArticle = blogTranslationLanguages(brand.plan);
  const estimate = estimateBlogMonth({ articles: usage.remaining, translationsPerArticle });
  const estimateFast = estimateBlogMonth({ articles: usage.remaining, mode: 'fast', translationsPerArticle });
  return {
    fastAvailable,
    usage,
    credits,
    estimate,
    estimateFast,
    monthJob: job && job.status !== 'ready' && job.status !== 'failed'
      ? { status: job.status, mode: job.mode, progress: job.progress }
      : null
  };
};

export const actions: Actions = {
  // Single articles are deliberately NOT capped: it's an explicit user action paid out of their credit
  // balance, and gateCredits() inside the generation already stops it when the balance is gone.
  generatePost: async ({ request, params, locals: { supabase } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const topic = String((await request.formData()).get('topic') ?? '').trim();
    if (!topic) return fail(400, { error: 'topic_required' });
    const { generateArticleFromTopic } = await import('$lib/server/blog-generate');
    const id = await generateArticleFromTopic(createAdminClient(), brand, topic);
    if (!id) return fail(502, { error: 'generation_failed' });
    throw redirect(303, `/app/${params.brand}/site/edit/${id}`);
  },

  // generateFromPlan removed from the UI — the month plan is the single "from the plan" entry point.
  // generateBlogBatchFromPlan itself stays: the autopilot drip and onboarding still call it.
  //
  // The month no longer generates anything inside this request: it plans the topics, queues a job and
  // returns. Writing ~28 articles and rendering ~84 images does not fit in one function invocation.
  planMonth: async ({ request, params, url, locals: { supabase, safeGetSession } }) => {
    const brand = await brandBySlug(supabase, params.brand);
    if (!brand) return fail(404, { error: 'Brand not found' });
    const { user } = await safeGetSession();

    // Server-side cap: the button is hidden past the ceiling, but the action must refuse too — a
    // stale page or a hand-rolled POST would otherwise plan a month the brand isn't entitled to.
    const admin = createAdminClient();
    const usage = await blogMonthlyUsage(admin, brand.id, brand.plan);
    if (usage.remaining <= 0) return fail(429, { error: 'month_cap_reached' });

    const wantsFast = String((await request.formData()).get('mode') ?? '') === 'fast';
    // Fast mode is gated on the top plan. Asking for it without the plan sends the user to checkout
    // rather than silently downgrading them to the slow path.
    if (wantsFast && !isTopPlan(brand.plan)) {
      throw redirect(303, `/app/${params.brand}/activate?plan=pro&from=blog-fast`);
    }

    // Credit pre-flight. gateCredits() is REACTIVE — it would abort mid-month and leave half the
    // placeholders empty for the user to clean up. Refusing up front turns that into a number they
    // can act on.
    const estimate = estimateBlogMonth({
      articles: usage.remaining,
      mode: wantsFast ? 'fast' : 'batch',
      translationsPerArticle: blogTranslationLanguages(brand.plan)
    });
    if ((await creditsRemaining(brand.id)) < estimate.credits) {
      return fail(402, { error: 'insufficient_credits' });
    }

    const { jobId, planned } = await startBlogMonthJob(
      admin,
      brand,
      user?.id ?? null,
      wantsFast ? 'fast' : 'batch'
    );
    if (!jobId) return fail(502, { error: 'plan_month_failed' });
    // Start immediately instead of waiting up to 2 minutes for the cron.
    void kickBlogMonthWork(url.origin);
    throw redirect(303, `/app/${params.brand}/site?from=month&n=${planned}&job=${wantsFast ? 'fast' : 'batch'}`);
  }
};
