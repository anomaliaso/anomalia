import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { normalizeWeeklyStrategy, type WeeklyStrategy } from '$lib/server/content-preview';
import { appOrigin } from '$lib/server/app-url';
import { SAVE_WEEK_SEEDS, statusForFailure } from '@anomalia/api-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

type DraftWritten = { ok: true; id: string; replaced: boolean } | { ok: false };

// A brand keeps ONE week draft in review — the plan page reads the newest and a second row would
// hide the first. So the rows land on the draft that is there, or open a new one.
async function writeWeekDraft(
  supabase: SupabaseClient,
  brandId: string,
  weekIndex: number,
  editorialPlanId: string | null,
  strategy: WeeklyStrategy
): Promise<DraftWritten> {
  const columns = { seeds: strategy, editorial_plan_id: editorialPlanId, editorial_week: weekIndex };

  const { data: existing } = await supabase
    .from('content_plans')
    .select('id')
    .eq('brand_id', brandId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from('content_plans')
      .update(columns)
      .eq('id', existing.id as string)
      .eq('brand_id', brandId);
    if (error) return { ok: false };
    return { ok: true, id: existing.id as string, replaced: true };
  }

  const { data, error } = await supabase
    .from('content_plans')
    .insert({
      brand_id: brandId,
      title: `External · ${new Date().toISOString().slice(0, 10)}`,
      source: 'manual',
      status: 'draft',
      ...columns
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false };
  return { ok: true, id: data.id as string, replaced: false };
};

export const POST: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = SAVE_WEEK_SEEDS.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json(
      { error: 'invalid_input', details: parsed.error.issues },
      { status: statusForFailure(SAVE_WEEK_SEEDS, 'invalid_input') }
    );
  }

  const { week_index, ...supplied } = parsed.data;
  const strategy = normalizeWeeklyStrategy(supplied);
  if (!strategy.seeds.length) {
    return json({ error: 'no_seeds' }, { status: statusForFailure(SAVE_WEEK_SEEDS, 'no_seeds') });
  }

  const { data: activePlan } = await supabase
    .from('editorial_plans')
    .select('id')
    .eq('brand_id', brand.id)
    .eq('status', 'active')
    .maybeSingle();
  const editorialPlanId = (activePlan?.id as string) ?? null;

  const written = await writeWeekDraft(supabase, brand.id, week_index, editorialPlanId, strategy);
  if (!written.ok) {
    return json({ error: 'save_failed' }, { status: statusForFailure(SAVE_WEEK_SEEDS, 'save_failed') });
  }

  return json({
    ok: true,
    draft_id: written.id,
    week_index,
    seeds_saved: strategy.seeds.length,
    editorial_plan_id: editorialPlanId,
    replaced: written.replaced,
    review_url: `${appOrigin(url)}/app/${brand.slug}/plan`
  });
};
