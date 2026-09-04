import { describe, it, expect } from 'vitest';
import { updateBrandRow, deleteBrandRow, ROW_NOT_FOUND, EMPTY_PATCH } from './brand-rows';

type Row = Record<string, unknown>;

function store(rows: Row[]) {
  const client = {
    from() {
      const state: { op: 'update' | 'delete' | ''; patch: Row; filters: Row } = {
        op: '',
        patch: {},
        filters: {}
      };
      const q = {
        update(patch: Row) {
          state.op = 'update';
          state.patch = patch;
          return q;
        },
        delete() {
          state.op = 'delete';
          return q;
        },
        eq(column: string, value: unknown) {
          state.filters[column] = value;
          return q;
        },
        async select() {
          const matched = rows.filter((row) =>
            Object.entries(state.filters).every(([column, value]) => row[column] === value)
          );
          if (state.op === 'update') {
            for (const row of matched) Object.assign(row, state.patch);
          }
          if (state.op === 'delete') {
            for (const row of matched) rows.splice(rows.indexOf(row), 1);
          }
          return { data: matched.map((row) => ({ id: row.id })), error: null };
        }
      };
      return q;
    }
  };
  return client as never;
}

const blend = () => ({
  id: 'p1',
  brand_id: 'brand-1',
  title: 'Blend Milano',
  description: 'Torrefazione lenta',
  pricing: '18,50 €',
  featured: true
});

describe('updateBrandRow', () => {
  it('scrive solo i campi passati e lascia gli altri identici', async () => {
    const rows = [blend()];

    const failure = await updateBrandRow(store(rows), 'products', 'brand-1', 'p1', {
      pricing: '19,90 €'
    });

    expect(failure).toBeNull();
    expect(rows[0]).toEqual({ ...blend(), pricing: '19,90 €' });
  });

  it('non tocca la riga di un altro brand', async () => {
    const rows = [{ ...blend(), brand_id: 'brand-2' }];

    const failure = await updateBrandRow(store(rows), 'products', 'brand-1', 'p1', {
      pricing: '19,90 €'
    });

    expect(failure).toEqual({ error: ROW_NOT_FOUND, status: 404 });
    expect(rows[0]).toEqual({ ...blend(), brand_id: 'brand-2' });
  });

  it('risponde allo stesso modo per un id inesistente e per uno di un altro brand', async () => {
    const elsewhere = await updateBrandRow(
      store([{ ...blend(), brand_id: 'brand-2' }]),
      'products',
      'brand-1',
      'p1',
      { title: 'x' }
    );
    const nowhere = await updateBrandRow(store([]), 'products', 'brand-1', 'p1', { title: 'x' });

    expect(nowhere).toEqual(elsewhere);
  });

  it('non scrive niente quando non c’è niente da cambiare', async () => {
    const rows = [blend()];

    const failure = await updateBrandRow(store(rows), 'products', 'brand-1', 'p1', {});

    expect(failure).toEqual({ error: EMPTY_PATCH, status: 400 });
    expect(rows[0]).toEqual(blend());
  });

  it('riporta l’errore del database come 500, non come riga mancante', async () => {
    const failing = {
      from: () => ({
        update: () => failing.from(),
        eq: () => failing.from(),
        select: async () => ({ data: null, error: { message: 'connection reset' } })
      })
    };

    const failure = await updateBrandRow(failing as never, 'products', 'brand-1', 'p1', { title: 'x' });

    expect(failure).toEqual({ error: 'connection reset', status: 500 });
  });
});

describe('deleteBrandRow', () => {
  it('cancella la riga del brand', async () => {
    const rows = [blend()];

    const failure = await deleteBrandRow(store(rows), 'products', 'brand-1', 'p1');

    expect(failure).toBeNull();
    expect(rows).toEqual([]);
  });

  it('non cancella la riga di un altro brand e la dichiara introvabile', async () => {
    const rows = [{ ...blend(), brand_id: 'brand-2' }];

    const failure = await deleteBrandRow(store(rows), 'products', 'brand-1', 'p1');

    expect(failure).toEqual({ error: ROW_NOT_FOUND, status: 404 });
    expect(rows).toHaveLength(1);
  });
});
