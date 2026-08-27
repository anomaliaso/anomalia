import { json } from '@sveltejs/kit';
import { saveOnboardingState, SECTION_APPROVED_NEXT_PHASE, type ApprovableSection } from '$lib/server/onboarding';
import type { RequestHandler } from './$types';

const SECTIONS: ApprovableSection[] = ['studio', 'strategy', 'editorial_plan'];

// POST: the user approves an onboarding section from the Panoramica card. Stamps it 'approved' and
// jumps to the next *_generation phase — the gate that unlocks the following section.
export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data: brand } = await supabase.from('brands').select('id, timezone').eq('slug', params.brand).maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  // Social-connection step: record whether the user connected accounts, then advance to the
  // completion phase. (No plan to activate — this just moves the state machine forward.)
  if (body.action === 'social_done') {
    const onboarding = await saveOnboardingState(supabase, brand.id, {
      sections: { social: body.connected ? 'connected' : 'not_connected' },
      phase: 'onboarding_completion_message'
    });
    return json({ onboarding });
  }

  // Completion: the user finishes the onboarding and enters free mode. status='completed' lifts the
  // "only the Panoramica" funnel AND turns off the agent's onboarding mode; stamping
  // setup_completed_at marks the brand as definitively set up.
  if (body.action === 'complete') {
    const onboarding = await saveOnboardingState(supabase, brand.id, { status: 'completed', phase: 'free_mode' });
    await supabase.from('brands').update({ setup_completed_at: new Date().toISOString() }).eq('id', brand.id);
    return json({ onboarding });
  }

  // Content approval: the user signed off on the week-1 content. Mark it approved and move to the
  // social step. The actual visual rendering runs in the background (render-content endpoint).
  if (body.section === 'content') {
    const onboarding = await saveOnboardingState(supabase, brand.id, {
      sections: { content: 'approved' },
      phase: 'social_connection_selection'
    });
    return json({ onboarding });
  }

  const section = body.section as ApprovableSection;
  if (!SECTIONS.includes(section)) return json({ error: 'Invalid section' }, { status: 400 });

  const tz = (brand.timezone as string) ?? 'Europe/Rome';

  // Approving a generated section also ACTIVATES its proposed plan (supersedes any prior active).
  // Studio has no plan to activate — it lives entirely in the brand_kit the agent already wrote.
  if (section === 'strategy') {
    const { data: prop } = await supabase.from('gtm_plans').select('id').eq('brand_id', brand.id).eq('status', 'proposed').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (prop) {
      const { activateGtm } = await import('$lib/server/gtm');
      await activateGtm(supabase, brand.id, prop.id, tz);
    }
  } else if (section === 'editorial_plan') {
    const { data: prop } = await supabase.from('editorial_plans').select('id').eq('brand_id', brand.id).eq('status', 'proposed').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (prop) {
      const { activatePlan } = await import('$lib/server/editorial-plan');
      await activatePlan(supabase, brand.id, prop.id, tz);
    }
  }

  const onboarding = await saveOnboardingState(supabase, brand.id, {
    sections: { [section]: 'approved' },
    phase: SECTION_APPROVED_NEXT_PHASE[section]
  });

  return json({ onboarding });
};
