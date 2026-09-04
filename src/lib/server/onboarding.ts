import type { SupabaseClient } from '@supabase/supabase-js';

// ── The conversational onboarding's state machine ──────────────────────────────
// One jsonb on brands.onboarding_state drives the whole post-payment experience: the user lives it
// in the Panoramica chat, the agent advances the phase, and the gate helpers below stop things from
// happening out of order (no Strategia before Studio approved, etc.). NULL = never started → the
// app treats the brand as in_progress/welcome.

export const ONBOARDING_PHASES = [
  'welcome',
  'collecting_brand_info',
  'collecting_objectives',
  'collecting_target',
  'collecting_differentiation',
  'collecting_competitors',
  'collecting_assets_initial',
  'studio_generation',
  'studio_review',
  'studio_approved',
  'strategy_generation',
  'strategy_review',
  'strategy_approved',
  'editorial_plan_generation',
  'editorial_plan_review',
  'editorial_plan_approved',
  'content_assets_request',
  'content_assets_upload',
  'content_assets_analysis',
  'content_generation_started',
  'social_connection_selection',
  'social_connection_guided',
  'social_connection_completed',
  'content_week_1_ready',
  'onboarding_completion_message',
  'pages_tutorial',
  'free_mode'
] as const;
export type OnboardingPhase = (typeof ONBOARDING_PHASES)[number];

export type SectionStatus = 'draft' | 'waiting_review' | 'approved' | 'needs_revision';
export type ContentStatus = 'not_started' | 'waiting_assets' | 'generating' | 'waiting_review' | 'ready' | 'needs_revision' | 'approved';
export type CalendarStatus = 'not_started' | 'generating' | 'ready' | 'needs_revision' | 'approved';
export type SocialStatus = 'not_connected' | 'partially_connected' | 'connected';
export type OnboardingStatus = 'in_progress' | 'paused' | 'completed';

export type OnboardingSections = {
  studio: SectionStatus;
  strategy: SectionStatus;
  editorial_plan: SectionStatus;
  content: ContentStatus;
  calendar: CalendarStatus;
  social: SocialStatus;
};

export type OnboardingState = {
  status: OnboardingStatus;
  phase: OnboardingPhase;
  sections: OnboardingSections;
};

export function defaultOnboardingState(): OnboardingState {
  return {
    status: 'in_progress',
    phase: 'welcome',
    sections: {
      studio: 'draft',
      strategy: 'draft',
      editorial_plan: 'draft',
      content: 'not_started',
      calendar: 'not_started',
      social: 'not_connected'
    }
  };
}

// Read a brand's onboarding state, defaulting a never-started brand to in_progress/welcome and
// keeping any unknown stored values from breaking the shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOnboardingState(raw: any): OnboardingState {
  const d = defaultOnboardingState();
  if (!raw || typeof raw !== 'object') return d;
  return {
    status: raw.status === 'paused' || raw.status === 'completed' ? raw.status : 'in_progress',
    phase: (ONBOARDING_PHASES as readonly string[]).includes(raw.phase) ? (raw.phase as OnboardingPhase) : 'welcome',
    sections: { ...d.sections, ...(raw.sections ?? {}) }
  };
}

// The three review-and-approve sections of the build phase. When the agent finishes gathering a
// section it flips it to 'waiting_review' (→ the *_review phase), which surfaces the approval card
// in the Panoramica. The user's "Approva" then stamps 'approved' and jumps to the next *_generation
// phase — the source of truth that unlocks the following section's gate.
export type ApprovableSection = 'studio' | 'strategy' | 'editorial_plan';

export const SECTION_REVIEW_PHASE: Record<ApprovableSection, OnboardingPhase> = {
  studio: 'studio_review',
  strategy: 'strategy_review',
  editorial_plan: 'editorial_plan_review'
};

export const SECTION_APPROVED_NEXT_PHASE: Record<ApprovableSection, OnboardingPhase> = {
  studio: 'strategy_generation',
  strategy: 'editorial_plan_generation',
  editorial_plan: 'content_assets_request'
};

