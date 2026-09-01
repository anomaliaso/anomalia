import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const scrapeCreatorsGet = vi.fn();
vi.mock('$lib/server/scrapecreators', () => ({ scrapeCreatorsGet: (path: string) => scrapeCreatorsGet(path) }));

const { runOutcomeChecks, pendingOutcomeChecks } = await import('./lead-outcomes');

const LEAD = {
  id: 'lead-1',
  brand_id: 'brand-1',
  url: 'https://www.reddit.com/r/SaaS/comments/abc/def/',
  suggestion: 'Forget paid ads with zero traction, go talk to the people complaining about the bottleneck you solve.',
  done_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  author_handle: 'u/pippo',
  author_platform: 'reddit'
};

type Op = { table: string; op: string; payload?: unknown };

/** Un admin finto che registra ogni scrittura: è su quelle che si giudica, non sui ritorni. */
function fakeAdmin(leads: Array<Record<string, unknown>> = [LEAD]) {
  const ops: Op[] = [];
  const rows: Record<string, unknown[]> = { brand_news_items: leads, lead_outcomes: [] };

  const client = {
    from: (table: string) => {
      const op: Op = { table, op: 'select' };
      const b: Record<string, unknown> = {};
      const self = () => b;
      for (const m of ['select', 'eq', 'not', 'gte', 'lte', 'order', 'limit', 'in']) b[m] = self;
      b.upsert = (payload: unknown) => { ops.push({ table, op: 'upsert', payload }); return Promise.resolve({ error: null }); };
      b.insert = (payload: unknown) => { ops.push({ table, op: 'insert', payload }); return Promise.resolve({ error: null }); };
      b.then = (resolve: (v: { data: unknown[]; error: null }) => void) => {
        ops.push(op);
        return resolve({ data: rows[table] ?? [], error: null });
      };
      return b;
    }
  } as unknown as SupabaseClient;

  return { client, ops };
}

beforeEach(() => scrapeCreatorsGet.mockReset());

describe('runOutcomeChecks — il ramo opt-out arriva davvero fino alla soppressione', () => {
  it('un "non contattarmi" nel thread sopprime l\'autore a livello globale', async () => {
    // Il thread viene comunque riletto per cercare il nostro commento: se dentro c'è un ritiro del
    // consenso, quella persona non va mai più proposta a nessun brand dell'istanza.
    scrapeCreatorsGet.mockResolvedValue({
      comments: [
        { body: 'Please stop contacting me about this, I mean it.', author: 'pippo', ups: 2 },
        { body: 'Unrelated chatter that is long enough to be considered.', author: 'altro', ups: 1 }
      ]
    });

    const { client, ops } = fakeAdmin();
    await runOutcomeChecks(client, 5);

    const suppression = ops.find((o) => o.table === 'lead_suppressions' && o.op === 'upsert');
    expect(suppression, 'nessuna soppressione scritta: il ramo opt-out non è stato raggiunto').toBeDefined();
    expect(suppression?.payload).toMatchObject({
      platform: 'reddit',
      handle: 'u/pippo',
      source: 'thread_scan'
    });
  });

  it('un thread senza segnali non sopprime nessuno', async () => {
    scrapeCreatorsGet.mockResolvedValue({
      comments: [{ body: 'Great thread, this was genuinely useful to read.', author: 'tizio', ups: 5 }]
    });

    const { client, ops } = fakeAdmin();
    await runOutcomeChecks(client, 5);

    expect(ops.find((o) => o.table === 'lead_suppressions')).toBeUndefined();
    // L'esito viene comunque registrato: non ritrovato, non "rimosso" per finta.
    expect(ops.find((o) => o.table === 'lead_outcomes' && o.op === 'insert')).toBeDefined();
  });
});

describe('pendingOutcomeChecks — i campi autore fanno parte del contratto', () => {
  it('porta author_handle e author_platform, che sono ciò che rende possibile la soppressione', async () => {
    const { client } = fakeAdmin();
    const [lead] = await pendingOutcomeChecks(client, 5);
    // Il tipo dichiarato li ometteva pur restituendoli: chi rimuovesse queste due righe dal mapper
    // spegnerebbe il ramo opt-out senza un solo errore di compilazione.
    expect(lead.author_handle).toBe('u/pippo');
    expect(lead.author_platform).toBe('reddit');
  });
});
