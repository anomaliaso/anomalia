import { describe, it, expect, vi, beforeEach } from 'vitest';
import { json } from '@sveltejs/kit';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => undefined)
}));
vi.mock('$lib/server/app-url', () => ({ appOrigin: () => 'https://anomalia.test' }));

import { POST } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

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
  platform: 'instagram',
  username: 'demo.brand',
  display_name: 'Demo Brand',
  profile_url: null,
  status: 'active',
  connected_at: '2026-08-01T10:00:00.000Z'
};

const url = 'https://anomalia.test/api/v1/brands/demo/social/connect';

const mint = (body: unknown, accounts: Row[] = [], brand: Row = BRAND) => {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: fakeSupabase(accounts),
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand, error: null } as never);

  return (POST as (e: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    params: { slug: 'demo' },
    url: new URL(url)
  }).then(async (res) => ({ res, body: await res.json() }));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(undefined);
});

describe('POST /api/v1/brands/:slug/social/connect', () => {
  it('consegna la porta e non attraversa niente: nessun redirect, nessun OAuth', async () => {
    const { res, body } = await mint({ platform: 'instagram' });

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(body.ok).toBe(true);
    expect(body.url).toBe('https://anomalia.test/app/demo/settings/connect/instagram');
    expect(body.already_connected).toBe(false);
  });

  it('conia lo stesso link per riautorizzare una piattaforma già collegata, e lo dice', async () => {
    const { res, body } = await mint({ platform: 'instagram' }, [IG]);

    expect(res.status).toBe(200);
    expect(body.already_connected).toBe(true);
  });

  it('rifiuta una piattaforma che il prodotto non pubblica, dicendo quali sono ammesse', async () => {
    const { res, body } = await mint({ platform: 'myspace' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(body.platform_choices).toContain('instagram');
    expect(body.platform_choices).not.toContain('myspace');
  });

  it("rifiuta `twitter`: è l'alias storico di `x`, e la porta giusta ha un nome solo", async () => {
    const { res, body } = await mint({ platform: 'twitter' });

    expect(res.status).toBe(400);
    expect(body.platform_choices).toContain('x');
  });

  it('rifiuta un piano che non collega account, invece di mandare qualcuno a un muro', async () => {
    const { res, body } = await mint({ platform: 'instagram' }, [], {
      ...BRAND,
      plan: null,
      status: 'trial'
    });

    expect(res.status).toBe(409);
    expect(body.error).toBe('plan_cannot_connect');
    expect(body.activate_url).toBe('https://anomalia.test/app/demo/activate');
  });

  it('rifiuta quando i posti del piano sono finiti, che è un altro rimedio', async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ ...IG, username: `a${i}` }));

    const { res, body } = await mint({ platform: 'tiktok' }, full);

    expect(res.status).toBe(409);
    expect(body.error).toBe('account_limit');
    expect(body.slots.used).toBeGreaterThanOrEqual(body.slots.limit);
    expect(body.manage_url).toBe('https://anomalia.test/app/demo/settings/connected-accounts');
  });

  it('una chiave di sola lettura non conia niente', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      json({ error: 'API key is read-only' }, { status: 403 })
    );

    const { res, body } = await mint({ platform: 'instagram' });

    expect(res.status).toBe(403);
    expect(body.url).toBeUndefined();
  });

  it('non restituisce un token, un id Zernio o qualunque altra credenziale', async () => {
    const { body } = await mint({ platform: 'instagram' }, [
      { ...IG, access_token: 'ig-secret', zernio_account_id: 'zern-1' }
    ]);

    expect(JSON.stringify(body)).not.toContain('ig-secret');
    expect(JSON.stringify(body)).not.toContain('zern-1');
    expect(JSON.stringify(body)).not.toMatch(/token|secret|zernio/i);
  });

  it('risponde esattamente quello che il contratto dichiara, niente di più', async () => {
    const { SOCIAL_CONNECT_LINK } = await import('@anomalia/api-contracts');
    const { body } = await mint({ platform: 'linkedin' });

    expect(SOCIAL_CONNECT_LINK.output.strict().safeParse(body).success).toBe(true);
  });
});
