import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * «Fammi una grafica, ma niente post» non era esprimibile: `design_graphic` chiedeva un `post_id`
 * obbligatorio, quindi comporre una grafica voleva dire creare un post — che l'utente aveva
 * vietato. L'unico strumento che produce un'immagine senza toccare un post era `generate_image`,
 * che pero` fa una FOTO. L'agente non disobbediva: dava l'unica cosa che poteva, e non era quella
 * chiesta.
 */
const mocks = vi.hoisted(() => ({
  composed: {
    rendered: {
      png: Buffer.from('finta-png'),
      spec: { v: 2, kind: 'html', aspect: '1:1' },
      source: '<div>ciao</div>',
      sourceKind: 'html',
      aspect: '1:1',
      issues: []
    },
    issues: [],
    repaired: false,
    stillBlocking: false
  },
  inserted: [] as Array<Record<string, unknown>>,
  versions: [] as Array<Record<string, unknown>>,
  uploads: 0
}));

vi.mock('$lib/server/design-compose', () => ({
  composeAndRenderGraphic: async () => mocks.composed,
  withBrandKitLogos: (imgs: unknown[]) => imgs
}));
vi.mock('$lib/server/design-store', () => ({
  latestGraphic: async () => null,
  versionSource: () => null,
  saveGraphicVersion: async (_c: unknown, input: Record<string, unknown>) => {
    mocks.versions.push(input);
    return 1;
  }
}));
vi.mock('$lib/server/content-preview', () => ({
  uploadPostImage: async () => {
    mocks.uploads++;
    return 'https://cdn.test/grafica.png';
  },
  generateStandaloneImage: async () => ({ imageUrl: undefined })
}));
vi.mock('$lib/server/media-generator/persist', () => ({
  insertMediaGeneratorItem: async (_c: unknown, input: Record<string, unknown>) => {
    mocks.inserted.push(input);
    return { row: { id: 'media-1' } };
  },
  updateMediaGeneratorItemUrl: async () => ({ ok: true })
}));
vi.mock('$lib/server/brand-analysis', () => ({ isUrlSafe: () => true }));
vi.mock('$lib/server/design-visual-refs', () => ({
  resolvePeopleVisualRefs: async () => [],
  resolveTalentVisualRefs: async () => [],
  pushVisualRefs: () => {}
}));
vi.mock('$lib/server/brand-media', () => ({
  resolveBrandImageIds: async () => [],
  recordBrandMediaUse: async () => {}
}));
vi.mock('$lib/server/graphic-review', () => ({
  attachRenderForReview: () => ({ reviewed: true }),
  routeCarriesMedia: () => true
}));

const { designStandaloneGraphic } = await import('./post-editor-tools');

/** Una tabella toccata e` un post creato: il test guarda proprio quello. */
function supabaseSpy() {
  const touched: string[] = [];
  return {
    touched,
    client: {
      from: (table: string) => {
        touched.push(table);
        const q = {
          select: () => q,
          eq: () => q,
          insert: () => q,
          update: () => q,
          maybeSingle: async () => ({ data: null }),
          single: async () => ({ data: null })
        };
        return q;
      }
    } as unknown as SupabaseClient
  };
}

const CTX = {
  language: 'it',
  brandColors: ['#000'],
  logos: [],
  faviconUrl: null,
  typography: { display: 'Inter', body: 'Inter', instructions: '' }
};

describe('una grafica che non appartiene a nessun post', () => {
  it('non crea nessun post, e restituisce l\'immagine', async () => {
    mocks.inserted = [];
    mocks.versions = [];
    const s = supabaseSpy();

    const out = await designStandaloneGraphic(
      { supabase: s.client, brandId: 'brand-1', userId: 'user-1', ctx: CTX as never },
      { brief: 'una citazione su fondo blu' }
    );

    expect(out).toMatchObject({ ok: true, image_url: 'https://cdn.test/grafica.png', post_created: false });
    expect(s.touched).not.toContain('posts');
  });

  /**
   * LA CHAT RENDE UN MEDIA SOLO DA `media: [{url}]` (chat-media.ts, `rowsFromRecord`). Senza questa
   * riga la grafica veniva composta, salvata, e l'utente non la vedeva: «nessuna immagine in chat,
   * nulla». Un risultato che esiste e non si vede è un risultato che non è stato consegnato.
   */
  it('si mostra da sola in chat', async () => {
    mocks.inserted = [];
    const s = supabaseSpy();

    const out = (await designStandaloneGraphic(
      { supabase: s.client, brandId: 'brand-1', userId: 'user-1', ctx: CTX as never },
      { brief: 'una citazione su fondo blu' }
    )) as Record<string, unknown>;

    expect(out.media).toEqual([
      { url: 'https://cdn.test/grafica.png', caption: 'una citazione su fondo blu' }
    ]);
  });

  /** Resta SORGENTE, o «accorcia il titolo» tornerebbe a essere una ricomposizione da zero. */
  it('la salva come asset modificabile, con la sua versione', async () => {
    mocks.inserted = [];
    mocks.versions = [];
    const s = supabaseSpy();

    const out = await designStandaloneGraphic(
      { supabase: s.client, brandId: 'brand-1', userId: 'user-1', ctx: CTX as never },
      { brief: 'una citazione' }
    );

    expect(out).toMatchObject({ media_id: 'media-1', editable: true });
    expect(mocks.inserted[0]).toMatchObject({ kind: 'image', url: 'https://cdn.test/grafica.png' });
    expect(mocks.versions[0]).toMatchObject({
      target: { kind: 'media_item', id: 'media-1' },
      source: '<div>ciao</div>'
    });
  });

  /** Una revisione resta sulla STESSA tessera: la cronologia e` una catena, non una pila di take. */
  it('con media_id revisiona quella esistente invece di crearne una nuova', async () => {
    mocks.inserted = [];
    mocks.versions = [];
    const s = supabaseSpy();

    const out = await designStandaloneGraphic(
      { supabase: s.client, brandId: 'brand-1', userId: 'user-1', ctx: CTX as never },
      { brief: 'togli il sottotitolo', media_id: 'media-9' }
    );

    expect(mocks.inserted).toEqual([]);
    expect(out).toMatchObject({ media_id: 'media-9' });
    expect(mocks.versions[0]).toMatchObject({ target: { kind: 'media_item', id: 'media-9' } });
  });
});
