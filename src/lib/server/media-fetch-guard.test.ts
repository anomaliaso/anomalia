/**
 * Le tre funzioni che scaricano un URL remoto e lo depositano: il logo del brand, l'archivio
 * immagini e l'archivio dei media di mercato. Il test è uno solo perché la guardia è una sola —
 * `safeFetchBytes` — e ciò che va dimostrato per ognuna è identico: un nome pubblico che risolve
 * su un indirizzo privato, un redirect che ci cammina dentro, un corpo oltre il tetto con e senza
 * content-length. Tre copie di questi helper sarebbero tre copie che divergono.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { archiveImageToBucket } from './media-archive';
import { archiveMarketMedia } from './market-media';
import { storeBrandLogoFromUrl } from './studio-actions';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const OVER_LOGO_CEILING = Buffer.alloc(4_500_000, 1);
const OVER_ARCHIVE_CEILING = Buffer.alloc(5_500_000, 1);
const OVER_MARKET_IMAGE_CEILING = Buffer.alloc(8_500_000, 1);

const PUBLIC_ADDRESS = '93.184.216.34';
const LITERAL_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

type Hop = { status: number; location?: string; type?: string; length?: string; body?: Buffer };

function resolvesTo(byHost: Record<string, string>) {
  vi.mocked(lookup).mockImplementation((async (host: string) => {
    // Come il resolver vero: un indirizzo scritto per esteso torna se stesso, così il rifiuto
    // arriva da isPrivateAddress e non dal fatto che il nome non esiste.
    const address = LITERAL_IPV4.test(host) ? host : byHost[host];
    if (!address) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return [{ address, family: 4 }];
  }) as never);
}

function serves(hops: Record<string, Hop>): { requested: string[]; headers: Array<Record<string, string>> } {
  const requested: string[] = [];
  const headers: Array<Record<string, string>> = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      headers.push(Object.fromEntries(new Headers(init?.headers ?? {}).entries()));

      const hop = hops[url];
      if (!hop) throw new Error(`ECONNREFUSED ${url}`);

      const out = new Headers();
      if (hop.location) out.set('location', hop.location);
      if (hop.type) out.set('content-type', hop.type);
      if (hop.length) out.set('content-length', hop.length);
      return new Response(hop.body ? new Uint8Array(hop.body) : null, { status: hop.status, headers: out });
    })
  );

  return { requested, headers };
}

/**
 * Un corpo che arriva a pezzi, contando quanti ne vengono TIRATI.
 *
 * Il tetto di byte non si dimostra dall'esito: bufferizzare tutto e poi misurare restituisce lo
 * stesso rifiuto di fermarsi a metà. La differenza — l'unica che conta, perché è quella che
 * riempie la memoria della funzione — è quanti pezzi il lettore chiede prima di mollare.
 */
function servesChunked(url: string, opts: { type: string; chunkBytes: number; chunks: number }) {
  const pulled = { count: 0 };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      if (String(input) !== url) throw new Error(`ECONNREFUSED ${String(input)}`);

      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= opts.chunks) {
            controller.close();
            return;
          }
          sent++;
          pulled.count++;
          controller.enqueue(new Uint8Array(opts.chunkBytes));
        }
      });

      return new Response(body, { status: 200, headers: { 'content-type': opts.type } });
    })
  );

  return pulled;
}

function fakeSupabase(fails: { upload?: string } = {}) {
  const uploads: Array<{ path: string; contentType: string; bytes: number }> = [];

  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, body: Buffer, opts: { contentType: string }) => {
          if (fails.upload) return { error: { message: fails.upload } };
          uploads.push({ path, contentType: opts.contentType, bytes: body.byteLength });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://public.test/${path}` } })
      })
    }
  };

  return { client, uploads };
}

function archiveImage(url: string) {
  const supa = fakeSupabase();
  return archiveImageToBucket(supa.client as never, 'brand-1/thumb.jpg', url).then((path) => ({
    path,
    ...supa
  }));
}

function archiveMarket(url: string) {
  const supa = fakeSupabase();
  return archiveMarketMedia(supa.client as never, {
    platform: 'threads',
    externalId: 'threads:abc',
    url
  }).then((result) => ({ result, ...supa }));
}

