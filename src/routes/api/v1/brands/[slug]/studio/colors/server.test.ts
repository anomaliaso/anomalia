import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));

import { PUT } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

let upserted: Record<string, unknown>[] = [];

const fakeSupabase = () => ({
  from: () => ({
    upsert: async (row: Record<string, unknown>) => {
      upserted.push(row);
      return { error: null };
    }
  })
});

const put = (body: Record<string, unknown>) =>
  (PUT as (e: unknown) => Promise<Response>)({
    request: new Request('https://example.test/api/v1/brands/demo/studio/colors', {
      method: 'PUT',
      body: JSON.stringify(body)
    }),
    params: { slug: 'demo' }
  });

beforeEach(() => {
  upserted = [];
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({ supabase: fakeSupabase(), apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-1' }, error: null } as never);
});

describe('PUT /api/v1/brands/:slug/studio/colors', () => {
  it('prende un esadecimale anche senza cancelletto e lo salva col cancelletto', async () => {
    const res = await put({ colors: ['7c5cff', '#ffffff'] });

    expect(res.status).toBe(200);
    expect(upserted[0].brand_colors).toEqual(['#7c5cff', '#ffffff']);
    expect(await res.json()).toEqual({ ok: true, colors: ['#7c5cff', '#ffffff'] });
  });

  it('rifiuta quello che esadecimale non è', async () => {
    expect((await put({ colors: ['viola'] })).status).toBe(400);
  });
});
