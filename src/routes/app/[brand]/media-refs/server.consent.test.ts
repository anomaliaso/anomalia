import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/people', () => ({
  signPersonImages: async (_s: unknown, imgs: Array<{ path: string }>) =>
    imgs.map((i) => `https://signed.example/${i.path}`)
}));
vi.mock('$lib/server/media-archive', () => ({
  signKnowledgePaths: async () => new Map<string, string>()
}));
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('$lib/server/talent', () => ({ listTalents: async () => [] }));
vi.mock('$lib/server/stored-ads', () => ({ listStoredAdRefs: async () => [] }));

import { GET } from './+server';

type PersonRow = {
  id: string;
  name: string;
  role: string | null;
  kind: string;
  consent: unknown;
  images: Array<{ path: string }>;
};

function fakeSupabase(people: PersonRow[]) {
  return {
    from(table: string) {
      const rows = table === 'people' ? people : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: table === 'brands' ? { id: 'brand-1' } : null }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (ok: any, ko: any) => Promise.resolve({ data: rows }).then(ok, ko)
      };
      return q;
    }
  };
}

const person = (over: Partial<PersonRow> = {}): PersonRow => ({
  id: 'p1',
  name: 'Marta',
  role: null,
  kind: 'real',
  consent: true,
  images: [{ path: 'a.jpg' }],
  ...over
});

async function listPeople(people: PersonRow[]) {
  const res = await (GET as (event: unknown) => Promise<Response>)({
    params: { brand: 'demo' },
    locals: {
      supabase: fakeSupabase(people),
      safeGetSession: async () => ({ user: { id: 'u1' } })
    }
  });
  return (await res.json()).people as Array<{ id: string; name: string; urls: string[] }>;
}

describe('GET /app/:brand/media-refs — the likeness gate on the workbench door', () => {
  it('offers a real person once consent is attested', async () => {
    const people = await listPeople([person()]);

    expect(people.map((p) => p.name)).toEqual(['Marta']);
    expect(people[0].urls).toEqual(['https://signed.example/a.jpg']);
  });

  it('withholds a real person imported without attestation', async () => {
    const people = await listPeople([person({ consent: false })]);

    expect(people).toEqual([]);
  });

  it('treats a missing or malformed consent value as no consent', async () => {
    for (const bad of [undefined, null, 'true', 1]) {
      const people = await listPeople([person({ consent: bad })]);

      expect(people, `consent=${String(bad)} must not pass`).toEqual([]);
    }
  });

  it('never gates an AI persona — there is no real person to consent', async () => {
    const people = await listPeople([person({ kind: 'ai', name: 'Nova', consent: false })]);

    expect(people.map((p) => p.name)).toEqual(['Nova']);
  });

  it('withholds only the unattested person in a mixed set', async () => {
    const people = await listPeople([
      person({ id: 'p1', name: 'Marta', consent: true }),
      person({ id: 'p2', name: 'Luca', consent: false }),
      person({ id: 'p3', name: 'Nova', kind: 'ai', consent: false })
    ]);

    expect(people.map((p) => p.name)).toEqual(['Marta', 'Nova']);
  });
});
