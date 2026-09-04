import { describe, it, expect, vi, beforeEach } from 'vitest';

const structured = vi.fn();
const gateCredits = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/research', () => ({ structured: (...args: unknown[]) => structured(...args) }));
vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  CreditsExhaustedError: class extends Error {}
}));

import { GET as runsRoute } from './runs/+server';
import { GET as runRoute } from './run/+server';
import { GET as artifactsRoute } from './artifacts/+server';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

type Handler = (event: unknown) => Promise<Response>;

const getRuns = runsRoute as unknown as Handler;
const getRun = runRoute as unknown as Handler;
const getArtifacts = artifactsRoute as unknown as Handler;

type Row = Record<string, unknown>;
type Tables = { brand_geo_audits?: Row[]; brand_geo_artifacts?: Row[] };

const BRAND = 'brand-1';
const OTHER_BRAND = 'brand-2';

function citation(over: Row = {}): Row {
  return {
    engine: 'gemini',
    prompt: 'miglior crm per agenzie',
    brandMentioned: true,
    rank: 2,
    competitors: ['altro-brand'],
    sources: ['esempio.it', 'rivista.example'],
    error: null,
    ...over
  };
}

function fakeSupabase(tables: Tables) {
  return {
    from(table: keyof Tables) {
      const filters: Array<[string, unknown]> = [];
      let slice: [number, number] | null = null;
      let ascending = false;

      const rows = () => {
        const all = (tables[table] ?? []).filter((r) => filters.every(([key, value]) => r[key] === value));
        const sorted = [...all].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        if (ascending) sorted.reverse();
        return slice ? sorted.slice(slice[0], slice[1] + 1) : sorted;
      };

      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        order: (_column: string, options?: { ascending?: boolean }) => {
          ascending = options?.ascending ?? true;
          return query;
        },
        range: (from: number, to: number) => {
          slice = [from, to];
          return query;
        },
        limit: (count: number) => {
          slice = [0, count - 1];
          return query;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: rows(), error: null })
      };
      return query;
    }
  };
}

