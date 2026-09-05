import { describe, it, expect, vi } from 'vitest';
import {
  writeMemory,
  buildMemoryContext,
  skillTrigger,
  runDream,
  DREAM_MAX_WRITES_PER_BRAND
} from './brand-memory';

describe('writeMemory session scope', () => {
  it('rejects session writes without threadId (DB CHECK would also fail)', async () => {
    const supabase = { from: vi.fn() };
    await expect(
      writeMemory(supabase as never, 'brand-1', {
        key: 'tone',
        value: 'keep it casual',
        category: 'voice',
        layer: 'session'
      })
    ).rejects.toThrow(/threadId is required/);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe('skillTrigger', () => {
  it('takes the first non-empty line, strips markdown, and truncates', () => {
    expect(skillTrigger('\n\n## **Use when** writing a caption\n1. step one')).toBe(
      'Use when writing a caption'
    );
    expect(skillTrigger('x'.repeat(200))).toHaveLength(100);
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSupabase(rows: any[]) {
  // Every builder method returns the chain; awaiting it yields { data }.
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows })
  };
  for (const m of ['select', 'eq', 'neq', 'gte', 'order', 'limit', 'is', 'or']) chain[m] = () => chain;
  const rpc = vi.fn().mockResolvedValue({ error: null });
  return { supabase: { from: () => chain, rpc }, rpc };
}

describe('buildMemoryContext skills', () => {
  it('injects only the trigger line and does not count a listing as usage', async () => {
    const { supabase, rpc } = mockSupabase([
      { id: 'f1', category: 'fact', key: 'site', value: 'The site is anomalia.so', confidence: 1 },
      {
        id: 's1',
        category: 'skill',
        key: 'caption_rules',
        value: 'Use when writing a caption\n1. no emoji in the hook\n2. CTA on the last line',
        confidence: 0.7
      }
    ]);

    const out = await buildMemoryContext(supabase as never, 'brand-1');

    expect(out).toContain('caption_rules — Use when writing a caption');
    // The steps stay out of the prompt: the model pulls them with read_memory.
    expect(out).not.toContain('CTA on the last line');
    // Only the fact counts as used — otherwise a listed-but-unused skill would never decay.
    expect(rpc).toHaveBeenCalledWith('bump_brand_memory_usage', { entry_ids: ['f1'] });
  });

  it('appends built-in product skill triggers, scoped by agent', async () => {
    const { supabase } = mockSupabase([]);

    // Il Motion Specialist vede i trigger delle skill di default (trigger, mai il corpo).
    const motion = await buildMemoryContext(supabase as never, 'brand-1', { agent: 'motion' });
    expect(motion).toContain('motion-voiceover-fit — Use when');
    expect(motion).toContain('motion-transition-mechanism — Use when');
    expect(motion).not.toContain('generate_voiceover ONCE'); // steps stay behind read_memory

    // L'analyst non scrive sorgente Remotion: nessuna riga spesa sul suo prompt.
    const analyst = await buildMemoryContext(supabase as never, 'brand-1', { agent: 'analyst' });
    expect(analyst).not.toContain('motion-voiceover-fit');
  });
});

// ── La memoria dell'agente: il mestiere, non il brand ─────────────────────────
//
// Il mock qui sotto APPLICA davvero i filtri (a differenza di mockSupabase): senza, un test sullo
// scoping passerebbe con qualunque implementazione.
type Row = Record<string, unknown>;

function scopedSupabase(rows: Row[]) {
  const inserts: Row[] = [];
  const updates: Row[] = [];
  const make = (data: Row[], filters: Array<(r: Row) => boolean>) => {
    const push = (f: (r: Row) => boolean) => make(data, [...filters, f]);
    const resolve = () => data.filter((r) => filters.every((f) => f(r)));
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      eq: (c: string, v: unknown) => push((r) => r[c] === v),
      neq: (c: string, v: unknown) => push((r) => r[c] !== v),
      gte: (c: string, v: number) => push((r) => Number(r[c] ?? 0) >= v),
      is: (c: string, v: unknown) => push((r) => (r[c] ?? null) === v),
      // `agent.is.null,agent.eq."x"` — la sola forma che scopeToAgent produce.
      or: (f: string) => {
        const wanted = f.match(/agent\.eq\."([^"]*)"/)?.[1] ?? null;
        return push((r) => (r.agent ?? null) === null || r.agent === wanted);
      },
      insert: (row: Row) => {
        inserts.push(row);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: 'new-id' }, error: null }) }) };
      },
      update: (row: Row) => {
        updates.push(row);
        return { eq: async () => ({ data: null }) };
      },
      maybeSingle: async () => ({ data: resolve()[0] ?? null }),
      then: (res: (v: unknown) => unknown) => res({ data: resolve() })
    };
    return chain;
  };
  return {
    supabase: { from: () => make(rows, []), rpc: vi.fn().mockResolvedValue({ error: null }) },
    inserts,
    updates
  };
}

