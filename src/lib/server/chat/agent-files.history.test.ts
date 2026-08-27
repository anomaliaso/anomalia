import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * L'ANALYST CIECO — eval del 24/8, motore KIT.
 *
 * Un brand con quattro post davvero pubblicati si è sentito rispondere «Non risultano post
 * pubblicati». La causa non era il modello ed era a due passi da dove sembrava:
 *
 *  1. La spec dell'Analyst dice «Ground every claim in `query` results or `work/history/`».
 *  2. `work/history/` NON ESISTEVA: `filesIndexFor` non lo elencava e `resolve` rispondeva
 *     «No such file».
 *  3. Ripiegando su `query`, l'agente guardava `posts` — che contiene solo ciò che ha pubblicato
 *     QUESTO prodotto — mentre i post veri del brand vivono in `social_post_history`.
 *
 * Riparato dove nasce: il path che la spec già nomina diventa un file vero, e quel file porta
 * ENTRAMBE le sorgenti. Questi test falliscono se una delle due torna a sparire.
 *
 * (Nota per chi cerca il fix nel posto sbagliato: il motore kit — `runKitTurn`, quello che l'eval
 * misura — non ha nessun tool `read_posts`. I suoi builtin vengono da `@anomalia/agent-core`.
 * Aggiustare `read_posts` in `chat/tools.ts` serve la chat classica e non tocca l'Analyst.)
 */

vi.mock('$lib/server/ai-log', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, logAiCall: () => {} };
});

import { createFileTools, filesIndexFor } from './agent-files';

type Row = Record<string, unknown>;

/** Supabase finto che filtra e ordina davvero — stesso fake di `agent-files.artifacts.test.ts`. */
function fakeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  function builder(table: string) {
    let rows = [...(tables[table] ?? [])];
    const b = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        rows = rows.filter((r) => r[k] === v);
        return b;
      },
      gte: (k: string, v: string) => {
        rows = rows.filter((r) => String(r[k] ?? '') >= v);
        return b;
      },
      order: (k: string, opts?: { ascending?: boolean }) => {
        const asc = opts?.ascending !== false;
        rows = [...rows].sort((a, c) =>
          asc
            ? String(a[k] ?? '').localeCompare(String(c[k] ?? ''))
            : String(c[k] ?? '').localeCompare(String(a[k] ?? ''))
        );
        return b;
      },
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return b;
      },
      then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null })
    };
    return b;
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient;
}

const BRAND = 'b1';

// Le stesse didascalie che il fixture della valutazione semina in `social_post_history`.
const HISTORY = [
  {
    id: 'h1',
    brand_id: BRAND,
    source: 'zernio',
    platform: 'instagram',
    content: 'Sei pezzi in gres non smaltato, cotti a legna.',
    published_at: '2026-08-20T10:00:00Z',
    metrics: { likes: 120, comments: 4 }
  },
  {
    id: 'h2',
    brand_id: BRAND,
    source: 'zernio',
    platform: 'linkedin',
    content: 'Due giorni in bottega, massimo sei persone.',
    published_at: '2026-08-17T10:00:00Z',
    metrics: { likes: 157, comments: 5 }
  }
];

const PRODUCT_POSTS = [
  {
    id: 'p1',
    brand_id: BRAND,
    status: 'published',
    caption: 'Il tornio gira da vent’anni\nseconda riga da ignorare',
    platforms: ['instagram'],
    published_at: '2026-08-22T09:00:00Z',
    created_at: '2026-08-22T08:00:00Z'
  }
];

const stub = {} as never;

const readHistory = async (tables: Record<string, Row[]>, path = 'work/history.md') => {
  const { read_file } = createFileTools('analyst', 'th', {
    supabase: fakeSupabase(tables),
    brandId: BRAND,
    threadId: 'th',
    userId: 'u1'
  });
  return (await read_file.execute({ path }, stub)) as { content?: string; error?: string };
};

describe('work/history.md — il path che la spec dell’Analyst già nomina esiste davvero', () => {
  it('è elencato nell’indice dei file, altrimenti l’agente non sa di poterlo aprire', () => {
    expect(filesIndexFor('analyst')).toContain('work/history.md');
  });

  it('IL CUORE: con `posts` vuota, i post veri degli account arrivano lo stesso', async () => {
    const out = await readHistory({ social_post_history: HISTORY, posts: [] });
    expect(out.error).toBeUndefined();
    expect(out.content).toContain('gres non smaltato');
    expect(out.content).toContain('Due giorni in bottega');
    // E la sezione vuota lo DICE, invece di sembrare l’unica verità.
    expect(out.content).toContain('nothing scheduled through this product has gone out yet');
  });

  it('e viceversa: senza storico sincronizzato, i post del prodotto non spariscono', async () => {
    const out = await readHistory({ social_post_history: [], posts: PRODUCT_POSTS });
    expect(out.content).toContain('Il tornio gira da vent’anni');
    // Una riga per post: la seconda riga della didascalia non deve sporcare l’elenco.
    expect(out.content).not.toContain('seconda riga da ignorare');
    expect(out.content).toContain('none synced yet');
  });

  it('le metriche vere ci sono — un Analyst che le stima è un Analyst che inventa', async () => {
    const out = await readHistory({ social_post_history: HISTORY, posts: PRODUCT_POSTS });
    expect(out.content).toContain('likes 120');
    expect(out.content).toContain('likes 157');
  });

  it('solo i post del BRAND: la RLS copre tutti i brand dell’utente, il file no', async () => {
    const out = await readHistory({
      social_post_history: [...HISTORY, { ...HISTORY[0], id: 'x', brand_id: 'altro', content: 'DI UN ALTRO CLIENTE' }],
      posts: []
    });
    expect(out.content).not.toContain('DI UN ALTRO CLIENTE');
  });

  it('lo storico scrapato dei concorrenti non è «cosa ho pubblicato io»', async () => {
    const out = await readHistory({
      social_post_history: [{ ...HISTORY[0], id: 'c', source: 'scrapecreators', content: 'POST DI UN CONCORRENTE' }],
      posts: []
    });
    expect(out.content).not.toContain('POST DI UN CONCORRENTE');
  });

  it('zero post ovunque si dice come fatto, non come file vuoto', async () => {
    const out = await readHistory({ social_post_history: [], posts: [] });
    expect(out.error).toBeUndefined();
    expect(out.content).toContain('published NOTHING yet');
  });

  it('`work/history/` con la barra — come la scrive la spec — apre lo stesso file', async () => {
    const out = await readHistory({ social_post_history: HISTORY, posts: [] }, 'work/history/');
    expect(out.content).toContain('gres non smaltato');
  });
});
