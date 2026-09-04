import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));

import { GET, PUT } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { GPT_IMAGE_2_MODEL } from '$lib/image-models';
import { ALEPH_REFINE_MODEL, GROK_IMAGINE_VIDEO_MODEL, SEEDANCE_25_MODEL } from '$lib/video-models';

type Row = Record<string, unknown>;

function fakeSupabase(updateError: { message: string } | null = null) {
  const updates: Row[] = [];
  const client = {
    from() {
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

const brand = (content_prefs: Row | null) => ({ id: 'brand-1', slug: 'demo', content_prefs });

const url = 'https://example.test/api/v1/brands/demo/settings/models';

const read = () =>
  (GET as (e: unknown) => Promise<Response>)({
    request: new Request(url),
    params: { slug: 'demo' }
  });

const write = (body: unknown) =>
  (PUT as (e: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'PUT', body: JSON.stringify(body) }),
    params: { slug: 'demo' }
  });

beforeEach(() => {
  vi.clearAllMocks();
  supabase = fakeSupabase();
  vi.mocked(authenticate).mockResolvedValue({ supabase: supabase.client, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: brand(null), error: null } as never);
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(null as never);
});

describe('GET /api/v1/brands/:slug/settings/models', () => {
  it('elenca i sei mestieri con le scelte che ciascuno accetta davvero', async () => {
    const body = await (await read()).json();

    expect(body.brand).toBe('demo');
    expect(body.slots.map((s: Row) => s.slot)).toEqual([
      'imageModel',
      'imageRefineModel',
      'videoModel',
      'videoImageModel',
      'videoRefineModel',
      'videoMotionModel'
    ]);

    const refine = body.slots.find((s: Row) => s.slot === 'videoRefineModel');
    expect(refine.choices.map((c: Row) => c.id)).toEqual([ALEPH_REFINE_MODEL]);
  });

  it('senza una scelta del brand risponde null, non un modello che nessuno ha scelto', async () => {
    const body = await (await read()).json();

    expect(body.slots.every((s: Row) => s.model === null)).toBe(true);
  });

  it('riporta la scelta del brand quando c è', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: brand({ imageModel: GPT_IMAGE_2_MODEL }),
      error: null
    } as never);

    const body = await (await read()).json();

    expect(body.slots.find((s: Row) => s.slot === 'imageModel').model).toBe(GPT_IMAGE_2_MODEL);
  });

  it('non spaccia per attiva una preferenza che il mestiere non sa più fare', async () => {
    // Un catalogo cambia; un id salvato che ha perso il ruolo il renderer lo scarta già.
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: brand({ videoRefineModel: GROK_IMAGINE_VIDEO_MODEL }),
      error: null
    } as never);

    const body = await (await read()).json();

    expect(body.slots.find((s: Row) => s.slot === 'videoRefineModel').model).toBeNull();
  });
});

describe('PUT /api/v1/brands/:slug/settings/models', () => {
  it('salva il modello sotto il mestiere scelto', async () => {
    const res = await write({ slot: 'imageModel', model: GPT_IMAGE_2_MODEL });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, slot: 'imageModel', model: GPT_IMAGE_2_MODEL });
    expect(supabase.updates[0]).toEqual({ content_prefs: { imageModel: GPT_IMAGE_2_MODEL } });
  });

  it('rifiuta un modello che quel mestiere non fa, e dice quali erano ammessi', async () => {
    const res = await write({ slot: 'videoRefineModel', model: GROK_IMAGINE_VIDEO_MODEL });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('model_not_for_slot');
    expect(body.allowed).toEqual([ALEPH_REFINE_MODEL]);
    expect(supabase.updates).toEqual([]);
  });

  it('rifiuta un mestiere che non esiste, invece di scartarlo in silenzio', async () => {
    const res = await write({ slot: 'videoVibesModel', model: GPT_IMAGE_2_MODEL });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_input');
    expect(supabase.updates).toEqual([]);
  });

  it('null toglie la scelta e lascia intatto il resto delle preferenze', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: brand({ imageModel: GPT_IMAGE_2_MODEL, language: 'it' }),
      error: null
    } as never);

    const res = await write({ slot: 'imageModel', model: null });

    expect(res.status).toBe(200);
    expect(supabase.updates[0]).toEqual({ content_prefs: { language: 'it' } });
  });

  it('riporta la durata dentro il tetto del modello appena scelto', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: brand({ videoModel: SEEDANCE_25_MODEL, videoDuration: 30 }),
      error: null
    } as never);

    await write({ slot: 'videoModel', model: GROK_IMAGINE_VIDEO_MODEL });

    const prefs = supabase.updates[0].content_prefs as Row;
    expect(prefs.videoDuration as number).toBeLessThanOrEqual(15);
  });

  it('si ferma prima di scrivere se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response('read only', { status: 403 }) as never
    );

    const res = await write({ slot: 'imageModel', model: GPT_IMAGE_2_MODEL });

    expect(res.status).toBe(403);
    expect(supabase.updates).toEqual([]);
  });

  it('si ferma prima di scrivere se il brand non è del chiamante', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: null,
      error: new Response('not found', { status: 404 })
    } as never);

    const res = await write({ slot: 'imageModel', model: GPT_IMAGE_2_MODEL });

    expect(res.status).toBe(404);
    expect(supabase.updates).toEqual([]);
  });

  it('riporta il fallimento della scrittura come il 500 dichiarato', async () => {
    supabase = fakeSupabase({ message: 'connection reset' });
    vi.mocked(authenticate).mockResolvedValue({ supabase: supabase.client, apiKey: null, error: null } as never);

    const res = await write({ slot: 'imageModel', model: GPT_IMAGE_2_MODEL });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('update_failed');
  });
});
