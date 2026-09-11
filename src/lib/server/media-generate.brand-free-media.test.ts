import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il disegno senza brand esisteva già; il video, il carosello e la rifinitura no — e non era una
 * decisione di prodotto, era un lavoro non finito. Qui si misurano le tre risposte che la strada
 * senza brand deve dare identiche per tutte e quattro: chi paga, che cosa non esiste (la libreria),
 * e come si nomina una sorgente quando una libreria non c'è.
 *
 * Il negativo che conta resta la lettura di `brands`: se un percorso senza brand la tocca ancora,
 * è ancora ancorato a uno e l'opzionale è finto.
 */

const renderPostImage = vi.fn();
const insertBrandMedia = vi.fn();
const storeBrandMediaBytes = vi.fn();
const signKnowledgePaths = vi.fn();
const withBrandContext = vi.fn();
const withOrgContext = vi.fn();
const planCarousel = vi.fn();
const submitAndTrackVideoRender = vi.fn();
const countOutstandingVideoRenders = vi.fn();
const imagePartFor = vi.fn();
const transformVideo = vi.fn();
const persistExternalVideo = vi.fn();
const remaining = vi.fn();

const PNG_DATA_URL = 'data:image/png;base64,AAAA';
const SIGNED = 'https://storage.test/signed?token=abc';

vi.mock('$lib/server/content-preview', () => ({
  renderPostImage: (...args: unknown[]) => renderPostImage(...args),
  buildImageRequest: (_prompt: string, opts: { model?: string }) => ({ model: opts.model ?? null }),
  loadBrandVisualContext: vi.fn()
}));
vi.mock('$lib/server/brand-media', () => ({
  loadLibraryMediaParts: async () => [],
  insertBrandMedia: (...args: unknown[]) => insertBrandMedia(...args),
  storeBrandMediaBytes: (...args: unknown[]) => storeBrandMediaBytes(...args),
  probeImageDimensions: async () => ({ width: 1080, height: 1080 }),
  resolveBrandImageIds: async () => [],
  saveRenderedVideoToLibrary: vi.fn()
}));
vi.mock('$lib/server/brand-context', () => ({
  imagePartFor: (...args: unknown[]) => imagePartFor(...args)
}));
vi.mock('$lib/server/media-archive', () => ({
  signKnowledgePaths: (...args: unknown[]) => signKnowledgePaths(...args)
}));
vi.mock('$lib/server/content-credentials', () => ({
  markImage: async (bytes: Buffer) => bytes,
  DIGITAL_SOURCE_TYPE: { synthetic: 'trainedAlgorithmicMedia' }
}));
vi.mock('$lib/server/ai-log', () => ({
  billedUsdInScope: () => 0.05,
  withBrandContext: <T>(brandId: string, fn: () => T) => {
    withBrandContext(brandId);
    return fn();
  },
  withOrgContext: <T>(orgId: string, fn: () => T) => {
    withOrgContext(orgId);
    return fn();
  }
}));
vi.mock('$lib/server/carousel-generate', () => ({
  planCarousel: (...args: unknown[]) => planCarousel(...args),
  clampSlideCount: (n?: number) => n ?? 5
}));
vi.mock('$lib/server/video-render-queue', () => ({
  submitAndTrackVideoRender: (...args: unknown[]) => submitAndTrackVideoRender(...args),
  countOutstandingVideoRenders: (...args: unknown[]) => countOutstandingVideoRenders(...args)
}));
vi.mock('$lib/server/video', () => ({
  transformVideo: (...args: unknown[]) => transformVideo(...args),
  persistExternalVideo: (...args: unknown[]) => persistExternalVideo(...args),
  resolveVideoModel: () => 'bytedance/seedance-2-5',
  clampVideoDuration: (d: number) => d
}));
vi.mock('$lib/server/usage', () => ({ remaining: (...args: unknown[]) => remaining(...args) }));
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => adminClient }));

import {
  generateCarouselWithoutBrand,
  generateVideoWithoutBrand,
  refineMediaWithoutBrand,
  listOrgMediaJobs
} from './media-generate';

