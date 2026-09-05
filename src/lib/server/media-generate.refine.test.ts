import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL TEST CHE RIPRODUCE LA SESSIONE DI ANDREA. Un'immagine gia' in libreria, l'istruzione «me lo
 * fai rosso»: il risultato deve DERIVARE da quell'asset. Si vede da `opts.baseImage` valorizzato
 * con l'originale e dal modello di REFINE scelto al posto di quello di generazione — se passasse
 * anche con `baseImage` vuoto non misurerebbe nulla, perche' ridisegnare da zero e' esattamente il
 * difetto.
 *
 * E il negativo che conta: un id che non esiste, o di un altro brand, deve FERMARSI. Ricadere
 * sulla generazione sarebbe il difetto travestito da rimedio — l'agente pagherebbe un disegno
 * nuovo credendo di aver modificato il suo.
 */

const renderPostImage = vi.fn();
const loadLibraryMediaParts = vi.fn();
const insertBrandMedia = vi.fn();
const storeBrandMediaBytes = vi.fn();

const ORIGINAL = { inlineData: { mimeType: 'image/png', data: 'ORIGINALE' } };
const PNG_DATA_URL = 'data:image/png;base64,AAAA';

// `buildImageRequest` qui e' uno specchio: restituisce cio' che il servizio gli passa, cosi' il
// test misura QUALI opzioni sono state scelte. Che poi quelle opzioni risolvano al modello giusto
// e' un fatto di buildImageRequest, e sta nel suo test — importarlo davvero qui tira dentro sharp,
// i client dei modelli e mezzo mondo.
vi.mock('$lib/server/content-preview', () => ({
  renderPostImage: (...args: unknown[]) => renderPostImage(...args),
  buildImageRequest: (_prompt: string, opts: { baseImage?: unknown; refineModel?: string; model?: string }) => ({
    model: (opts.baseImage ? opts.refineModel : undefined) ?? opts.model ?? null
  })
}));
vi.mock('$lib/server/brand-media', () => ({
  loadLibraryMediaParts: (...args: unknown[]) => loadLibraryMediaParts(...args),
  insertBrandMedia: (...args: unknown[]) => insertBrandMedia(...args),
  storeBrandMediaBytes: (...args: unknown[]) => storeBrandMediaBytes(...args),
  probeImageDimensions: async () => ({ width: 1080, height: 1080 })
}));
vi.mock('$lib/server/media-archive', () => ({
  signKnowledgePaths: async () => new Map()
}));
vi.mock('$lib/server/content-credentials', () => ({
  markImage: async (bytes: Buffer) => bytes,
  DIGITAL_SOURCE_TYPE: { synthetic: 'trainedAlgorithmicMedia' }
}));
vi.mock('$lib/server/ai-log', () => ({
  billedUsdInScope: () => undefined,
  withBrandContext: <T>(_brandId: string, fn: () => T) => fn()
}));

import { refineBrandImage, generateBrandImages } from './media-generate';

const REFINE_MODEL = 'gemini-3.1-flash-image';

const FULL_ID = '11111111-2222-3333-4444-555555555555';

function supabaseWith(
  prefs: Record<string, unknown>,
  media: Array<{ id: string; kind?: string }> = [{ id: FULL_ID, kind: 'image' }]
) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === 'brand_media'
            ? { limit: async () => ({ data: media, error: null }) }
            : { maybeSingle: async () => ({ data: { content_prefs: prefs }, error: null }) }
      })
    })
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  renderPostImage.mockResolvedValue(PNG_DATA_URL);
  loadLibraryMediaParts.mockResolvedValue([ORIGINAL]);
  storeBrandMediaBytes.mockResolvedValue({});
  insertBrandMedia.mockResolvedValue({ row: { id: 'media-new', kind: 'image' } });
});

