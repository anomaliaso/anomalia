import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { platformOf, isOptOutSignal, dmWithOptOut, gateVerdict, contactGate, suppressAuthor, sweepLeadRetention } from './lead-contact';

describe('platformOf (una sola fonte di verità per la piattaforma di un lead)', () => {
  it('riconosce le quattro piattaforme di engage e manda il resto a web', () => {
    expect(platformOf('https://www.reddit.com/r/SaaS/comments/abc/hi/')).toBe('reddit');
    expect(platformOf('https://www.threads.net/@ciao/post/123')).toBe('threads');
    expect(platformOf('https://x.com/pippo/status/1')).toBe('x');
    expect(platformOf('https://twitter.com/pippo/status/1')).toBe('x');
    expect(platformOf('https://www.linkedin.com/posts/pippo-123')).toBe('linkedin');
    expect(platformOf('https://news.google.com/rss/articolo')).toBe('web');
  });
});

describe('isOptOutSignal (setaccio del consenso ritirato: stretto, non generico)', () => {
  it('becca le richieste di non essere ricontattati, in inglese e in italiano', () => {
    expect(isOptOutSignal('Stop contacting me please.')).toBe(true);
    expect(isOptOutSignal("Please don't contact me again")).toBe(true);
    expect(isOptOutSignal('Non contattarmi più, grazie')).toBe(true);
    expect(isOptOutSignal('Smettila di scrivermi')).toBe(true);
    expect(isOptOutSignal('please unsubscribe me from this')).toBe(true);
  });

  it('non scatta su testo normale che contiene parole vicine', () => {
    expect(isOptOutSignal('Stop wasting time on paid ads.')).toBe(false);
    expect(isOptOutSignal('I stopped using that tool months ago')).toBe(false);
    expect(isOptOutSignal('Grazie mille, molto utile!')).toBe(false);
    expect(isOptOutSignal('')).toBe(false);
  });
});

describe('dmWithOptOut (la riga di opt-out nel DM è garantita dal server, non dal modello)', () => {
  it('aggiunge la riga a un DM che non la contiene', () => {
    const out = dmWithOptOut('Ciao! Ti consiglio di provare X.');
    expect(out.startsWith('Ciao! Ti consiglio di provare X.')).toBe(true);
    expect(out).toContain('stop');
  });

  it('non duplica quando il DM già contiene il segnale', () => {
    const dm = 'Ciao! Reply "stop" if you want no more messages.';
    expect(dmWithOptOut(dm)).toBe(dm);
  });

  it('ignora il vuoto', () => {
    expect(dmWithOptOut('')).toBe('');
  });
});

describe('gateVerdict (la soppressione batte il contatto passato)', () => {
  it('ordina i casi nel verso giusto', () => {
    expect(gateVerdict({ suppressed: true, contacted: true })).toBe('suppressed');
    expect(gateVerdict({ suppressed: false, contacted: true })).toBe('contacted');
    expect(gateVerdict({ suppressed: false, contacted: false })).toBe('ok');
  });
});

describe('contactGate (interroga soppressione globale e contatti passati)', () => {
  function fakeAdmin(tables: Record<string, unknown[]>) {
    const calls: string[] = [];
    const build = (table: string) => {
      const rows = tables[table] ?? [];
      const b: Record<string, unknown> = {};
      b.select = () => { calls.push(`${table}:select`); return b; };
      b.eq = () => { return b; };
      b.or = () => { calls.push(`${table}:or`); return b; };
      b.limit = () => b;
      b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      b.then = (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null });
      return b;
    };
    return {
      client: { from: (t: string) => { calls.push(t); return build(t); } } as unknown as SupabaseClient,
      calls
    };
  }

  it('becca prima la soppressione e non guarda oltre', async () => {
    const { client, calls } = fakeAdmin({ lead_suppressions: [{ handle: 'pippo' }] });
    const gate = await contactGate(client, 'reddit', 'pippo');
    expect(gate).toEqual({ suppressed: true, contacted: false });
    expect(calls).toContain('lead_suppressions');
    expect(calls).not.toContain('brand_news_items');
  });

  it('un contatto passato (status posted o done) blocca il secondo tocco', async () => {
    const { client, calls } = fakeAdmin({ brand_news_items: [{ id: 'l1' }] });
    const gate = await contactGate(client, 'reddit', 'pippo');
    expect(gate).toEqual({ suppressed: false, contacted: true });
    expect(calls.some((c) => c === 'brand_news_items:or')).toBe(true);
  });

  it('mano pulita: ok', async () => {
    const { client } = fakeAdmin({});
    expect(await contactGate(client, 'reddit', 'pippo')).toEqual({ suppressed: false, contacted: false });
  });
});

