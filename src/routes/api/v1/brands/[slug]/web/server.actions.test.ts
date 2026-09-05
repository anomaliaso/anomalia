import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateArticleFromTopic = vi.fn(async () => 'a1');
const optimizeArticleForScore = vi.fn(async () => undefined);
const notifyIndexers = vi.fn(async () => undefined);

let written: Record<string, unknown>[] = [];
let deleted = 0;

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(async () => ({ supabase: {}, apiKey: undefined, error: null })),
  loadBrandForUser: vi.fn(async () => ({ brand: { id: 'brand-1' }, error: null })),
  checkApiKeyWriteAccess: () => null,
  gateAiAction: async () => undefined
}));
vi.mock('$lib/server/ai-log', () => ({
  withBrandContext: (_id: string, fn: () => Promise<Response>) => fn()
}));
vi.mock('$lib/server/blog-generate', () => ({
  generateArticleFromTopic: (...a: unknown[]) => generateArticleFromTopic(...(a as [])),
  optimizeArticleForScore: (...a: unknown[]) => optimizeArticleForScore(...(a as []))
}));
vi.mock('$lib/server/indexing', () => ({
  notifyIndexers: (...a: unknown[]) => notifyIndexers(...(a as []))
}));
vi.mock('$lib/server/cli-queries', () => ({ getWeb: async () => ({ articles: [] }) }));
vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        update(row: Record<string, unknown>) {
          written.push(row);
          return q;
        },
        delete() {
          deleted += 1;
          return q;
        },
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { slug: 'un-articolo' }, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ error: null })
      };
      return q;
    }
  })
}));

import { POST as dispatch } from './+server';
import { DELETE as remove } from './article/[id]/+server';
import { POST as optimize } from './article/[id]/optimize/+server';
import { POST as publish } from './article/[id]/publish/+server';
import { POST as unpublish } from './article/[id]/unpublish/+server';
import { POST as generate } from './generate/+server';

const call = (handler: unknown, body: Record<string, unknown>, id = 'a1'): Promise<Response> =>
  (handler as (e: unknown) => Promise<Response>)({
    request: new Request('https://example.test/api/v1/brands/demo/web', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    params: { slug: 'demo', id }
  });

beforeEach(() => {
  written = [];
  deleted = 0;
  vi.clearAllMocks();
});

describe('ogni azione sugli articoli ha la sua rotta', () => {
  it('la rotta fa una cosa sola, e la fa senza leggere nessun `action`', async () => {
    expect(await (await call(generate, { topic: 'tastiere' })).json()).toEqual({
      ok: true,
      articleId: 'a1'
    });

    expect((await call(optimize, {})).status).toBe(200);
    expect(optimizeArticleForScore.mock.calls[0]?.[2]).toBe('a1');

    expect(await (await call(publish, {})).json()).toEqual({ ok: true, status: 'published' });
    expect(written[0].status).toBe('published');
    expect(notifyIndexers).toHaveBeenCalledTimes(1);

    expect(await (await call(unpublish, {})).json()).toEqual({ ok: true, status: 'draft' });
    expect(written[1]).toEqual({ status: 'draft', published_at: null });

    expect(await (await call(remove, {})).json()).toEqual({ ok: true });
    expect(deleted).toBe(1);
  });

  it('generare senza tema resta un 400', async () => {
    expect((await call(generate, {})).status).toBe(400);
  });
});

/**
 * Il contratto fra i chiamanti e la vecchia rotta è una stringa, e una stringa nessun compilatore
 * la controlla. Ora ogni azione ha la sua rotta e la vecchia resta solo per chi la chiamava: deve
 * inoltrare ognuna delle cinque, portando l'`id` dal corpo al percorso, e dire di no alle altre.
 */
describe('la rotta `action` resta, e non fa altro che inoltrare', () => {
  it('ognuna delle cinque arriva dove arrivava prima', async () => {
    expect(await (await call(dispatch, { action: 'generate', topic: 'x' })).json()).toEqual({
      ok: true,
      articleId: 'a1'
    });

    await call(dispatch, { action: 'optimize', id: 'abc123' });
    expect(optimizeArticleForScore.mock.calls[0]?.[2]).toBe('abc123');

    expect(await (await call(dispatch, { action: 'publish', id: 'abc123' })).json()).toEqual({
      ok: true,
      status: 'published'
    });
    expect(await (await call(dispatch, { action: 'unpublish', id: 'abc123' })).json()).toEqual({
      ok: true,
      status: 'draft'
    });
    expect(await (await call(dispatch, { action: 'delete', id: 'abc123' })).json()).toEqual({
      ok: true
    });
    expect(deleted).toBe(1);
  });

  it('senza id le quattro azioni sull’articolo restano un 400', async () => {
    for (const action of ['optimize', 'publish', 'unpublish', 'delete']) {
      const res = await call(dispatch, { action });

      expect(await res.json(), action).toEqual({ error: 'Missing id' });
      expect(res.status, action).toBe(400);
    }
  });

  it('un’azione che non esiste resta un 400, non un silenzio', async () => {
    const res = await call(dispatch, { action: 'rewrite', id: 'abc123' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unknown action: rewrite' });
  });
});
