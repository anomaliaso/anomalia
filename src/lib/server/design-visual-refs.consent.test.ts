import { describe, it, expect, vi } from 'vitest';

// The one gate between a real person's photograph and a generative model. Everything else in this
// file's module talks to the network, so only the people path is exercised here.
vi.mock('$lib/server/people', () => ({
  signPersonImages: async (_s: unknown, imgs: Array<{ path: string }>) =>
    imgs.map((i) => `https://signed.example/${i.path}`)
}));

import { resolvePeopleVisualRefs, resolvePeopleVisualRefsDetailed } from './design-visual-refs';

type Row = { id: string; name: string; kind: string; images: Array<{ path: string }>; consent: boolean };

function supabaseWith(rows: Row[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => Promise.resolve({ data: rows })
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any;
}

const real = (over: Partial<Row> = {}): Row => ({
  id: 'p1',
  name: 'Marta',
  kind: 'real',
  images: [{ path: 'a.jpg' }],
  consent: true,
  ...over
});

describe('likeness consent gate', () => {
  it('passes a real person through once consent is recorded', async () => {
    const out = await resolvePeopleVisualRefsDetailed(supabaseWith([real()]), 'b1', ['p1']);
    expect(out.refs).toHaveLength(1);
    expect(out.refs[0].label).toBe('person:Marta');
    expect(out.blocked).toEqual([]);
  });

  it('withholds a real person with no consent, and names them', async () => {
    const out = await resolvePeopleVisualRefsDetailed(
      supabaseWith([real({ consent: false })]),
      'b1',
      ['p1']
    );
    expect(out.refs).toEqual([]);
    expect(out.blocked).toEqual(['Marta']);
  });

  it('treats a missing or malformed consent value as no consent', async () => {
    for (const bad of [undefined, null, 'true', 1]) {
      const out = await resolvePeopleVisualRefsDetailed(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabaseWith([real({ consent: bad as any })]),
        'b1',
        ['p1']
      );
      expect(out.refs, `consent=${String(bad)} must not pass`).toEqual([]);
      expect(out.blocked).toEqual(['Marta']);
    }
  });

  it('never gates an AI persona — there is no real person to consent', async () => {
    const out = await resolvePeopleVisualRefsDetailed(
      supabaseWith([real({ kind: 'ai', name: 'Nova', consent: false })]),
      'b1',
      ['p1']
    );
    expect(out.refs).toHaveLength(1);
    expect(out.refs[0].label).toBe('ai person:Nova');
    expect(out.blocked).toEqual([]);
  });

  it('blocks only the unattested person in a mixed set', async () => {
    const out = await resolvePeopleVisualRefsDetailed(
      supabaseWith([
        real({ id: 'p1', name: 'Marta', consent: true }),
        real({ id: 'p2', name: 'Luca', consent: false }),
        real({ id: 'p3', name: 'Nova', kind: 'ai', consent: false })
      ]),
      'b1',
      ['p1', 'p2', 'p3']
    );
    expect(out.refs.map((r) => r.label)).toEqual(['person:Marta', 'ai person:Nova']);
    expect(out.blocked).toEqual(['Luca']);
  });

  it('the refs-only wrapper drops blocked people rather than throwing', async () => {
    const refs = await resolvePeopleVisualRefs(supabaseWith([real({ consent: false })]), 'b1', ['p1']);
    expect(refs).toEqual([]);
  });

  it('short-circuits with no ids, without touching the database', async () => {
    const supabase = {
      from: () => {
        throw new Error('should not query');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await expect(resolvePeopleVisualRefsDetailed(supabase, 'b1', [])).resolves.toEqual({
      refs: [],
      blocked: []
    });
  });
});
