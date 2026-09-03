import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * UNA FEATURE A META`, e la seconda meta`.
 *
 * Una grafica standalone nasceva con il suo sorgente HTML/TSX e la sua cronologia di versioni, ma
 * `grep_source` / `read_source` / `replace_source` conoscevano solo `{ kind: 'post' }`. Il codice
 * c'era e nessuno sapeva aprirlo: la grafica si poteva rifare a parole (`design_graphic`) e non
 * correggere di una parola. Questi test tengono aperta la porta.
 */
const store = vi.hoisted(() => ({
  targets: [] as Array<Record<string, unknown>>,
  source: '<div class="t">Saldi -30%</div>',
  version: 3,
  applied: [] as Array<Record<string, unknown>>
}));

vi.mock('$lib/server/design-store', () => ({
  latestGraphic: async (_c: unknown, target: Record<string, unknown>) => {
    store.targets.push(target);
    if (target.kind !== 'media_item') return null;
    return {
      id: 'g1',
      version: store.version,
      spec: { v: 2, kind: 'html', aspect: '1:1' },
      source: store.source,
      sourceKind: 'html',
      aspect: '1:1',
      mediaUrl: 'https://cdn.test/a.png',
      brief: null,
      createdAt: 'now'
    };
  },
  versionSource: (g: { source: string }) => g.source,
  saveGraphicVersion: async () => 1
}));

vi.mock('$lib/agent/tools/post-editor-tools', () => ({
  applyStandaloneGraphicSource: async (t: Record<string, unknown>, args: Record<string, unknown>) => {
    store.applied.push({ mediaId: t.mediaId, ...args });
    return { success: true, media_url: 'https://cdn.test/b.png', version: store.version + 1, graphic_source: args.source };
  },
  applyPostGraphicSource: async () => ({ error: 'il post non c\'entra in questo test' })
}));

vi.mock('$lib/server/design-render', () => ({ sourceToSatoriTree: async () => ({ tree: {}, width: 1080, height: 1080 }) }));
vi.mock('$lib/design/graphic-check', () => ({ inspectGraphicTree: () => [] }));

const { grepPostGraphicSource, readPostGraphicSource, replacePostGraphicSource } = await import(
  './graphic-source-edit'
);

const TARGET = {
  supabase: {} as SupabaseClient,
  brandId: 'brand-1',
  userId: 'user-1',
  ctx: { brandColors: ['#000'], typography: { display: 'Inter', body: 'Inter' } } as never,
  mediaId: 'media-7'
};

beforeEach(() => {
  store.targets = [];
  store.applied = [];
  store.source = '<div class="t">Saldi -30%</div>';
});

describe('il codice di una grafica che non ha un post', () => {
  it('lo cerca sull\'asset di libreria, non su un post', async () => {
    const out = await grepPostGraphicSource(TARGET, { query: 'Saldi' });

    expect(store.targets[0]).toMatchObject({ kind: 'media_item', id: 'media-7' });
    // Il risultato nomina l'asset, non un post_id vuoto.
    expect(out).toMatchObject({ media_id: 'media-7' });
    expect(out).not.toHaveProperty('post_id');
  });

  it('lo legge a pagine, come per un post', async () => {
    const out = (await readPostGraphicSource(TARGET, {})) as Record<string, unknown>;
    expect(String(out.source ?? out.slice ?? '')).toContain('Saldi -30%');
  });

  /**
   * La guardia «leggi prima di scrivere» vale anche qui: senza, un replace partirebbe da un
   * sorgente che il modello non ha mai visto.
   */
  it('rifiuta la modifica finche\' non e\' stato letto', async () => {
    // Un asset MAI letto in questo processo: le receipt sono di modulo e le altre prove ne
    // lasciano una su `media-7`.
    const out = (await replacePostGraphicSource({ ...TARGET, mediaId: 'media-mai-letto' }, {
      old_str: 'Saldi -30%',
      new_str: 'Saldi -40%'
    })) as Record<string, unknown>;

    expect(String(out.error ?? '')).toMatch(/read_source/i);
    expect(store.applied).toEqual([]);
  });

  it('dopo la lettura scrive sull\'asset, non su un post', async () => {
    await readPostGraphicSource(TARGET, {});

    const out = (await replacePostGraphicSource(TARGET, {
      old_str: 'Saldi -30%',
      new_str: 'Saldi -40%'
    })) as Record<string, unknown>;

    expect(out.ok).toBe(true);
    expect(store.applied).toHaveLength(1);
    expect(store.applied[0]).toMatchObject({ mediaId: 'media-7', brief: 'replace_source' });
    expect(String(store.applied[0].source)).toContain('Saldi -40%');
  });
});

/**
 * IL CABLAGGIO, non solo le funzioni.
 *
 * Le prove qui sopra chiamano le funzioni con un bersaglio gia` costruito. Questa chiama la TOOL
 * come la chiama il modello: schema, risoluzione del bersaglio, esecuzione. E` il pezzo che il
 * browser non ha esercitato — l'agente ha preferito `query` e poi `bash`+`grep`, quindi la strada
 * nuova non era mai stata percorsa davvero.
 */
describe('la tool che il modello chiama davvero', () => {
  it('accetta media_id e arriva alla grafica dell\'asset', async () => {
    const { createGraphicSourceEditTools } = await import('./graphic-source-edit');
    const seen: Array<Record<string, unknown>> = [];

    const tools = createGraphicSourceEditTools(
      async ({ post_id, media_id }) => {
        seen.push({ post_id, media_id });
        if (!media_id) return { error: 'atteso media_id' };
        return { ...TARGET, mediaId: media_id };
      },
      { requirePostId: true }
    );

    const out = (await tools.grep_source.execute!(
      { query: 'Saldi', media_id: 'media-42' },
      {} as never
    )) as Record<string, unknown>;

    expect(seen[0]).toMatchObject({ media_id: 'media-42' });
    expect(store.targets.at(-1)).toMatchObject({ kind: 'media_item', id: 'media-42' });
    expect(out).toMatchObject({ media_id: 'media-42' });
  });

  /** Lo schema deve DICHIARARE media_id, o il modello non sa che esiste. */
  it('dichiara media_id nello schema, non solo lo accetta', async () => {
    const { createGraphicSourceEditTools } = await import('./graphic-source-edit');
    const tools = createGraphicSourceEditTools(async () => TARGET, { requirePostId: true });

    for (const name of ['grep_source', 'read_source', 'replace_source', 'write_source'] as const) {
      const shape = (tools[name].inputSchema as { shape?: Record<string, unknown> }).shape ?? {};
      expect(Object.keys(shape)).toContain('media_id');
    }
  });
});
