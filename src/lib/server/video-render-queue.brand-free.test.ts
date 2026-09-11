/**
 * Un clip chiesto senza nominare un brand: dove atterra, e su quale conto.
 *
 * L'immagine risponde subito e consegna un percorso, quindi non deve ricordarsi di niente. Il clip
 * no: kie ci mette minuti, la richiesta è finita da un pezzo, e a chiuderlo è un cron che ha in
 * mano la sola riga. Finché ogni risposta di quella riga era un brand, un clip senza brand non
 * aveva un posto dove atterrare.
 *
 * Il test che conta di più è il terzo: uno scope sbagliato scrive una riga in `ai_calls` che nessuna
 * organizzazione somma, e una generazione che non viene contata è denaro che esce senza che nessuno
 * lo veda. È la forma esatta del difetto DataForSEO — il fornitore non addebitava, quindi nessuna
 * fattura segnalava niente.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const finishVideoRender = vi.fn();
const withBrandContext = vi.fn();
const withOrgContext = vi.fn();
const saveRenderedVideoToLibrary = vi.fn();
const addUsage = vi.fn();

vi.mock('$lib/server/video', () => ({
  finishVideoRender: (...args: unknown[]) => finishVideoRender(...args),
  videoTaskProvider: () => 'kie'
}));
vi.mock('$lib/server/ai-log', () => ({
  withBrandContext: <T>(brandId: string, fn: () => T) => {
    withBrandContext(brandId);
    return fn();
  },
  withOrgContext: <T>(orgId: string, fn: () => T) => {
    withOrgContext(orgId);
    return fn();
  }
}));
vi.mock('$lib/server/brand-media', () => ({
  saveRenderedVideoToLibrary: (...args: unknown[]) => saveRenderedVideoToLibrary(...args)
}));
vi.mock('$lib/server/usage', () => ({
  addUsage: (...args: unknown[]) => addUsage(...args),
  monthKey: () => '2026-09'
}));

function makeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));

  function build(name: string, mode: 'select' | 'update', patch?: Row) {
    const table = (tables[name] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let limit = Infinity;

    const run = () => {
      const hits = table.filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (mode === 'update') hits.forEach((r) => Object.assign(r, patch));
      return hits;
    };

    const api: Row = {
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), api),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
      lt: (c: string, v: string) => (filters.push((r) => r[c] != null && r[c] < v), api),
      order: () => api,
      limit: (n: number) => ((limit = n), api),
      select: () => api,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res?: (v: { data: Row[]; error: null }) => unknown, rej?: (e: unknown) => unknown) => {
        try {
          const value = { data: run(), error: null };
          return Promise.resolve(res ? res(value) : value);
        } catch (e) {
          return rej ? Promise.resolve(rej(e)) : Promise.reject(e);
        }
      }
    };
    return api;
  }

  return {
    tables,
    client: {
      from: (name: string) => ({
        select: () => build(name, 'select'),
        update: (patch: Row) => build(name, 'update', patch),
        insert: (row: Row) => {
          const created = { id: `row-${(tables[name] ??= []).length + 1}`, ...row };
          tables[name].push(created);
          return { select: () => ({ maybeSingle: async () => ({ data: created, error: null }) }) };
        }
      })
    }
  };
}

function orgRow(over: Row = {}): Row {
  return {
    id: 'render-1',
    brand_id: null,
    org_id: 'org-1',
    user_id: 'user-1',
    post_id: null,
    thread_id: null,
    task_id: 'kie-task-1',
    model: 'bytedance/seedance-2-5',
    status: 'rendering',
    duration_seconds: 8,
    resolution: '720p',
    cover_url: null,
    prompt: 'un gatto che salta',
    persist_opts: { captions: false, tighten: false },
    submitted_at: new Date(Date.now() - 30_000).toISOString(),
    attempts: 0,
    ...over
  };
}

async function reconcile(client: unknown) {
  const { reconcileVideoRenders } = await import('./video-render-queue');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return reconcileVideoRenders(client as any);
}

const LANDED = {
  status: 'done',
  url: 'https://cdn/clip.mp4',
  durationSeconds: 8,
  resolution: '720p'
};

beforeEach(() => {
  vi.clearAllMocks();
  finishVideoRender.mockResolvedValue(LANDED);
  saveRenderedVideoToLibrary.mockResolvedValue({ mediaId: 'media-1' });
  addUsage.mockResolvedValue(undefined);
});

describe('un clip senza brand', () => {
  it('atterra sulla riga stessa: è lì che il clip si ritrova', async () => {
    const { tables, client } = makeDb({ video_renders: [orgRow()] });

    expect(await reconcile(client)).toMatchObject({ done: 1, failed: 0, expired: 0 });
    expect(tables.video_renders[0]).toMatchObject({
      status: 'done',
      media_url: 'https://cdn/clip.mp4'
    });
  });

  /**
   * `brand_media` dice `brand_id in (select auth_brand_ids())`, e `NULL in (…)` vale NULL: una riga
   * senza brand sarebbe invisibile a tutti, non visibile a tutti. Lo stesso motivo per cui il
   * disegno senza brand consegna un percorso invece di un id.
   */
  it('non deposita niente in una libreria che non esiste', async () => {
    const { client } = makeDb({ video_renders: [orgRow()] });

    await reconcile(client);

    expect(saveRenderedVideoToLibrary).not.toHaveBeenCalled();
  });

  /**
   * IL TEST CHE CONTA. Lo scope decide dove finisce la riga di `ai_calls` che `finishVideoRender`
   * scrive: col brand sbagliato o senza scope, `sum_org_ai_cost_usd` non la vede e il cancello dei
   * crediti passa per sempre su una spesa vera.
   */
  it('addebita all organizzazione, che è chi paga quando nessun brand paga', async () => {
    const { client } = makeDb({ video_renders: [orgRow()] });

    await reconcile(client);

    expect(withOrgContext).toHaveBeenCalledWith('org-1');
    expect(withBrandContext).not.toHaveBeenCalled();
  });

  /** L'allocazione mensile dei video è del PIANO di un brand. Qui non c'è un piano da consumare. */
  it('non consuma l allocazione mensile di nessuno', async () => {
    const { client } = makeDb({ video_renders: [orgRow()] });

    await reconcile(client);

    expect(addUsage).not.toHaveBeenCalled();
  });

  it('un fallimento resta un fallimento, con il motivo scritto sulla riga', async () => {
    finishVideoRender.mockResolvedValue({ status: 'failed', error: 'kie ha rifiutato' });
    const { tables, client } = makeDb({ video_renders: [orgRow()] });

    expect(await reconcile(client)).toMatchObject({ failed: 1 });
    expect(tables.video_renders[0]).toMatchObject({ status: 'failed', error: 'kie ha rifiutato' });
  });
});