/** Legge `brands`: qui è un fallimento, non un dato. Un percorso senza brand non deve arrivarci. */
function noBrands() {
  return {
    from: (table: string) => {
      if (table === 'brands' || table === 'brand_kit' || table === 'brand_media') {
        throw new Error(`ha letto ${table}`);
      }
      throw new Error(`ha letto ${table}`);
    }
  } as never;
}

/** L'admin del percorso video: legge la coda, e su ogni tabella di brand fallisce apposta. */
function adminForVideo() {
  return {
    from: (table: string) => {
      if (table !== 'video_renders') throw new Error(`ha letto ${table}`);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'job-1' }, error: null }) }) })
      };
    }
  } as never;
}

let adminClient: unknown = adminForVideo();

function jobsClient(rows: Array<Record<string, unknown>>) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    is: () => api,
    order: () => api,
    limit: () => api,
    then: (res: (v: unknown) => unknown) => Promise.resolve(res({ data: rows, error: null }))
  };
  return { from: () => api } as never;
}

const ORG = 'org-1';
const USER = 'user-1';
const OWN_IMAGE = `${USER}/media/generated-a1.png`;
const OWN_CLIP = `${USER}/generated/a1b2.mp4`;
const SOMEONE_ELSE = 'user-2/media/generated-a1.png';

beforeEach(() => {
  vi.clearAllMocks();
  adminClient = adminForVideo();
  renderPostImage.mockResolvedValue(PNG_DATA_URL);
  storeBrandMediaBytes.mockResolvedValue({});
  signKnowledgePaths.mockImplementation(
    async (_c: unknown, paths: string[]) => new Map(paths.map((p) => [p, SIGNED]))
  );
  imagePartFor.mockResolvedValue({ ok: true, part: { inlineData: { mimeType: 'image/png', data: 'AAAA' } } });
  planCarousel.mockResolvedValue({
    slidePrompts: ['slide uno', 'slide due', 'slide tre'],
    continuityTokens: ['ocra', 'luce radente']
  });
  submitAndTrackVideoRender.mockResolvedValue({
    taskId: 'kie-1',
    model: 'bytedance/seedance-2-5',
    durationSeconds: 8
  });
  countOutstandingVideoRenders.mockResolvedValue(0);
  remaining.mockResolvedValue({ videos: 10 });
});

describe('un carosello senza brand', () => {
  const job = { orgId: ORG, userId: USER, brief: 'tre motivi per cambiare sedia' };

  it('non legge la tabella dei brand', async () => {
    const out = await generateCarouselWithoutBrand(noBrands(), job);

    expect(out.ok).toBe(true);
  });

  it('addebita all organizzazione, che è chi paga quando nessun brand paga', async () => {
    await generateCarouselWithoutBrand(noBrands(), job);

    expect(withOrgContext).toHaveBeenCalledWith(ORG);
    expect(withBrandContext).not.toHaveBeenCalled();
  });

  it('consegna una slide per prompt, e nessuna entra in una libreria', async () => {
    const out = await generateCarouselWithoutBrand(noBrands(), job);

    expect(out.ok && out.media).toHaveLength(3);
    expect(out.ok && out.renders).toBe(3);
    expect(insertBrandMedia).not.toHaveBeenCalled();
    expect(out.ok && out.media.every((m) => m.id === null)).toBe(true);
  });

  it('tiene i gettoni di continuità: senza, una slide rifinita esce dalla serie', async () => {
    const out = await generateCarouselWithoutBrand(noBrands(), job);

    expect(out.ok && out.continuityTokens).toEqual(['ocra', 'luce radente']);
  });

  it('una serie incompleta è un carosello mancato, non uno più corto', async () => {
    renderPostImage.mockResolvedValueOnce(PNG_DATA_URL).mockResolvedValue(undefined);

    const out = await generateCarouselWithoutBrand(noBrands(), job);

    expect(out.ok).toBe(false);
  });
});

