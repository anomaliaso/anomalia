import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishApprovedPost = vi.fn();
const structured = vi.fn();
const gateCredits = vi.fn();
const findBrandMediaByIds = vi.fn();
const publishLibraryMediaAsPostMedia = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/cli-queries', () => ({ getPosts: vi.fn() }));
vi.mock('$lib/server/post-editing', () => ({
  EDITOR_POST_COLS: 'id',
  deletePostCancellingZernio: vi.fn()
}));
vi.mock('$lib/server/post-verdict', () => ({ recordPostVerdicts: vi.fn() }));
vi.mock('$lib/server/publish', () => ({
  publishApprovedPost: (...args: unknown[]) => publishApprovedPost(...args)
}));
vi.mock('$lib/server/research', () => ({ structured: (...args: unknown[]) => structured(...args) }));
vi.mock('$lib/server/ai-log', () => ({ withBrandContext: (_b: string, fn: () => unknown) => fn() }));
vi.mock('$lib/server/brand-media', () => ({
  publishLibraryImageAsPostMedia: vi.fn(),
  findBrandMediaByIds: (...args: unknown[]) => findBrandMediaByIds(...args),
  publishLibraryMediaAsPostMedia: (...args: unknown[]) => publishLibraryMediaAsPostMedia(...args)
}));
vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  CreditsExhaustedError: class extends Error {}
}));
vi.mock('$lib/server/app-url', () => ({ appOrigin: () => 'https://anomalia.test' }));

import { POST } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess, gateAiAction } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;

const THURSDAY_0900_IN_ROME = {
  wallClock: '2030-05-16T09:00',
  utc: '2030-05-16T07:00:00.000Z',
  local: '2030-05-16 09:00 (Europe/Rome)',
  slot: 'Thu 09:00'
};

function fakeSupabase(): { client: unknown; rows: Row[] } {
  const rows: Row[] = [];
  const client = {
    from() {
      const q = {
        insert(row: Row) {
          rows.push(row);
          return q;
        },
        select: () => q,
        eq: () => q,
        single: async () => ({ data: { id: 'post-1' }, error: null }),
        maybeSingle: async () => ({ data: { id: 'post-1', ...rows[0] }, error: null })
      };
      return q;
    }
  };
  return { client, rows };
}

