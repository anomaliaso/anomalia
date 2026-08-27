import { describe, expect, it } from 'vitest';
import { assessLoops, doctorHeadline, type DoctorFacts } from './brand-doctor';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

/** Un brand che sta funzionando: tutto collegato, coda vuota, dati propri, review non fresca. */
function healthy(over: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    now: NOW,
    plan: 'pro',
    autopilotEnabled: true,
    autopilotFailureCount: 0,
    lastAutopilotRunAt: daysAgo(2),
    hasActiveEditorialPlan: true,
    connectedAccounts: 2,
    exportOnly: false,
    ownHistoryAt: daysAgo(3),
    pendingPosts: 0,
    pendingStalePosts: 0,
    publishedLast30: 9,
    lastAnalyticsRunAt: daysAgo(8),
    lastTicks: {},
    lastSchedulerError: null,
    ...over
  };
}

const loop = (facts: DoctorFacts, name: string) => assessLoops(facts).find((l) => l.loop === name)!;

describe('assessLoops — publishing', () => {
  it('clears every gate for a brand that publishes', () => {
    expect(loop(healthy(), 'publishing').status).toBe('ok');
  });

  it('names the missing accounts first — it is the gate that makes all the others pointless', () => {
    const l = loop(healthy({ connectedAccounts: 0, publishedLast30: 0, pendingPosts: 12 }), 'publishing');
    expect(l.status).toBe('blocked');
    expect(l.blockedBy).toBe('social_accounts');
    expect(l.gates.find((g) => g.id === 'social_accounts')?.fix).toMatch(/Piattaforme/);
  });

  it('does not call zero accounts a failure on an export-only plan', () => {
    // Go vende socialsIncluded: 0. Segnalarlo come guasto vorrebbe dire dire a un cliente pagante
    // che il suo piano è rotto perché funziona come è stato venduto.
    const l = loop(healthy({ connectedAccounts: 0, exportOnly: true }), 'publishing');
    expect(l.gates.find((g) => g.id === 'social_accounts')?.status).toBe('pass');
    expect(l.blockedBy).not.toBe('social_accounts');
  });

  it('reports the backlog on the STALE count and the real threshold, not on the queue size', () => {
    // Lo scheduler frena su >15 pending più vecchi di 7 giorni. Un doctor che frenasse "appena
    // c'è un pending" direbbe all'utente una cosa che il codice non fa.
    const l = loop(healthy({ pendingPosts: 41, pendingStalePosts: 40, publishedLast30: 0 }), 'publishing');
    expect(l.blockedBy).toBe('approval_backlog');
    expect(l.gates.find((g) => g.id === 'approval_backlog')?.detail).toContain('40');
  });

  it('leaves a fresh queue alone: 20 pending posted this week are not a stall', () => {
    const l = loop(healthy({ pendingPosts: 20, pendingStalePosts: 0 }), 'publishing');
    expect(l.gates.find((g) => g.id === 'approval_backlog')?.status).toBe('pass');
    expect(l.status).toBe('ok');
  });

  it('flags a silent stall: accounts connected, queue clear, nothing published', () => {
    const l = loop(healthy({ publishedLast30: 0 }), 'publishing');
    expect(l.blockedBy).toBe('recent_publish');
  });

  it('does not call "nothing published" a failure on an export-only plan', () => {
    const l = loop(healthy({ publishedLast30: 0, exportOnly: true, connectedAccounts: 0 }), 'publishing');
    expect(l.gates.find((g) => g.id === 'recent_publish')?.status).toBe('unknown');
    expect(l.status).toBe('unknown');
    expect(l.blockedBy).toBeNull();
  });
});

describe('assessLoops — autopilot', () => {
  it('reports the auto-disable with the reason instead of just "off"', () => {
    const l = loop(
      healthy({
        autopilotEnabled: false,
        autopilotFailureCount: 3,
        lastSchedulerError: { at: daysAgo(1), error: 'media_mode.enum[2]: cannot be empty' }
      }),
      'autopilot'
    );
    expect(l.status).toBe('blocked');
    expect(l.blockedBy).toBe('autopilot_enabled');
    expect(l.gates.find((g) => g.id === 'autopilot_enabled')?.detail).toContain('3 fallimenti');
  });

  it('calls a still-enabled brand with failures "failing", not "blocked"', () => {
    // Distinzione che conta: 2/3 fallimenti è un incendio in corso, non una porta chiusa —
    // ed è la finestra in cui si può ancora intervenire prima dello spegnimento automatico.
    const l = loop(
      healthy({ autopilotFailureCount: 2, lastSchedulerError: { at: daysAgo(1), error: 'boom' } }),
      'autopilot'
    );
    expect(l.status).toBe('failing');
    expect(l.blockedBy).toBe('consecutive_failures');
    expect(l.gates.find((g) => g.id === 'consecutive_failures')?.detail).toContain('boom');
  });

  it('treats a missing editorial plan as unknown, never as a blocker', () => {
    // Senza piano l'autopilot gira lo stesso, sulla cadenza di content_prefs: segnalarlo come
    // blocco manderebbe il supporto a caccia di un problema che non c'è.
    const l = loop(healthy({ hasActiveEditorialPlan: false }), 'autopilot');
    expect(l.status).toBe('unknown');
    expect(l.blockedBy).toBeNull();
  });
});

describe('assessLoops — analytics review', () => {
  it('names the free plan', () => {
    const l = loop(healthy({ plan: null }), 'analytics_review');
    expect(l.blockedBy).toBe('paid_plan');
  });

  it('names the missing own data — the gate that kept this agent from ever running', () => {
    const l = loop(healthy({ ownHistoryAt: null }), 'analytics_review');
    expect(l.status).toBe('blocked');
    expect(l.blockedBy).toBe('own_performance_data');
    expect(l.gates.find((g) => g.id === 'own_performance_data')?.detail).toContain('competitor');
  });

  it('distinguishes "already done" from "blocked"', () => {
    const l = loop(healthy({ lastAnalyticsRunAt: daysAgo(1) }), 'analytics_review');
    expect(l.status).toBe('waiting');
    expect(l.blockedBy).toBe('freshness');
  });

  it('is ok once the freshness window has passed', () => {
    expect(loop(healthy({ lastAnalyticsRunAt: daysAgo(6) }), 'analytics_review').status).toBe('ok');
  });

  it('surfaces the last recorded tick outcome, skips included', () => {
    const l = loop(
      healthy({ lastTicks: { analytics_review: { at: daysAgo(1), outcome: 'skipped', reason: 'no_budget' } } }),
      'analytics_review'
    );
    expect(l.lastRun).toEqual({ at: daysAgo(1), outcome: 'skipped', reason: 'no_budget' });
  });
});

describe('doctorHeadline', () => {
  it('leads with the first blocked loop and its fix', () => {
    const head = doctorHeadline(assessLoops(healthy({ connectedAccounts: 0, publishedLast30: 0 })));
    expect(head).toContain('publishing');
    expect(head).toContain('→');
  });

  it('does not claim health it cannot see', () => {
    // "Nessun blocco" deve restare circoscritto ai cicli coperti: il doctor ne vede tre su nove.
    expect(doctorHeadline(assessLoops(healthy()))).toContain('cicli coperti');
  });
});
