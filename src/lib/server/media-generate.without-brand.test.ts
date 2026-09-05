import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «Puoi generare la img di un gatto?» — e l'agente ha risposto di no. Non aveva torto: ogni strada
 * verso il generatore passava sotto `/brands/:slug/`, quindi per disegnare un gatto avrebbe dovuto
 * prima scegliere un'azienda a cui addebitarlo. Qui si misura la strada che non ci passa.
 *
 * Il negativo che conta è la lettura di `brands`: se quel percorso la tocca ancora, qualcosa lo
 * sta ancora ancorando a un brand e l'opzionale è finto. E il positivo che conta è che il brand,
 * quando c'è, si comporti esattamente come prima — rendere opzionale un parametro è il modo
 * classico di far sparire in silenzio quello che quel parametro portava.
 */

const renderPostImage = vi.fn();
const insertBrandMedia = vi.fn();
const storeBrandMediaBytes = vi.fn();
const signKnowledgePaths = vi.fn();
const withBrandContext = vi.fn();
const withOrgContext = vi.fn();

const PNG_DATA_URL = 'data:image/png;base64,AAAA';

let billedUsd: number | undefined;

vi.mock('$lib/server/content-preview', () => ({
  renderPostImage: (...args: unknown[]) => renderPostImage(...args),
  buildImageRequest: (_prompt: string, opts: { model?: string }) => ({ model: opts.model ?? null })
}));
vi.mock('$lib/server/brand-media', () => ({
  loadLibraryMediaParts: async () => [],
  insertBrandMedia: (...args: unknown[]) => insertBrandMedia(...args),
  storeBrandMediaBytes: (...args: unknown[]) => storeBrandMediaBytes(...args),
  probeImageDimensions: async () => ({ width: 1080, height: 1080 })
}));
vi.mock('$lib/server/media-archive', () => ({
  signKnowledgePaths: (...args: unknown[]) => signKnowledgePaths(...args)
}));
vi.mock('$lib/server/content-credentials', () => ({
  markImage: async (bytes: Buffer) => bytes,
  DIGITAL_SOURCE_TYPE: { synthetic: 'trainedAlgorithmicMedia' }
}));
vi.mock('$lib/server/ai-log', () => ({
  billedUsdInScope: () => billedUsd,
  withBrandContext: <T>(brandId: string, fn: () => T) => {
    withBrandContext(brandId);
    return fn();
  },
  withOrgContext: <T>(orgId: string, fn: () => T) => {
    withOrgContext(orgId);
    return fn();
  }
}));

import { generateBrandImages, generateImagesWithoutBrand } from './media-generate';

const SIGNED = 'https://storage.test/signed?token=abc';

/** Legge `brands`: qui è un fallimento, non un dato. Un percorso senza brand non deve arrivarci. */
function supabaseThatHasNoBrands() {
  return {
    from: (table: string) => {
      throw new Error(`ha letto ${table}`);
    }
  } as never;
}

function supabaseWithPrefs(prefs: Record<string, unknown>) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { content_prefs: prefs }, error: null }) }) })
    })
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  billedUsd = 0.0336;
  renderPostImage.mockResolvedValue(PNG_DATA_URL);
  storeBrandMediaBytes.mockResolvedValue({});
  insertBrandMedia.mockResolvedValue({ row: { id: 'media-new', kind: 'image', short_code: 'K7BX2MQ4' } });
  signKnowledgePaths.mockImplementation(async (_c: unknown, paths: string[]) => new Map(paths.map((p) => [p, SIGNED])));
});

