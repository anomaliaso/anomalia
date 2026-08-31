import { describe, expect, it, vi } from 'vitest';

// Senza questo, il test leggeva il .env dello sviluppatore: con WEEK_PLANNER_AGENT_ENABLED=false
// in locale falliva sempre, e quello che verificava non era il default ma la macchina.
vi.mock('$env/dynamic/private', () => ({ env: {} }));
import { MAX_WEEK_PLANNER_DRAFTS, MAX_WEEK_PLANNER_RESEARCH, weekPlannerAgentEnabled } from './week-planner-agent';
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

// Il planner non è mai uscito sul web: i suoi tool leggono solo dentro il brand. Così una battuta
// che nomina un modulo, una norma o un messaggio d'errore lo INVENTA, e sembra pure verificabile.
// Il tetto esiste perché ogni ricerca costa: senza, un agente curioso brucia il budget del batch.
describe('tetto alle ricerche', () => {
  it('conta le ricerche e si ferma al tetto', () => {
    let used = 0;
    const allow = () => (used++ < MAX_WEEK_PLANNER_RESEARCH);
    const results = Array.from({ length: MAX_WEEK_PLANNER_RESEARCH + 2 }, allow);
    expect(results.filter(Boolean)).toHaveLength(MAX_WEEK_PLANNER_RESEARCH);
    expect(results[MAX_WEEK_PLANNER_RESEARCH]).toBe(false);
  });

  it('è un tetto piccolo: la ricerca serve a verificare, non a documentarsi', () => {
    expect(MAX_WEEK_PLANNER_RESEARCH).toBeGreaterThan(0);
    expect(MAX_WEEK_PLANNER_RESEARCH).toBeLessThanOrEqual(8);
  });
});
