/**
 * L'endpoint importa la foto di una persona da un URL ESTERNO scelto durante l'analisi del brand:
 * l'URL arriva da fuori, quindi la superficie che conta è il rifiuto.
 *
 * La guardia locale che c'era prima confrontava `URL.hostname` con delle espressioni regolari, e
 * per un letterale IPv6 `hostname` conserva le parentesi quadre (`[fc00::1]`): nessun pattern
 * poteva corrispondere, e ogni indirizzo IPv6 passava. I test qui sotto sono la prova che non
 * passa più — e che il rifiuto vale anche per un nome pubblico il cui DNS punta in casa, che
 * nessun confronto di stringhe potrà mai vedere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('$lib/server/access', () => ({ canEnter: vi.fn(async () => true) }));
vi.mock('$lib/server/onboarding-errors', () => ({ logOnboardingError: vi.fn(async () => {}) }));

import { lookup } from 'node:dns/promises';
import { POST } from './+server';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const PUBLIC_ADDRESS = '93.184.216.34';
const LOOPBACK = '127.0.0.1';

const IPV6_LITERALS = {
  'unique-local': 'http://[fc00::1]/photo.png',
  loopback: 'http://[::1]/photo.png',
  'link-local': 'http://[fe80::1]/photo.png',
  'IPv4-mapped': 'http://[::ffff:127.0.0.1]/photo.png',
  '6to4': 'http://[2002:7f00:1::]/photo.png',
  NAT64: 'http://[64:ff9b::7f00:1]/photo.png'
};

function resolvesTo(byHost: Record<string, string>) {
  vi.mocked(lookup).mockImplementation((async (host: string) => {
    const address = byHost[host];
    if (!address) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return [{ address, family: 4 }];
  }) as never);
}

/** Ogni URL risponde con un PNG valido, così ciò che ferma la richiesta è solo la guardia. */
function servesImageEverywhere(redirects: Record<string, string> = {}) {
  const requested: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = String(input);
      requested.push(url);

      const location = redirects[url];
      if (location) {
        return new Response(null, { status: 302, headers: { location } });
      }
      return new Response(new Uint8Array(PNG), { status: 200, headers: { 'content-type': 'image/png' } });
    })
  );

  return requested;
}

function storage() {
  const uploaded: string[] = [];
  return {
    uploaded,
    client: {
      storage: {
        from: () => ({
          upload: async (path: string) => {
            uploaded.push(path);
            return { error: null };
          },
          createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.test/a.png' } })
        })
      }
    }
  };
}

function post(url: string, supabase: unknown) {
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request('https://anomalia.test/app/onboarding/people/import', {
      method: 'POST',
      body: JSON.stringify({ url })
    }),
    locals: {
      supabase,
      safeGetSession: async () => ({ session: { user: { id: 'user-1' } }, user: { id: 'user-1' } })
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /app/onboarding/people/import', () => {
  it('archivia la foto quando l host risolve su un indirizzo pubblico', async () => {
    resolvesTo({ 'cdn.example.com': PUBLIC_ADDRESS });
    servesImageEverywhere();
    const store = storage();

    const res = await post('https://cdn.example.com/photo.png', store.client);

    expect(res.status).toBe(200);
    expect(store.uploaded).toHaveLength(1);
  });

  for (const [shape, url] of Object.entries(IPV6_LITERALS)) {
    it(`rifiuta il letterale IPv6 ${shape} (${url})`, async () => {
      resolvesTo({});
      const requested = servesImageEverywhere();
      const store = storage();

      const res = await post(url, store.client);

      expect(res.status).toBe(400);
      expect(requested).toEqual([]);
      expect(store.uploaded).toEqual([]);
    });
  }

  it('rifiuta un nome pubblico il cui DNS punta sul loopback', async () => {
    resolvesTo({ 'rebind.example.com': LOOPBACK });
    const requested = servesImageEverywhere();
    const store = storage();

    const res = await post('https://rebind.example.com/photo.png', store.client);

    expect(res.status).toBe(400);
    expect(requested).toEqual([]);
    expect(store.uploaded).toEqual([]);
  });

  it('rifiuta un redirect che cammina dentro la rete privata', async () => {
    resolvesTo({ 'cdn.example.com': PUBLIC_ADDRESS, 'rebind.example.com': LOOPBACK });
    const requested = servesImageEverywhere({
      'https://cdn.example.com/photo.png': 'https://rebind.example.com/photo.png'
    });
    const store = storage();

    const res = await post('https://cdn.example.com/photo.png', store.client);

    expect(res.status).toBe(400);
    expect(requested).toEqual(['https://cdn.example.com/photo.png']);
    expect(store.uploaded).toEqual([]);
  });
});
