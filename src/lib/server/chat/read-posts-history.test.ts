import { describe, expect, it } from 'vitest';
import { createChatTools } from '$lib/agent/tools/index';

/**
 * L'ANALYST CIECO — eval del 24/8.
 *
 * Un brand con quattro post davvero pubblicati sui suoi account si è sentito rispondere «non
 * risultano post pubblicati». Non era una bugia del modello: `read_posts` legge `posts`, che
 * contiene solo ciò che ha pubblicato QUESTO prodotto, mentre ciò che il brand ha pubblicato
 * sui propri account vive in `social_post_history`. La domanda «cosa ho pubblicato» ha risposta
 * in due tabelle e il tool ne guardava una.
 *
 * Riparato nel TOOL e non nella spec dell'Analyst: `read_posts` è di tutti i mestieri, e una
 * riga di prompt per l'Analyst avrebbe lasciato ciechi gli altri quattro.
 */

type Chain = Record<string, unknown>;

/** PostgREST finto: ogni tabella risponde le sue righe, e la catena è awaitable in qualsiasi punto. */
function fakeSupabase(byTable: Record<string, Array<Record<string, unknown>>>) {
  const chain = (table: string): Chain => {
    const rows = byTable[table] ?? [];
    const result = { data: rows, error: null, count: rows.length };
    const c: Chain = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'not', 'order', 'limit', 'gte']) c[m] = () => c;
    c.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
    return c;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readPosts = (supabase: any, input: Record<string, unknown>): Promise<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (createChatTools(supabase, 'b1', 'Europe/Rome', 'u1').read_posts as any).execute(input, {});

const HISTORY = [
  { id: 'h1', source: 'zernio', platform: 'instagram', content: 'Sei pezzi in gres, cotti a legna', published_at: '2026-08-20T10:00:00Z', metrics: { likes: 120 } },
  { id: 'h2', source: 'zernio', platform: 'linkedin', content: 'Due giorni in bottega', published_at: '2026-08-17T10:00:00Z', metrics: { likes: 157 } }
];

describe('read_posts non chiama vuoto un brand che ha pubblicato davvero', () => {
  it('con `posts` vuota, i post veri degli account arrivano comunque al modello', async () => {
    const out = await readPosts(fakeSupabase({ posts: [], social_post_history: HISTORY }), {
      status: 'published'
    });
    expect(out.posts).toEqual([]);
    // IL CUORE: la risposta onesta qui è «due», non «nessuno».
    expect(out.published_on_socials).toHaveLength(2);
    expect(JSON.stringify(out.published_on_socials)).toContain('gres');
    expect(out.published_on_socials_note).toContain('published');
  });

  it('senza filtro di stato vale lo stesso: «cosa ho pubblicato» è la domanda senza stato', async () => {
    const out = await readPosts(fakeSupabase({ posts: [], social_post_history: HISTORY }), {});
    expect(out.published_on_socials).toHaveLength(2);
  });

  it('su una domanda che non riguarda il pubblicato lo storico non si allega', async () => {
    const out = await readPosts(fakeSupabase({ posts: [], social_post_history: HISTORY }), {
      status: 'pending_user'
    });
    expect(out.published_on_socials).toBeUndefined();
  });

  // `returned` c'e' sempre: e' quante righe l'agente ha DAVVERO sotto gli occhi, e distinguerla da
  // `count` (quante ne esistono) e' esattamente cio' che gli impediva di spacciare la pagina per il
  // totale. Non e' una chiave vuota: e' la meta' del confronto.
  it('brand senza storico: nessuna chiave vuota da interpretare, ma il conto resta a due voci', async () => {
    const out = await readPosts(fakeSupabase({ posts: [], social_post_history: [] }), {
      status: 'published'
    });
    expect(out).toEqual({ posts: [], count: 0, returned: 0 });
  });
});