function call(handler: Handler, path: string, tables: Tables = {}, slug = 'demo') {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: fakeSupabase(tables),
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: BRAND, slug, timezone: 'Europe/Rome' },
    error: null
  } as never);

  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}${path}`);
  return handler({ request: new Request(url), params: { slug }, url }).then(async (res) => ({
    res,
    body: await res.json()
  }));
}

const AUDIT_AUGUST = {
  id: 'run-august',
  brand_id: BRAND,
  created_at: '2026-08-10T08:00:00Z',
  tech_score: 61,
  tech: {
    issues: [{ id: 'no-llms-txt', severity: 'high', title: 'Manca llms.txt', detail: '', fix: '' }],
    citability: { score: 44, bindingConstraint: { id: 'evidence', label: 'Densità di evidenza', why: '' } }
  },
  share_of_voice: 42,
  citations: [citation()],
  search: { organicKeywords: 380 },
  backlinks: { referringDomains: 87 },
  ai_overview: { checked: 10, cited: 1, rows: [] }
};

const AUDIT_SEPTEMBER_CITATIONS_ONLY = {
  id: 'run-september',
  brand_id: BRAND,
  created_at: '2026-09-01T08:00:00Z',
  tech_score: null,
  tech: null,
  share_of_voice: 30,
  citations: [citation({ engine: 'exa', brandMentioned: false, rank: null, competitors: [], sources: [] })],
  search: null,
  backlinks: null,
  ai_overview: null
};

const OTHER_BRAND_AUDIT = { ...AUDIT_AUGUST, id: 'run-altrui', brand_id: OTHER_BRAND };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/brands/:slug/evidence/runs', () => {
  it('elenca le run dalla più recente, con quanto ha misurato ciascuna', async () => {
    const { res, body } = await call(getRuns, '/evidence/runs', {
      brand_geo_audits: [AUDIT_AUGUST, AUDIT_SEPTEMBER_CITATIONS_ONLY]
    });

    expect(res.status).toBe(200);
    expect(body.runs.map((r: Row) => r.id)).toEqual(['run-september', 'run-august']);
    expect(body.runs[1]).toEqual({
      id: 'run-august',
      at: '2026-08-10T08:00:00Z',
      tech_score: 61,
      share_of_voice: 42,
      citability_score: 44,
      binding_constraint: 'Densità di evidenza',
      citation_count: 1,
      issue_count: 1
    });
  });

  it('un brand senza audit torna una lista vuota, non un errore', async () => {
    const { res, body } = await call(getRuns, '/evidence/runs', { brand_geo_audits: [] });

    expect(res.status).toBe(200);
    expect(body).toEqual({ runs: [] });
  });

  it('non arriva alle prove di un altro brand', async () => {
    const { body } = await call(getRuns, '/evidence/runs', {
      brand_geo_audits: [OTHER_BRAND_AUDIT, AUDIT_AUGUST]
    });

    expect(body.runs.map((r: Row) => r.id)).toEqual(['run-august']);
  });

  it('rifiuta un limite oltre il tetto invece di riversare la storia intera nel contesto', async () => {
    const { res, body } = await call(getRuns, '/evidence/runs?limit=100');

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
  });

  it('salta le run già lette quando gliene si chiede altre', async () => {
    const { body } = await call(getRuns, '/evidence/runs?limit=1&offset=1', {
      brand_geo_audits: [AUDIT_AUGUST, AUDIT_SEPTEMBER_CITATIONS_ONLY]
    });

    expect(body.runs.map((r: Row) => r.id)).toEqual(['run-august']);
  });
});

describe('GET /api/v1/brands/:slug/evidence/run', () => {
  it('senza run_id apre la run più recente, non una più vecchia che ha più dati', async () => {
    const { res, body } = await call(getRun, '/evidence/run', {
      brand_geo_audits: [AUDIT_AUGUST, AUDIT_SEPTEMBER_CITATIONS_ONLY]
    });

    expect(res.status).toBe(200);
    expect(body.run.id).toBe('run-september');
    expect(body.run.tech).toBeNull();
  });

  it('restituisce la run richiesta com è stata registrata', async () => {
    const { body } = await call(getRun, '/evidence/run?run_id=run-august', {
      brand_geo_audits: [AUDIT_AUGUST, AUDIT_SEPTEMBER_CITATIONS_ONLY]
    });

    expect(body.run).toEqual({
      id: 'run-august',
      at: '2026-08-10T08:00:00Z',
      tech_score: 61,
      share_of_voice: 42,
      tech: AUDIT_AUGUST.tech,
      search: AUDIT_AUGUST.search,
      backlinks: AUDIT_AUGUST.backlinks,
      ai_overview: AUDIT_AUGUST.ai_overview
    });
  });

  it('ogni citazione porta istante, motore, domanda, verdetto e domini citati', async () => {
    const { body } = await call(getRun, '/evidence/run?run_id=run-august', {
      brand_geo_audits: [AUDIT_AUGUST]
    });

    expect(body.citations.items).toEqual([
      {
        observed_at: '2026-08-10T08:00:00Z',
        engine: 'gemini',
        query: 'miglior crm per agenzie',
        brand_mentioned: true,
        rank: 2,
        competitors: ['altro-brand'],
        source_domains: ['esempio.it', 'rivista.example'],
        error: null
      }
    ]);
    expect(body.citations.total).toBe(1);
  });

  it('pagina le citazioni senza perdere il totale', async () => {
    const many = { ...AUDIT_AUGUST, citations: Array.from({ length: 7 }, (_, i) => citation({ prompt: `domanda ${i}` })) };
    const { body } = await call(getRun, '/evidence/run?limit=2&offset=4', { brand_geo_audits: [many] });

    expect(body.citations).toMatchObject({ total: 7, offset: 4, limit: 2 });
    expect(body.citations.items.map((c: Row) => c.query)).toEqual(['domanda 4', 'domanda 5']);
  });

  it('la run di un altro brand non è raggiungibile nemmeno conoscendone l id', async () => {
    const { res, body } = await call(getRun, '/evidence/run?run_id=run-altrui', {
      brand_geo_audits: [OTHER_BRAND_AUDIT]
    });

    expect(res.status).toBe(200);
    expect(body.run).toBeNull();
    expect(body.citations.items).toEqual([]);
  });

  it('un brand senza audit torna una risposta coerente invece di rompersi', async () => {
    const { res, body } = await call(getRun, '/evidence/run', { brand_geo_audits: [] });

    expect(res.status).toBe(200);
    expect(body).toEqual({ run: null, citations: { total: 0, offset: 0, limit: 50, items: [] } });
  });

  it('rifiuta un limite oltre il tetto delle citazioni', async () => {
    const { res } = await call(getRun, '/evidence/run?limit=500');

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/brands/:slug/evidence/artifacts', () => {
  const GEO_FIX = {
    id: 'art-geo',
    brand_id: BRAND,
    kind: 'llms_txt',
    title: 'llms.txt',
    format: 'txt',
    body: '# Demo Brand\n\n- /prodotti',
    status: 'draft',
    target_path: '/llms.txt',
    source_finding: 'no-llms-txt',
    created_at: '2026-08-11T08:00:00Z'
  };
  const SEO_ASSET = {
    id: 'art-seo',
    brand_id: BRAND,
    kind: 'blog_article',
    title: 'Guida ai CRM',
    format: 'markdown',
    body: '## Guida',
    status: 'accepted',
    target_path: '/blog/guida-crm',
    source_finding: 'seo:init-1',
    created_at: '2026-08-12T08:00:00Z'
  };

  it('restituisce il fix per intero, corpo compreso', async () => {
    const { res, body } = await call(getArtifacts, '/evidence/artifacts', {
      brand_geo_artifacts: [GEO_FIX]
    });

    expect(res.status).toBe(200);
    expect(body.artifacts).toEqual([
      {
        id: 'art-geo',
        surface: 'geo',
        kind: 'llms_txt',
        title: 'llms.txt',
        format: 'txt',
        status: 'draft',
        target_path: '/llms.txt',
        source_finding: 'no-llms-txt',
        created_at: '2026-08-11T08:00:00Z',
        body: '# Demo Brand\n\n- /prodotti'
      }
    ]);
  });

  it('dice a quale superficie appartiene un artefatto senza far leggere il prefisso a chi chiama', async () => {
    const { body } = await call(getArtifacts, '/evidence/artifacts', {
      brand_geo_artifacts: [GEO_FIX, SEO_ASSET]
    });

    expect(body.artifacts.map((a: Row) => [a.id, a.surface])).toEqual([
      ['art-seo', 'seo'],
      ['art-geo', 'geo']
    ]);
  });

  it('apre un artefatto solo, quando si sa già quale', async () => {
    const { body } = await call(getArtifacts, '/evidence/artifacts?artifact_id=art-geo', {
      brand_geo_artifacts: [GEO_FIX, SEO_ASSET]
    });

    expect(body.artifacts.map((a: Row) => a.id)).toEqual(['art-geo']);
  });

  it('filtra per stato, così le bozze non arrivano mischiate a quelle già scartate', async () => {
    const { body } = await call(getArtifacts, '/evidence/artifacts?status=accepted', {
      brand_geo_artifacts: [GEO_FIX, SEO_ASSET]
    });

    expect(body.artifacts.map((a: Row) => a.id)).toEqual(['art-seo']);
  });

  it('rifiuta un limite oltre il tetto: i corpi sono lunghi', async () => {
    const { res } = await call(getArtifacts, '/evidence/artifacts?limit=50');

    expect(res.status).toBe(400);
  });

  it('un brand senza artefatti torna una lista vuota', async () => {
    const { body } = await call(getArtifacts, '/evidence/artifacts', { brand_geo_artifacts: [] });

    expect(body).toEqual({ artifacts: [] });
  });
});

describe('le letture delle prove non spendono e non modificano', () => {
  const HANDLERS: Array<[string, Handler, string]> = [
    ['runs', getRuns, '/evidence/runs'],
    ['run', getRun, '/evidence/run'],
    ['artifacts', getArtifacts, '/evidence/artifacts']
  ];

  it.each(HANDLERS)('%s non chiama il modello e non tocca i crediti', async (_name, handler, path) => {
    await call(handler, path, { brand_geo_audits: [AUDIT_AUGUST] });

    expect(structured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it.each(HANDLERS)('%s rifiuta una richiesta senza autenticazione', async (_name, handler, path) => {
    vi.mocked(authenticate).mockResolvedValue({
      error: new Response('Unauthorized', { status: 401 })
    } as never);
    const url = new URL(`https://anomalia.test/api/v1/brands/demo${path}`);

    const res = await handler({ request: new Request(url), params: { slug: 'demo' }, url });

    expect(res.status).toBe(401);
  });

  it.each(HANDLERS)('%s rifiuta un brand a cui il chiamante non accede', async (_name, handler, path) => {
    vi.mocked(authenticate).mockResolvedValue({
      supabase: fakeSupabase({}),
      user: { id: 'user-1' },
      apiKey: undefined,
      error: null
    } as never);
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);
    const url = new URL(`https://anomalia.test/api/v1/brands/altrui${path}`);

    const res = await handler({ request: new Request(url), params: { slug: 'altrui' }, url });

    expect(res.status).toBe(404);
  });
});