describe('un video senza brand', () => {
  const job = { orgId: ORG, userId: USER, prompt: 'un gatto che salta' };

  it('non legge la tabella dei brand', async () => {
    const out = await generateVideoWithoutBrand(job);

    expect(out.ok).toBe(true);
  });

  it('addebita all organizzazione, che è chi paga quando nessun brand paga', async () => {
    await generateVideoWithoutBrand(job);

    expect(withOrgContext).toHaveBeenCalledWith(ORG);
    expect(withBrandContext).not.toHaveBeenCalled();
  });

  /** La riga della coda porta il padrone addosso: è l'unica cosa che il cron avrà in mano. */
  it('scrive l organizzazione sulla riga della coda, e nessun brand', async () => {
    await generateVideoWithoutBrand(job);

    expect(submitAndTrackVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: null, orgId: ORG })
    );
  });

  /** L'allocazione mensile è del piano di un brand: qui non c'è un piano da interrogare. */
  it('non interroga l allocazione mensile di nessuno', async () => {
    await generateVideoWithoutBrand(job);

    expect(remaining).not.toHaveBeenCalled();
    expect(countOutstandingVideoRenders).not.toHaveBeenCalled();
  });

  it('anima il percorso che il generatore senza brand ha consegnato', async () => {
    await generateVideoWithoutBrand({ ...job, baseMediaId: OWN_IMAGE });

    expect(submitAndTrackVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({ render: expect.objectContaining({ imageUrl: SIGNED }) })
    );
  });

  /**
   * Il primo segmento del percorso è lo user, ed è la stessa cosa che guarda la policy dello
   * storage. Il percorso di un altro non risolve — esattamente come l'id di un altro inquilino non
   * risolve sotto il brand. Fermarsi qui è il punto: filmare da zero chi ha chiesto di animare la
   * SUA foto è il difetto travestito da rimedio.
   */
  it('il percorso di un altro utente non risolve, e il render non parte', async () => {
    const out = await generateVideoWithoutBrand({ ...job, baseMediaId: SOMEONE_ELSE });

    expect(out).toMatchObject({ ok: false, error: 'source_not_found' });
    expect(submitAndTrackVideoRender).not.toHaveBeenCalled();
  });

  it('un indirizzo scelto da chi chiama non è una sorgente', async () => {
    const out = await generateVideoWithoutBrand({ ...job, baseMediaId: 'https://evil.test/a.png' });

    expect(out).toMatchObject({ ok: false, error: 'source_not_found' });
    expect(submitAndTrackVideoRender).not.toHaveBeenCalled();
  });

  it('torna un job da seguire, perché un clip non è mai pronto subito', async () => {
    const out = await generateVideoWithoutBrand(job);

    expect(out.ok && out.status).toBe('rendering');
    expect(out.ok && out.jobId).toBeTruthy();
  });
});

