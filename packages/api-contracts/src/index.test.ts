import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BRAND_ENDPOINTS, pathFor, statusForFailure, type BrandEndpoint } from './index';

const byTool = (tool: string): BrandEndpoint => {
  const found = BRAND_ENDPOINTS.find((e) => e.tool === tool);
  if (!found) throw new Error(`missing endpoint ${tool}`);
  return found;
};

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

  // Il limite dichiarato della versione 1: un endpoint con :id ha anche bisogno della
  // risoluzione del prefisso (resolvePostId), che il registry non sa fare. Finché non la sa,
  // quegli endpoint restano scritti a mano invece di entrare qui a metà.
  it('non accetta ancora un endpoint con un segmento :id', () => {
    for (const e of BRAND_ENDPOINTS) {
      expect(e.pathUnderBrand.includes(':'), e.tool).toBe(false);
    }
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

  it('una response con outputSchema è un oggetto: MCP non sa trasportare un array', () => {
    for (const e of BRAND_ENDPOINTS) {
      if (!(e.output instanceof z.ZodObject)) continue;
      expect(e.output.safeParse([]).success, e.tool).toBe(false);
    }
  });
});
