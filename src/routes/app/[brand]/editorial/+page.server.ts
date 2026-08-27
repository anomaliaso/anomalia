import { swallow } from '$lib/server/swallow';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { genaiClient } from '$lib/server/research';
import { plannerProfile, planEvidence, proposeFirstPlan } from '$lib/server/planner-inputs';
import { remaining } from '$lib/server/usage';
import { withBrandContext } from '$lib/server/ai-log';
import {
  revisePlan,
  replanWeek,
  normalizePlan,
  activatePlan,
  syncPrefsFromPlan,
  cadenceAllowed,
  CADENCES,
  currentWeekIndex,
  type EditorialPlan
} from '$lib/server/editorial-plan';
import { activeGtmBrief } from '$lib/server/gtm';
import { localeLanguageName } from '$lib/i18n/locale';
import { cachedBrandPage } from '$lib/server/page-cache';

// The Strategy page: the brand's living editorial plan. The active plan is shown (and edited)
// here; conversational feedback produces a 'proposed' revision the user approves or discards;
// per-week briefs trigger a replan of that week; brands created before the editorial-plan era
// can generate their first proposal on demand from everything already stored about them.

// The revise/replan/propose actions each carry one Gemini call (~15-30s) — give the function room.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

type BrandRow = {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  timezone: string;
  target_platforms: unknown;
  content_prefs: unknown;
};

async function requireBrand(supabase: SupabaseClient, slug: string): Promise<BrandRow> {
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, slug, plan, timezone, target_platforms, content_prefs')
    .eq('slug', slug)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');
  return brand as BrandRow;
}

async function withBrand<T>(supabase: SupabaseClient, slug: string, fn: (brand: BrandRow) => Promise<T>): Promise<T> {
  const brand = await requireBrand(supabase, slug);
  return withBrandContext(brand.id, () => fn(brand));
}

// plannerProfile / planEvidence live in $lib/server/planner-inputs (shared with the /plan
// blank-slate's first-plan proposal). attachBrandPages (content library) is folded in THERE,
// so every consumer of the planner profile gets the brand's linkable site pages.

function rowToPlan(row: Record<string, unknown>): EditorialPlan & { id: string; status: string } {
  const plan = normalizePlan(row, [...CADENCES]);
  // Preserve the stamped week_starts (normalizePlan keeps them when present on the JSON).
  return {
    ...plan,
    id: String(row.id),
    status: String(row.status),
    ...(Array.isArray(row.changes_summary) ? { changes_summary: (row.changes_summary as string[]).map(String) } : {})
  };
}

const PLAN_COLS = 'id, status, strategy, voice, cadence, platform_mix, gtm, weeks, parent_id, revision_feedback, changes_summary, source, created_at, activated_at';

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const [{ data: activeRow }, { data: proposedRows }, { data: histRows }, budget] = await Promise.all([
      supabase.from('editorial_plans').select(PLAN_COLS).eq('brand_id', brand.id).eq('status', 'active').maybeSingle(),
      supabase
        .from('editorial_plans')
        .select(PLAN_COLS)
        .eq('brand_id', brand.id)
        .eq('status', 'proposed')
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('editorial_plans')
        .select(PLAN_COLS)
        .eq('brand_id', brand.id)
        .eq('status', 'superseded')
        .order('activated_at', { ascending: false })
        .limit(20),
      remaining(supabase, brand.id, brand.plan, brand.timezone)
    ]);

    const active = activeRow ? rowToPlan(activeRow) : null;
    const proposed = proposedRows?.[0] ? rowToPlan(proposedRows[0]) : null;
    const history = (histRows ?? []).map((r) => ({
      ...rowToPlan(r),
      activated_at: (r.activated_at as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      changes_summary: Array.isArray(r.changes_summary) ? (r.changes_summary as string[]) : null
    }));

    return {
      plan: active,
      proposed,
      history,
      proposedFeedback: (proposedRows?.[0]?.revision_feedback as string | null) ?? null,
      currentWeek: active ? currentWeekIndex(active, brand.timezone) : null,
      allowedCadences: cadenceAllowed(brand.plan),
      quota: { remaining: budget.posts, total: budget.postsQuota }
    };
  });
};