describe('con un brand, niente è cambiato', () => {
  const branded = orgRow({ brand_id: 'brand-1', org_id: null });

  it('deposita in libreria e addebita il mese del brand', async () => {
    const { client } = makeDb({ video_renders: [branded], brands: [{ id: 'brand-1', timezone: 'Europe/Rome' }] });

    await reconcile(client);

    expect(saveRenderedVideoToLibrary).toHaveBeenCalled();
    expect(addUsage).toHaveBeenCalled();
  });

  it('resta nello scope del brand: è così che la spesa gli arriva', async () => {
    const { client } = makeDb({ video_renders: [branded], brands: [{ id: 'brand-1', timezone: 'Europe/Rome' }] });

    await reconcile(client);

    expect(withBrandContext).toHaveBeenCalledWith('brand-1');
    expect(withOrgContext).not.toHaveBeenCalled();
  });
});

describe('enqueueVideoRender', () => {
  const submitted = {
    taskId: 'kie-task-9',
    model: 'bytedance/seedance-2-5',
    prompt: 'un gatto',
    durationSeconds: 8,
    resolution: '720p',
    persistOpts: { captions: false, tighten: false },
    submittedAt: Date.now()
  };

  it('scrive l organizzazione e lascia il brand vuoto', async () => {
    const { tables, client } = makeDb({ video_renders: [] });
    const { enqueueVideoRender } = await import('./video-render-queue');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueVideoRender(client as any, { brandId: null, orgId: 'org-1', userId: 'user-1', submitted });

    expect(tables.video_renders[0]).toMatchObject({ brand_id: null, org_id: 'org-1' });
  });

  it('col brand continua a scrivere il brand, e nessuna organizzazione', async () => {
    const { tables, client } = makeDb({ video_renders: [] });
    const { enqueueVideoRender } = await import('./video-render-queue');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueVideoRender(client as any, { brandId: 'brand-1', userId: 'user-1', submitted });

    expect(tables.video_renders[0]).toMatchObject({ brand_id: 'brand-1', org_id: null });
  });
});
