import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishApprovedPost = vi.fn();
const structured = vi.fn();

vi.mock('$lib/server/publish', () => ({
  publishApprovedPost: (...args: unknown[]) => publishApprovedPost(...args)
}));
vi.mock('$lib/server/research', () => ({
  structured: (...args: unknown[]) => structured(...args)
}));
vi.mock('$lib/server/ai-log', () => ({
  withBrandContext: (_brandId: string, fn: () => unknown) => fn()
}));
const findBrandMediaByIds = vi.fn();
const publishLibraryMediaAsPostMedia = vi.fn();

vi.mock('$lib/server/brand-media', () => ({
  publishLibraryImageAsPostMedia: vi.fn(),
  findBrandMediaByIds: (...args: unknown[]) => findBrandMediaByIds(...args),
  publishLibraryMediaAsPostMedia: (...args: unknown[]) => publishLibraryMediaAsPostMedia(...args)
}));

import { createManualPost } from './manual-posting';

const TZ = 'Europe/Rome';

const THURSDAY_0900_IN_ROME = {
  date: '2030-05-16',
  time: '09:00',
  utc: '2030-05-16T07:00:00.000Z',
  slot: 'Thu 09:00'
};

type Row = Record<string, unknown>;

function fakeSupabase(): { client: SupabaseLike; rows: Row[] } {
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
  return { client: client as unknown as SupabaseLike, rows };
}

type SupabaseLike = Parameters<typeof createManualPost>[0]['supabase'];

function create(input: Parameters<typeof createManualPost>[0]['input']) {
  const { client, rows } = fakeSupabase();
  return createManualPost({
    supabase: client,
    userId: 'user-1',
    brandId: 'brand-1',
    timezone: TZ,
    input
  }).then((result) => ({ result, rows }));
}

beforeEach(() => {
  vi.clearAllMocks();
  publishApprovedPost.mockResolvedValue({ scheduled: 1, failed: 0 });
});

describe('createManualPost', () => {
  it('un draft resta senza data e non passa dalla pubblicazione', async () => {
    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy scritto a mano',
      mode: 'draft'
    });

    expect(result).toEqual({ ok: true, id: 'post-1', status: 'pending_user', slot: null });
    expect(rows[0].status).toBe('pending_user');
    expect(rows[0].scheduled_for).toBeNull();
    expect(rows[0].slot).toBeNull();
    expect(publishApprovedPost).not.toHaveBeenCalled();
  });

  it('lo scheduling fissa istante e slot sull orologio del brand, poi pubblica', async () => {
    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy scritto a mano',
      mode: 'schedule',
      date: THURSDAY_0900_IN_ROME.date,
      time: THURSDAY_0900_IN_ROME.time
    });

    expect(rows[0].scheduled_for).toBe(THURSDAY_0900_IN_ROME.utc);
    expect(rows[0].slot).toBe(THURSDAY_0900_IN_ROME.slot);
    expect(rows[0].status).toBe('pending_user');
    expect(publishApprovedPost).toHaveBeenCalledTimes(1);
    expect(publishApprovedPost.mock.calls[0][3]).toEqual({ now: false });
    expect(result).toMatchObject({ ok: true, status: 'scheduled' });
  });

  it('la pubblicazione immediata non fissa nessuna data', async () => {
    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy scritto a mano',
      mode: 'now'
    });

    expect(rows[0].scheduled_for).toBeNull();
    expect(rows[0].slot).toBeNull();
    expect(publishApprovedPost.mock.calls[0][3]).toEqual({ now: true });
    expect(result).toMatchObject({ ok: true, status: 'published' });
  });

  it('una data già passata viene rifiutata', async () => {
    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy scritto a mano',
      mode: 'schedule',
      date: '2020-01-01',
      time: '09:00'
    });

    expect(result).toEqual({ ok: false, error: 'too_soon' });
    expect(rows).toEqual([]);
  });

  it('non chiama mai il modello: la copy arriva già scritta', async () => {
    await create({ platforms: ['linkedin'], caption: 'copy scritto a mano', mode: 'draft' });

    expect(structured).not.toHaveBeenCalled();
  });
});

describe('createManualPost con media della libreria', () => {
  const IMAGE = { id: 'media-img', kind: 'image' as const };
  const VIDEO = { id: 'media-vid', kind: 'video' as const };

  beforeEach(() => {
    findBrandMediaByIds.mockResolvedValue([IMAGE, VIDEO]);
    publishLibraryMediaAsPostMedia.mockImplementation(async (_c: unknown, o: { mediaId: string }) => ({
      publicUrl: `https://cdn.test/${o.mediaId}.bin`,
      media: { id: o.mediaId }
    }));
  });

  it('attacca l immagine della libreria e la pubblica con la sua natura', async () => {
    const { result, rows } = await create({
      platforms: ['instagram'],
      caption: 'copy con immagine',
      libraryIds: [IMAGE.id],
      mode: 'propose'
    });

    expect(result).toMatchObject({ ok: true, status: 'pending_user' });
    expect(rows[0].media_url).toBe('https://cdn.test/media-img.bin');
    expect(publishLibraryMediaAsPostMedia.mock.calls[0][1]).toMatchObject({ kind: 'image' });
  });

  it('un video della libreria soddisfa una piattaforma che vuole il video', async () => {
    const { result, rows } = await create({
      platforms: ['youtube'],
      caption: 'copy con video',
      title: 'Titolo',
      libraryIds: [VIDEO.id],
      mode: 'propose'
    });

    expect(result).toMatchObject({ ok: true });
    expect(rows[0].content_type).toBe('uploaded_video');
  });

  it('un id che non è di questo brand viene rifiutato, non scartato', async () => {
    findBrandMediaByIds.mockResolvedValue([]);

    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy',
      libraryIds: ['media-di-un-altro-brand'],
      mode: 'propose'
    });

    expect(result).toEqual({ ok: false, error: 'media_not_found' });
    expect(rows).toEqual([]);
    expect(publishLibraryMediaAsPostMedia).not.toHaveBeenCalled();
  });

  it('un id malformato non si distingue da un id di un altro brand', async () => {
    findBrandMediaByIds.mockResolvedValue([]);

    const { result: altroBrand } = await create({
      platforms: ['linkedin'],
      caption: 'copy',
      libraryIds: ['media-di-un-altro-brand'],
      mode: 'propose'
    });
    const { result: malformato } = await create({
      platforms: ['linkedin'],
      caption: 'copy',
      libraryIds: ['%%%'],
      mode: 'propose'
    });

    expect(malformato).toEqual(altroBrand);
  });

  it('un media che esiste ma che non riusciamo a materializzare è un guasto nostro, non un id sbagliato', async () => {
    publishLibraryMediaAsPostMedia.mockResolvedValue({ error: 'Upload of library media failed' });

    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy',
      libraryIds: [IMAGE.id],
      mode: 'propose'
    });

    expect(result).toEqual({ ok: false, error: 'media_unavailable' });
    expect(rows).toEqual([]);
  });

  it('un percorso fuori dagli upload di chi chiama viene rifiutato', async () => {
    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy',
      mediaPaths: ['un-altro-utente/uploads/foto.png'],
      mode: 'propose'
    });

    expect(result).toEqual({ ok: false, error: 'media_not_found' });
    expect(rows).toEqual([]);
  });
});
