import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * LA SESSIONE DI ANDREA. Un gatto bianco gia' in libreria, «puoi animarlo con un video di 5s?».
 * L'agente rispondeva che per animare QUELLA foto serviva prima metterla come copertina di una
 * bozza — vero, perche' l'unica strada era `make_video` su un post.
 *
 * Il test guarda che l'immagine di partenza ARRIVI al fornitore come copertina. Che sia tornato un
 * video non dimostra niente: un video torna anche filmando il prompt da zero, ed e' esattamente il
 * difetto — si paga un clip che non c'entra con la foto che era stata chiesta.
 */

const submitAndTrackVideoRender = vi.fn();
const countOutstandingVideoRenders = vi.fn();
const resolveBrandImageIds = vi.fn();

vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => admin }));
vi.mock('$lib/server/video-render-queue', () => ({
  submitAndTrackVideoRender: (...a: unknown[]) => submitAndTrackVideoRender(...a),
  countOutstandingVideoRenders: (...a: unknown[]) => countOutstandingVideoRenders(...a)
}));
vi.mock('$lib/server/brand-media', () => ({
  resolveBrandImageIds: (...a: unknown[]) => resolveBrandImageIds(...a)
}));
vi.mock('$lib/server/usage', () => ({ remaining: async () => ({ videos: 5 }) }));
vi.mock('$lib/server/ai-log', () => ({ withBrandContext: <T>(_b: string, fn: () => T) => fn() }));

const FULL_ID = '11111111-2222-3333-4444-555555555555';
const COVER = 'https://signed.test/gatto-bianco.png';

let mediaRows: Array<{ id: string; kind: string }> = [];

const admin = {
  from: (table: string) => ({
    select: () => ({
      eq: () =>
        table === 'brand_media'
          ? { limit: async () => ({ data: mediaRows, error: null }) }
          : {
              maybeSingle: async () => ({
                data:
                  table === 'brands'
                    ? { plan: 'pro', timezone: 'Europe/Rome', content_prefs: {} }
                    : { id: 'job-1' },
                error: null
              })
            }
    })
  })
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mediaRows = [{ id: FULL_ID, kind: 'image' }];
  countOutstandingVideoRenders.mockResolvedValue(0);
  resolveBrandImageIds.mockResolvedValue([COVER]);
  submitAndTrackVideoRender.mockResolvedValue({ taskId: 'kie-1', model: 'grok-imagine/i2v' });
});

const run = async (over: Record<string, unknown> = {}) => {
  const { generateBrandVideo } = await import('./media-generate');
  return generateBrandVideo({
    brandId: 'brand-1',
    userId: 'user-1',
    prompt: 'fallo camminare verso la camera',
    ...over
  } as never);
};

describe('animare un immagine della libreria', () => {
  it('la foto di partenza arriva al fornitore come copertina', async () => {
    // 12s e non 5: il modello non scende sotto i 10, e chiedere 5 ora viene RIFIUTATO invece di
    // essere riportato in silenzio a 10 — vedi media-generate.video-errors.test.ts.
    const out = await run({ baseMediaId: FULL_ID, durationSeconds: 12 });

    expect(out.ok).toBe(true);
    const sent = submitAndTrackVideoRender.mock.calls[0][0];
    // La riga che distingue «anima questa foto» da «filmami un gatto».
    expect(sent.render.imageUrl).toBe(COVER);
    expect(sent.render.duration).toBe(12);
    expect(sent.postId).toBeNull();
  });

  it('senza sorgente non manda nessuna copertina', async () => {
    await run();

    expect(submitAndTrackVideoRender.mock.calls[0][0].render.imageUrl).toBeUndefined();
    expect(resolveBrandImageIds).not.toHaveBeenCalled();
  });

  it('un id di un altro brand FERMA la richiesta invece di filmare da zero', async () => {
    mediaRows = [];

    const out = await run({ baseMediaId: '99999999-0000-0000-0000-000000000000' });

    expect(out).toEqual({ ok: false, error: 'source_not_found' });
    expect(submitAndTrackVideoRender).not.toHaveBeenCalled();
  });

  it('un id che esiste ma non e un immagine lo dice, invece di confonderlo con assente', async () => {
    mediaRows = [{ id: FULL_ID, kind: 'video' }];

    const out = await run({ baseMediaId: FULL_ID });

    expect(out).toEqual({ ok: false, error: 'source_not_an_image' });
    expect(submitAndTrackVideoRender).not.toHaveBeenCalled();
  });

  it('accetta un prefisso corto, come gli id dei post', async () => {
    await run({ baseMediaId: '1111' });

    expect(resolveBrandImageIds).toHaveBeenCalledWith(expect.anything(), 'brand-1', [FULL_ID]);
  });

  it('animare usa il catalogo di videoImageModel, non quello di videoModel', async () => {
    const out = await run({ baseMediaId: FULL_ID, model: 'un-modello-inventato' });

    expect(out.ok).toBe(false);
    expect('error' in out && out.error).toBe('model_not_for_slot');
    expect(submitAndTrackVideoRender).not.toHaveBeenCalled();
  });

  it('dice quale modello ha girato davvero', async () => {
    const out = await run({ baseMediaId: FULL_ID });

    expect(out.ok && out.model).toBe('grok-imagine/i2v');
  });
});