export const actions: Actions = {
  // Inline edits to the active plan's sections (strategy, voice, cadence, platform mix, week
  // themes). The plan stays the source of truth; content_prefs is re-synced so the scheduler's
  // snapshot follows.
  updateSection: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      let raw: unknown;
      try {
        raw = JSON.parse(String(data.get('plan') ?? ''));
      } catch {
        return fail(400, { error: 'invalid_plan' });
      }
      const planId = String(data.get('plan_id') ?? '');
      const incoming = normalizePlan(raw as Record<string, unknown>, cadenceAllowed(brand.plan));
      const { error: err } = await supabase
        .from('editorial_plans')
        .update({
          strategy: incoming.strategy || null,
          voice: incoming.voice,
          cadence: incoming.cadence,
          platform_mix: incoming.platform_mix,
          weeks: incoming.weeks,
          updated_at: new Date().toISOString()
        })
        .eq('id', planId)
        .eq('brand_id', brand.id)
        .eq('status', 'active');
      if (err) return fail(500, { error: err.message });
      await syncPrefsFromPlan(supabase, brand.id, incoming);
      return { saved: true };
    });
  },

  // Save a week's brief without replanning (the planner already treats it as authoritative).
  saveBrief: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');
      const weekIndex = Number(data.get('week') ?? -1);
      const brief = String(data.get('brief') ?? '').trim();
      const { data: row } = await supabase
        .from('editorial_plans')
        .select('weeks')
        .eq('id', planId)
        .eq('brand_id', brand.id)
        .maybeSingle();
      const weeks = Array.isArray(row?.weeks) ? (row?.weeks as Record<string, unknown>[]) : [];
      if (!weeks[weekIndex]) return fail(400, { error: 'invalid_week' });
      weeks[weekIndex] = { ...weeks[weekIndex], brief: brief || null };
      const { error: err } = await supabase
        .from('editorial_plans')
        .update({ weeks, updated_at: new Date().toISOString() })
        .eq('id', planId)
        .eq('brand_id', brand.id);
      if (err) return fail(500, { error: err.message });
      return { saved: true, week: weekIndex };
    });
  },

  // "Reserve this week for something special": rebuild ONE week around the user's brief, keeping
  // the rest of the cycle untouched.
  replanWeek: async ({ request, params, locals: { supabase, locale } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');
      const weekIndex = Number(data.get('week') ?? -1);
      const brief = String(data.get('brief') ?? '').trim();
      if (!brief) return fail(400, { error: 'brief_required' });

      const { data: row } = await supabase
        .from('editorial_plans')
        .select(PLAN_COLS)
        .eq('id', planId)
        .eq('brand_id', brand.id)
        .maybeSingle();
      if (!row) return fail(404, { error: 'plan_not_found' });
      const plan = rowToPlan(row);
      if (!plan.weeks[weekIndex]) return fail(400, { error: 'invalid_week' });

      try {
        const [profile, evidence] = await Promise.all([plannerProfile(supabase, brand), planEvidence(supabase, brand.id)]);
        const week = await replanWeek(genaiClient(), plan, weekIndex, brief, profile, localeLanguageName(locale), {
          platforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
          allowedCadences: cadenceAllowed(brand.plan),
          benchmark: evidence.benchmark,
          topPosts: evidence.topPosts,
          supabase,
          brandId: brand.id,
          planTier: brand.plan
        });
        const weeks = plan.weeks.map((w, i) => (i === weekIndex ? week : w));
        const { error: err } = await supabase
          .from('editorial_plans')
          .update({ weeks, updated_at: new Date().toISOString() })
          .eq('id', planId)
          .eq('brand_id', brand.id);
        if (err) return fail(500, { error: err.message });
        return { replanned: true, week: weekIndex };
      } catch (e) {
        return fail(500, { error: e instanceof Error ? e.message : 'replan_failed' });
      }
    });
  },

  // Conversational feedback on the whole plan → a full revision proposal (status 'proposed',
  // linked to its parent) the user reviews and approves/discards.
  revise: async ({ request, params, locals: { supabase, locale } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');
      const feedback = String(data.get('feedback') ?? '').trim();
      if (!feedback) return fail(400, { error: 'feedback_required' });

      const { data: row } = await supabase
        .from('editorial_plans')
        .select(PLAN_COLS)
        .eq('id', planId)
        .eq('brand_id', brand.id)
        .eq('status', 'active')
        .maybeSingle();
      if (!row) return fail(404, { error: 'plan_not_found' });
      const current = rowToPlan(row);

      try {
        const [profile, evidence, gtmBrief] = await Promise.all([
          plannerProfile(supabase, brand),
          planEvidence(supabase, brand.id),
          activeGtmBrief(supabase, brand.id, brand.timezone).catch((error) => { swallow('load gtm brief', error); return ''; })
        ]);
        const revised = await revisePlan(genaiClient(), current, feedback, profile, {
          platforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
          allowedCadences: cadenceAllowed(brand.plan),
          outputLanguage: localeLanguageName(locale),
          strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
          benchmark: evidence.benchmark,
          topPosts: evidence.topPosts,
          supabase,
          brandId: brand.id,
          planTier: brand.plan
        });
        await supabase.from('editorial_plans').update({ status: 'rejected' }).eq('brand_id', brand.id).eq('status', 'proposed');
        const { error: err } = await supabase.from('editorial_plans').insert({
          brand_id: brand.id,
          status: 'proposed',
          strategy: revised.strategy || null,
          voice: revised.voice,
          cadence: revised.cadence,
          platform_mix: revised.platform_mix,
          gtm: revised.gtm,
          weeks: revised.weeks,
          parent_id: current.id,
          revision_feedback: feedback,
          changes_summary: revised.changes_summary ?? [],
          source: 'revision'
        });
        if (err) return fail(500, { error: err.message });
        return { revised: true };
      } catch (e) {
        return fail(500, { error: e instanceof Error ? e.message : 'revise_failed' });
      }
    });
  },

  // Approve a 'proposed' plan (revision or first-ever proposal): supersede the active one, stamp
  // week starts, sync prefs.
  approveRevision: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');
      const activated = await activatePlan(supabase, brand.id, planId, brand.timezone);
      if (!activated) return fail(404, { error: 'plan_not_found' });
      return { approved: true };
    });
  },

  discardRevision: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');
      const { error: err } = await supabase
        .from('editorial_plans')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', planId)
        .eq('brand_id', brand.id)
        .eq('status', 'proposed');
      if (err) return fail(500, { error: err.message });
      return { discarded: true };
    });
  },

  // Hard-delete an editorial-plan version (the active one or a superseded history entry) by id.
  deleteVersion: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const id = String((await request.formData()).get('id') ?? '');
      if (!id) return fail(400, { error: 'missing_id' });
      const { error: err } = await supabase.from('editorial_plans').delete().eq('id', id).eq('brand_id', brand.id);
      if (err) return fail(500, { error: err.message });
      return { deleted: true };
    });
  },

  // Migration path for brands created before the editorial-plan era: propose their first plan
  // on demand from everything already stored (brand_kit + strategy report + post history).
  // Left as 'proposed' here — this page has the review/approve UI.
  propose: async ({ params, locals: { supabase, locale } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      try {
        await proposeFirstPlan(supabase, brand, locale);
        return { proposedNew: true };
      } catch (e) {
        return fail(500, { error: e instanceof Error ? e.message : 'propose_failed' });
      }
    });
  }
};
