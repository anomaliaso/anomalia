import { swallow } from '$lib/server/swallow';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  planWeekStrategy,
  normalizeWeeklyStrategy,
  type ContentPrefs,
  type PastWinner
} from '$lib/server/content-preview';
import { attachBrandPeople } from '$lib/server/people';
import { attachBrandPages } from '$lib/server/content-library';
import { loadActivePlan, activatePlan, currentWeekIndex, weekStrategyBrief, postsForWeek, weekWindow } from '$lib/server/editorial-plan';
import { proposeFirstPlan } from '$lib/server/planner-inputs';
import { activeGtmBrief, loadActiveGtm, currentPhaseIndex } from '$lib/server/gtm';
import { countForFrequency } from '$lib/server/plans';
import { remaining } from '$lib/server/usage';
import { rankRecentWinners } from '$lib/server/scheduler';
import { cachedBrandPage } from '$lib/server/page-cache';
import { deletePostCancellingZernio } from '$lib/server/post-editing';

// Il piano editoriale a righe: il batch della settimana come RIGHE MODIFICABILI (i seed della
// prima passata) che l'utente rivede PRIMA che venga prodotta una sola caption o immagine.
// Approvare passa le righe all'endpoint generate ({ draftPlanId }): niente esce senza conferma.

// Scaglione condiviso, non budget: il lavoro vero sta in ~120s. Su Vercel ogni valore DISTINTO
// di `maxDuration` fa emettere una funzione serverless intera (~90 MB), e gli scaglioni sono tre
// (300/800/1800): rimetterlo a 120 non renderebbe la rotta più sicura, aggiungerebbe 90 MB.
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

