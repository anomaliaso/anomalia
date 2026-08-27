import { describe, it, expect, vi } from 'vitest';
import {
  reconcileOnboardingState,
  defaultOnboardingState,
  approveStudioIfNeeded,
  type OnboardingState
} from './onboarding';

const stuck = (): OnboardingState => ({
  status: 'in_progress',
  phase: 'studio_review',
  sections: {
    studio: 'waiting_review',
    strategy: 'draft',
    editorial_plan: 'draft',
    content: 'not_started',
    calendar: 'not_started',
    social: 'not_connected'
  }
});

describe('reconcileOnboardingState', () => {
  it('fast-forwards a stale state when active artifacts exist (the "re-approve the Studio" bug)', () => {
    const next = reconcileOnboardingState(stuck(), {
      hasActiveGtm: true,
      hasActiveEditorialPlan: true,
      hasLivePosts: true,
      socialConnected: true
    });
    expect(next).toEqual({
      status: 'completed',
      phase: 'free_mode',
      sections: {
        studio: 'approved',
        strategy: 'approved',
        editorial_plan: 'approved',
        content: 'approved',
        calendar: 'not_started',
        social: 'connected'
      }
    });
  });

  it('raises only the sections whose artifacts exist, and keeps onboarding in progress', () => {
    const next = reconcileOnboardingState(stuck(), {
      hasActiveGtm: true,
      hasActiveEditorialPlan: false,
      hasLivePosts: false,
      socialConnected: false
    });
    expect(next?.status).toBe('in_progress');
    expect(next?.sections.studio).toBe('approved');
    expect(next?.sections.strategy).toBe('approved');
    expect(next?.sections.editorial_plan).toBe('draft');
    expect(next?.phase).toBe('editorial_plan_generation');
  });

  it('leaves a genuinely fresh onboarding untouched (chat generations are only "proposed")', () => {
    expect(
      reconcileOnboardingState(defaultOnboardingState(), {
        hasActiveGtm: false,
        hasActiveEditorialPlan: false,
        hasLivePosts: false,
        socialConnected: false
      })
    ).toBeNull();
  });

  it('never moves the phase backwards for a brand further along in the chat flow', () => {
    const s: OnboardingState = {
      status: 'in_progress',
      phase: 'social_connection_guided',
      sections: {
        studio: 'approved',
        strategy: 'approved',
        editorial_plan: 'approved',
        content: 'approved',
        calendar: 'not_started',
        social: 'not_connected'
      }
    };
    const next = reconcileOnboardingState(s, {
      hasActiveGtm: true,
      hasActiveEditorialPlan: true,
      hasLivePosts: true,
      socialConnected: false
    });
    expect(next).toBeNull(); // nothing to raise, phase untouched
  });

  it('does not touch paused or completed onboarding', () => {
    expect(
      reconcileOnboardingState(
        { ...stuck(), status: 'completed' },
        { hasActiveGtm: true, hasActiveEditorialPlan: true, hasLivePosts: true, socialConnected: true }
      )
    ).toBeNull();
  });
});

describe('approveStudioIfNeeded', () => {
  it('marks studio approved and advances phase', async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'brands') throw new Error(table);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { onboarding_state: stuck() } })
            })
          }),
          update
        };
      })
    } as never;

    const result = await approveStudioIfNeeded(supabase, 'brand-1');
    expect(result.already).toBe(false);
    expect(result.approved).toBe(true);
    expect(result.state.sections.studio).toBe('approved');
    expect(result.state.phase).toBe('strategy_generation');
    expect(update).toHaveBeenCalled();
  });

  it('is a no-op when studio is already approved', async () => {
    const update = vi.fn();
    const approved: OnboardingState = {
      ...stuck(),
      sections: { ...stuck().sections, studio: 'approved' },
      phase: 'strategy_generation'
    };
    const supabase = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { onboarding_state: approved } })
          })
        }),
        update
      }))
    } as never;

    const result = await approveStudioIfNeeded(supabase, 'brand-1');
    expect(result).toEqual({ approved: false, already: true, state: approved });
    expect(update).not.toHaveBeenCalled();
  });
});