describe('disegnare senza un brand', () => {
  const job = { orgId: 'org-1', userId: 'user-1', prompt: 'un gatto' };

  it('non legge la tabella dei brand: se lo facesse, sarebbe ancora ancorato a uno', async () => {
    const out = await generateImagesWithoutBrand(supabaseThatHasNoBrands(), job);

    expect(out.ok).toBe(true);
  });

  it('addebita all organizzazione, che è chi paga quando nessun brand paga', async () => {
    await generateImagesWithoutBrand(supabaseThatHasNoBrands(), job);

    expect(withOrgContext).toHaveBeenCalledWith('org-1');
    expect(withBrandContext).not.toHaveBeenCalled();
  });

  it('non deposita nessuna riga in libreria, e l id non esiste', async () => {
    const out = await generateImagesWithoutBrand(supabaseThatHasNoBrands(), job);

    expect(insertBrandMedia).not.toHaveBeenCalled();
    expect(out.ok && out.media[0].id).toBeNull();
  });

  /**
   * Le policy di `brand_media` dicono `brand_id in (select auth_brand_ids())`, e `NULL in (…)` vale
   * NULL, non true: una riga senza brand sarebbe invisibile a tutti e nemmeno inseribile. Il file
   * però sta in storage, sotto lo user — e lì la policy guarda solo il PRIMO segmento del percorso.
   */
  it('il file sta sotto lo user, dove la policy dello storage lo trova', async () => {
    await generateImagesWithoutBrand(supabaseThatHasNoBrands(), job);

    const [, path] = storeBrandMediaBytes.mock.calls[0];
    expect(String(path).split('/')[0]).toBe('user-1');
  });

  it('torna un link firmato e il percorso, perché non c è un id con cui ritrovarlo', async () => {
    const out = await generateImagesWithoutBrand(supabaseThatHasNoBrands(), job);

    expect(out.ok && out.media[0].url).toBe(SIGNED);
    expect(out.ok && out.media[0].storage_path).toMatch(/^user-1\/media\//);
  });

  it('più alternative, più render pagati, e il conto lo dice', async () => {
    const out = await generateImagesWithoutBrand(supabaseThatHasNoBrands(), { ...job, count: 3 });

    expect(renderPostImage).toHaveBeenCalledTimes(3);
    expect(out.ok && out.renders).toBe(3);
  });

  it('dice quanto è costato leggendolo dalle righe, non da un listino accanto', async () => {
    const out = await generateImagesWithoutBrand(supabaseThatHasNoBrands(), job);

    expect(out.ok && out.costUsd).toBe(0.0336);
  });

  it('una fattura che non è arrivata resta sconosciuta, non zero', async () => {
    billedUsd = undefined;

    const out = await generateImagesWithoutBrand(supabaseThatHasNoBrands(), job);

    expect(out.ok && out.costUsd).toBeNull();
  });

  /**
   * Senza id, la firma è l'UNICO modo di raggiungere il file: se non arriva, chi legge `ok` si
   * ritrova un render pagato e niente da aprire. Un successo vuoto è peggio di un errore.
   */
  it('una firma che non arriva è un fallimento, non una url nulla', async () => {
    signKnowledgePaths.mockResolvedValue(new Map());

    const out = await generateImagesWithoutBrand(supabaseThatHasNoBrands(), job);

    expect(out).toEqual({ ok: false, error: 'store_failed' });
  });

  it('un render che non torna niente è un fallimento, non un successo vuoto', async () => {
    renderPostImage.mockResolvedValue(undefined);

    const out = await generateImagesWithoutBrand(supabaseThatHasNoBrands(), job);

    expect(out).toEqual({ ok: false, error: 'render_failed' });
  });
});

describe('con un brand, niente è cambiato', () => {
  const job = { brandId: 'brand-1', userId: 'user-1', prompt: 'un banco in noce' };

  it('il modello continua a venire dalle preferenze del brand', async () => {
    const out = await generateBrandImages(supabaseWithPrefs({ imageModel: 'nano-banana-pro' }), job);

    expect(out.ok && out.model).toBe('nano-banana-pro');
  });

  it('il render resta avvolto nel contesto del brand: è così che la spesa gli arriva', async () => {
    await generateBrandImages(supabaseWithPrefs({}), job);

    expect(withBrandContext).toHaveBeenCalledWith('brand-1');
    expect(withOrgContext).not.toHaveBeenCalled();
  });

  it('l asset entra ancora in libreria, con un id da passare a create_post', async () => {
    const out = await generateBrandImages(supabaseWithPrefs({}), job);

    expect(insertBrandMedia).toHaveBeenCalled();
    expect(out.ok && out.media[0].id).toBe('media-new');
  });
});
