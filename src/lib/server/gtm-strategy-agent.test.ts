import { describe, expect, it, vi } from 'vitest';

// Senza questo, il test leggeva il .env dello sviluppatore: con GTM_AGENT_ENABLED=false
// in locale falliva sempre, e quello che verificava non era il default ma la macchina.
vi.mock('$env/dynamic/private', () => ({ env: {} }));
import { gtmStrategyAgentEnabled, MAX_GTM_AGENT_DRAFTS } from './gtm-strategy-agent';
import { consumeDraftBudget, createStrategyBudget } from './strategy-agent';

describe('gtm strategy agent', () => {
  it('rejects draft_gtm beyond per-run cap', () => {
    const budget = createStrategyBudget({ drafts: MAX_GTM_AGENT_DRAFTS });
    for (let i = 0; i < MAX_GTM_AGENT_DRAFTS; i++) {
      expect(consumeDraftBudget(budget).ok).toBe(true);
    }
    expect(consumeDraftBudget(budget).ok).toBe(false);
  });

  it('defaults enabled unless GTM_AGENT_ENABLED=false', () => {
    expect(gtmStrategyAgentEnabled()).toBe(true);
  });
});
