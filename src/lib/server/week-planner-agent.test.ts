import { describe, expect, it, vi } from 'vitest';

// Senza questo, il test leggeva il .env dello sviluppatore: con WEEK_PLANNER_AGENT_ENABLED=false
// in locale falliva sempre, e quello che verificava non era il default ma la macchina.
vi.mock('$env/dynamic/private', () => ({ env: {} }));
import { MAX_WEEK_PLANNER_DRAFTS, weekPlannerAgentEnabled } from './week-planner-agent';
import { consumeDraftBudget, createStrategyBudget } from './strategy-agent';

describe('week planner agent', () => {
  it('is enabled by default (opt-out via WEEK_PLANNER_AGENT_ENABLED=false)', () => {
    expect(weekPlannerAgentEnabled()).toBe(true);
  });

  it('rejects draft_seeds beyond the per-run cap', () => {
    const budget = createStrategyBudget({ drafts: MAX_WEEK_PLANNER_DRAFTS });
    for (let i = 0; i < MAX_WEEK_PLANNER_DRAFTS; i++) {
      expect(consumeDraftBudget(budget).ok).toBe(true);
    }
    expect(consumeDraftBudget(budget).ok).toBe(false);
  });
});