const BRAND_FACT = {
  id: 'b1',
  brand_id: 'brand-1',
  layer: 'project',
  category: 'voice',
  key: 'no_buzzwords',
  value: 'Mai dire "soluzione innovativa"',
  confidence: 1,
  agent: null
};
const CONTENT_CRAFT = {
  id: 'c1',
  brand_id: 'brand-1',
  layer: 'project',
  category: 'insight',
  key: 'carousel_price_slide',
  value: 'I caroselli rendono col prezzo alla terza slide',
  confidence: 1,
  agent: 'content'
};

describe('memoria del brand vs memoria dell agente', () => {
  it('un fatto sul brand resta visibile a OGNI agente', async () => {
    for (const agent of ['content', 'motion', 'custom:11111111-1111-1111-1111-111111111111']) {
      const { supabase } = scopedSupabase([BRAND_FACT, CONTENT_CRAFT]);
      const out = await buildMemoryContext(supabase as never, 'brand-1', { agent });
      expect(out).toContain('soluzione innovativa');
    }
  });

  it('una nota di mestiere di Content non arriva a Motion', async () => {
    const { supabase } = scopedSupabase([BRAND_FACT, CONTENT_CRAFT]);
    const content = await buildMemoryContext(supabase as never, 'brand-1', { agent: 'content' });
    expect(content).toContain('terza slide');

    const { supabase: s2 } = scopedSupabase([BRAND_FACT, CONTENT_CRAFT]);
    const motion = await buildMemoryContext(s2 as never, 'brand-1', { agent: 'motion' });
    expect(motion).not.toContain('terza slide');
  });

  it('senza agente (scheduler, radar) entra solo la memoria del brand', async () => {
    const { supabase } = scopedSupabase([BRAND_FACT, CONTENT_CRAFT]);
    const out = await buildMemoryContext(supabase as never, 'brand-1');
    expect(out).toContain('soluzione innovativa');
    expect(out).not.toContain('terza slide');
  });

  it('una voice scritta come privata finisce comunque al brand', async () => {
    for (const category of ['voice', 'constraint', 'fact'] as const) {
      const { supabase, inserts } = scopedSupabase([]);
      await writeMemory(supabase as never, 'brand-1', {
        key: `k_${category}`,
        value: 'v',
        category,
        agent: 'content'
      });
      expect(inserts.at(-1)?.agent).toBeNull();
    }
    // Una nota di metodo, invece, resta di chi la scrive.
    const { supabase, inserts } = scopedSupabase([]);
    await writeMemory(supabase as never, 'brand-1', {
      key: 'carousel_price_slide',
      value: 'v',
      category: 'insight',
      agent: 'content'
    });
    expect(inserts.at(-1)?.agent).toBe('content');
  });

  it('due agenti possono avere la stessa chiave senza rinforzarsi a vicenda', async () => {
    // Motion scrive `carousel_price_slide` mentre Content ce l'ha già: deve nascere una riga
    // NUOVA, non un update della nota di Content (era impossibile con unique (brand_id, key)).
    const { supabase, inserts } = scopedSupabase([CONTENT_CRAFT]);
    const res = await writeMemory(supabase as never, 'brand-1', {
      key: 'carousel_price_slide',
      value: 'Nei video il prezzo va alla fine',
      category: 'insight',
      agent: 'motion'
    });
    expect(res.reinforced).toBe(false);
    expect(inserts.at(-1)?.agent).toBe('motion');

    // …e lo stesso agente sulla stessa chiave rinforza invece di duplicare.
    const { supabase: s2, inserts: i2 } = scopedSupabase([CONTENT_CRAFT]);
    const again = await writeMemory(s2 as never, 'brand-1', {
      key: 'carousel_price_slide',
      value: 'Prezzo alla terza slide, confermato',
      category: 'insight',
      agent: 'content'
    });
    expect(again.reinforced).toBe(true);
    expect(i2).toHaveLength(0);
  });
});

// ── Dream: il lavoro notturno ──────────────────────────────────────────────────
//
// Mock con tabelle vere e filtri veri: insert/update/delete si applicano davvero alle righe, così
// un test sulla promozione fallisce se la promozione non succede (con un mock che ingoia tutto
// passerebbe comunque).
type Tbl = Record<string, Row[]>;

