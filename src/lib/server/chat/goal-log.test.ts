import { describe, expect, it, vi } from 'vitest';
import { logGoalEvent, summarizeGoals, type GoalHistoryEntry } from './goal-log';

const crit = (id: string, status: 'open' | 'done' | 'dropped') => ({
  id,
  text: `criterio ${id}`,
  status,
  note: null
});

const entry = (over: Partial<GoalHistoryEntry> = {}): GoalHistoryEntry => ({
  id: 'g1',
  statement: 'Tutti gli articoli con copertina',
  status: 'met',
  source: 'agent',
  laps: 0,
  criteria: [crit('c1', 'done')],
  created_at: '2026-08-20T10:00:00Z',
  closed_at: '2026-08-20T10:04:00Z',
  closing_note: null,
  events: [],
  ...over
});

describe('logGoalEvent', () => {
  it('scrive la riga con i contatori fuori dal payload — è così che si aggrega', async () => {
    const rows: unknown[] = [];
    const supabase = {
      from: () => ({
        insert: async (row: unknown) => {
          rows.push(row);
          return { error: null };
        }
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await logGoalEvent(supabase, {
      kind: 'settled',
      goalId: 'g1',
      brandId: 'b1',
      threadId: 't1',
      reason: 'open_criteria',
      criteria: [crit('c1', 'done'), crit('c2', 'open'), crit('c3', 'dropped')],
      closedNow: 1,
      laps: 2,
      depth: 3,
      queued: true
    });

    expect(rows[0]).toMatchObject({
      kind: 'settled',
      reason: 'open_criteria',
      criteria_done: 1,
      // 'dropped' esce dal totale: un criterio buttato non è lavoro che manca
      criteria_total: 2,
      criteria_closed_now: 1,
      laps: 2,
      depth: 3,
      queued: true,
      actor: 'agent'
    });
  });

  it('non fa mai fallire il turno che sta raccontando', async () => {
    const supabase = {
      from: () => ({
        insert: async () => {
          throw new Error('database in fiamme');
        }
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      logGoalEvent(supabase, { kind: 'opened', goalId: 'g1', brandId: 'b1', criteria: [] })
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('summarizeGoals', () => {
  it('conta gli esiti e distingue chi ce l’ha fatta al primo colpo', () => {
    const s = summarizeGoals([
      entry({ id: 'a', status: 'met', laps: 0 }),
      entry({ id: 'b', status: 'met', laps: 2 }),
      entry({ id: 'c', status: 'handed_back', laps: 4, criteria: [crit('c1', 'open')] }),
      entry({ id: 'd', status: 'open', laps: 1, criteria: [crit('c1', 'done'), crit('c2', 'open')] }),
      entry({ id: 'e', status: 'abandoned', laps: 0, criteria: [crit('c1', 'dropped')] })
    ]);

    expect(s).toMatchObject({
      goals: 5,
      met: 2,
      met_first_pass: 1,
      handed_back: 1,
      open: 1,
      abandoned: 1,
      // 0 + 2 + 4 + 1 + 0 — la voce di spesa della funzione, in un numero solo
      laps: 7,
      criteria_done: 3,
      criteria_dropped: 1,
      criteria_open: 2
    });
  });

  it('la ragione che conta è quella con cui la catena si è fermata, non le riprese riuscite', () => {
    const s = summarizeGoals([
      entry({
        status: 'handed_back',
        events: [
          { kind: 'settled', reason: 'open_criteria', actor: 'agent', progress: '1/3', closed_now: 1, laps: 1, queued: true, at: '1' },
          { kind: 'settled', reason: 'no_progress', actor: 'agent', progress: '1/3', closed_now: 0, laps: 2, queued: false, at: '2' }
        ]
      })
    ]);
    expect(s.stopped_by).toEqual({ no_progress: 1 });
  });

  it('su zero obiettivi non inventa numeri', () => {
    expect(summarizeGoals([])).toMatchObject({ goals: 0, laps: 0, stopped_by: {} });
  });
});
