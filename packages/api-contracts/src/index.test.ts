import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BRAND_ENDPOINTS,
  BRAND_RESOURCES,
  RESOURCE_SEGMENT,
  pathFor,
  statusForFailure,
  type BrandEndpoint
} from './index';

const byTool = (tool: string): BrandEndpoint => {
  const found = BRAND_ENDPOINTS.find((e) => e.tool === tool);
  if (!found) throw new Error(`missing endpoint ${tool}`);
  return found;
};

const ON_A_POST = {
  tool: 'fixture_post_read',
  title: 'Fixture',
  description: 'Fixture',
  method: 'GET',
  pathUnderBrand: '/posts/:id/media',
  resource: 'post',
  input: z.object({}).strict(),
  output: z.object({ status: z.string() }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

const modelled = (e: BrandEndpoint): boolean =>
  e.pathUnderBrand.includes(RESOURCE_SEGMENT) === (e.resource !== undefined) &&
  !e.pathUnderBrand.replace(RESOURCE_SEGMENT, '').includes(':');

describe('il registry degli endpoint di brand', () => {
  it('descrive almeno una lettura e una scrittura, o non prova niente', () => {
    expect(BRAND_ENDPOINTS.some((e) => e.method === 'GET')).toBe(true);
    expect(BRAND_ENDPOINTS.some((e) => e.method === 'POST')).toBe(true);
  });

  it('non ripete un nome di tool', () => {
    const names = BRAND_ENDPOINTS.map((e) => e.tool);
    expect(names).toEqual([...new Set(names)]);
  });

  it('ogni path parte da / e resta sotto il brand', () => {
    for (const e of BRAND_ENDPOINTS) {
      expect(e.pathUnderBrand.startsWith('/'), e.tool).toBe(true);
    }
    expect(pathFor(byTool('create_post'), 'demo')).toBe('/api/v1/brands/demo/posts');
  });

  it('un endpoint di risorsa mette l id risolto al posto del segmento', () => {
    expect(pathFor(ON_A_POST, 'demo', '2b38abc5-7f31-4e0a-9a41-0f2d0c1b8e55')).toBe(
      '/api/v1/brands/demo/posts/2b38abc5-7f31-4e0a-9a41-0f2d0c1b8e55/media'
    );
  });

  it('senza id un endpoint di risorsa non costruisce un path a metà', () => {
    // @ts-expect-error un endpoint che dichiara una risorsa non è chiamabile senza il suo id
    expect(() => pathFor(ON_A_POST, 'demo')).toThrow(/post/);
  });

  it('un segmento dinamico esiste se e solo se la risorsa che lo risolve è dichiarata', () => {
    for (const e of BRAND_ENDPOINTS) {
      expect(modelled(e), e.tool).toBe(true);
    }
    expect(modelled({ ...ON_A_POST, resource: undefined })).toBe(false);
    expect(modelled({ ...ON_A_POST, pathUnderBrand: '/posts/:id/media/:index' })).toBe(false);
  });

  it('ogni risorsa nominata da un endpoint ha una riga nella tabella delle risorse', () => {
    for (const e of BRAND_ENDPOINTS) {
      if (e.resource === undefined) continue;
      expect(BRAND_RESOURCES[e.resource], e.tool).toBeDefined();
    }
    expect(BRAND_RESOURCES[ON_A_POST.resource]).toBe('Post');
  });

  it('una lettura non è mai distruttiva', () => {
    for (const e of BRAND_ENDPOINTS.filter((e) => e.method === 'GET')) {
      expect(e.destructive, e.tool).toBe(false);
    }
  });

  it('ogni fallimento dichiarato ha un nome unico e uno status client o server', () => {
    for (const e of BRAND_ENDPOINTS) {
      const names = e.failures.map((f) => f.error);
      expect(names, e.tool).toEqual([...new Set(names)]);
      for (const f of e.failures) {
        expect(f.status, `${e.tool}/${f.error}`).toBeGreaterThanOrEqual(400);
        expect(f.status, `${e.tool}/${f.error}`).toBeLessThan(600);
      }
    }
  });

  it('lo status di un fallimento non dichiarato è 500, non un 400 silenzioso', () => {
    const createPost = byTool('create_post');
    expect(statusForFailure(createPost, 'need_caption')).toBe(400);
    expect(statusForFailure(createPost, 'insert_failed')).toBe(500);
  });

  it('un guasto della pipeline media non è colpa di chi chiama: 5xx, non 400', () => {
    const createPost = byTool('create_post');
    expect(statusForFailure(createPost, 'media_not_found')).toBe(400);
    expect(statusForFailure(createPost, 'media_unavailable')).toBe(502);
  });

  it('create_post accetta la copy e rifiuta una richiesta senza piattaforme', () => {
    const { input } = byTool('create_post');
    expect(input.safeParse({ platforms: ['linkedin'], caption: 'ciao' }).success).toBe(true);
    expect(input.safeParse({ platforms: [], caption: 'ciao' }).success).toBe(false);
    expect(input.safeParse({ platforms: ['linkedin'], caption: '' }).success).toBe(false);
  });

  it('un campo che nessun endpoint dichiara viene rifiutato, non scartato in silenzio', () => {
    for (const e of BRAND_ENDPOINTS) {
      expect(e.input.safeParse({ campo_che_non_esiste: 'x' }).success, e.tool).toBe(false);
    }
    expect(
      byTool('create_post').input.safeParse({
        platforms: ['linkedin'],
        caption: 'ciao',
        campo_che_non_esiste: 'x'
      }).success
    ).toBe(false);
  });

  it('create_post accetta i media della libreria, che prima non avevano dove passare', () => {
    const { input } = byTool('create_post');
    expect(
      input.safeParse({ platforms: ['instagram'], caption: 'ciao', media_ids: ['asset-1'] }).success
    ).toBe(true);
  });

  it('list_media è una lettura e non dichiara fallimenti propri', () => {
    const listMedia = byTool('list_media');
    expect(listMedia.method).toBe('GET');
    expect(listMedia.destructive).toBe(false);
    expect(listMedia.input.safeParse({ query: 'logo', limit: 10 }).success).toBe(true);
    expect(listMedia.input.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('import_media_url dichiara ogni rifiuto della guardia, e nessuno di essi resta un 500', () => {
    const importMedia = byTool('import_media_url');
    expect(importMedia.method).toBe('POST');
    expect(importMedia.destructive).toBe(false);
    expect(importMedia.failures.map((f) => f.error).sort()).toEqual(
      ['blocked_host', 'empty', 'fetch_failed', 'not_https', 'store_failed', 'too_large', 'unsupported_type'].sort()
    );
    expect(statusForFailure(importMedia, 'blocked_host')).toBe(400);
    expect(statusForFailure(importMedia, 'unsupported_type')).toBe(415);
    expect(statusForFailure(importMedia, 'too_large')).toBe(413);
  });

  it('import_media_url chiede un URL, e niente che non abbia dichiarato', () => {
    const { input } = byTool('import_media_url');
    expect(input.safeParse({ url: 'https://cdn.example.com/a.png' }).success).toBe(true);
    expect(input.safeParse({ url: 'https://cdn.example.com/a.png', title: 'Scatto' }).success).toBe(true);
    expect(input.safeParse({}).success).toBe(false);
    expect(input.safeParse({ url: '' }).success).toBe(false);
    expect(input.safeParse({ url: 'https://cdn.example.com/a.png', quality: 'high' }).success).toBe(false);
  });

  it('create_post promette un post pending_user con la data proposta', () => {
    const { output } = byTool('create_post');
    const ok = output.safeParse({
      ok: true,
      id: 'post-1',
      status: 'pending_user',
      scheduled_for: '2030-05-16T07:00:00.000Z',
      scheduled_for_local: '2030-05-16 09:00 (Europe/Rome)',
      slot: 'Thu 09:00',
      review_url: 'https://anomalia.so/app/demo/posts/post-1'
    });
    expect(ok.success).toBe(true);
    expect(output.safeParse({ ok: true, id: 'post-1', status: 'approved' }).success).toBe(false);
  });

  it('check_content è una POST per forma e una lettura per effetto', () => {
    const check = byTool('check_content');
    expect(check.method).toBe('POST');
    expect(check.destructive).toBe(false);
    expect(pathFor(check, 'demo')).toBe('/api/v1/brands/demo/content/check');
  });

  it('check_content promette errori, avvisi, punteggi e le versioni delle regole', () => {
    const { output } = byTool('check_content');
    const ok = output.safeParse({
      ok: false,
      errors: [{ code: 'over_limit', field: 'caption', detail: 'LinkedIn: 3001 characters, limit 3000' }],
      warnings: [],
      scores: [
        {
          platform: 'linkedin',
          index: 42.5,
          checks: [{ id: 'hook_strength', value: 0.4, weight: 18, note: 'hook generico' }]
        }
      ],
      versions: { rules: 1, scorer: 3 }
    });
    expect(ok.success).toBe(true);
    expect(output.safeParse({ ok: true, errors: [], warnings: [], scores: [] }).success).toBe(false);
  });

  it('get_article è una lettura, quindi una API key di sola lettura la raggiunge', () => {
    const get = byTool('get_article');
    expect(get.method).toBe('GET');
    expect(get.destructive).toBe(false);
    expect(pathFor(get, 'demo')).toBe('/api/v1/brands/demo/web/article');
    expect(get.input.safeParse({ id: 'art-1' }).success).toBe(true);
    expect(get.input.safeParse({}).success).toBe(false);
  });

  it('update_article dichiara ogni campo che si può scrivere senza un modello', () => {
    const { input } = byTool('update_article');
    expect(
      input.safeParse({
        id: 'art-1',
        title: 'Guida',
        body_md: '# Guida',
        meta_title: null,
        meta_description: null,
        category_id: 'cat-1',
        author_id: null,
        tag_ids: ['tag-1'],
        language: 'it',
        scheduled_for: null
      }).success
    ).toBe(true);
    expect(input.safeParse({ id: 'art-1', title: '' }).success).toBe(false);
    expect(input.safeParse({ id: 'art-1', title: 'a'.repeat(201) }).success).toBe(false);
    expect(input.safeParse({ id: 'art-1', meta_title: 'a'.repeat(71) }).success).toBe(false);
    expect(input.safeParse({ id: 'art-1', cover_image: 'https://cdn/x.png' }).success).toBe(false);
  });

  it('un articolo pubblicato non si aggiorna: il rifiuto è un 409, non un 500 muto', () => {
    const update = byTool('update_article');
    expect(statusForFailure(update, 'article_published')).toBe(409);
    expect(statusForFailure(update, 'planned_needs_slot')).toBe(409);
    expect(statusForFailure(update, 'translation_locked')).toBe(409);
    expect(statusForFailure(update, 'category_not_found')).toBe(400);
    expect(statusForFailure(update, 'article_not_found')).toBe(404);
  });

  it('leggere e scrivere un articolo passano dallo stesso indirizzo', () => {
    expect(byTool('update_article').pathUnderBrand).toBe(byTool('get_article').pathUnderBrand);
    expect(byTool('update_article').method).toBe('POST');
  });

  it('ads_remix è tornato: la rotta esiste, il client la sapeva chiamare, poi solo lui l ha persa', () => {
    const remix = byTool('ads_remix');
    expect(remix.method).toBe('POST');
    expect(pathFor(remix, 'demo')).toBe('/api/v1/brands/demo/ads/remix');
    expect(remix.destructive).toBe(false);
    expect(statusForFailure(remix, 'ads_not_on_plan')).toBe(403);
    expect(statusForFailure(remix, 'credits_exhausted')).toBe(402);
    expect(statusForFailure(remix, 'no_competitor_ads')).toBe(400);
  });

  it('ads_remix promette brief classificati, non una lista di stringhe', () => {
    const { output } = byTool('ads_remix');
    expect(
      output.safeParse({
        ok: true,
        briefs: [
          {
            rank: 1,
            strategy: 'Riprendi hook-problema-soluzione',
            hook: 'Stufo di risultati che non arrivano?',
            headline: 'Il metodo che funziona',
            productName: 'Kit Completo',
            visualPrompt: 'Flat lay del kit'
          }
        ]
      }).success
    ).toBe(true);
    expect(output.safeParse({ ok: true, briefs: ['un brief'] }).success).toBe(false);
  });

  it('una response con outputSchema è un oggetto: MCP non sa trasportare un array', () => {
    for (const e of BRAND_ENDPOINTS) {
      if (!(e.output instanceof z.ZodObject)) continue;
      expect(e.output.safeParse([]).success, e.tool).toBe(false);
    }
  });
});
