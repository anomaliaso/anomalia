import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * STESSA RAGIONE DEL MOCK IN `agent-files.test.ts`: `logAiCall` scrive davvero in `ai_calls`
 * tramite l'admin client. Senza questo mock ogni `ls`/`grep`/`read_file` di questi test aprirebbe
 * una connessione verso Supabase vera.
 */
vi.mock('$lib/server/ai-log', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, logAiCall: () => {} };
});

import { createFileTools } from './agent-files';

/**
 * SUPABASE FINTO, MA CHE FILTRA E ORDINA DAVVERO.
 *
 * Non basta restituire righe fisse: il test sull'ordine di `ls('artifacts/')` deve esercitare il
 * `sort` vero del codice, non un ordine deciso a mano nel fixture. Quindi questo fake applica
 * `eq`/`in`/`is`/`order`/`limit` sull'array in memoria, come farebbe Postgres — solo senza rete.
 * `select('*')` non proietta colonne: i test passano righe già complete, come una riga vera.
 */
type Row = Record<string, unknown>;

function fakeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  function builder(table: string) {
    let rows = [...(tables[table] ?? [])];
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        rows = rows.filter((r) => r[k] === v);
        return b;
      },
      in: (k: string, arr: unknown[]) => {
        rows = rows.filter((r) => arr.includes(r[k]));
        return b;
      },
      is: (k: string, v: null) => {
        rows = rows.filter((r) => (r[k] ?? null) === v);
        return b;
      },
      order: (k: string, opts?: { ascending?: boolean }) => {
        const asc = opts?.ascending !== false;
        rows = [...rows].sort((a, c) => {
          const av = String(a[k] ?? '');
          const cv = String(c[k] ?? '');
          return asc ? av.localeCompare(cv) : cv.localeCompare(av);
        });
        return b;
      },
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return b;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      // Thenable: il codice di produzione fa spesso `await supabase.from(x).select()...` senza
      // chiamare `maybeSingle()` — la promise nativa arriva chiamando `.then` sul builder.
      then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null })
    };
    return b;
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient;
}

const BRAND = 'b1';

const MOTION_A = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  brand_id: BRAND,
  title: 'Hero launch reel',
  source: '<Composition id="Hero">const x = 1;</Composition>',
  preview_url: 'https://media.example.com/hero.mp4',
  fps: 30,
  duration_in_frames: 180,
  width: 1080,
  height: 1080,
  created_at: '2026-08-20T10:00:00Z',
  updated_at: '2026-08-20T10:05:00Z'
};
const MOTION_B_UNRENDERED = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  brand_id: BRAND,
  title: 'Draft teaser',
  source: '<Composition id="Draft">short</Composition>',
  preview_url: null,
  fps: 30,
  duration_in_frames: 90,
  width: 1080,
  height: 1350,
  created_at: '2026-08-19T09:00:00Z',
  updated_at: '2026-08-19T09:00:00Z'
};
const BIG_SOURCE = 'x'.repeat(70_000);
const MOTION_C_BIG = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  brand_id: BRAND,
  title: 'Big video',
  source: BIG_SOURCE,
  preview_url: 'https://media.example.com/big.mp4',
  fps: 30,
  duration_in_frames: 300,
  width: 1080,
  height: 1920,
  created_at: '2026-08-21T09:00:00Z',
  updated_at: '2026-08-21T09:00:00Z'
};

const MEDIA_D = {
  id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  brand_id: BRAND,
  kind: 'image',
  title: 'Product hero',
  file_name: 'hero.jpg',
  storage_path: 'u1/b1/media/hero.jpg',
  url: 'u1/b1/media/hero.jpg',
  description: 'A product photo on a white background',
  tags: ['product', 'hero'],
  subjects: ['bottle'],
  colors: null,
  mood: null,
  media_kind: 'product',
  suggested_use: 'Use as hero shot on feed posts',
  when_to_use: null,
  how_to_use: null,
  where_to_use: null,
  catalog_status: 'ready',
  catalog_error: null,
  width: 1200,
  height: 1200,
  bytes: 234_000,
  mime: 'image/jpeg',
  duration_seconds: null,
  source: 'upload',
  times_used: 2,
  last_used_at: '2026-08-19T00:00:00Z',
  created_at: '2026-08-18T09:00:00Z'
};

const GRAPHIC_E_V1 = {
  id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  brand_id: BRAND,
  target_kind: 'post',
  target_id: 'post-1',
  slide_index: null,
  version: 1,
  spec: { aspect: '1:1', theme: 'light' },
  media_url: 'https://media.example.com/g1.png',
  brief: 'Quote card, brand colors',
  source: '<div>Quote v1</div>',
  created_at: '2026-08-17T09:00:00Z'
};
const GRAPHIC_F_V2 = {
  ...GRAPHIC_E_V1,
  id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  version: 2,
  brief: 'Quote card v2',
  media_url: 'https://media.example.com/g2.png',
  source: '<div>Quote v2</div>',
  created_at: '2026-08-22T09:00:00Z'
};