describe('suppressAuthor (upsert idempotente, mai duplicati)', () => {
  it('scrive platform+handle+source con onConflict sulla coppia', async () => {
    const ups: Array<{ payload: Record<string, unknown>; options: Record<string, unknown> }> = [];
    const client = {
      from: () => ({
        upsert: (payload: Record<string, unknown>, options: Record<string, unknown>) => {
          ups.push({ payload, options });
          return Promise.resolve({ error: null });
        }
      })
    } as unknown as SupabaseClient;

    await suppressAuthor(client, { platform: 'reddit', handle: 'pippo', source: 'manual', reason: 'chiede di essere lasciato in pace' });
    expect(ups[0].payload).toMatchObject({ platform: 'reddit', handle: 'pippo', source: 'manual' });
    expect(ups[0].options).toMatchObject({ onConflict: 'platform,handle', ignoreDuplicates: true });
  });

  it('non lancia quando il db rifiuta: il guard non deve mai far morire la scansione', async () => {
    const client = {
      from: () => ({ upsert: () => Promise.resolve({ error: { message: 'boom' } }) })
    } as unknown as SupabaseClient;
    await expect(suppressAuthor(client, { platform: 'x', handle: 'pippo', source: 'reply' })).resolves.toBe(false);
  });
});

describe('sweepLeadRetention (il contenuto scade, la riga minima e gli esiti no)', () => {
  type Op = { table: string; op: string; payload?: Record<string, unknown>; filters: string[] };
  function fakeAdmin() {
    const ops: Op[] = [];
    const chain = (op: Op) => {
      const b: Record<string, unknown> = {};
      const add = (f: string) => { op.filters.push(f); return b; };
      b.update = (payload: Record<string, unknown>) => { op.op = 'update'; op.payload = payload; return b; };
      b.delete = () => { op.op = 'delete'; return b; };
      b.lt = (col: string, v: unknown) => add(`lt:${col}`);
      b.in = (col: string, v: unknown) => add(`in:${col}=${JSON.stringify(v)}`);
      b.is = (col: string) => add(`is:${col}=null`);
      b.not = (col: string, word: string) => add(`not:${col}.${word}`);
      b.then = (resolve: (v: { data: []; error: null }) => void) => resolve({ data: [], error: null });
      return b;
    };
    const client = {
      from: (table: string) => {
        const op: Op = { table, op: 'unknown', filters: [] };
        ops.push(op);
        return chain(op);
      }
    } as unknown as SupabaseClient;
    return { client, ops };
  }

  it('applica le quattro scadenze alle tabelle giuste', async () => {
    const { client, ops } = fakeAdmin();
    await sweepLeadRetention(client);
    const byKey = Object.fromEntries(ops.map((o) => [`${o.table}:${o.op}`, o]));
    expect(byKey['brand_news_items:update']).toMatchObject({ payload: { gist: null }, filters: ['lt:created_at', 'not:gist.is'] });
    expect(byKey['brand_news_items:delete']?.filters.join(' ')).toContain("in:status=");
    expect(byKey['brand_news_items:delete']?.filters.join(' ')).toContain('is:done_at=null');
    expect(byKey['brand_news_items:delete']?.filters.join(' ')).toContain('lt:created_at');
    expect(byKey['lead_outcomes:delete']?.op).toBe('delete');
    expect(byKey['radar_searches:delete']?.op).toBe('delete');
  });

  it('non lancia mai: una scadenza rotta non deve fermare il tick', async () => {
    const client = {
      from: () => { throw new Error('boom'); }
    } as unknown as SupabaseClient;
    await expect(sweepLeadRetention(client)).resolves.toBeUndefined();
  });
});