// La bozza in revisione: se ne tiene al massimo una, ripianificare la sostituisce.
async function loadDraft(supabase: SupabaseClient, brandId: string) {
  const { data } = await supabase
    .from('content_plans')
    .select('id, seeds, editorial_plan_id, editorial_week, created_at')
    .eq('brand_id', brandId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

const POST_COLS = 'id, platform, platforms, caption, status, slot, scheduled_for, published_at, pillar, format, content_type, plan_row_id';

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const url = event.url;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const [draft, editorialPlan, gtm, budget, { data: products }, { data: people }, growth] = await Promise.all([
      loadDraft(supabase, brand.id),
      loadActivePlan(supabase, brand.id),
      loadActiveGtm(supabase, brand.id),
      remaining(supabase, brand.id, brand.plan, brand.timezone),
      supabase.from('products').select('title').eq('brand_id', brand.id).limit(12),
      supabase.from('people').select('name').eq('brand_id', brand.id).limit(8),
      import('$lib/server/growth-readiness').then((m) => m.loadGrowthReadiness(supabase, brand.id))
    ]);

    const weekCount = editorialPlan?.weeks?.length ?? 0;
    // La settimana in cui il ciclo si trova davvero (null quando le 4 sono passate: si ricomincia).
    const currentIdx = editorialPlan ? currentWeekIndex(editorialPlan, brand.timezone) : null;
    let weekIdx: number | null = currentIdx;
    if (editorialPlan && weekCount) {
      const raw = url.searchParams.get('week');
      const req = raw == null || raw === '' ? NaN : Number(raw);
      if (Number.isInteger(req) && req >= 0 && req < weekCount) weekIdx = req;
      else if (weekIdx == null) weekIdx = weekCount - 1;
    }
    const phaseIdx = gtm ? currentPhaseIndex(gtm, brand.timezone) : null;

    const draftWeek = draft ? ((draft.editorial_week as number | null) ?? currentIdx) : null;
    const showDraft = Boolean(draft) && draftWeek === weekIdx;
    const draftStrategy = showDraft ? normalizeWeeklyStrategy(draft!.seeds) : null;

    // Trovati in DUE modi e uniti, così un collegamento editoriale rotto o stantio non nasconde
    // mai lavoro vero: (a) i batch legati esplicitamente a questo piano+settimana, e (b) tutto ciò
    // che è PROGRAMMATO dentro la finestra della settimana, legame o no.
    const win = editorialPlan && weekIdx != null ? weekWindow(editorialPlan, weekIdx) : null;

    // Nessuna delle tre dipende dal risultato delle altre: partono insieme, non in fila.
    const [{ data: weekPlans }, { data: windowPosts }, { data: planRows }] = await Promise.all([
      editorialPlan?.id && weekIdx != null
        ? supabase
            .from('content_plans')
            .select('id')
            .eq('brand_id', brand.id)
            .eq('editorial_plan_id', editorialPlan.id)
            .eq('editorial_week', weekIdx)
        : Promise.resolve({ data: null }),
      win
        ? supabase
            .from('posts')
            .select(POST_COLS)
            .eq('brand_id', brand.id)
            .gte('scheduled_for', win.startISO)
            .lt('scheduled_for', win.endISO)
            .order('scheduled_for', { ascending: true })
            .limit(40)
        : Promise.resolve({ data: null }),
      editorialPlan?.id && weekCount
        ? supabase
            .from('content_plans')
            .select('id, editorial_week')
            .eq('brand_id', brand.id)
            .eq('editorial_plan_id', editorialPlan.id)
        : Promise.resolve({ data: null })
    ]);

    const byId = new Map<string, Record<string, unknown>>();
    const planIds = new Set<string>();
    if (showDraft) planIds.add(draft!.id as string);
    for (const p of weekPlans ?? []) planIds.add(p.id as string);

    const weekHasContent: boolean[] = new Array(weekCount).fill(false);
    for (const p of planRows ?? []) {
      const wi = p.editorial_week as number | null;
      if (wi != null && wi >= 0 && wi < weekCount) weekHasContent[wi] = true;
    }

    // `posts` non ha una colonna editorial_week: sta su content_plans. Ogni plan id qui viene da
    // planRows, che ha già segnato weekHasContent per ciascuno — una seconda lookup sullo stesso
    // insieme non potrebbe segnare nulla di nuovo.
    const { data: posts } = planIds.size
      ? await supabase
          .from('posts')
          .select(POST_COLS)
          .eq('brand_id', brand.id)
          .in('plan_id', [...planIds])
          .order('created_at', { ascending: true })
          .limit(40)
      : { data: null };
    for (const p of posts ?? []) byId.set(String(p.id), p);
    for (const p of windowPosts ?? []) byId.set(String(p.id), p);
    const weekPosts = [...byId.values()];

    // Lo stato della settimana si deriva dai post, mai da un flag 'done' salvato che può divergere.
    const pendingCount = weekPosts.filter((p) => p.status === 'pending_user').length;
    const hasSeeds = (draftStrategy?.seeds?.length ?? 0) > 0;
    const weekComplete = weekPosts.length > 0 && pendingCount === 0 && !hasSeeds;

    return {
      draft: showDraft
        ? { id: draft!.id as string, strategy: draftStrategy, editorialWeek: draftWeek }
        : null,
      growth,
      // Il piano si costruisce DALLA strategia: senza, lo stato vuoto manda prima a crearla.
      hasStrategy: !!gtm,
      weekPosts,
      weekIdx,
      currentWeekIdx: currentIdx,
      weekComplete,
      pendingCount,
      weekHasContent,
      weeks:
        editorialPlan && weekCount
          ? editorialPlan.weeks.map((w) => ({
              index: w.index,
              theme: w.theme,
              status: w.status,
              posts: postsForWeek(editorialPlan, w.index)
            }))
          : [],
      inheritance:
        editorialPlan && weekIdx != null
          ? {
              week: weekIdx,
              theme: editorialPlan.weeks[weekIdx]?.theme ?? '',
              mix: editorialPlan.platform_mix,
              posts: postsForWeek(editorialPlan, weekIdx)
            }
          : null,
      gtmPhase:
        gtm && phaseIdx != null
          ? {
              index: phaseIdx,
              name: gtm.phases[phaseIdx]?.name ?? '',
              weights: gtm.phases[phaseIdx]?.platform_weights ?? []
            }
          : null,
      // Il DOCUMENTO del piano approvato, in sola lettura: si modifica dalla pagina Strategia.
      editorialDoc: editorialPlan
        ? {
            id: editorialPlan.id,
            strategy: editorialPlan.strategy,
            voice: editorialPlan.voice,
            cadence: editorialPlan.cadence,
            platform_mix: editorialPlan.platform_mix,
            weeks: editorialPlan.weeks
          }
        : null,
      platforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
      productNames: (products ?? []).map((p) => String(p.title)).filter(Boolean),
      peopleNames: (people ?? []).map((p) => String(p.name)).filter(Boolean),
      quota: { remaining: budget.posts, total: budget.postsQuota }
    };
  }, url.searchParams.get('week') ?? '');
};