function call(body: unknown, slug = 'demo') {
  const { client, rows } = fakeSupabase();
  vi.mocked(authenticate).mockResolvedValue({
    supabase: client,
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug, timezone: 'Europe/Rome' },
    error: null
  } as never);
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/posts`);
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json(), rows }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(undefined);
  publishApprovedPost.mockResolvedValue({ scheduled: 1, failed: 0 });
  findBrandMediaByIds.mockResolvedValue([]);
});

describe('POST /api/v1/brands/:slug/posts', () => {
  it('deposita la copy come post pending_user e dice dove rivederlo', async () => {
    const { res, body, rows } = await call({
      platforms: ['linkedin'],
      caption: 'Tre cose che abbiamo imparato spedendo di venerdì.'
    });

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      id: 'post-1',
      status: 'pending_user',
      scheduled_for: null,
      scheduled_for_local: null,
      slot: null,
      review_url: 'https://anomalia.test/app/demo/posts/post-1'
    });
    expect(rows[0]).toMatchObject({
      brand_id: 'brand-1',
      status: 'pending_user',
      caption: 'Tre cose che abbiamo imparato spedendo di venerdì.',
      platforms: ['linkedin'],
      source: 'external',
      scheduled_for: null,
      slot: null
    });
  });

  it('non pubblica, non programma, non chiama il modello e non tocca i crediti', async () => {
    await call({ platforms: ['linkedin'], caption: 'copy già scritta' });

    expect(publishApprovedPost).not.toHaveBeenCalled();
    expect(structured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it('una data senza offset è letta sull orologio del brand, non su quello del server', async () => {
    const { body, rows } = await call({
      platforms: ['linkedin'],
      caption: 'copy già scritta',
      scheduled_for: THURSDAY_0900_IN_ROME.wallClock
    });

    expect(body.scheduled_for).toBe(THURSDAY_0900_IN_ROME.utc);
    expect(body.scheduled_for_local).toBe(THURSDAY_0900_IN_ROME.local);
    expect(body.slot).toBe(THURSDAY_0900_IN_ROME.slot);
    expect(rows[0].scheduled_for).toBe(THURSDAY_0900_IN_ROME.utc);
    expect(rows[0].status).toBe('pending_user');
    expect(publishApprovedPost).not.toHaveBeenCalled();
  });

  it('un offset esplicito è tenuto come scritto: l istante proposto non si sposta', async () => {
    const { body } = await call({
      platforms: ['linkedin'],
      caption: 'copy già scritta',
      scheduled_for: '2030-05-16T09:00:00Z'
    });

    expect(body.scheduled_for).toBe('2030-05-16T09:00:00.000Z');
  });

  it('rifiuta una richiesta senza autenticazione', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      error: new Response('Unauthorized', { status: 401 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/demo/posts');
    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'demo' },
      url
    });

    expect(res.status).toBe(401);
  });

  it('rifiuta un brand a cui il chiamante non accede', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      supabase: fakeSupabase().client,
      user: { id: 'user-1' },
      apiKey: undefined,
      error: null
    } as never);
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/altrui/posts');
    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'altrui' },
      url
    });

    expect(res.status).toBe(404);
  });

  it('rifiuta una API key di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response(JSON.stringify({ error: 'API key is read-only' }), { status: 403 }) as never
    );
    const { res, rows } = await call({ platforms: ['linkedin'], caption: 'copy' });

    expect(res.status).toBe(403);
    expect(rows).toEqual([]);
  });

  it.each([
    ['senza piattaforme', { platforms: [], caption: 'copy' }],
    ['senza copy', { platforms: ['linkedin'], caption: '' }],
    ['senza campi', {}]
  ])('rifiuta una richiesta %s prima di toccare il database', async (_label, body) => {
    const { res, body: out, rows } = await call(body);

    expect(res.status).toBe(400);
    expect(out.error).toBe('invalid_input');
    expect(rows).toEqual([]);
  });

  it('rifiuta un campo che il contratto non dichiara, invece di scartarlo in silenzio', async () => {
    const { res, body, rows } = await call({
      platforms: ['linkedin'],
      caption: 'copy',
      campo_che_non_esiste: 'x'
    });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(rows).toEqual([]);
  });

  it('un media di un altro brand ferma la creazione invece di produrre un post senza immagine', async () => {
    findBrandMediaByIds.mockResolvedValue([]);

    const { res, body, rows } = await call({
      platforms: ['instagram'],
      caption: 'copy',
      media_ids: ['asset-di-un-altro-brand']
    });

    expect(res.status).toBe(400);
    expect(body.error).toBe('media_not_found');
    expect(rows).toEqual([]);
  });

  it('un media della libreria sblocca instagram, che da sola la copy non regge', async () => {
    findBrandMediaByIds.mockResolvedValue([{ id: 'asset-1', kind: 'image' }]);
    publishLibraryMediaAsPostMedia.mockResolvedValue({
      publicUrl: 'https://cdn.test/asset-1.png',
      media: { id: 'asset-1' }
    });

    const { res, body, rows } = await call({
      platforms: ['instagram'],
      caption: 'copy con immagine riusata',
      media_ids: ['asset-1']
    });

    expect(res.status).toBe(200);
    expect(body.status).toBe('pending_user');
    expect(rows[0].media_url).toBe('https://cdn.test/asset-1.png');
    expect(rows[0].content_type).toBe('uploaded_image');
  });

  it('rifiuta una piattaforma sconosciuta al dominio', async () => {
    const { res, body, rows } = await call({ platforms: ['mastodon'], caption: 'copy' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('no_platforms');
    expect(rows).toEqual([]);
  });

  it.each(['instagram', 'tiktok', 'youtube'])(
    'rifiuta %s: senza media non regge il solo testo',
    async (platform) => {
      const { res, body, rows } = await call({ platforms: [platform], caption: 'copy' });

      expect(res.status).toBe(400);
      expect(body.error).toBe('need_media');
      expect(rows).toEqual([]);
    }
  );

  it('rifiuta una copy oltre il limite di una piattaforma che non taglia da sola', async () => {
    const { res, body, rows } = await call({ platforms: ['linkedin'], caption: 'a'.repeat(3001) });

    expect(res.status).toBe(400);
    expect(body.error).toBe('over_limit');
    expect(rows).toEqual([]);
  });

  it('rifiuta reddit senza titolo', async () => {
    const { res, body } = await call({ platforms: ['reddit'], caption: 'copy' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('reddit_title');
  });

  it.each([
    ['malformata', 'domani alle 18'],
    ['vuota di senso', 'not-a-date']
  ])('rifiuta una data %s senza scrivere niente', async (_label, scheduled_for) => {
    const { res, body, rows } = await call({ platforms: ['linkedin'], caption: 'copy', scheduled_for });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_scheduled_for');
    expect(rows).toEqual([]);
  });

  it('rifiuta una data già passata', async () => {
    const { res, body, rows } = await call({
      platforms: ['linkedin'],
      caption: 'copy',
      scheduled_for: '2020-01-01T09:00'
    });

    expect(res.status).toBe(400);
    expect(body.error).toBe('too_soon');
    expect(rows).toEqual([]);
  });
});
