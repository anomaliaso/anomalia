import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestSupabase, type TestSupabase } from '$lib/testkit/supabase';
import type { ApiKeyInfo } from '$lib/server/cli-auth';

const gateCredits = vi.fn();
const renderPreviewImages = vi.fn();
const brandContexts: string[] = [];

class CreditsExhaustedError extends Error {}

vi.mock('$lib/server/access', () => ({ userCanEnter: async () => true }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({}) }));
vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  CreditsExhaustedError
}));
vi.mock('$lib/server/content-preview', () => ({
  renderPreviewImages: (...args: unknown[]) => renderPreviewImages(...args)
}));
vi.mock('$lib/server/ai-log', () => ({
  withBrandContext: <T>(brandId: string, fn: () => T) => {
    brandContexts.push(brandId);
    return fn();
  }
}));

// gateAiAction e checkApiKeyWriteAccess restano quelli veri: il difetto era che la rotta non li
// chiamava, e un mock del gate non avrebbe potuto accorgersene.
vi.mock('$lib/server/cli-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/cli-auth')>()),
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn()
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

const BRAND = { id: 'brand-1', org_id: 'org-1', slug: 'demo', name: 'Demo', plan: 'pro' };
const POST_ROW = {
  id: 'post-1',
  brand_id: 'brand-1',
  platform: 'instagram',
  platforms: ['instagram'],
  format: 'single',
  content_type: 'image',
  caption: 'copy',
  image_prompt: 'una tazza sul bancone',
  image_prompts: null,
  media_url: null,
  product_name: null,
  pillar: null
};

const READ_ONLY_KEY: ApiKeyInfo = {
  id: 'key-1',
  name: 'read only',
  user_id: 'user-1',
  permissions: { brand_ids: '*', scopes: ['read'] }
};

function call(apiKey?: ApiKeyInfo, prepare?: (kit: TestSupabase) => void) {
  const kit = createTestSupabase({ posts: [{ ...POST_ROW }], brand_kit: [], products: [] });
  prepare?.(kit);
  vi.mocked(authenticate).mockResolvedValue({
    supabase: kit.client,
    user: { id: 'user-1' },
    apiKey,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: BRAND, error: null } as never);

  const url = new URL('https://anomalia.test/api/v1/brands/demo/posts/post-1/render');
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST' }),
    params: { slug: 'demo', id: 'post-1' },
    url
  }).then(async (res) => ({ res, body: await res.json(), kit }));
}

beforeEach(() => {
  vi.clearAllMocks();
  brandContexts.length = 0;
  gateCredits.mockResolvedValue(undefined);
  renderPreviewImages.mockImplementation(
    async (_profile: unknown, _posts: unknown, opts: { onPost: (p: unknown) => Promise<void> }) => {
      await opts.onPost({ imageUrl: 'https://cdn.test/a.png', format: 'single' });
    }
  );
});

describe('POST /api/v1/brands/:slug/posts/:id/render', () => {
  it('nega una API key di sola lettura, e non renderizza niente', async () => {
    const { res, body } = await call(READ_ONLY_KEY);

    expect(res.status).toBe(403);
    expect(body.error).toBe('API key is read-only');
    expect(renderPreviewImages).not.toHaveBeenCalled();
  });

  it('nega un brand senza crediti, e non renderizza niente', async () => {
    gateCredits.mockRejectedValue(new CreditsExhaustedError('no credits'));

    const { res, body } = await call();

    expect(res.status).toBe(402);
    expect(body.error).toBe('credits_exhausted');
    expect(renderPreviewImages).not.toHaveBeenCalled();
  });

  it('renderizza quando il gate passa, e attribuisce il render al brand', async () => {
    const { res, body, kit } = await call();

    expect(res.status).toBe(200);
    expect(body.url).toBe('https://cdn.test/a.png');
    expect(gateCredits).toHaveBeenCalledWith('brand-1');
    expect(brandContexts).toEqual(['brand-1']);
    expect(renderPreviewImages.mock.calls[0][2]).toEqual(expect.objectContaining({ brandId: 'brand-1' }));
    expect(kit.tables.get('posts')?.[0].media_url).toBe('https://cdn.test/a.png');
  });

  it('un render senza immagine non è ok: true, e dice che i crediti sono già usciti', async () => {
    renderPreviewImages.mockImplementation(
      async (_profile: unknown, _posts: unknown, opts: { onPost: (p: unknown) => Promise<void> }) => {
        await opts.onPost({ imageUrl: null, __renderError: 'il modello ha rifiutato il prompt' });
      }
    );

    const { res, body } = await call();

    expect(res.ok).toBe(false);
    expect(body.ok).not.toBe(true);
    expect(body.error).toContain('il modello ha rifiutato il prompt');
    expect(body.credits_spent).toBe(true);
  });

  it('un renderer che alza non è ok: true, e dice che i crediti sono già usciti', async () => {
    renderPreviewImages.mockRejectedValue(new Error('il fornitore ha chiuso la connessione'));

    const { res, body } = await call();

    expect(res.ok).toBe(false);
    expect(body.ok).not.toBe(true);
    expect(body.error).toContain('il fornitore ha chiuso la connessione');
    expect(body.credits_spent).toBe(true);
  });

  it('una scrittura fallita non è ok: true, e dice che i crediti sono già usciti', async () => {
    const { res, body } = await call(undefined, (kit) =>
      kit.failNext('posts', 'permission denied for table posts', 'update')
    );

    expect(res.ok).toBe(false);
    expect(body.ok).not.toBe(true);
    expect(body.error).toContain('permission denied for table posts');
    expect(body.credits_spent).toBe(true);
  });
});