describe('rifinire un asset della libreria', () => {
  it('parte DALL ORIGINALE: baseImage è l asset, non un disegno nuovo', async () => {
    const out = await refineBrandImage(supabaseWith({ imageRefineModel: REFINE_MODEL }), {
      brandId: 'brand-1',
      userId: 'user-1',
      prompt: 'me lo fai rosso',
      baseMediaId: FULL_ID
    });

    expect(out.ok).toBe(true);
    expect(loadLibraryMediaParts).toHaveBeenCalledWith(
      expect.anything(),
      'brand-1',
      [FULL_ID],
      1
    );

    const opts = renderPostImage.mock.calls[0][2];
    // Questa è la riga che distingue «rendilo rosso» da «disegna un gatto rosso».
    expect(opts.baseImage).toEqual(ORIGINAL);
    expect(opts.refineModel).toBe(REFINE_MODEL);
  });

  it('sceglie il modello di REFINE, non quello di generazione', async () => {
    const out = await refineBrandImage(
      supabaseWith({ imageModel: 'gemini-3.1-flash-lite-image', imageRefineModel: REFINE_MODEL }),
      { brandId: 'brand-1', userId: 'user-1', prompt: 'più caldo', baseMediaId: FULL_ID }
    );

    expect(out.ok && out.model).toBe(REFINE_MODEL);
  });

  it('un asset che non esiste FERMA la richiesta invece di disegnarne uno nuovo', async () => {
    loadLibraryMediaParts.mockResolvedValue([]);

    const out = await refineBrandImage(supabaseWith({}, []), {
      brandId: 'brand-1',
      userId: 'user-1',
      prompt: 'me lo fai rosso',
      baseMediaId: 'media-di-un-altro-brand'
    });

    expect(out).toEqual({ ok: false, error: 'source_not_found' });
    // Il difetto travestito da rimedio: pagare un disegno nuovo credendo di aver modificato.
    expect(renderPostImage).not.toHaveBeenCalled();
  });

  it('generare senza sorgente non tocca il ramo di rifinitura', async () => {
    await generateBrandImages(supabaseWith({ imageRefineModel: REFINE_MODEL }), {
      brandId: 'brand-1',
      userId: 'user-1',
      prompt: 'un gatto rosso'
    });

    const opts = renderPostImage.mock.calls[0][2];
    expect(opts.baseImage).toBeUndefined();
    expect(loadLibraryMediaParts).not.toHaveBeenCalled();
  });

  it('accetta un prefisso corto, come gli id dei post', async () => {
    await refineBrandImage(supabaseWith({}, [{ id: FULL_ID, kind: 'image' }, { id: '99999999-0000-0000-0000-000000000000', kind: 'image' }]), {
      brandId: 'brand-1',
      userId: 'user-1',
      prompt: 'più caldo',
      baseMediaId: '1111'
    });

    expect(loadLibraryMediaParts).toHaveBeenCalledWith(expect.anything(), 'brand-1', [FULL_ID], 1);
  });

  it('un prefisso che combacia con due asset non ne sceglie uno a caso', async () => {
    const out = await refineBrandImage(
      supabaseWith({}, [{ id: '1111aaaa-0000-0000-0000-000000000000', kind: 'image' }, { id: '1111bbbb-0000-0000-0000-000000000000', kind: 'image' }]),
      { brandId: 'brand-1', userId: 'user-1', prompt: 'x', baseMediaId: '1111' }
    );

    expect(out).toEqual({ ok: false, error: 'source_not_found' });
    expect(renderPostImage).not.toHaveBeenCalled();
  });

  // Il conto dichiarato deve raccontare i RENDER, non le immagini consegnate. Un render riuscito
  // che qualcosa a valle scarta e' pagato lo stesso, e la sessione che ha aperto questa indagine
  // aveva tre righe `ok: true` con costo per un'immagine sola: `ai_calls` non dice mai che un
  // render e' stato buttato, quindi se non lo dice la risposta non lo dice nessuno.
  it('dice quanti render sono stati PAGATI, non quante immagini consegna', async () => {
    const out = await generateBrandImages(supabaseWith({}), {
      brandId: 'brand-1',
      userId: 'user-1',
      prompt: 'tre direzioni',
      count: 3
    });

    expect(out.ok && out.renders).toBe(3);
    expect(out.ok && out.media.length).toBe(3);
  });

  it('un render pagato che non torna con un immagine resta nel conto', async () => {
    renderPostImage.mockResolvedValueOnce(PNG_DATA_URL).mockResolvedValueOnce(undefined);

    const out = await generateBrandImages(supabaseWith({}), {
      brandId: 'brand-1',
      userId: 'user-1',
      prompt: 'due direzioni',
      count: 2
    });

    // Una immagine consegnata, due render partiti: dichiarare "1" nasconderebbe il secondo conto.
    expect(out.ok && out.media.length).toBe(1);
    expect(out.ok && out.renders).toBe(2);
  });

  it('l originale non viene sovrascritto: esce un asset NUOVO', async () => {
    await refineBrandImage(supabaseWith({}), {
      brandId: 'brand-1',
      userId: 'user-1',
      prompt: 'più caldo',
      baseMediaId: FULL_ID
    });

    // Una insert, mai un update su media-0: chi sbaglia il rosso deve poter ripartire dall'originale.
    expect(insertBrandMedia).toHaveBeenCalledTimes(1);
    expect(insertBrandMedia.mock.calls[0][1]).toMatchObject({ brandId: 'brand-1', source: 'generate' });
  });
});