describe('rifinire senza brand', () => {
  const job = { orgId: ORG, userId: USER, baseMediaId: OWN_IMAGE, instruction: 'più caldo' };

  it('parte dal percorso consegnato dal generatore, non da zero', async () => {
    const out = await refineMediaWithoutBrand(noBrands(), job);

    expect(out.ok).toBe(true);
    expect(imagePartFor).toHaveBeenCalledWith(SIGNED);
    const opts = renderPostImage.mock.calls[0][1];
    expect(opts.baseImage).toBeDefined();
  });

  it('addebita all organizzazione, che è chi paga quando nessun brand paga', async () => {
    await refineMediaWithoutBrand(noBrands(), job);

    expect(withOrgContext).toHaveBeenCalledWith(ORG);
    expect(withBrandContext).not.toHaveBeenCalled();
  });

  it('il percorso di un altro utente non risolve, e il render non parte', async () => {
    const out = await refineMediaWithoutBrand(noBrands(), { ...job, baseMediaId: SOMEONE_ELSE });

    expect(out).toMatchObject({ ok: false, error: 'source_not_found' });
    expect(renderPostImage).not.toHaveBeenCalled();
  });

  /**
   * Il difetto che #403 ha chiuso, e che questo ramo non deve rifare. Un file più pesante del
   * tetto tornava `source_not_found` — «non trovata» per una cosa che c'era — e l'agente
   * rigenerava da zero, cioè esattamente il danno che refine_media esiste per impedire. Qui le
   * sorgenti sono file appena caricati dall'utente: grandi per definizione.
   */
  it('un file troppo pesante si dice pesante, non introvabile', async () => {
    imagePartFor.mockResolvedValue({ ok: false, reason: 'too_large' });

    const out = await refineMediaWithoutBrand(noBrands(), job);

    expect(out).toMatchObject({ ok: false, error: 'source_too_large' });
    expect(out.ok === false && 'limit' in out && out.limit).toBeGreaterThan(0);
    expect(renderPostImage).not.toHaveBeenCalled();
  });

  /** Il peso non c'è dove nessuna riga lo scrive: `null` è il fatto, il tetto resta detto. */
  it('senza una riga di libreria il peso è sconosciuto, non inventato', async () => {
    imagePartFor.mockResolvedValue({ ok: false, reason: 'too_large' });

    const out = await refineMediaWithoutBrand(noBrands(), job);

    expect(out.ok === false && 'bytes' in out && out.bytes).toBeNull();
  });

  it('una sorgente che non è un immagine resta introvabile, non pesante', async () => {
    imagePartFor.mockResolvedValue({ ok: false, reason: 'not_an_image' });

    const out = await refineMediaWithoutBrand(noBrands(), job);

    expect(out).toMatchObject({ ok: false, error: 'source_not_found' });
  });

  it('un indirizzo scelto da chi chiama non è una sorgente', async () => {
    const out = await refineMediaWithoutBrand(noBrands(), {
      ...job,
      baseMediaId: 'https://evil.test/a.png'
    });

    expect(out).toMatchObject({ ok: false, error: 'source_not_found' });
    expect(renderPostImage).not.toHaveBeenCalled();
  });

  it('risalire di una cartella non è il proprio percorso', async () => {
    const out = await refineMediaWithoutBrand(noBrands(), {
      ...job,
      baseMediaId: `${USER}/../user-2/media/x.png`
    });

    expect(out).toMatchObject({ ok: false, error: 'source_not_found' });
  });

  /**
   * Il tipo lo dice il FILE, non chi chiama: senza una riga di libreria il percorso è tutto ciò che
   * c'è, e un mp4 mandato al motore delle immagini è il difetto che questo percorso toglie.
   */
  it('un clip lo rifinisce il motore dei video, letto dal percorso', async () => {
    transformVideo.mockResolvedValue({ url: 'https://cdn/refined.mp4', taskId: 't-1', model: 'runway/aleph' });

    const out = await refineMediaWithoutBrand(noBrands(), { ...job, baseMediaId: OWN_CLIP, model: 'runway/aleph' });

    expect(out.ok && out.kind).toBe('video');
    expect(renderPostImage).not.toHaveBeenCalled();
  });

  /** Senza preferenze di brand non c'è un modello scelto: rifilmare da capo sarebbe un altro clip. */
  it('un clip senza un modello di rifinitura si rifiuta invece di rifilmare', async () => {
    const out = await refineMediaWithoutBrand(noBrands(), { ...job, baseMediaId: OWN_CLIP });

    expect(out).toMatchObject({ ok: false, error: 'no_refine_model' });
    expect(transformVideo).not.toHaveBeenCalled();
  });
});

describe('i lavori di un organizzazione', () => {
  it('legge i clip senza brand, e consegna dove sono invece di un id di libreria', async () => {
    const jobs = await listOrgMediaJobs(
      jobsClient([
        { id: 'job-1', status: 'done', error: null, submitted_at: '2026-09-11T10:00:00Z', media_url: 'https://cdn/clip.mp4' }
      ]),
      ORG
    );

    expect(jobs).toEqual([
      {
        id: 'job-1',
        status: 'done',
        error: null,
        submitted_at: '2026-09-11T10:00:00Z',
        media_url: 'https://cdn/clip.mp4'
      }
    ]);
  });
});
