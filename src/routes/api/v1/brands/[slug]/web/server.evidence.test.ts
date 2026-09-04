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

import { GET as auditsRoute } from './audits/+server';
import { GET as findingsRoute } from './audits/findings/+server';
import { GET as citationsRoute } from './audits/citations/+server';
import { GET as fixesRoute } from './fixes/+server';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

type Handler = (event: unknown) => Promise<Response>;

const getAudits = auditsRoute as unknown as Handler;
const getFindings = findingsRoute as unknown as Handler;
const getCitations = citationsRoute as unknown as Handler;
const getFixes = fixesRoute as unknown as Handler;

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
  id: 'audit-august',
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
  id: 'audit-september',
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

const OTHER_BRAND_AUDIT = { ...AUDIT_AUGUST, id: 'audit-altrui', brand_id: OTHER_BRAND };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/brands/:slug/web/audits', () => {
  it('elenca gli audit dal più recente, con quanto ha misurato ciascuno', async () => {
    const { res, body } = await call(getAudits, '/web/audits', {
      brand_geo_audits: [AUDIT_AUGUST, AUDIT_SEPTEMBER_CITATIONS_ONLY]
    });

    expect(res.status).toBe(200);
    expect(body.audits.map((a: Row) => a.id)).toEqual(['audit-september', 'audit-august']);
    expect(body.audits[1]).toEqual({
      id: 'audit-august',
      at: '2026-08-10T08:00:00Z',
      tech_score: 61,
      share_of_voice: 42,
      citability_score: 44,
      binding_constraint: 'Densità di evidenza',
      citation_count: 1,
      finding_count: 1
    });
  });

  it('un brand senza audit torna una lista vuota, non un errore', async () => {
    const { res, body } = await call(getAudits, '/web/audits', { brand_geo_audits: [] });

    expect(res.status).toBe(200);
    expect(body).toEqual({ audits: [] });
  });

  it('non arriva agli audit di un altro brand', async () => {
    const { body } = await call(getAudits, '/web/audits', {
      brand_geo_audits: [OTHER_BRAND_AUDIT, AUDIT_AUGUST]
    });

    expect(body.audits.map((a: Row) => a.id)).toEqual(['audit-august']);
  });

  it('rifiuta un limite oltre il tetto invece di riversare la storia intera nel contesto', async () => {
    const { res, body } = await call(getAudits, '/web/audits?limit=100');

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
  });

  it('salta gli audit già letti quando gliene si chiede altri', async () => {
    const { body } = await call(getAudits, '/web/audits?limit=1&offset=1', {
      brand_geo_audits: [AUDIT_AUGUST, AUDIT_SEPTEMBER_CITATIONS_ONLY]
    });

    expect(body.audits.map((a: Row) => a.id)).toEqual(['audit-august']);
  });
});

describe('GET /api/v1/brands/:slug/web/audits/findings', () => {
  it('senza audit_id apre il più recente, non uno più vecchio che ha più dati', async () => {
    const { res, body } = await call(getFindings, '/web/audits/findings', {
      brand_geo_audits: [AUDIT_AUGUST, AUDIT_SEPTEMBER_CITATIONS_ONLY]
    });

    expect(res.status).toBe(200);
    expect(body.audit.id).toBe('audit-september');
    expect(body.audit.technical).toBeNull();
  });

  it('restituisce le osservazioni com erano state registrate', async () => {
    const { body } = await call(getFindings, '/web/audits/findings?audit_id=audit-august', {
      brand_geo_audits: [AUDIT_AUGUST, AUDIT_SEPTEMBER_CITATIONS_ONLY]
    });

    expect(body.audit).toEqual({
      id: 'audit-august',
      at: '2026-08-10T08:00:00Z',
      tech_score: 61,
      share_of_voice: 42,
      technical: AUDIT_AUGUST.tech,
      search: AUDIT_AUGUST.search,
      backlinks: AUDIT_AUGUST.backlinks,
      ai_overview: AUDIT_AUGUST.ai_overview
    });
  });

  it('l audit di un altro brand non è raggiungibile nemmeno conoscendone l id', async () => {
    const { res, body } = await call(getFindings, '/web/audits/findings?audit_id=audit-altrui', {
      brand_geo_audits: [OTHER_BRAND_AUDIT]
    });

    expect(res.status).toBe(200);
    expect(body.audit).toBeNull();
  });

  it('un brand senza audit torna audit null invece di rompersi', async () => {
    const { res, body } = await call(getFindings, '/web/audits/findings', { brand_geo_audits: [] });

    expect(res.status).toBe(200);
    expect(body).toEqual({ audit: null });
  });
});

