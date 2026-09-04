import { describe, expect, it } from 'vitest';
import { pathFor } from './index';
import { EDIT_POST } from './posts';
import { GET_DASHBOARD } from './reads';

describe('la dashboard del brand', () => {
  it('sta sul brand stesso: nessun segmento sotto, e nessun secondo registro per arrivarci', () => {
    expect(pathFor(GET_DASHBOARD, 'demo')).toBe('/api/v1/brands/demo');
    expect(GET_DASHBOARD.method).toBe('GET');
    expect(GET_DASHBOARD.input.safeParse({}).success).toBe(true);
    expect(GET_DASHBOARD.input.safeParse({ slug: 'demo' }).success).toBe(false);
  });
});

describe('la modifica di un post', () => {
  it('è una PUT sola sul post, e cambia solo i campi che le mandi', () => {
    expect(EDIT_POST.method).toBe('PUT');
    expect(pathFor(EDIT_POST, 'demo', 'p1')).toBe('/api/v1/brands/demo/posts/p1');
    expect(EDIT_POST.input.safeParse({ caption: 'ciao' }).success).toBe(true);
    expect(EDIT_POST.input.safeParse({}).success).toBe(true);
  });

  it('svuota immagine e caption per piattaforma con null, e rifiuta ciò che la rotta ignora', () => {
    expect(EDIT_POST.input.safeParse({ media_url: null }).success).toBe(true);
    expect(EDIT_POST.input.safeParse({ platform_captions: null }).success).toBe(true);
    expect(EDIT_POST.input.safeParse({ status: 'published' }).success).toBe(false);
  });

  it('risponde con il patch applicato, non con l’eco di quello che hai chiesto', () => {
    expect(EDIT_POST.output.safeParse({ ok: true, patch: { caption: 'ciao' } }).success).toBe(true);
    expect(EDIT_POST.output.safeParse({ ok: true }).success).toBe(false);
  });
});