// Persist a shallow patch (sections merge), merging with whatever's already stored.
export async function saveOnboardingState(
  supabase: SupabaseClient,
  brandId: string,
  patch: Partial<Omit<OnboardingState, 'sections'>> & { sections?: Partial<OnboardingSections> }
): Promise<OnboardingState> {
  const { data } = await supabase.from('brands').select('onboarding_state').eq('id', brandId).maybeSingle();
  const current = getOnboardingState(data?.onboarding_state);
  const next: OnboardingState = {
    status: patch.status ?? current.status,
    phase: patch.phase ?? current.phase,
    sections: { ...current.sections, ...(patch.sections ?? {}) }
  };
  await supabase.from('brands').update({ onboarding_state: next }).eq('id', brandId);
  return next;
}

/**
 * Mark Studio approved in onboarding_state when it isn't yet.
 * Chat setup is autonomous: once brand identity exists (or strategy is about to run),
 * we don't wait for a separate user "Approva" on Studio.
 */
export async function approveStudioIfNeeded(
  supabase: SupabaseClient,
  brandId: string
): Promise<{ approved: boolean; already: boolean; state: OnboardingState }> {
  const { data } = await supabase.from('brands').select('onboarding_state').eq('id', brandId).maybeSingle();
  const current = getOnboardingState(data?.onboarding_state);
  if (current.sections.studio === 'approved') {
    return { approved: false, already: true, state: current };
  }
  const state = await saveOnboardingState(supabase, brandId, {
    sections: { studio: 'approved' },
    phase: SECTION_APPROVED_NEXT_PHASE.studio
  });
  return { approved: true, already: false, state };
}

// ── Reconcile with reality ─────────────────────────────────────────────────────
// The onboarding_state only advances through the chat tools — but strategy, plans, content and
// socials can all be built from the side pages or the CLI, which never touch it. A stale state
// left the chat stuck in onboarding mode demanding a Studio re-approval while an ACTIVE plan
// already existed. Artifacts are only flipped to 'active' on approval (the chat inserts
// 'proposed'), so an active artifact IS an approval — raise the matching sections and phase.
// Returns the corrected state, or null when nothing needs to change.
export function reconcileOnboardingState(
  s: OnboardingState,
  facts: { hasActiveGtm: boolean; hasActiveEditorialPlan: boolean; hasLivePosts: boolean; socialConnected: boolean }
): OnboardingState | null {
  if (s.status !== 'in_progress') return null;
  const sections = { ...s.sections };
  if (facts.hasActiveGtm || facts.hasActiveEditorialPlan) {
    sections.studio = 'approved';
    sections.strategy = 'approved';
  }
  if (facts.hasActiveEditorialPlan) sections.editorial_plan = 'approved';
  if (facts.hasLivePosts) sections.content = 'approved';
  if (facts.socialConnected) sections.social = 'connected';

  const operational = sections.editorial_plan === 'approved' && facts.hasLivePosts && facts.socialConnected;
  const targetPhase: OnboardingPhase = operational
    ? 'free_mode'
    : sections.editorial_plan === 'approved'
      ? 'content_assets_request'
      : sections.strategy === 'approved'
        ? 'editorial_plan_generation'
        : s.phase;
  // Only ever move FORWARD: a brand mid-onboarding in the chat keeps its phase.
  const phase = ONBOARDING_PHASES.indexOf(targetPhase) > ONBOARDING_PHASES.indexOf(s.phase) ? targetPhase : s.phase;
  const status: OnboardingStatus = operational ? 'completed' : s.status;

  const next: OnboardingState = { status, phase, sections };
  return JSON.stringify(next) === JSON.stringify(s) ? null : next;
}

// ── Phase-ordering gate ────────────────────────────────────────────────────────
// The hard rule of the flow: never run a phase before its prerequisite section is approved.
// Generation tools (added in later milestones) call this so the AI can't skip ahead.
export function canGenerate(s: OnboardingState, section: 'strategy' | 'editorial_plan' | 'content'): boolean {
  if (section === 'strategy') return s.sections.studio === 'approved';
  if (section === 'editorial_plan') return s.sections.strategy === 'approved';
  if (section === 'content') return s.sections.editorial_plan === 'approved';
  return false;
}
