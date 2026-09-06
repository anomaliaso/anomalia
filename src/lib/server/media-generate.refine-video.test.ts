import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La meta' che mancava: una clip gia' in libreria si CORREGGE, non si rifilma.
 *
 * `videoRefineModel` esisteva in `set_media_model` da prima di questo percorso e nessun tool lo
 * chiamava — un brand poteva sceglierlo e la scelta non faceva niente. I due fatti che questo file
 * tiene fermi sono quelli che rendono il tool diverso da un generatore:
 *
 *   · un asset di tipo `video` va a `transformVideo`, MAI al motore delle immagini. Se il dispatch
 *     sbaglia riga, un mp4 finisce a un modello che disegna, e il test lo vede.
 *   · senza un modello di refine si RIFIUTA prima di spendere. Ricadere sulla generazione
 *     consegnerebbe una clip nuova a chi ha chiesto di correggere la sua: e' il difetto originale,
 *     tornato dalla porta del video.
 */

const transformVideo = vi.fn();
const saveRenderedVideoToLibrary = vi.fn();
const renderPostImage = vi.fn();

const VIDEO_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const SOURCE_PATH = 'user-1/brand-1/media/original.mp4';
const SIGNED = 'https://storage.example/original.mp4?sig=1';

vi.mock('$lib/server/video', () => ({
  transformVideo: (...args: unknown[]) => transformVideo(...args)
}));
vi.mock('$lib/server/brand-media', () => ({
  saveRenderedVideoToLibrary: (...args: unknown[]) => saveRenderedVideoToLibrary(...args),
  loadLibraryMediaParts: async () => [],
  insertBrandMedia: async () => ({ row: null }),
  storeBrandMediaBytes: async () => ({}),
  probeImageDimensions: async () => ({ width: null, height: null })
}));
vi.mock('$lib/server/content-preview', () => ({
  renderPostImage: (...args: unknown[]) => renderPostImage(...args),
  buildImageRequest: () => ({ model: null }),
  loadBrandVisualContext: async () => ({})
}));
vi.mock('$lib/server/media-archive', () => ({
  signKnowledgePaths: async (_s: unknown, paths: string[]) => new Map(paths.map((p) => [p, SIGNED]))
}));
vi.mock('$lib/server/content-credentials', () => ({
  markImage: async (bytes: Buffer) => bytes,
  DIGITAL_SOURCE_TYPE: { synthetic: 'trainedAlgorithmicMedia' }
}));
vi.mock('$lib/server/ai-log', () => ({
  billedUsdInScope: () => undefined,
  withBrandContext: <T>(_brandId: string, fn: () => T) => fn()
}));

import { refineBrandMedia } from './media-generate';
import { ALEPH_REFINE_MODEL } from '$lib/video-models';

/**
 * Lo stub risponde per COLONNA richiesta, non per tabella: `brand_media` viene letta tre volte con
 * tre select diverse — l'elenco per risolvere il prefisso, il percorso per firmarlo, il codice
 * corto per il link — e distinguerle qui e' cio' che rende il test capace di fallire sul dispatch
 * invece che sul primo `undefined`.
 */
function supabaseWith(prefs: Record<string, unknown>, rows: Array<{ id: string; kind: string }>) {
  const answer = (table: string, columns: string) => {
    if (table === 'brands') return { data: { content_prefs: prefs }, error: null };
    if (columns.includes('storage_path')) return { data: { storage_path: SOURCE_PATH }, error: null };
    if (columns.includes('short_code')) return { data: { short_code: 'ABCD2345' }, error: null };
    return { data: rows, error: null };
  };

  return {
    from: (table: string) => ({
      select: (columns: string) => {
        const step = {
          eq: () => step,
          limit: async () => answer(table, columns),
          maybeSingle: async () => answer(table, columns)
        };
        return step;
      }
    })
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  transformVideo.mockResolvedValue({ url: 'https://cdn/refined.mp4', taskId: 'task-9', model: ALEPH_REFINE_MODEL });
  saveRenderedVideoToLibrary.mockResolvedValue({ mediaId: 'media-refined' });
});

describe('rifinire una clip della libreria', () => {
  it('manda un video a transformVideo, non al motore delle immagini', async () => {
    const out = await refineBrandMedia(supabaseWith({ videoRefineModel: ALEPH_REFINE_MODEL }, [{ id: VIDEO_ID, kind: 'video' }]), {
      brandId: 'brand-1',
      userId: 'user-1',
      baseMediaId: VIDEO_ID,
      instruction: 'tieni il movimento ma fallo notturno'
    });

    expect(out.ok).toBe(true);
    expect(out.ok && out.kind).toBe('video');
    expect(renderPostImage).not.toHaveBeenCalled();

    // La sorgente e' la clip esistente, firmata: senza, il modello filmerebbe da zero.
    expect(transformVideo).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'refine', videoUrl: SIGNED, prompt: 'tieni il movimento ma fallo notturno' })
    );
  });

  it('deposita la clip rifinita come asset NUOVO e ne restituisce l id', async () => {
    const out = await refineBrandMedia(supabaseWith({ videoRefineModel: ALEPH_REFINE_MODEL }, [{ id: VIDEO_ID, kind: 'video' }]), {
      brandId: 'brand-1',
      userId: 'user-1',
      baseMediaId: VIDEO_ID,
      instruction: 'piu` freddo'
    });

    expect(saveRenderedVideoToLibrary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ brandId: 'brand-1', url: 'https://cdn/refined.mp4', sourceRef: 'task-9' })
    );
    expect(out.ok && out.media[0].id).toBe('media-refined');
    expect(out.ok && out.renders).toBe(1);
  });

  it('senza un modello di refine RIFIUTA invece di filmare una clip nuova', async () => {
    const out = await refineBrandMedia(supabaseWith({}, [{ id: VIDEO_ID, kind: 'video' }]), {
      brandId: 'brand-1',
      userId: 'user-1',
      baseMediaId: VIDEO_ID,
      instruction: 'fallo notturno'
    });

    expect(out).toEqual({ ok: false, error: 'no_refine_model' });
    // Niente e' partito, quindi niente e' stato fatturato.
    expect(transformVideo).not.toHaveBeenCalled();
    expect(renderPostImage).not.toHaveBeenCalled();
  });

  it('un modello che non sa riscrivere una clip e` rifiutato con l elenco di quelli ammessi', async () => {
    const out = await refineBrandMedia(supabaseWith({}, [{ id: VIDEO_ID, kind: 'video' }]), {
      brandId: 'brand-1',
      userId: 'user-1',
      baseMediaId: VIDEO_ID,
      instruction: 'fallo notturno',
      model: 'bytedance/seedance-2-5'
    });

    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toBe('model_not_for_slot');
    expect(!out.ok && 'allowed' in out && out.allowed).toContain(ALEPH_REFINE_MODEL);
    expect(transformVideo).not.toHaveBeenCalled();
  });

  it('un tipo che nessuno sa rifinire lo dice, invece di provarci', async () => {
    const out = await refineBrandMedia(supabaseWith({}, [{ id: VIDEO_ID, kind: 'audio' }]), {
      brandId: 'brand-1',
      userId: 'user-1',
      baseMediaId: VIDEO_ID,
      instruction: 'alzalo'
    });

    expect(out).toEqual({ ok: false, error: 'kind_not_refinable' });
    expect(transformVideo).not.toHaveBeenCalled();
    expect(renderPostImage).not.toHaveBeenCalled();
  });
});
