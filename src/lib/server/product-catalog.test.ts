import { beforeEach, describe, expect, it } from 'vitest';
import { createTestSupabase, type TestSupabase } from '$lib/testkit/supabase';
import { replaceBrandCatalog } from './product-catalog';

const OLD = [
  { id: 'old-1', brand_id: 'brand-1', title: 'Tazza blu', url: 'https://shop.test/tazza' },
  { id: 'old-2', brand_id: 'brand-1', title: 'Tazza rossa', url: 'https://shop.test/rossa' }
];

const SCRAPED = [
  { brand_id: 'brand-1', title: 'Moka 3 tazze', url: 'https://shop.test/moka' },
  { brand_id: 'brand-1', title: 'Senza schema', url: 'shop.test/rotto' },
  { brand_id: 'brand-1', title: 'Filtro', url: 'https://shop.test/filtro' }
];

let kit: TestSupabase;

const titles = () => (kit.tables.get('products') ?? []).map((r) => r.title).sort();

beforeEach(() => {
  kit = createTestSupabase({ products: OLD.map((r) => ({ ...r })) });
});

describe('replaceBrandCatalog', () => {
  it('sostituisce il catalogo quando ogni riga entra', async () => {
    const result = await replaceBrandCatalog(kit.client, 'brand-1', SCRAPED);

    expect(result).toEqual({ inserted: 3, rejected: [], replaced: true });
    expect(titles()).toEqual(['Filtro', 'Moka 3 tazze', 'Senza schema']);
  });

  it('una riga rifiutata non fa cadere le altre, e viene nominata col motivo', async () => {
    kit.failNext('products', 'batch rejected', 'insert');
    kit.failNext('products', 'violates check constraint "products_url_check"', 'insert');

    const result = await replaceBrandCatalog(kit.client, 'brand-1', SCRAPED);

    expect(result.inserted).toBe(2);
    expect(result.replaced).toBe(true);
    expect(result.rejected).toEqual([
      { title: 'Moka 3 tazze', reason: 'violates check constraint "products_url_check"' }
    ]);
    expect(titles()).toEqual(['Filtro', 'Senza schema']);
  });

  it('quando non entra niente il catalogo di prima resta dov era', async () => {
    for (let i = 0; i <= SCRAPED.length; i++) {
      kit.failNext('products', 'permission denied for table products', 'insert');
    }

    const result = await replaceBrandCatalog(kit.client, 'brand-1', SCRAPED);

    expect(result.inserted).toBe(0);
    expect(result.replaced).toBe(false);
    expect(result.rejected).toHaveLength(3);
    expect(titles()).toEqual(['Tazza blu', 'Tazza rossa']);
  });

  it('non cancella niente prima di sapere che il nuovo catalogo è entrato', async () => {
    await replaceBrandCatalog(kit.client, 'brand-1', SCRAPED);

    const ops = kit.calls.filter((c) => c.table === 'products' && c.op !== 'select');

    expect(ops[0].op).toBe('insert');
    expect(ops[ops.length - 1].op).toBe('delete');
  });

  it('una cancellazione fallita si dichiara invece di sparire', async () => {
    kit.failNext('products', 'deadlock detected', 'delete');

    await expect(replaceBrandCatalog(kit.client, 'brand-1', SCRAPED)).rejects.toThrow(/deadlock/);
  });
});
