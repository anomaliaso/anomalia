import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDisruptiveIdeasSection,
  formatIdeaLine,
  IDEAS_IN_PROMPT,
  markIdeaUsed,
  saveDisruptiveIdea,
  type DisruptiveIdea
} from './disruptive-ideas';

/**
 * Fake PostgREST builder — chainable, records what it was asked, answers from `rows`.
 * Enough for the two behaviours that matter here: the dedup-on-title read and what gets written.
 */
function fakeSupabase(rows: Partial<DisruptiveIdea>[] = []) {
  const calls: { op: string; payload?: unknown; filters: Record<string, unknown> }[] = [];
  let store = rows.map(
    (r, i) => ({ id: `id-${i}`, status: 'new', tags: [], shown_count: 0, last_shown_at: null, ...r }) as DisruptiveIdea
  );
  // Orologio finto e monotono: `now()` due volte nello stesso millisecondo renderebbe la rotazione
  // indistinguibile proprio nel test che deve dimostrarla.
  let clock = 0;

  const builder = (op: string, payload?: unknown) => {
    const filters: Record<string, unknown> = {};
    calls.push({ op, payload, filters });
    let result: unknown[] = op === 'select' ? [...store] : [];
    const orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
    let lim = Infinity;

    const val = (r: unknown, col: string) => (r as Record<string, unknown>)[col] ?? null;
    const finalize = () => {
      const sorted = [...(result as DisruptiveIdea[])].sort((a, b) => {
        for (const o of orders) {
          const x = val(a, o.col);
          const y = val(b, o.col);
          if (x === y) continue;
          if (x === null) return o.nullsFirst ? -1 : 1;
          if (y === null) return o.nullsFirst ? 1 : -1;
          const cmp = x < y ? -1 : 1;
          return o.asc ? cmp : -cmp;
        }
        return 0;
      });
      return sorted.slice(0, lim);
    };

    const chain = {
      eq(col: string, v: unknown) {
        filters[col] = v;
        result = (result as DisruptiveIdea[]).filter(
          (r) => (r as unknown as Record<string, unknown>)[col] === v
        );
        return chain;
      },
      in(col: string, vals: unknown[]) {
        filters[col] = vals;
        result = (result as DisruptiveIdea[]).filter((r) =>
          vals.includes((r as unknown as Record<string, unknown>)[col])
        );
        return chain;
      },
      ilike(col: string, pattern: string) {
        filters[`ilike:${col}`] = pattern;
        const plain = pattern.replace(/\\(.)/g, '$1');
        result = (result as DisruptiveIdea[]).filter(
          (r) => String((r as unknown as Record<string, unknown>)[col]).toLowerCase() === plain.toLowerCase()
        );
        return chain;
      },
      order(col: string, opt?: { ascending?: boolean; nullsFirst?: boolean }) {
        orders.push({ col, asc: opt?.ascending !== false, nullsFirst: !!opt?.nullsFirst });
        return chain;
      },
      limit(n: number) {
        lim = n;
        return chain;
      },
      select() {
        if (op === 'insert') {
          const row = { id: 'new-id', status: 'new', ...(payload as object) } as DisruptiveIdea;
          store = [...store, row];
          result = [row];
        }
        if (op === 'update') {
          result = [{ ...(store[0] ?? {}), ...(payload as object) } as DisruptiveIdea];
        }
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({ data: finalize()[0] ?? null, error: null });
      },
      then(res: (v: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: finalize(), error: null }).then(res);
      }
    };
    return chain;
  };

  const client = {
    from: () => ({
      select: () => builder('select'),
      insert: (payload: unknown) => builder('insert', payload),
      update: (payload: unknown) => builder('update', payload),
      delete: () => builder('delete')
    }),
    // L'unico rpc che questo modulo chiama: segna come mostrate le idee appena lette.
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ op: `rpc:${name}`, payload: args, filters: {} });
      if (name === 'bump_disruptive_idea_shown') {
        const ids = args.idea_ids as string[];
        for (const row of store) {
          if (!ids.includes(row.id) || row.brand_id !== args.p_brand) continue;
          row.last_shown_at = new Date(++clock).toISOString();
          row.shown_count += 1;
        }
      }
      return Promise.resolve({ data: null, error: null });
    }
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('saveDisruptiveIdea', () => {
  it('writes the lever, the contrast and the origin, clamping the score', async () => {
    const { client, calls } = fakeSupabase();
    const res = await saveDisruptiveIdea(client, 'brand-1', 'user-1', {
      title: '  La maglia che brucia  ',
      idea: 'Qualcuno brucia una maglia low-cost, marchio mai inquadrato.',
      device: 'destroy_the_alternative',
      whyItContrasts: 'Nessuno mostra la fine del prodotto che vende',
      whoItAnnoys: 'Chi vende fast fashion',
      format: 'comparison',
      score: 140,
      surface: 'ugc',
      agent: 'ugc'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.duplicate).toBe(false);
    const insert = calls.find((c) => c.op === 'insert')!.payload as Record<string, unknown>;
    expect(insert.title).toBe('La maglia che brucia');
    expect(insert.device).toBe('destroy_the_alternative');
    expect(insert.score).toBe(100);
    expect(insert.surface).toBe('ugc');
    expect(insert.user_id).toBe('user-1');
  });

  it('drops a lever that is not in the catalog instead of storing junk', async () => {
    const { client, calls } = fakeSupabase();
    await saveDisruptiveIdea(client, 'b', null, {
      title: 'X',
      idea: 'Y',
      device: 'be_edgy'
    });
    expect((calls.find((c) => c.op === 'insert')!.payload as Record<string, unknown>).device).toBeNull();
  });

  it('refuses an idea without a title or a body', async () => {
    const { client } = fakeSupabase();
    expect(await saveDisruptiveIdea(client, 'b', null, { title: '', idea: 'x' })).toEqual({
      ok: false,
      error: 'title e idea sono obbligatori'
    });
  });

  it('updates instead of duplicating when the same title comes back', async () => {
    const { client, calls } = fakeSupabase([
      { title: 'La maglia che brucia', idea: 'vecchia versione', brand_id: 'brand-1' }
    ]);
    const res = await saveDisruptiveIdea(client, 'brand-1', null, {
      title: 'la maglia CHE brucia',
      idea: 'versione nuova'
    });
    expect(res.ok && res.duplicate).toBe(true);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
    const update = calls.find((c) => c.op === 'update')!.payload as Record<string, unknown>;
    expect(update.idea).toBe('versione nuova');
    // The surface stays the one the idea was born on — it is where it came from, not where it was seen again.
    expect(update.surface).toBeUndefined();
  });

  it('escapes ILIKE wildcards so a title with % does not match half the bank', async () => {
    const { client, calls } = fakeSupabase();
    await saveDisruptiveIdea(client, 'b', null, { title: 'Sconto 50% vero', idea: 'x' });
    expect(calls[0]!.filters['ilike:title']).toBe('Sconto 50\\% vero');
  });
});

describe('formatIdeaLine', () => {
  it('renders one line a model can act on', () => {
    const line = formatIdeaLine({
      id: '1',
      brand_id: 'b',
      user_id: null,
      title: 'La maglia che brucia',
      idea: 'brucia una maglia low-cost',
      device: 'destroy_the_alternative',
      why_it_contrasts: 'nessuno mostra la fine del prodotto',
      who_it_annoys: 'il fast fashion',
      format: 'comparison',
      score: 88,
      surface: 'ugc',
      agent: 'ugc',
      thread_id: null,
      status: 'new',
      used_post_id: null,
      used_at: null,
      last_shown_at: null,
      shown_count: 0,
      tags: [],
      created_at: '2026-01-01',
      updated_at: '2026-01-01'
    });
    expect(line).toContain('[new]');
    expect(line).toContain('88/100');
    expect(line).toContain("Distruggi l'alternativa");
    expect(line).toContain('infastidisce: il fast fashion');
  });
});

describe('buildDisruptiveIdeasSection', () => {
  it('says the bank is empty rather than leaving the agent guessing', async () => {
    const { client } = fakeSupabase();
    const section = await buildDisruptiveIdeasSection(client, 'b');
    expect(section).toMatch(/Vuoto/);
    expect(section).toContain('save_disruptive_idea');
  });

  it('lists the ideas still to shoot and asks for a new one anyway', async () => {
    const { client } = fakeSupabase([
      { brand_id: 'b', title: 'La maglia che brucia', idea: 'brucia', status: 'new', score: 90 },
      { brand_id: 'b', title: 'Il numero che nessuno mostra', idea: 'margine', status: 'shortlisted' }
    ]);
    const section = await buildDisruptiveIdeasSection(client, 'b');
    expect(section).toContain('La maglia che brucia');
    expect(section).toContain('Il numero che nessuno mostra');
    // Il banco è un pavimento: si può ripescare, e si può depositare.
    expect(section).not.toMatch(/Ripescare batte reinventare/);
    expect(section).toContain('save_disruptive_idea');
    expect(section).toContain('mark_idea_used');
  });

  /**
   * L'INVITO NON PUÒ TORNARE A ESSERE UNA QUOTA. La prima versione di questa sezione diceva
   * "questo lavoro deve lasciare almeno UNA idea NUOVA nel banco" (DUE a banco quasi vuoto), e in
   * modalità obiettivo quella frase si è decomposta in un criterio da spuntare: un post grafico
   * risultava incompleto perché mancavano due idee dirompenti che nessuno aveva chiesto. Un'idea
   * dirompente non è una quota — e una quota produce esattamente il riempitivo che il banco esiste
   * per evitare. Nessun numero e nessun "deve" davanti a save_disruptive_idea, con qualunque
   * quantità di idee nel banco.
   */
  it('invites, never requires: no quota an agent can turn into a goal criterion', async () => {
    const one = [{ brand_id: 'b', title: 'Una', idea: 'x', status: 'new' as const }];
    const many = Array.from({ length: 9 }, (_, i) => ({
      brand_id: 'b',
      title: `Idea ${i}`,
      idea: 'x',
      status: 'new' as const
    }));
    for (const bank of [[], one, many]) {
      const { client } = fakeSupabase(bank);
      const section = await buildDisruptiveIdeasSection(client, 'b');
      expect(section).toContain('save_disruptive_idea');
      // Stessa famiglia di parole del divieto in `lib/disruptive.test.ts`, che copre le sezioni
      // di dottrina: la sezione del banco vive qui perché ha bisogno del finto Supabase.
      // Toccando una delle due liste, guardare l'altra.
      expect(section).not.toMatch(/almeno (UN|UNA|DUE|TRE|\d)/i);
      expect(section).not.toMatch(/at least (ONE|TWO|THREE|\d)/i);
      expect(section).not.toMatch(/deve lasciare|deve comunque|devi salvare|must leave/i);
    }
  });

  /**
   * IL TEST CHE MANCAVA. Il difetto riportato — "l'AI usa continuamente le stesse identiche 2
   * idee" — non era un difetto del modello: la sezione ordinava per punteggio, quindi le due col
   * punteggio più alto stavano in cima a ogni singolo prompt, per sempre. Due letture di fila
   * devono dare due liste diverse, e devono farlo SENZA che nessuno abbia marcato niente.
   */
  it('rotates: two reads in a row do not put the same ideas on top', async () => {
    const bank = Array.from({ length: 12 }, (_, i) => ({
      brand_id: 'b',
      title: `Idea ${i}`,
      idea: 'cosa si vede',
      status: 'new' as const,
      // Punteggi decrescenti: senza rotazione le prime otto sarebbero sempre le stesse otto.
      score: 100 - i
    }));
    const { client } = fakeSupabase(bank);
    const first = await buildDisruptiveIdeasSection(client, 'b');
    const second = await buildDisruptiveIdeasSection(client, 'b');
    expect(first).not.toBe(second);
    const titles = (s: string) => [...s.matchAll(/Idea \d+/g)].map((m) => m[0]);
    expect(titles(first)).toHaveLength(IDEAS_IN_PROMPT);
    // Le quattro mai mostrate devono entrare al secondo giro.
    expect(titles(second)).toEqual(expect.arrayContaining(['Idea 8', 'Idea 9', 'Idea 10', 'Idea 11']));
    // Il punteggio ordina DENTRO il gruppo, non sopra: al primo giro (tutte mai mostrate) vince 100.
    expect(titles(first)[0]).toBe('Idea 0');
  });

  it('records the ideas it showed, and one brand cannot bump another', async () => {
    const { client, calls } = fakeSupabase([
      { brand_id: 'b', title: 'Una', idea: 'x', status: 'new', score: 10 }
    ]);
    await buildDisruptiveIdeasSection(client, 'b');
    const bump = calls.find((c) => c.op === 'rpc:bump_disruptive_idea_shown');
    expect(bump).toBeTruthy();
    expect((bump!.payload as { p_brand: string }).p_brand).toBe('b');
  });

  it('keeps reading when the shown-bump fails: it is telemetry, not the answer', async () => {
    const { client } = fakeSupabase([{ brand_id: 'b', title: 'Una', idea: 'x', status: 'new' }]);
    (client as unknown as { rpc: () => Promise<unknown> }).rpc = () => Promise.reject(new Error('boom'));
    const section = await buildDisruptiveIdeasSection(client, 'b');
    expect(section).toContain('Una');
  });
});

describe('markIdeaUsed', () => {
  it('marks by title, because the prompt shows titles and not uuids', async () => {
    const { client, calls } = fakeSupabase([
      { brand_id: 'b', title: 'La maglia che brucia', idea: 'brucia', status: 'new' }
    ]);
    const res = await markIdeaUsed(client, 'b', { title: 'la MAGLIA che brucia', postId: 'post-1' });
    expect(res).toBeTruthy();
    const update = calls.find((c) => c.op === 'update')!.payload as Record<string, unknown>;
    expect(update.status).toBe('used');
    expect(update.used_post_id).toBe('post-1');
    expect(update.used_at).toBeTruthy();
  });

  it('says no instead of marking something at random when the title is unknown', async () => {
    const { client, calls } = fakeSupabase([{ brand_id: 'b', title: 'Una', idea: 'x' }]);
    expect(await markIdeaUsed(client, 'b', { title: 'Mai vista' })).toBeNull();
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });
});
