import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestSupabase, type TestSupabase } from '$lib/testkit/supabase';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => undefined)
}));
vi.mock('$lib/server/tool-guard', () => ({
  safeFetchUrl: async () => ({ body: '<html>Shopify.theme</html>' })
}));
vi.mock('$lib/server/brand-analysis', () => ({
  isShopifySite: () => true,
  isWooCommerceSite: () => false,
  fetchShopifyProducts: async () => SCRAPED,
  fetchWooCommerceProducts: async () => []
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

const SCRAPED = [
  { name: 'Moka 3 tazze', description: 'alluminio', pricing: '29€', productType: 'moka', images: [] },
  { name: 'Filtro', description: 'carta', pricing: '4€', productType: 'filtri', images: [] }
];

const OLD = [
  { id: 'old-1', brand_id: 'brand-1', title: 'Tazza blu' },
  { id: 'old-2', brand_id: 'brand-1', title: 'Tazza rossa' }
];

let kit: TestSupabase;

function call(prepare?: (kit: TestSupabase) => void) {
  kit = createTestSupabase({
    products: OLD.map((r) => ({ ...r })),
    brands: [{ id: 'brand-1', website: 'https://shop.test' }]
  });
  prepare?.(kit);
  vi.mocked(authenticate).mockResolvedValue({
    supabase: kit.client,
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo', name: 'Demo' },
    error: null
  } as never);

  const url = new URL('https://anomalia.test/api/v1/brands/demo/products');
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST' }),
    params: { slug: 'demo' },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

const titles = () => (kit.tables.get('products') ?? []).map((r) => r.title).sort();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/brands/:slug/products', () => {
  it('importa il catalogo nuovo e toglie quello vecchio', async () => {
    const { res, body } = await call();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, platform: 'Shopify', synced: 2, rejected: [] });
    expect(titles()).toEqual(['Filtro', 'Moka 3 tazze']);
  });

  it('un insert che fallisce non lascia il brand senza catalogo, e non dice synced', async () => {
    const { res, body } = await call((k) => {
      k.failNext('products', 'batch rejected', 'insert');
      k.failNext('products', 'violates check constraint "products_url_check"', 'insert');
      k.failNext('products', 'violates check constraint "products_url_check"', 'insert');
    });

    expect(res.ok).toBe(false);
    expect(body.ok).not.toBe(true);
    expect(body.synced).toBeUndefined();
    expect(body.rejected).toHaveLength(2);
    expect(body.rejected[0].reason).toContain('products_url_check');
    expect(titles()).toEqual(['Tazza blu', 'Tazza rossa']);
  });

  it('conta le righe entrate, non quelle trovate sul sito', async () => {
    const { body } = await call((k) => {
      k.failNext('products', 'batch rejected', 'insert');
      k.failNext('products', 'violates check constraint "products_title_check"', 'insert');
    });

    expect(body.synced).toBe(1);
    expect(body.rejected).toEqual([
      { title: 'Moka 3 tazze', reason: 'violates check constraint "products_title_check"' }
    ]);
    expect(titles()).toEqual(['Filtro']);
  });
});