function dreamSupabase(tables: Tbl) {
  const writes = { updates: 0, deletes: 0, inserts: 0 };
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    // mode/patch stanno FUORI da build: `.update({...}).eq('id', x)` costruisce una catena nuova a
    // ogni filtro, e un mode locale si perderebbe al primo `.eq`.
    const state: { mode: 'select' | 'update' | 'delete'; patch: Row } = { mode: 'select', patch: {} };
    const build = (filters: Array<(r: Row) => boolean>) => {
      const push = (f: (r: Row) => boolean) => build([...filters, f]);
      const match = () => rows.filter((r) => filters.every((f) => f(r)));
      const apply = () => {
        const { mode, patch } = state;
        if (mode === 'update') {
          writes.updates++;
          for (const r of match()) Object.assign(r, patch);
          return { data: null, error: null };
        }
        if (mode === 'delete') {
          writes.deletes++;
          for (const r of match()) rows.splice(rows.indexOf(r), 1);
          return { data: null, error: null };
        }
        return { data: match(), error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        in: (c: string, v: unknown[]) => push((r) => v.includes(r[c])),
        eq: (c: string, v: unknown) => push((r) => r[c] === v),
        neq: (c: string, v: unknown) => push((r) => r[c] !== v),
        gte: (c: string, v: number) => push((r) => Number(r[c] ?? 0) >= v),
        is: (c: string, v: unknown) => push((r) => (r[c] ?? null) === v),
        maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => res(apply())
      };
      chain.update = (p: Row) => {
        state.mode = 'update';
        state.patch = p;
        return chain;
      };
      chain.delete = () => {
        state.mode = 'delete';
        return chain;
      };
      chain.insert = (row: Row) => {
        writes.inserts++;
        rows.push({ id: `id-${rows.length + 1}`, ...row });
        return {
          select: () => ({ maybeSingle: async () => ({ data: rows.at(-1), error: null }) }),
          then: (res: (v: unknown) => unknown) => res({ data: null, error: null })
        };
      };
      return chain;
    };
    return build([]);
  };
  return { supabase: { from, rpc: vi.fn().mockResolvedValue({ error: null }) }, writes, tables };
}

const OLD = new Date(Date.now() - 90 * 86400000).toISOString();

function staleRow(i: number, over: Row = {}): Row {
  return {
    id: `m${i}`,
    brand_id: 'brand-1',
    layer: 'project',
    category: 'fact',
    key: `k${i}`,
    value: 'v',
    confidence: 0.8,
    times_reinforced: 0,
    times_used: 1,
    last_used_at: OLD,
    last_reinforced_at: OLD,
    created_at: OLD,
    updated_at: OLD,
    pinned: false,
    expires_at: null,
    agent: null,
    ...over
  };
}