// `as any`: stessa convenzione di `T()` in agent-files.test.ts — i tool tornano `execute?:`
// facoltativo per costruzione (`tool()` dell'AI SDK), e qui è sempre presente davvero.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tools(): any {
  const supabase = fakeSupabase({
    motion_videos: [MOTION_A, MOTION_B_UNRENDERED, MOTION_C_BIG],
    brand_media: [MEDIA_D],
    graphic_designs: [GRAPHIC_E_V1, GRAPHIC_F_V2]
  });
  return createFileTools('content', 'th', { supabase, brandId: BRAND, threadId: 'th', userId: 'u1' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stub = {} as any;

describe('artifacts/ — ls elenca per data desc, una riga per artifact', () => {
  it('ordine giusto e formato di riga', async () => {
    const { ls } = tools();
    const out = (await ls.execute({ path: 'artifacts/' }, stub)) as { files: string[] };
    // Desc per created_at: F(08-22) > C(08-21) > A(08-20) > B(08-19) > D(08-18) > E(08-17)
    expect(out.files.map((l) => l.split(' — ')[0])).toEqual([
      `artifacts/graphic/${GRAPHIC_F_V2.id}.md`,
      `artifacts/motion/${MOTION_C_BIG.id}.md`,
      `artifacts/motion/${MOTION_A.id}.md`,
      `artifacts/motion/${MOTION_B_UNRENDERED.id}.md`,
      `artifacts/media/${MEDIA_D.id}.md`,
      `artifacts/graphic/${GRAPHIC_E_V1.id}.md`
    ]);
    // `artifacts/<tipo>/<uuid>.md — <tipo> · <titolo/prompt troncato> · <stato> · <data>`
    const motionA = out.files.find((l) => l.startsWith(`artifacts/motion/${MOTION_A.id}.md`));
    expect(motionA).toBe(`artifacts/motion/${MOTION_A.id}.md — motion · Hero launch reel · shipped · 2026-08-20`);
  });

  it('un prefisso di tipo filtra a un solo sottoalbero', async () => {
    const { ls } = tools();
    const out = (await ls.execute({ path: 'artifacts/media/' }, stub)) as { files: string[] };
    expect(out.files).toHaveLength(1);
    expect(out.files[0]).toContain('artifacts/media/');
  });
});

describe('artifacts/motion/<id>.md — read_file', () => {
  it('un motion reso porta url pubblico e sorgente', async () => {
    const { read_file } = tools();
    const out = (await read_file.execute({ path: `artifacts/motion/${MOTION_A.id}.md` }, stub)) as {
      content: string;
    };
    expect(out.content).toContain(MOTION_A.preview_url);
    expect(out.content).toContain('<Composition id="Hero">const x = 1;</Composition>');
  });

  it('un motion mai reso mostra lo stato onesto e NESSUN url inventato', async () => {
    const { read_file } = tools();
    const out = (await read_file.execute({ path: `artifacts/motion/${MOTION_B_UNRENDERED.id}.md` }, stub)) as {
      content: string;
    };
    expect(out.content).toContain('no render yet');
    expect(out.content).toContain('Public URL: none');
    expect(out.content).not.toMatch(/https?:\/\//);
  });

  it('un sorgente oltre il budget viene tagliato e il taglio si dichiara', async () => {
    const { read_file } = tools();
    const out = (await read_file.execute({ path: `artifacts/motion/${MOTION_C_BIG.id}.md` }, stub)) as {
      content: string;
    };
    expect(out.content.length).toBeLessThan(BIG_SOURCE.length);
    expect(out.content).toContain('…[troncato:');
    expect(out.content).toContain('caratteri in più');
  });

  it('un id inesistente da` l\'errore-che-insegna, non un crash', async () => {
    const { read_file } = tools();
    const out = (await read_file.execute(
      { path: 'artifacts/motion/99999999-9999-9999-9999-999999999999.md' },
      stub
    )) as { error?: string };
    expect(out.error).toContain('Artifact not found');
    expect(out.error).toContain('ls("artifacts/motion/")');
  });
});

describe('artifacts/media/<id>.md — read_file', () => {
  it('meta, url onesto (nessuno inventato) e nessun prompt inventato', async () => {
    const { read_file } = tools();
    const out = (await read_file.execute({ path: `artifacts/media/${MEDIA_D.id}.md` }, stub)) as {
      content: string;
    };
    expect(out.content).toContain('Product hero');
    expect(out.content).toContain('product, hero');
    expect(out.content).toContain('private bucket');
    expect(out.content).not.toMatch(/https?:\/\//);
    expect(out.content).toContain('Generation prompt: not recorded');
  });
});

describe('artifacts/graphic/<id>.md — read_file', () => {
  it('la versione superata lo dice, e la corrente pure', async () => {
    const { read_file } = tools();
    const v1 = (await read_file.execute({ path: `artifacts/graphic/${GRAPHIC_E_V1.id}.md` }, stub)) as {
      content: string;
    };
    expect(v1.content).toContain('superseded by v2 (this is v1)');
    expect(v1.content).toContain('<div>Quote v1</div>');

    const v2 = (await read_file.execute({ path: `artifacts/graphic/${GRAPHIC_F_V2.id}.md` }, stub)) as {
      content: string;
    };
    expect(v2.content).toContain('current version (v2)');
  });
});

describe('grep aggancia i corpi degli artifact solo per path esatto', () => {
  it('un path esatto trova testo dentro il sorgente', async () => {
    const { grep } = tools();
    const out = (await grep.execute(
      { query: 'const x = 1', path: `artifacts/motion/${MOTION_A.id}.md` },
      stub
    )) as { matches: Array<{ path: string }> };
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].path).toBe(`artifacts/motion/${MOTION_A.id}.md`);
  });

  it('un grep in blocco sotto artifacts/ dichiara il limite invece di tacere', async () => {
    const { grep } = tools();
    const out = (await grep.execute({ query: 'const x', path: 'artifacts/' }, stub)) as {
      matches: unknown[];
      blind: string;
    };
    expect(out.matches).toEqual([]);
    expect(out.blind).toContain('grep in blocco non ci arriva');
  });
});
