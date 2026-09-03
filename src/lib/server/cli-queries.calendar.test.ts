import { describe, it, expect } from 'vitest';
import { getCalendar } from './cli-queries';

/**
 * Un post proposto da un agente esterno ha una data e non è ancora approvato. Prima, i pending
 * erano esclusi dalle query sul mese e ripescati tutti insieme senza filtro: un post datato
 * ottobre compariva anche a gennaio. La data proposta vale come posizione nel calendario; senza
 * data il post resta una bozza a parte.
 */

type Filter = { op: string; column: string; value: unknown };
type Query = { filters: Filter[]; rows: Record<string, unknown>[] };

function fakeSupabase(rows: Record<string, unknown>[]) {
  const queries: Query[] = [];
  const client = {
    from() {
      const q: Record<string, unknown> = {};
      const filters: Filter[] = [];
      const add = (op: string) => (column: string, value?: unknown) => {
        filters.push({ op, column, value });
        return q;
      };
      Object.assign(q, {
        select: () => q,
        eq: add('eq'),
        gte: add('gte'),
        lte: add('lte'),
        order: () => q,
        is: add('is'),
        not: (column: string, op: string, value: unknown) => {
          filters.push({ op: `not.${op}`, column, value });
          return q;
        },
        limit: () => {
          const matched = rows.filter((row) => filters.every((f) => matches(row, f)));
          queries.push({ filters, rows: matched });
          return Promise.resolve({ data: matched, error: null });
        }
      });
      return q;
    }
  };
  return { client, queries };
}

function matches(row: Record<string, unknown>, f: Filter): boolean {
  const value = row[f.column] ?? null;
  if (f.op === 'eq') return value === f.value;
  if (f.op === 'not.eq') return value !== f.value;
  if (f.op === 'is') return value === f.value;
  if (f.op === 'not.is') return value !== f.value;
  if (f.op === 'gte') return value !== null && String(value) >= String(f.value);
  if (f.op === 'lte') return value !== null && String(value) <= String(f.value);
  return true;
}

const DATED_IN_OCTOBER = {
  id: 'proposed',
  brand_id: 'brand-1',
  status: 'pending_user',
  scheduled_for: '2030-10-14T07:30:00.000Z',
  slot: 'Mon 09:30'
};

const UNDATED = {
  id: 'draft',
  brand_id: 'brand-1',
  status: 'pending_user',
  scheduled_for: null,
  slot: null
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const calendar = (rows: Record<string, unknown>[], year: number, month: number) => {
  const { client } = fakeSupabase(rows);
  return getCalendar(client as any, 'brand-1', 'Europe/Rome', year, month);
};

describe('getCalendar con un post proposto dall esterno', () => {
  it('mette un pending datato nel suo mese', async () => {
    const out = await calendar([DATED_IN_OCTOBER], 2030, 10);

    expect(out.posts.map((p) => p.id)).toContain('proposed');
  });

  it('non lo mostra negli altri mesi', async () => {
    const out = await calendar([DATED_IN_OCTOBER], 2030, 1);

    expect(out.posts.map((p) => p.id)).not.toContain('proposed');
  });

  it('tiene la bozza senza data fuori dal mese, come bozza', async () => {
    const out = await calendar([UNDATED], 2030, 1);

    const draft = out.posts.find((p) => p.id === 'draft');
    expect(draft).toBeDefined();
    expect(draft?.isDraft).toBe(true);
  });

  it('un pending datato non è una bozza: ha già un posto nel calendario', async () => {
    const out = await calendar([DATED_IN_OCTOBER], 2030, 10);

    expect(out.posts.find((p) => p.id === 'proposed')?.isDraft).toBeUndefined();
  });
});
