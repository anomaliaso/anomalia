import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn()
}));
vi.mock('$lib/server/app-url', () => ({ appOrigin: () => 'https://anomalia.test' }));

import { GET } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;

function fakeSupabase(accounts: Row[]) {
  const q = {
    select: () => q,
    eq: () => q,
    order: async () => ({ data: accounts })
  };
  return { from: () => q };
}

const BRAND = { id: 'brand-1', slug: 'demo', plan: 'pro', status: 'active' };

const IG = {
  platform: 'Instagram',
  username: 'demo.brand',
  display_name: 'Demo Brand',
  profile_url: 'https://instagram.com/demo.brand',
  status: 'active',
  connected_at: '2026-08-01T10:00:00.000Z'
};

const url = 'https://anomalia.test/api/v1/brands/demo/social/accounts';

const read = (accounts: Row[] = [IG], brand: Row = BRAND) => {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: fakeSupabase(accounts),
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand, error: null } as never);

  return (GET as (e: unknown) => Promise<Response>)({
    request: new Request(url),
    params: { slug: 'demo' },
    url: new URL(url)
  }).then(async (res) => ({ res, body: await res.json() }));
};

beforeEach(() => vi.clearAllMocks());

describe('GET /api/v1/brands/:slug/social/accounts', () => {
  it("dice su quale handle pubblica, non solo che la piattaforma c'è", async () => {
    const { body } = await read();

    expect(body.accounts).toEqual([
      {
        platform: 'instagram',
        username: 'demo.brand',
        display_name: 'Demo Brand',
        profile_url: 'https://instagram.com/demo.brand',
        status: 'active',
        connected_at: '2026-08-01T10:00:00.000Z'
      }
    ]);
    expect(body.connected_platforms).toEqual(['instagram']);
  });

  it('separa una piattaforma rotta da una che non è mai stata collegata', async () => {
    // Il caso che oggi nessuno vede: la riga c'è, il post è programmato, e non esce.
    const { body } = await read([{ ...IG, status: 'expired' }]);

    expect(body.connected_platforms).toEqual([]);
    expect(body.broken_platforms).toEqual(['instagram']);
  });

  it('non chiama rotta una piattaforma che ha anche un solo account vivo', async () => {
    const { body } = await read([
      { ...IG, status: 'disconnected', username: 'vecchio' },
      { ...IG, username: 'nuovo' }
    ]);

    expect(body.connected_platforms).toEqual(['instagram']);
    expect(body.broken_platforms).toEqual([]);
  });

  it('dice che un piano free non collega niente, prima che qualcuno provi', async () => {
    const { body } = await read([], { ...BRAND, plan: null, status: 'trial' });

    expect(body.can_connect).toBe(false);
    expect(body.slots).toEqual({ used: 0, limit: 0 });
  });

  it('conta solo gli account attivi contro il tetto del piano', async () => {
    const { body } = await read([IG, { ...IG, platform: 'tiktok', status: 'disconnected' }]);

    expect(body.slots.used).toBe(1);
    expect(body.slots.limit).toBeGreaterThan(0);
  });

  it('porta il vocabolario delle piattaforme e la porta dove si scollega', async () => {
    const { body } = await read();

    expect(body.platform_choices).toContain('linkedin');
    expect(body.manage_url).toBe(
      'https://anomalia.test/app/demo/settings/connected-accounts'
    );
  });

  it('non fa uscire un token, un id Zernio o qualunque altra credenziale', async () => {
    const { body } = await read([
      { ...IG, access_token: 'ig-secret', zernio_account_id: 'zern-1' }
    ]);

    expect(JSON.stringify(body)).not.toContain('ig-secret');
    expect(JSON.stringify(body)).not.toContain('zern-1');
    expect(JSON.stringify(body)).not.toMatch(/token|secret|zernio/i);
  });

  it('risponde esattamente quello che il contratto dichiara, niente di più', async () => {
    const { LIST_SOCIAL_ACCOUNTS } = await import('@anomalia/api-contracts');
    const { body } = await read();

    expect(LIST_SOCIAL_ACCOUNTS.output.strict().safeParse(body).success).toBe(true);
  });
});