export const actions: Actions = {
  // Primo piano dal foglio bianco: proporre e attivare in un colpo solo, il clic È l'approvazione.
  // Guardia contro un piano già attivo, o un doppio invio ne soppianterebbe uno appena ottenuto.
  proposeFull: async ({ params, locals: { supabase, locale } }) => {
    const brand = await requireBrand(supabase, params.brand);
    const existing = await loadActivePlan(supabase, brand.id);
    if (existing) return fail(400, { error: 'plan_exists' });
    try {
      const { id } = await proposeFirstPlan(supabase, brand, locale);
      const activated = await activatePlan(supabase, brand.id, id, brand.timezone);
      if (!activated) return fail(500, { error: 'activate_failed' });
      return { planCreated: true };
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : 'propose_failed' });
    }
  },

  // Prima passata (strategia → righe), salvata come BOZZA della settimana scelta. `week` permette
  // di pianificare una settimana FUTURA, non solo rifare quella di oggi.
  plan: async ({ params, request, url, locals: { supabase } }) => {
    const brand = await requireBrand(supabase, params.brand);
    const budget = await remaining(supabase, brand.id, brand.plan, brand.timezone);
    if (budget.posts <= 0) return fail(400, { error: 'quota' });
    if (budget.credits.remaining <= 0) return fail(402, { error: 'credits_exhausted', resetDate: budget.credits.periodEnd.toISOString(), quota: budget.credits.quota, used: budget.credits.used });

    const form = await request.formData().catch(() => null);
    const reqWeekStr = (form?.get('week') as string | null) ?? url.searchParams.get('week');
    const reqWeekRaw = reqWeekStr == null || reqWeekStr === '' ? NaN : Number(reqWeekStr);

    const { data: kit } = await supabase
      .from('brand_kit')
      .select('category, about, target_audience, brand_colors, ai_character, ai_context, visual_style, site_type, content_pillars')
      .eq('brand_id', brand.id)
      .maybeSingle();
    const { data: products } = await supabase
      .from('products')
      .select('title, description, kind, pricing, images')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: true })
      .limit(12);
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
      products: (products ?? []).map((p) => ({ name: p.title, description: p.description, kind: p.kind, pricing: p.pricing, images: p.images }))
    };
    await attachBrandPeople(profile, supabase, brand.id);
    await attachBrandPages(profile, supabase, brand.id).catch(swallow('attach brand pages'));

    const { data: history } = await supabase
      .from('social_post_history')
      .select('content, platform, metrics, published_at')
      .eq('brand_id', brand.id)
      .limit(200);
    const topPosts: PastWinner[] = rankRecentWinners(history ?? []);

    const prefs: ContentPrefs = (brand.content_prefs as ContentPrefs) ?? {};
    const platforms = Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [];

    const editorialPlan = await loadActivePlan(supabase, brand.id);
    const currentIdx = editorialPlan ? currentWeekIndex(editorialPlan, brand.timezone) : null;
    const weekCount = editorialPlan?.weeks?.length ?? 0;
    const weekIdx =
      editorialPlan && weekCount && Number.isInteger(reqWeekRaw) && reqWeekRaw >= 0 && reqWeekRaw < weekCount
        ? reqWeekRaw
        : currentIdx;

    // Guardia anti-duplicato: niente seconda bozza per una settimana che ha già post prodotti
    // (la trappola del 3+3). Si ripianifica solo finché la settimana è ancora solo righe.
    if (editorialPlan?.id && weekIdx != null) {
      let produced = 0;
      const { data: linked } = await supabase
        .from('content_plans')
        .select('id')
        .eq('brand_id', brand.id)
        .eq('editorial_plan_id', editorialPlan.id)
        .eq('editorial_week', weekIdx);
      const linkedIds = (linked ?? []).map((r) => r.id as string);
      if (linkedIds.length) {
        const { count } = await supabase.from('posts').select('id', { count: 'exact', head: true }).in('plan_id', linkedIds);
        produced = count ?? 0;
      }
      const win = weekWindow(editorialPlan, weekIdx);
      if (win) {
        const { count } = await supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('brand_id', brand.id)
          .gte('scheduled_for', win.startISO)
          .lt('scheduled_for', win.endISO);
        produced = Math.max(produced, count ?? 0);
      }
      if (produced > 0) return fail(409, { error: 'week_has_posts', produced, week: weekIdx });
    }

    const gtmBrief = await activeGtmBrief(supabase, brand.id, brand.timezone).catch((error) => { swallow('load gtm brief', error); return ''; });
    const strategyBrief = [gtmBrief, editorialPlan && weekIdx != null ? weekStrategyBrief(editorialPlan, weekIdx) : '']
      .filter(Boolean)
      .join('\n\n');
    const desired = editorialPlan && weekIdx != null ? postsForWeek(editorialPlan, weekIdx) : countForFrequency(prefs.frequency);
    const count = Math.min(desired, budget.posts);
    const maxVideos = Math.min(budget.videos, count);

    try {
      const strategy = await planWeekStrategy(profile, { platforms, prefs, maxVideos, topPosts, strategyBrief }, count);

      const existing = await loadDraft(supabase, brand.id);
      if (existing) {
        const { error: err } = await supabase
          .from('content_plans')
          .update({
            seeds: strategy,
            editorial_plan_id: editorialPlan && weekIdx != null ? (editorialPlan.id ?? null) : null,
            editorial_week: editorialPlan && weekIdx != null ? weekIdx : null
          })
          .eq('id', existing.id);
        if (err) return fail(500, { error: err.message });
      } else {
        const { error: err } = await supabase.from('content_plans').insert({
          brand_id: brand.id,
          title: `Week of ${new Date().toISOString().slice(0, 10)}`,
          source: 'manual_trigger',
          status: 'draft',
          seeds: strategy,
          editorial_plan_id: editorialPlan && weekIdx != null ? (editorialPlan.id ?? null) : null,
          editorial_week: editorialPlan && weekIdx != null ? weekIdx : null
        });
        if (err) return fail(500, { error: err.message });
      }
      return { planned: true };
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : 'plan_failed' });
    }
  },

  save: async ({ request, params, locals: { supabase } }) => {
    const brand = await requireBrand(supabase, params.brand);
    const data = await request.formData();
    const draftId = String(data.get('draft_id') ?? '');
    let raw: unknown;
    try {
      raw = JSON.parse(String(data.get('seeds') ?? ''));
    } catch {
      return fail(400, { error: 'invalid_seeds' });
    }
    const strategy = normalizeWeeklyStrategy(raw);
    if (!strategy.seeds.length) return fail(400, { error: 'no_rows' });
    const { error: err } = await supabase
      .from('content_plans')
      .update({ seeds: strategy })
      .eq('id', draftId)
      .eq('brand_id', brand.id)
      .eq('status', 'draft');
    if (err) return fail(500, { error: err.message });
    return { saved: true };
  },

  discard: async ({ request, params, locals: { supabase } }) => {
    const brand = await requireBrand(supabase, params.brand);
    const data = await request.formData();
    const draftId = String(data.get('draft_id') ?? '');
    const { error: err } = await supabase
      .from('content_plans')
      .delete()
      .eq('id', draftId)
      .eq('brand_id', brand.id)
      .eq('status', 'draft');
    if (err) return fail(500, { error: err.message });
    return { discarded: true };
  },

  // publish_logs.post_id è ON DELETE SET NULL, quindi la riga di audit sopravvive.
  // La REVOCA su Zernio viene PRIMA della cancellazione: senza, un post scheduled/approved usciva
  // lo stesso. Se la revoca fallisce, il post resta.
  deletePost: async ({ request, params, locals: { supabase } }) => {
    const brand = await requireBrand(supabase, params.brand);
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'missing_id' });
    const res = await deletePostCancellingZernio(supabase, id, brand.id);
    if (!res.ok) return fail(res.status, { error: res.message });
    return { deleted: true };
  },

  // Save the edited content mix for a week in the editorial plan.
  saveMix: async ({ request, params, locals: { supabase } }) => {
    const brand = await requireBrand(supabase, params.brand);
    const data = await request.formData();
    const planId = String(data.get('plan_id') ?? '');
    const weekIndex = Number(data.get('week') ?? -1);

    let contentMix: Array<{ type: string; count: number }> = [];
    try {
      const raw = JSON.parse(String(data.get('mix') ?? '[]'));
      contentMix = (Array.isArray(raw) ? raw : [])
        .filter((m: unknown): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          type: String(m.type ?? '').trim(),
          count: Math.max(0, Math.floor(Number(m.count) || 0))
        }))
        .filter(m => m.type && m.count > 0);
    } catch {
      return fail(400, { error: 'invalid_mix' });
    }

    const { data: row } = await supabase
      .from('editorial_plans')
      .select('weeks')
      .eq('id', planId)
      .eq('brand_id', brand.id)
      .maybeSingle();
    if (!row) return fail(404, { error: 'plan_not_found' });

    const weeks = Array.isArray(row?.weeks) ? (row?.weeks as Record<string, unknown>[]) : [];
    if (!weeks[weekIndex]) return fail(400, { error: 'invalid_week' });

    weeks[weekIndex] = { ...weeks[weekIndex], content_mix: contentMix };
    const { error: err } = await supabase
      .from('editorial_plans')
      .update({ weeks, updated_at: new Date().toISOString() })
      .eq('id', planId)
      .eq('brand_id', brand.id);
    if (err) return fail(500, { error: err.message });
    return { saved: true, week: weekIndex };
  }
};