describe('runDream', () => {
  it('non tocca più di DREAM_MAX_WRITES_PER_BRAND righe per giro', async () => {
    const rows = Array.from({ length: DREAM_MAX_WRITES_PER_BRAND + 50 }, (_, i) => staleRow(i));
    const { supabase, writes } = dreamSupabase({ brand_memory: rows });

    const r = await runDream(supabase as never, 'brand-1');

    expect(r.decayed).toBe(DREAM_MAX_WRITES_PER_BRAND);
    expect(r.capped).toBe(true);
    expect(writes.updates).toBe(DREAM_MAX_WRITES_PER_BRAND);
    // L'arretrato resta per la notte dopo, intatto.
    expect(rows.filter((r2) => r2.confidence === 0.8)).toHaveLength(50);
  });

  it('in prova conta tutto e non scrive niente', async () => {
    const rows = [staleRow(1), staleRow(2, { confidence: 0.3 }), staleRow(3, { expires_at: OLD })];
    const { supabase, writes } = dreamSupabase({ brand_memory: rows });

    const r = await runDream(supabase as never, 'brand-1', { dryRun: true });

    // k1 e k3 decadono (k2 è già al pavimento di 0.3), k2 e k3 sarebbero cancellate.
    expect(r.decayed).toBe(2);
    expect(r.archived).toBe(2);
    expect(r.archivedKeys).toEqual(['k2', 'k3']);
    expect(writes).toEqual({ updates: 0, deletes: 0, inserts: 0 });
    expect(rows).toHaveLength(3);
  });

  it('non cancella una riga che nessun prompt ha mai mostrato', async () => {
    // times_used = 0 ⇒ tagliata dal budget di 800 token, mai vista: decade fino a 0.3 e resta lì.
    const rows = [
      staleRow(1, { confidence: 0.3, times_used: 0 }),
      staleRow(2, { confidence: 0.3, times_used: 4 }),
      // Una scadenza esplicita vale comunque: l'ha decisa chi ha scritto la riga.
      staleRow(3, { confidence: 1, times_used: 0, expires_at: OLD })
    ];
    const { supabase } = dreamSupabase({ brand_memory: rows });

    const r = await runDream(supabase as never, 'brand-1');

    expect(r.archivedKeys).toEqual(['k2', 'k3']);
    expect(rows.map((x) => x.key)).toEqual(['k1']);
  });

  /**
   * UN'ASSENZA TOTALE DI DATI NON È UN DATO. Il decadimento sull'inutilizzo presume che qualcuno
   * stia segnalando l'uso. Con la superficie esterna, chi legge la memoria è un modello che sta
   * fuori e segnala con una scrittura esplicita: se non lo fa, l'ipotesi giusta non è «non le usa
   * nessuno» ma «nessuno sta segnalando», e far scendere la confidence sotto il pavimento di
   * iniezione toglierebbe dai prompt righe che stavano funzionando. Un'adozione mancata non deve
   * poter cancellare il patrimonio del cliente.
   */
  it('non decade niente in un brand dove nessuna riga è mai stata segnalata', async () => {
    const rows = [
      staleRow(1, { times_used: 0, last_used_at: null }),
      staleRow(2, { times_used: 0, last_used_at: null })
    ];
    const { supabase, writes } = dreamSupabase({ brand_memory: rows });

    const r = await runDream(supabase as never, 'brand-1');

    expect(r.decayed).toBe(0);
    expect(writes.updates).toBe(0);
    expect(rows.map((x) => x.confidence)).toEqual([0.8, 0.8]);
  });

  it('appena una riga è segnalata, il segnale è vivo e le altre tornano a decadere', async () => {
    const rows = [
      staleRow(1, { times_used: 0, last_used_at: null }),
      staleRow(2, { times_used: 3, last_used_at: OLD })
    ];
    const { supabase } = dreamSupabase({ brand_memory: rows });

    const r = await runDream(supabase as never, 'brand-1');

    expect(r.decayed).toBe(2);
    for (const row of rows) expect(row.confidence as number).toBeCloseTo(0.7);
  });

  it('una scadenza esplicita vale anche senza nessuna segnalazione: l’ha decisa chi ha scritto', async () => {
    const rows = [staleRow(1, { times_used: 0, last_used_at: null, expires_at: OLD })];
    const { supabase } = dreamSupabase({ brand_memory: rows });

    const r = await runDream(supabase as never, 'brand-1');

    expect(r.archivedKeys).toEqual(['k1']);
    expect(rows).toHaveLength(0);
  });

  it('promuove il fatto che la chat ha confermato quattro volte (oggi non succede mai)', async () => {
    // Il caso reale: quattro turni della STESSA chat riportano lo stesso fatto. Con il prompt che
    // diceva "salta ciò che è già in memoria" il modello non lo riestraeva, times_reinforced
    // restava 0 e la soglia di 3 era irraggiungibile per costruzione (max in produzione: 2).
    const { supabase, tables } = dreamSupabase({ brand_memory: [] });
    for (let turn = 0; turn < 4; turn++) {
      await writeMemory(supabase as never, 'brand-1', {
        key: 'spedizione_gratis',
        value: 'La spedizione è gratuita sopra i 50 euro',
        category: 'fact',
        confidence: 0.9,
        source: 'chat',
        layer: 'session',
        threadId: 'thread-1'
      });
    }

    const rows = tables.brand_memory;
    expect(rows).toHaveLength(1);
    expect(rows[0].times_reinforced).toBe(3);

    const r = await runDream(supabase as never, 'brand-1');

    expect(r.promoted).toBe(1);
    expect(rows[0].layer).toBe('project');
    expect(rows[0].thread_id).toBeNull();
  });
});

describe('extractMemoryFromChat', () => {
  it('chiede di RIEMETTERE la chiave già nota invece di saltarla', async () => {
    const prompts: string[] = [];
    vi.doMock('./research', () => ({
      structured: async (prompt: string) => {
        prompts.push(prompt);
        return [];
      }
    }));
    vi.doMock('$lib/server/brand-context', () => ({ genaiClient: () => ({}) }));
    vi.resetModules();
    const { extractMemoryFromChat } = await import('./brand-memory');

    const { supabase } = dreamSupabase({ brand_memory: [staleRow(1)] });
    await extractMemoryFromChat(
      supabase as never,
      'brand-1',
      'La spedizione è gratis sopra i 50 euro, ricordatelo',
      'Segnato: spedizione gratuita sopra i 50 euro.',
      { threadId: 'thread-1' }
    );

    expect(prompts).toHaveLength(1);
    // La causa della soglia irraggiungibile, in una riga.
    expect(prompts[0]).not.toContain('Skip things already in EXISTING MEMORY');
    expect(prompts[0]).toContain('EXACT SAME key');
    vi.doUnmock('./research');
    vi.doUnmock('$lib/server/brand-context');
    vi.resetModules();
  });
});
