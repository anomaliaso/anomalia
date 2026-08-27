import { swallow } from '$lib/server/swallow';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { genaiClient } from '$lib/server/research';
import { withBrandContext } from '$lib/server/ai-log';
import { plannerProfile, planEvidence } from '$lib/server/planner-inputs';
import { activeGtmBrief } from '$lib/server/gtm';
import {
  proposeRubrics,
  saveProposedRubrics,
  approveRubrics,
  loadApprovedRubrics,
  loadProposedRubrics
} from '$lib/server/rubrics';
import { localeLanguageName } from '$lib/i18n/locale';
import { CONTENT_FORMATS } from '$lib/content-formats';
import { cachedBrandPage } from '$lib/server/page-cache';

// The RUBRICHE page — the client-facing approval cycle for the brand's recurring content series:
// read the AI's proposals → edit any field → approve the subset to adopt. Approved rubrics then
// constrain the editorial plan and the batch planner (see rubricsBrief). Propose → approve, never
// silent autonomy — same contract as the GTM and editorial-plan pages.

// propose carries one Gemini call (~20-30s).
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~120s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 120 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

type BrandRow = { id: string; name: string; slug: string; timezone: string; target_platforms: unknown };

async function requireBrand(supabase: SupabaseClient, slug: string): Promise<BrandRow> {
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, slug, timezone, target_platforms')
    .eq('slug', slug)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');
  return brand as BrandRow;
}

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const params = event.params;

  // The brand row is resolved inside the callback here, so key the cache off the route
  // param — which is the slug — rather than a row we do not have yet.
  return cachedBrandPage(event, params.brand, async () => {
    const brand = await requireBrand(supabase, params.brand);
    const [approved, proposed] = await Promise.all([
      loadApprovedRubrics(supabase, brand.id),
      loadProposedRubrics(supabase, brand.id)
    ]);
    return { approved, proposed };
  });
};

export const actions: Actions = {
  // Generate a fresh batch of candidates (replaces any still-pending batch).
  propose: async ({ params, locals: { supabase, locale } }) => {
    const brand = await requireBrand(supabase, params.brand as string);
    try {
      await withBrandContext(brand.id, async () => {
        const [profile, evidence, gtmBrief] = await Promise.all([
          plannerProfile(supabase, brand),
          planEvidence(supabase, brand.id),
          activeGtmBrief(supabase, brand.id, brand.timezone).catch((error) => { swallow('load gtm brief', error); return ''; })
        ]);
        const candidates = await proposeRubrics(genaiClient(), profile, {
          platforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
          outputLanguage: localeLanguageName(locale),
          strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
          benchmark: evidence.benchmark
        });
        if (!candidates.length) throw new Error('no candidates');
        await saveProposedRubrics(supabase, brand.id, candidates);
      });
      return { proposed: true };
    } catch (e) {
      console.error('[rubrics] propose failed:', e instanceof Error ? e.message : e);
      return fail(500, { error: 'propose_failed' });
    }
  },

  // Approve the client's selection. The form posts, per proposed rubric id, a `pick_<id>`
  // checkbox plus the (possibly edited) field inputs — the edited text is what gets approved.
  approve: async ({ request, params, locals: { supabase } }) => {
    const brand = await requireBrand(supabase, params.brand as string);
    const form = await request.formData();
    const ids = form.getAll('pick').map(String).filter(Boolean);
    if (!ids.length) return fail(400, { error: 'none_selected' });
    const picks = ids.map((id) => {
      const fmt = String(form.get(`format_${id}`) ?? '');
      return {
        id,
        edits: {
          name: String(form.get(`name_${id}`) ?? ''),
          promise: String(form.get(`promise_${id}`) ?? ''),
          strategic_role: String(form.get(`role_${id}`) ?? ''),
          format: (CONTENT_FORMATS as readonly string[]).includes(fmt) ? fmt : undefined,
          cadence: String(form.get(`cadence_${id}`) ?? ''),
          differentiation: String(form.get(`diff_${id}`) ?? '')
        }
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { approved } = await approveRubrics(supabase, brand.id, picks as any);
    if (!approved) return fail(400, { error: 'approve_failed' });
    return { approved };
  }
};