describe('GET /api/v1/brands/:slug/web/audits/citations', () => {
  it('ogni citazione porta istante, motore, domanda, verdetto e domini citati', async () => {
    const { body } = await call(getCitations, '/web/audits/citations?audit_id=audit-august', {
      brand_geo_audits: [AUDIT_AUGUST]
    });

    expect(body.audit_id).toBe('audit-august');
    expect(body.citations).toEqual([
      {
        observed_at: '2026-08-10T08:00:00Z',
        answer_engine: 'gemini',
        question: 'miglior crm per agenzie',
        brand_mentioned: true,
        rank: 2,
        competitors: ['altro-brand'],
        source_domains: ['esempio.it', 'rivista.example'],
        error: null
      }
    ]);
    expect(body.total).toBe(1);
  });

  it('senza audit_id legge le sonde del più recente', async () => {
    const { body } = await call(getCitations, '/web/audits/citations', {
      brand_geo_audits: [AUDIT_AUGUST, AUDIT_SEPTEMBER_CITATIONS_ONLY]
    });

    expect(body.audit_id).toBe('audit-september');
    expect(body.citations[0].answer_engine).toBe('exa');
  });

  it('pagina le citazioni senza perdere il totale', async () => {
    const many = {
      ...AUDIT_AUGUST,
      citations: Array.from({ length: 7 }, (_, i) => citation({ prompt: `domanda ${i}` }))
    };
    const { body } = await call(getCitations, '/web/audits/citations?limit=2&offset=4', {
      brand_geo_audits: [many]
    });

    expect(body).toMatchObject({ total: 7, offset: 4, limit: 2 });
    expect(body.citations.map((c: Row) => c.question)).toEqual(['domanda 4', 'domanda 5']);
  });

  it('le citazioni di un altro brand non sono raggiungibili nemmeno con l id', async () => {
    const { res, body } = await call(getCitations, '/web/audits/citations?audit_id=audit-altrui', {
      brand_geo_audits: [OTHER_BRAND_AUDIT]
    });

    expect(res.status).toBe(200);
    expect(body.audit_id).toBeNull();
    expect(body.citations).toEqual([]);
  });

  it('un brand senza audit torna una risposta coerente invece di rompersi', async () => {
    const { res, body } = await call(getCitations, '/web/audits/citations', { brand_geo_audits: [] });

    expect(res.status).toBe(200);
    expect(body).toEqual({
      audit_id: null,
      observed_at: null,
      total: 0,
      offset: 0,
      limit: 50,
      citations: []
    });
  });

  it('rifiuta un limite oltre il tetto delle citazioni', async () => {
    const { res } = await call(getCitations, '/web/audits/citations?limit=500');

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/brands/:slug/web/fixes', () => {
  const GEO_FIX = {
    id: 'fix-geo',
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
    id: 'fix-seo',
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
    const { res, body } = await call(getFixes, '/web/fixes', { brand_geo_artifacts: [GEO_FIX] });

    expect(res.status).toBe(200);
    expect(body.fixes).toEqual([
      {
        id: 'fix-geo',
        surface: 'geo',
        kind: 'llms_txt',
        title: 'llms.txt',
        format: 'txt',
        status: 'draft',
        target_path: '/llms.txt',
        answers_finding: 'no-llms-txt',
        created_at: '2026-08-11T08:00:00Z',
        body: '# Demo Brand\n\n- /prodotti'
      }
    ]);
  });

  it('dice a quale superficie appartiene un fix senza far leggere il prefisso a chi chiama', async () => {
    const { body } = await call(getFixes, '/web/fixes', { brand_geo_artifacts: [GEO_FIX, SEO_ASSET] });

    expect(body.fixes.map((f: Row) => [f.id, f.surface])).toEqual([
      ['fix-seo', 'seo'],
      ['fix-geo', 'geo']
    ]);
  });

  it('apre un fix solo, quando si sa già quale', async () => {
    const { body } = await call(getFixes, '/web/fixes?fix_id=fix-geo', {
      brand_geo_artifacts: [GEO_FIX, SEO_ASSET]
    });

    expect(body.fixes.map((f: Row) => f.id)).toEqual(['fix-geo']);
  });

  it('filtra per stato, così le bozze non arrivano mischiate a quelle già scartate', async () => {
    const { body } = await call(getFixes, '/web/fixes?status=accepted', {
      brand_geo_artifacts: [GEO_FIX, SEO_ASSET]
    });

    expect(body.fixes.map((f: Row) => f.id)).toEqual(['fix-seo']);
  });

  it('non arriva ai fix di un altro brand', async () => {
    const { body } = await call(getFixes, '/web/fixes', {
      brand_geo_artifacts: [{ ...GEO_FIX, id: 'fix-altrui', brand_id: OTHER_BRAND }, GEO_FIX]
    });

    expect(body.fixes.map((f: Row) => f.id)).toEqual(['fix-geo']);
  });

  it('rifiuta un limite oltre il tetto: i corpi sono lunghi', async () => {
    const { res } = await call(getFixes, '/web/fixes?limit=50');

    expect(res.status).toBe(400);
  });

  it('un brand senza fix torna una lista vuota', async () => {
    const { body } = await call(getFixes, '/web/fixes', { brand_geo_artifacts: [] });

    expect(body).toEqual({ fixes: [] });
  });
});

describe('le letture delle prove non spendono e non modificano', () => {
  const HANDLERS: Array<[string, Handler, string]> = [
    ['audits', getAudits, '/web/audits'],
    ['findings', getFindings, '/web/audits/findings'],
    ['citations', getCitations, '/web/audits/citations'],
    ['fixes', getFixes, '/web/fixes']
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