function storeLogo(url: string) {
  const supa = fakeSupabase();
  return storeBrandLogoFromUrl(supa.client as never, { userId: 'user-1', imageUrl: url }).then(
    (result) => ({ result, ...supa })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resolvesTo({ 'cdn.example.com': PUBLIC_ADDRESS });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storeBrandLogoFromUrl', () => {
  it('deposita il logo e ne restituisce l URL pubblico', async () => {
    serves({ 'https://cdn.example.com/logo.png': { status: 200, type: 'image/png', body: PNG } });

    const { result, uploads } = await storeLogo('https://cdn.example.com/logo.png');

    expect(result).toEqual({ url: expect.stringContaining('https://public.test/user-1/studio/logo-') });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe('image/png');
  });

  it('accetta ancora http: un logo di onboarding arriva anche da un sito in chiaro', async () => {
    resolvesTo({ 'old-brand.example.com': PUBLIC_ADDRESS });
    serves({ 'http://old-brand.example.com/logo.png': { status: 200, type: 'image/png', body: PNG } });

    const { result, uploads } = await storeLogo('http://old-brand.example.com/logo.png');

    expect(result).toEqual({ url: expect.any(String) });
    expect(uploads).toHaveLength(1);
  });

  it('rifiuta un nome pubblico che il DNS risolve su un indirizzo privato', async () => {
    resolvesTo({ 'cdn.example.com': '169.254.169.254' });
    const { requested } = serves({});

    const { result, uploads } = await storeLogo('https://cdn.example.com/logo.png');

    expect(result).toEqual({ error: expect.stringMatching(/not fetchable/i) });
    expect(requested).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it('rifiuta un redirect che entra in una rete privata, senza seguirlo', async () => {
    resolvesTo({ 'cdn.example.com': PUBLIC_ADDRESS, 'internal.example.com': '127.0.0.1' });
    const { requested } = serves({
      'https://cdn.example.com/logo.png': { status: 302, location: 'https://internal.example.com/secret' },
      'https://internal.example.com/secret': { status: 200, type: 'image/png', body: PNG }
    });

    const { result, uploads } = await storeLogo('https://cdn.example.com/logo.png');

    expect(result).toEqual({ error: expect.stringMatching(/not fetchable/i) });
    expect(requested).toEqual(['https://cdn.example.com/logo.png']);
    expect(uploads).toEqual([]);
  });

  it('rifiuta un corpo oltre il tetto quando il content-length mente', async () => {
    serves({
      'https://cdn.example.com/big.png': {
        status: 200,
        type: 'image/png',
        length: '120',
        body: OVER_LOGO_CEILING
      }
    });

    const { result, uploads } = await storeLogo('https://cdn.example.com/big.png');

    expect(result).toEqual({ error: expect.stringMatching(/too large/i) });
    expect(uploads).toEqual([]);
  });

  it('rifiuta un corpo oltre il tetto anche quando il content-length manca', async () => {
    serves({
      'https://cdn.example.com/nolength.png': { status: 200, type: 'image/png', body: OVER_LOGO_CEILING }
    });

    const { result, uploads } = await storeLogo('https://cdn.example.com/nolength.png');

    expect(result).toEqual({ error: expect.stringMatching(/too large/i) });
    expect(uploads).toEqual([]);
  });
});

describe('archiveImageToBucket', () => {
  it('archivia la miniatura e conserva lo User-Agent con cui le CDN ci conoscono', async () => {
    const { headers } = serves({
      'https://cdn.example.com/thumb.jpg': { status: 200, type: 'image/jpeg', body: PNG }
    });

    const { path, uploads } = await archiveImage('https://cdn.example.com/thumb.jpg');

    expect(path).toBe('brand-1/thumb.jpg');
    expect(uploads).toHaveLength(1);
    expect(headers[0]['user-agent']).toContain('AnomaliaArchive');
  });

  it('rifiuta un nome pubblico che il DNS risolve su un indirizzo privato', async () => {
    resolvesTo({ 'cdn.example.com': '10.0.0.5' });
    const { requested } = serves({});

    const { path, uploads } = await archiveImage('https://cdn.example.com/thumb.jpg');

    expect(path).toBeNull();
    expect(requested).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it('rifiuta un redirect che entra in una rete privata, senza seguirlo', async () => {
    resolvesTo({ 'cdn.example.com': PUBLIC_ADDRESS, 'internal.example.com': '169.254.169.254' });
    const { requested } = serves({
      'https://cdn.example.com/thumb.jpg': { status: 302, location: 'https://internal.example.com/latest/meta-data' },
      'https://internal.example.com/latest/meta-data': { status: 200, type: 'image/jpeg', body: PNG }
    });

    const { path, uploads } = await archiveImage('https://cdn.example.com/thumb.jpg');

    expect(path).toBeNull();
    expect(requested).toEqual(['https://cdn.example.com/thumb.jpg']);
    expect(uploads).toEqual([]);
  });

  it('rifiuta un corpo oltre il tetto quando il content-length mente', async () => {
    serves({
      'https://cdn.example.com/big.jpg': {
        status: 200,
        type: 'image/jpeg',
        length: '120',
        body: OVER_ARCHIVE_CEILING
      }
    });

    const { path, uploads } = await archiveImage('https://cdn.example.com/big.jpg');

    expect(path).toBeNull();
    expect(uploads).toEqual([]);
  });

  it('rifiuta un corpo oltre il tetto anche quando il content-length manca', async () => {
    serves({
      'https://cdn.example.com/nolength.jpg': { status: 200, type: 'image/jpeg', body: OVER_ARCHIVE_CEILING }
    });

    const { path, uploads } = await archiveImage('https://cdn.example.com/nolength.jpg');

    expect(path).toBeNull();
    expect(uploads).toEqual([]);
  });

  it('smette di leggere appena supera il tetto, invece di tenere in memoria tutto il corpo', async () => {
    const CHUNK_BYTES = 256 * 1024;
    const SERVED_CHUNKS = 400; // 100MB, se qualcuno li chiedesse tutti.
    const pulled = servesChunked('https://cdn.example.com/flood.jpg', {
      type: 'image/jpeg',
      chunkBytes: CHUNK_BYTES,
      chunks: SERVED_CHUNKS
    });

    const { path, uploads } = await archiveImage('https://cdn.example.com/flood.jpg');

    expect(path).toBeNull();
    expect(uploads).toEqual([]);
    // Il tetto è 5MB: venti pezzi bastano a superarlo, e il ventunesimo è quello che lo dimostra.
    expect(pulled.count).toBeLessThan(SERVED_CHUNKS / 2);
  });
});

describe('archiveMarketMedia', () => {
  it('archivia il video e ne riporta peso e tipo', async () => {
    serves({ 'https://cdn.example.com/clip.mp4': { status: 200, type: 'video/mp4', body: PNG } });

    const { result, uploads } = await archiveMarket('https://cdn.example.com/clip.mp4');

    expect(result).toEqual({
      ok: true,
      media: { path: 'market/threads/threads_abc.mp4', bytes: PNG.byteLength, kind: 'video' }
    });
    expect(uploads).toHaveLength(1);
  });

  it('rifiuta un nome pubblico che il DNS risolve su un indirizzo privato', async () => {
    resolvesTo({ 'cdn.example.com': '127.0.0.1' });
    const { requested } = serves({});

    const { result, uploads } = await archiveMarket('https://cdn.example.com/clip.mp4');

    expect(result).toMatchObject({ ok: false, reason: 'blocked_host' });
    expect(requested).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it('rifiuta un redirect che entra in una rete privata, senza seguirlo', async () => {
    resolvesTo({ 'cdn.example.com': PUBLIC_ADDRESS, 'internal.example.com': '192.168.1.9' });
    const { requested } = serves({
      'https://cdn.example.com/clip.mp4': { status: 302, location: 'https://internal.example.com/secret' },
      'https://internal.example.com/secret': { status: 200, type: 'video/mp4', body: PNG }
    });

    const { result, uploads } = await archiveMarket('https://cdn.example.com/clip.mp4');

    expect(result).toMatchObject({ ok: false, reason: 'blocked_host' });
    expect(requested).toEqual(['https://cdn.example.com/clip.mp4']);
    expect(uploads).toEqual([]);
  });

  it('rifiuta un immagine oltre il suo tetto quando il content-length mente', async () => {
    serves({
      'https://cdn.example.com/big.jpg': {
        status: 200,
        type: 'image/jpeg',
        length: '120',
        body: OVER_MARKET_IMAGE_CEILING
      }
    });

    const { result, uploads } = await archiveMarket('https://cdn.example.com/big.jpg');

    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
    expect(uploads).toEqual([]);
  });

  it('rifiuta un immagine oltre il suo tetto anche quando il content-length manca', async () => {
    serves({
      'https://cdn.example.com/nolength.jpg': { status: 200, type: 'image/jpeg', body: OVER_MARKET_IMAGE_CEILING }
    });

    const { result, uploads } = await archiveMarket('https://cdn.example.com/nolength.jpg');

    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
    expect(uploads).toEqual([]);
  });

  it('accetta ancora http: le CDN delle piattaforme servono ancora link in chiaro', async () => {
    resolvesTo({ 'cdn.example.com': PUBLIC_ADDRESS });
    serves({ 'http://cdn.example.com/clip.mp4': { status: 200, type: 'video/mp4', body: PNG } });

    const { result, uploads } = await archiveMarket('http://cdn.example.com/clip.mp4');

    expect(result).toMatchObject({ ok: true });
    expect(uploads).toHaveLength(1);
  });
});
