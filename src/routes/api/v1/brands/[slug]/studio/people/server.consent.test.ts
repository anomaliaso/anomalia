import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));
vi.mock('$lib/server/people', () => ({
  generateAiPersonImages: vi.fn(async () => ['data:image/png;base64,AA'])
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

function fakeSupabase() {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        insert: (payload: Record<string, unknown>) => { inserts.push(payload); return q; },
        select: () => q,
        single: async () => ({ data: { id: 'p1', name: 'Marta', role: null, kind: 'real' }, error: null })
      };
      return q;
    }
  };
  return { client, inserts };
}

async function post(client: unknown, body: Record<string, unknown>) {
  vi.mocked(authenticate).mockResolvedValue({ supabase: client, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-1' }, error: null } as never);
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request('https://example.test/api/v1/brands/b/studio/people', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    params: { slug: 'b' }
  });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/v1/brands/:slug/studio/people', () => {
  it('refuses a real person the caller has not attested consent for', async () => {
    const { client, inserts } = fakeSupabase();

    const res = await post(client, { name: 'Marta' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/consent/i);
    expect(inserts).toEqual([]);
  });

  it('refuses a real person when consent is anything but a literal true', async () => {
    for (const consent of ['on', 'true', 1, false, null]) {
      const { client, inserts } = fakeSupabase();

      const res = await post(client, { name: 'Marta', consent });

      expect(res.status, `consent=${String(consent)} must not pass`).toBe(400);
      expect(inserts).toEqual([]);
    }
  });

  it('stamps consent_at and consent_source when the caller attests', async () => {
    const { client, inserts } = fakeSupabase();

    const res = await post(client, { name: 'Marta', consent: true });

    expect(res.status).toBe(200);
    expect(inserts[0]).toMatchObject({ consent: true, consent_source: 'owner_attested' });
    expect(inserts[0].consent_at).toBeTruthy();
  });

  it('marks an AI persona ai_generated without asking for an attestation', async () => {
    const { client, inserts } = fakeSupabase();

    const res = await post(client, { name: 'Nova', kind: 'ai' });

    expect(res.status).toBe(200);
    expect(inserts[0]).toMatchObject({ consent: true, consent_source: 'ai_generated' });
    expect(inserts[0].consent_at).toBeUndefined();
  });
});
