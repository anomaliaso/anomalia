import { describe, it, expect, vi } from 'vitest';

const tables: Record<string, Row[]> = {};

vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => db() }));
vi.mock('$lib/server/raster-image', () => ({ readUploadImage: vi.fn() }));

import { actions } from './+page.server';

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return {
    from(table: string) {
      const all = (tables[table] ??= []);
      const filters: Array<[string, unknown]> = [];
      let write: 'update' | 'delete' | null = null;
      let patch: Row = {};

      const run = () => {
        const hit = all.filter((r) => filters.every(([c, v]) => r[c] === v));
        if (write === 'update') {
          hit.forEach((r) => Object.assign(r, patch));
        }
        if (write === 'delete') {
          hit.forEach((r) => all.splice(all.indexOf(r), 1));
        }
        return hit;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return q;
        },
        update(fields: Row) {
          write = 'update';
          patch = fields;
          return q;
        },
        delete() {
          write = 'delete';
          return q;
        },
        insert(rows: Row | Row[]) {
          all.push(...[rows].flat());
          return q;
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: run(), error: null }))
      };
      return q;
    }
  };
}

function save(brandSlug: string, articleId: string, fields: Record<string, string | string[]>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of [v].flat()) form.append(k, one);
  }
  return (actions.save as (event: unknown) => Promise<unknown>)({
    request: new Request('https://example.test/save', { method: 'POST', body: form }),
    params: { brand: brandSlug, id: articleId },
    locals: { supabase: db() }
  });
}

describe('site article save', () => {
  it('non tocca i tag di un articolo di un altro cliente', async () => {
    tables.brands = [
      { id: 'brand-a', slug: 'a' },
      { id: 'brand-b', slug: 'b' }
    ];
    tables.brand_articles = [{ id: 'art-b', brand_id: 'brand-b', title: 'Titolo di B' }];
    tables.brand_article_tags = [{ article_id: 'art-b', tag_id: 'tag-di-b' }];

    const res = (await save('a', 'art-b', { title: 'preso', tag_ids: ['tag-di-a'] })) as {
      status?: number;
    };

    expect(tables.brand_article_tags).toEqual([{ article_id: 'art-b', tag_id: 'tag-di-b' }]);
    expect(res.status).toBe(404);
  });

  it('salva i tag del proprio articolo', async () => {
    tables.brands = [{ id: 'brand-a', slug: 'a' }];
    tables.brand_articles = [{ id: 'art-a', brand_id: 'brand-a', title: 'vecchio' }];
    tables.brand_article_tags = [{ article_id: 'art-a', tag_id: 'vecchio-tag' }];

    const res = (await save('a', 'art-a', { title: 'nuovo', tag_ids: ['nuovo-tag'] })) as {
      saved?: boolean;
    };

    expect(res.saved).toBe(true);
    expect(tables.brand_articles[0].title).toBe('nuovo');
    expect(tables.brand_article_tags).toEqual([{ article_id: 'art-a', tag_id: 'nuovo-tag' }]);
  });
});
