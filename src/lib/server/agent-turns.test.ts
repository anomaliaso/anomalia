import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

/**
 * Il ponte tick → coda chat per gli agenti di default promossi. Le proprietà:
 *   1. il turno finisce nel thread DELL'AGENTE (`job:<key>`), con scheduled=true e il brief
 *      server-side — il messaggio visibile resta la riga corta;
 *   2. il dedupe (minIntervalMs) guarda i soli turni schedulati del thread: un giro già accodato
 *      questa settimana risponde 'fresh', una risposta dell'utente nel thread non sopprime nulla;
 *   3. un giro precedente ancora attivo tiene il posto ('thread_busy');
 *   4. nei tick, il gate del roster sta PRIMA dell'enqueue e l'attivazione deterministica del
 *      rollover NON è dentro il ramo promosso (controlli sul sorgente, stile team-ignition.test).
 */

const mocks = vi.hoisted(() => ({
  getOrCreateAgentThread: vi.fn(async () => ({
    threadId: 't-strat',
    userId: 'owner1',
    locale: 'it' as const,
    created: false
  })),
  enqueueQueuedChatTurn: vi.fn(async () => 'job-1'),
  threadHasActiveChatResponse: vi.fn(async () => false),
  kickChatQueueWork: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/team-ignition', () => ({
  getOrCreateAgentThread: mocks.getOrCreateAgentThread
}));
vi.mock('$lib/server/chat/queue', () => ({
  enqueueQueuedChatTurn: mocks.enqueueQueuedChatTurn,
  threadHasActiveChatResponse: mocks.threadHasActiveChatResponse,
  kickChatQueueWork: mocks.kickChatQueueWork
}));

import { enqueueAgentJobTurn } from './agent-turns';

/** Fake admin: serve solo la query di dedupe su chat_jobs. */
function fakeAdmin(recentScheduledJobs: Array<{ id: string }>) {
  const filters: Record<string, unknown> = {};
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: (c: string, v: unknown) => ((filters[c] = v), b),
    gte: () => b,
    filter: (c: string, _op: string, v: unknown) => ((filters[c] = v), b),
    limit: async () => ({ data: recentScheduledJobs, error: null })
  });
  return {
    client: { from: () => b } as unknown as SupabaseClient,
    filters
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enqueueAgentJobTurn', () => {
  it('accoda nel thread del SUO agente: scheduled=true, brief nel system, riga corta visibile', async () => {
    const { client } = fakeAdmin([]);
    const r = await enqueueAgentJobTurn(client, {
      brandId: 'b1',
      jobKey: 'strategy_review',
      brief: '## SCHEDULED STRATEGY REVIEW\n- gtm',
      visible: { it: 'Revisione settimanale della strategia', en: 'Weekly strategy review' },
      minIntervalMs: 6 * 24 * 3600 * 1000
    });
    expect(r).toEqual({ ok: true, jobId: 'job-1', threadId: 't-strat' });
    expect(mocks.getOrCreateAgentThread).toHaveBeenCalledWith(client, 'b1', 'strategy_review');
    const call = mocks.enqueueQueuedChatTurn.mock.calls[0][1] as Record<string, unknown>;
    expect(call.threadId).toBe('t-strat');
    expect(call.scheduled).toBe(true);
    expect(call.brief).toContain('SCHEDULED STRATEGY REVIEW');
    // Il thread mostra la riga corta nella lingua dell'owner, mai il brief.
    expect(call.userMessage).toBe('Revisione settimanale della strategia');
    expect(call.locale).toBe('it');
  });

  it("un turno schedulato recente nel thread risponde 'fresh' e non accoda", async () => {
    const { client, filters } = fakeAdmin([{ id: 'old-job' }]);
    const r = await enqueueAgentJobTurn(client, {
      brandId: 'b1',
      jobKey: 'analytics_review',
      brief: 'x',
      visible: { it: 'v', en: 'v' },
      minIntervalMs: 6 * 24 * 3600 * 1000
    });
    expect(r).toEqual({ ok: false, reason: 'fresh' });
    expect(mocks.enqueueQueuedChatTurn).not.toHaveBeenCalled();
    // Il dedupe filtra sui SOLI turni schedulati: una risposta umana non deve contare.
    expect(filters['input_params->scheduled']).toBe('true');
  });

  it("un giro precedente ancora attivo tiene il posto: 'thread_busy'", async () => {
    mocks.threadHasActiveChatResponse.mockResolvedValueOnce(true);
    const { client } = fakeAdmin([]);
    const r = await enqueueAgentJobTurn(client, {
      brandId: 'b1',
      jobKey: 'strategy_review',
      brief: 'x',
      visible: { it: 'v', en: 'v' }
    });
    expect(r).toEqual({ ok: false, reason: 'thread_busy' });
    expect(mocks.enqueueQueuedChatTurn).not.toHaveBeenCalled();
  });

  it('brand orfano (nessun owner): niente thread, niente turno', async () => {
    mocks.getOrCreateAgentThread.mockResolvedValueOnce(null as never);
    const { client } = fakeAdmin([]);
    const r = await enqueueAgentJobTurn(client, {
      brandId: 'b1',
      jobKey: 'strategy_review',
      brief: 'x',
      visible: { it: 'v', en: 'v' }
    });
    expect(r).toEqual({ ok: false, reason: 'no_owner' });
  });
});

describe('i tick promossi — proprietà sul sorgente', () => {
  it('analytics: il gate del roster sta PRIMA dell’enqueue, e il report deterministico è sparito', () => {
    const src = readFileSync('src/routes/api/v1/analytics/review/tick/+server.ts', 'utf8');
    const gate = src.indexOf('jobEnabledForBrand(');
    const enqueue = src.indexOf('enqueueAgentJobTurn(');
    expect(gate).toBeGreaterThan(-1);
    expect(enqueue).toBeGreaterThan(gate);
    // Promosso = il testo del turno È il report: la riga deterministica raddoppierebbe.
    expect(src).not.toContain('reportToAgentThread('); // il commento di testa può nominarlo
  });

  it('scheduler: enqueue dello Stratega dietro il gate del roster; attivazione del rollover deterministica', () => {
    const src = readFileSync('src/lib/server/scheduler.ts', 'utf8');
    // L'enqueue è guardato dallo stesso interruttore del roster.
    expect(src).toContain('if (!strategistPaused && strategistTasks.length > 0)');
    // L'auto-attivazione della proposta scaduta resta una chiamata diretta (consegna, non
    // ragionamento) e NON dipende dallo stratega: spegnerlo non deve fermare la pubblicazione.
    const activation = src.indexOf('await activatePlan(supabase, brand.id, proposalId, brand.timezone)');
    expect(activation).toBeGreaterThan(-1);
    // Il ramo del ragionamento non contiene più la chiamata AI inline.
    expect(src).not.toContain('proposeNextCycle(genaiClient()');
    expect(src).not.toContain('reviewPhase(genaiClient()');
  });
});
