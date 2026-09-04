import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));

import { GET, PUT } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;

function fakeSupabase(accounts: Row[] = [], updateError: { message: string } | null = null) {
  const updates: Row[] = [];
  const client = {
    from(table: string) {
      if (table === 'social_accounts') {
        const q = {
          select: () => q,
          eq: () => q,
          order: async () => ({ data: accounts })
        };
        return q;
      }
      const q = {
        update(row: Row) {
          updates.push(row);
          return q;
        },
        eq: async () => ({ error: updateError })
      };
      return q;
    }
  };
  return { client, updates };
}

let supabase: ReturnType<typeof fakeSupabase>;

const BRAND = {
  id: 'brand-1',
  slug: 'demo',
  timezone: 'Europe/Rome',
  target_platforms: ['instagram'],
  content_prefs: null as Row | null
};

const brandWith = (patch: Partial<typeof BRAND>) => ({ ...BRAND, ...patch });

const url = 'https://example.test/api/v1/brands/demo/settings/brand';

const read = () =>
  (GET as (e: unknown) => Promise<Response>)({ request: new Request(url), params: { slug: 'demo' } });

const write = (body: unknown) =>
  (PUT as (e: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'PUT', body: JSON.stringify(body) }),
    params: { slug: 'demo' }
  });

beforeEach(() => {
  vi.clearAllMocks();
  supabase = fakeSupabase([{ platform: 'instagram' }]);
  vi.mocked(authenticate).mockResolvedValue({ supabase: supabase.client, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: BRAND, error: null } as never);
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(null as never);
});

describe('GET /api/v1/brands/:slug/settings/brand', () => {
  it('porta il fuso, le piattaforme scelte e il vocabolario ammesso', async () => {
    const body = await (await read()).json();

    expect(body.timezone).toBe('Europe/Rome');
    expect(body.platforms).toEqual(['instagram']);
    expect(body.platform_choices).toContain('linkedin');
  });

  it('dice quali piattaforme hanno davvero un account, non solo quali sono bersaglio', async () => {
    // Bersagliare una piattaforma senza account non è un errore, ma i post per lei restano fermi:
    // se il tool non lo dice, nessuno lo scopre finché non manca un post.
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: brandWith({ target_platforms: ['instagram', 'reddit'] }),
      error: null
    } as never);

    const body = await (await read()).json();

    expect(body.platforms).toEqual(['instagram', 'reddit']);
    expect(body.connected_platforms).toEqual(['instagram']);
  });

  it('un brand senza preferenze risponde con liste vuote, non con null', async () => {
    const body = await (await read()).json();

    expect(body.hashtags).toEqual({});
    expect(body.voice_examples).toEqual([]);
  });
});

describe('PUT /api/v1/brands/:slug/settings/brand', () => {
  it('cambia solo i campi nominati', async () => {
    const res = await write({ timezone: 'America/New_York' });

    expect(res.status).toBe(200);
    expect(supabase.updates[0]).toEqual({ timezone: 'America/New_York' });
  });

  it('rifiuta un fuso che non esiste invece di romperlo al primo calcolo di orario', async () => {
    const res = await write({ timezone: 'Europe/Atlantide' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_timezone');
    expect(supabase.updates).toEqual([]);
  });

  it('una richiesta senza campi è 400 dichiarato, non un 200 che non fa niente', async () => {
    const res = await write({});

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no_fields');
    expect(supabase.updates).toEqual([]);
  });

  it('rifiuta una piattaforma che il prodotto non serve', async () => {
    const res = await write({ platforms: ['myspace'] });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_input');
    expect(supabase.updates).toEqual([]);
  });

  it('togliere ogni piattaforma salva null, la forma che ogni lettore già gestisce', async () => {
    await write({ platforms: [] });

    expect(supabase.updates[0]).toEqual({ target_platforms: null });
  });

  it('non salva la stessa piattaforma due volte', async () => {
    await write({ platforms: ['instagram', 'instagram', 'linkedin'] });

    expect(supabase.updates[0]).toEqual({ target_platforms: ['instagram', 'linkedin'] });
  });

  it('avverte quando una piattaforma scelta non ha dove pubblicare', async () => {
    const body = await (await write({ platforms: ['instagram', 'reddit'] })).json();

    expect(body.without_account).toEqual(['reddit']);
  });

  it('ripulisce gli hashtag con lo stesso ripulitore del form', async () => {
    await write({ hashtags: { instagram: ['caffe speciale', '#Caffe'] } });

    const prefs = supabase.updates[0].content_prefs as Row;
    expect(prefs.platformHashtags).toEqual({ instagram: ['#caffe', '#speciale'] });
  });

  it('una mappa vuota toglie gli hashtag invece di salvarne una vuota', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: brandWith({ content_prefs: { platformHashtags: { instagram: ['#x'] }, language: 'it' } }),
      error: null
    } as never);

    await write({ hashtags: {} });

    expect(supabase.updates[0].content_prefs).toEqual({ language: 'it' });
  });

  it('scarta le righe vuote fra gli esempi di voce', async () => {
    await write({ voice_examples: ['Un post vero.', '   ', ''] });

    const prefs = supabase.updates[0].content_prefs as Row;
    expect(prefs.voiceExamples).toEqual(['Un post vero.']);
  });

  it('non tocca le altre preferenze del brand', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: brandWith({ content_prefs: { imageModel: 'gpt-image-2', language: 'it' } }),
      error: null
    } as never);

    await write({ voice_examples: ['Un post vero.'] });

    expect(supabase.updates[0].content_prefs).toEqual({
      imageModel: 'gpt-image-2',
      language: 'it',
      voiceExamples: ['Un post vero.']
    });
  });

  it('si ferma prima di scrivere se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(new Response('read only', { status: 403 }) as never);

    const res = await write({ timezone: 'America/New_York' });

    expect(res.status).toBe(403);
    expect(supabase.updates).toEqual([]);
  });

  it('si ferma prima di scrivere se il brand non è del chiamante', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: null,
      error: new Response('not found', { status: 404 })
    } as never);

    const res = await write({ timezone: 'America/New_York' });

    expect(res.status).toBe(404);
    expect(supabase.updates).toEqual([]);
  });

  it('riporta il fallimento della scrittura come il 500 dichiarato', async () => {
    supabase = fakeSupabase([], { message: 'connection reset' });
    vi.mocked(authenticate).mockResolvedValue({ supabase: supabase.client, apiKey: null, error: null } as never);

    const res = await write({ timezone: 'America/New_York' });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('update_failed');
  });
});
