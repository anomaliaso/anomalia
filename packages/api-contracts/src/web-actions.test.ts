import { describe, expect, it } from 'vitest';
import { pathFor } from './index';
import {
  DELETE_ARTICLE,
  GENERATE_ARTICLE,
  OPTIMIZE_ARTICLE,
  PUBLISH_ARTICLE,
  UNPUBLISH_ARTICLE
} from './articles';

const A_UUID = '9f8b1a2c-3d4e-4f60-8a1b-2c3d4e5f6071';
const ACTIONS = [
  GENERATE_ARTICLE,
  OPTIMIZE_ARTICLE,
  PUBLISH_ARTICLE,
  UNPUBLISH_ARTICLE,
  DELETE_ARTICLE
];

describe('le cinque azioni sugli articoli', () => {
  it('hanno una rotta propria: nessuna dice cosa fare dentro il corpo', () => {
    for (const endpoint of ACTIONS) {
      expect(Object.keys(endpoint.input.shape), endpoint.tool).not.toContain('action');
    }

    expect(pathFor(GENERATE_ARTICLE, 'demo')).toBe('/api/v1/brands/demo/web/generate');
    expect(pathFor(OPTIMIZE_ARTICLE, 'demo', 'a1')).toBe(
      '/api/v1/brands/demo/web/article/a1/optimize'
    );
    expect(pathFor(PUBLISH_ARTICLE, 'demo', 'a1')).toBe(
      '/api/v1/brands/demo/web/article/a1/publish'
    );
    expect(pathFor(UNPUBLISH_ARTICLE, 'demo', 'a1')).toBe(
      '/api/v1/brands/demo/web/article/a1/unpublish'
    );
    expect(pathFor(DELETE_ARTICLE, 'demo', A_UUID)).toBe(
      `/api/v1/brands/demo/web/article/${A_UUID}`
    );
  });

  it('generare vuole un tema; le altre quattro non vogliono niente oltre l’articolo', () => {
    expect(GENERATE_ARTICLE.input.safeParse({ topic: 'Come si monta una tastiera' }).success).toBe(true);
    expect(GENERATE_ARTICLE.input.safeParse({}).success).toBe(false);

    for (const endpoint of [OPTIMIZE_ARTICLE, PUBLISH_ARTICLE, UNPUBLISH_ARTICLE]) {
      expect(endpoint.input.safeParse({}).success, endpoint.tool).toBe(true);
    }
  });

  it('cancellare un articolo prende l’UUID pieno, mai un prefisso', () => {
    expect(DELETE_ARTICLE.method).toBe('DELETE');
    expect(DELETE_ARTICLE.input.safeParse({ id: A_UUID }).success).toBe(true);
    expect(DELETE_ARTICLE.input.safeParse({ id: A_UUID.slice(0, 8) }).success).toBe(false);
  });

  it('mettere e togliere dal vivo, e cancellare, si dichiarano distruttive', () => {
    for (const endpoint of [PUBLISH_ARTICLE, UNPUBLISH_ARTICLE, DELETE_ARTICLE]) {
      expect(endpoint.destructive, endpoint.tool).toBe(true);
    }
    for (const endpoint of [GENERATE_ARTICLE, OPTIMIZE_ARTICLE]) {
      expect(endpoint.destructive, endpoint.tool).toBe(false);
    }
  });
});
