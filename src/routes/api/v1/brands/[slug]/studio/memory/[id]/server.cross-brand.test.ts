import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));

import { PATCH, DELETE } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;

// Il client sul percorso a chiave API è service role: nessuna RLS trattiene questa scrittura.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serviceRole(rows: Row[]): any {
  return {
    from() {
      const filters: Array<[string, unknown]> = [];
      let patch: Row = {};
      let removing = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        update(fields: Row) {
          patch = fields;
          return q;
        },
        delete() {
          removing = true;
          return q;
        },
        select: () => q,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return q;
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
          const hit = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          if (removing) {
            hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
          } else {
            hit.forEach((r) => Object.assign(r, patch));
          }
          return Promise.resolve(resolve({ data: hit, error: null }));
        }
      };
      return q;
    }
  };
}

function patch(rows: Row[], body: unknown) {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: serviceRole(rows),
    apiKey: { id: 'k1' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-mio' } } as any);

  return (PATCH as unknown as (event: unknown) => Promise<Response>)({
    request: new Request('https://example.test/memory/m1', {
      method: 'PATCH',
      body: JSON.stringify(body)
    }),
    params: { slug: 'mio', id: 'm1' }
  });
}

function remove(rows: Row[]) {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: serviceRole(rows),
    apiKey: { id: 'k1' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-mio' } } as any);

  return (DELETE as unknown as (event: unknown) => Promise<Response>)({
    request: new Request('https://example.test/memory/m1', { method: 'DELETE' }),
    params: { slug: 'mio', id: 'm1' }
  });
}

describe('PATCH studio memory entry', () => {
  it('non sposta la riga nel brand di un altro cliente', async () => {
    const rows: Row[] = [{ id: 'm1', brand_id: 'brand-mio', value: 'mia', category: 'fact' }];

    const res = await patch(rows, { value: 'iniettata', brand_id: 'brand-vittima' });

    expect(rows[0].brand_id).toBe('brand-mio');
    expect(res.status).toBe(400);
  });

  it('non dichiara successo su una riga che non ha toccato', async () => {
    const rows: Row[] = [{ id: 'm1', brand_id: 'brand-di-un-altro', value: 'sua', category: 'fact' }];

    const res = await patch(rows, { value: 'preso' });

    expect(res.status).toBe(404);
    expect(rows[0].value).toBe('sua');
  });

  it('aggiorna i campi ammessi', async () => {
    const rows: Row[] = [{ id: 'm1', brand_id: 'brand-mio', value: 'vecchia', category: 'fact' }];

    const res = await patch(rows, { value: 'nuova', pinned: true });

    expect(res.status).toBe(200);
    expect(rows[0].value).toBe('nuova');
    expect(rows[0].pinned).toBe(true);
  });
});

describe('DELETE studio memory entry', () => {
  it('non dichiara successo su una riga che non ha toccato', async () => {
    const rows: Row[] = [{ id: 'm1', brand_id: 'brand-di-un-altro', value: 'sua' }];

    const res = await remove(rows);

    expect(res.status).toBe(404);
    expect(rows).toHaveLength(1);
  });

  it('cancella la propria', async () => {
    const rows: Row[] = [{ id: 'm1', brand_id: 'brand-mio', value: 'mia' }];

    const res = await remove(rows);

    expect(res.status).toBe(200);
    expect(rows).toHaveLength(0);
  });
});
