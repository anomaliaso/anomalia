import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { importBrandMediaFromUrl } from './media-import';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const OVER_IMAGE_CEILING = Buffer.alloc(13_000_000, 1);

type Hop = { status: number; location?: string; type?: string; length?: string; body?: Buffer };

const LITERAL_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function resolvesTo(byHost: Record<string, string>) {
  vi.mocked(lookup).mockImplementation((async (host: string) => {
    // Come il resolver vero: un indirizzo scritto per esteso torna se stesso, quindi il rifiuto
    // deve venire da isPrivateAddress e non dal fatto che il nome non esiste.
    const address = LITERAL_IPV4.test(host) ? host : byHost[host];
    if (!address) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return [{ address, family: 4 }];
  }) as never);
}

function serves(hops: Record<string, Hop>): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = String(input);
      requested.push(url);
      const hop = hops[url];
      if (!hop) throw new Error(`ECONNREFUSED ${url}`);

      const headers = new Headers();
      if (hop.location) headers.set('location', hop.location);
      if (hop.type) headers.set('content-type', hop.type);
      if (hop.length) headers.set('content-length', hop.length);
      return new Response(hop.body ? new Uint8Array(hop.body) : null, { status: hop.status, headers });
    })
  );
  return requested;
}

function fakeSupabase(fails: { upload?: string; insert?: string } = {}) {
  const uploads: Array<{ path: string; contentType: string; bytes: number }> = [];
  const rows: Array<Record<string, unknown>> = [];

  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, body: Buffer, opts: { contentType: string }) => {
          if (fails.upload) return { error: { message: fails.upload } };
          uploads.push({ path, contentType: opts.contentType, bytes: body.byteLength });
          return { error: null };
        },
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}` }))
        })
      })
    },
    from: () => {
      const q = {
        insert(row: Record<string, unknown>) {
          rows.push(row);
          return q;
        },
        select: () => q,
        maybeSingle: async () =>
          fails.insert
            ? { data: null, error: { message: fails.insert } }
            : { data: { id: 'media-1', ...rows[rows.length - 1] }, error: null }
      };
      return q;
    }
  };

  return { client, uploads, rows };
}

function importFrom(url: string, fails?: { upload?: string; insert?: string }) {
  const supa = fakeSupabase(fails);
  return importBrandMediaFromUrl(supa.client as never, {
    brandId: 'brand-1',
    userId: 'user-1',
    url
  }).then((result) => ({ result, ...supa }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resolvesTo({ 'cdn.example.com': '93.184.216.34', 'evil.example.com': '93.184.216.34' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('importare un media da un URL pubblico', () => {
  it('deposita l immagine in libreria e ne registra la provenienza', async () => {
    serves({ 'https://cdn.example.com/a.png': { status: 200, type: 'image/png', body: PNG } });

    const { result, uploads, rows } = await importFrom('https://cdn.example.com/a.png');

    expect(result).toMatchObject({
      ok: true,
      media: {
        id: 'media-1',
        kind: 'image',
        mime: 'image/png',
        bytes: PNG.byteLength,
        source_url: 'https://cdn.example.com/a.png'
      }
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe('image/png');
    expect(uploads[0].path.startsWith('user-1/brand-1/media/')).toBe(true);
    expect(rows[0]).toMatchObject({
      brand_id: 'brand-1',
      user_id: 'user-1',
      kind: 'image',
      mime: 'image/png',
      source_ref: 'https://cdn.example.com/a.png'
    });
  });

  it('registra come provenienza l ultimo URL della catena, non quello di partenza', async () => {
    serves({
      'https://cdn.example.com/short': { status: 302, location: 'https://cdn.example.com/real.png' },
      'https://cdn.example.com/real.png': { status: 200, type: 'image/png', body: PNG }
    });

    const { result, rows } = await importFrom('https://cdn.example.com/short');

    expect(result).toMatchObject({ ok: true });
    expect(rows[0].source_ref).toBe('https://cdn.example.com/real.png');
  });

  it('rifiuta http: un import in chiaro è manomettibile da chiunque stia in mezzo', async () => {
    const requested = serves({});

    const { result, uploads } = await importFrom('http://cdn.example.com/a.png');

    expect(result).toEqual({ ok: false, error: 'not_https' });
    expect(requested).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it.each([
    ['il loopback scritto per esteso', 'https://127.0.0.1/a.png'],
    ['il metadata service della cloud', 'https://169.254.169.254/latest/meta-data'],
    ['una rete privata', 'https://10.0.0.5/a.png'],
    ['localhost', 'https://localhost/a.png']
  ])('rifiuta %s senza chiedere niente alla rete', async (_label, url) => {
    const requested = serves({});

    const { result, uploads } = await importFrom(url);

    expect(result).toEqual({ ok: false, error: 'blocked_host' });
    expect(requested).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it('rifiuta un host pubblico che il DNS risolve su un indirizzo privato', async () => {
    resolvesTo({ 'cdn.example.com': '169.254.169.254' });
    const requested = serves({});

    const { result } = await importFrom('https://cdn.example.com/a.png');

    expect(result).toEqual({ ok: false, error: 'blocked_host' });
    expect(requested).toEqual([]);
  });

  it('rifiuta un URL pubblico che redirige su una rete privata, senza seguirlo', async () => {
    resolvesTo({ 'cdn.example.com': '93.184.216.34', 'internal.example.com': '127.0.0.1' });
    const requested = serves({
      'https://cdn.example.com/a.png': { status: 302, location: 'https://internal.example.com/secret' },
      'https://internal.example.com/secret': { status: 200, type: 'image/png', body: PNG }
    });

    const { result, uploads } = await importFrom('https://cdn.example.com/a.png');

    expect(result).toEqual({ ok: false, error: 'blocked_host' });
    expect(requested).toEqual(['https://cdn.example.com/a.png']);
    expect(uploads).toEqual([]);
  });

  it('rifiuta un redirect che scende da https a http', async () => {
    const requested = serves({
      'https://cdn.example.com/a.png': { status: 302, location: 'http://cdn.example.com/a.png' },
      'http://cdn.example.com/a.png': { status: 200, type: 'image/png', body: PNG }
    });

    const { result } = await importFrom('https://cdn.example.com/a.png');

    expect(result).toEqual({ ok: false, error: 'blocked_host' });
    expect(requested).toEqual(['https://cdn.example.com/a.png']);
  });

  it.each([
    ['una pagina HTML', 'text/html'],
    ['un SVG, che è codice eseguibile travestito da immagine', 'image/svg+xml'],
    ['un tipo assente', ''],
    ['un PDF', 'application/pdf']
  ])('rifiuta %s: un tipo che non sappiamo pubblicare non entra in libreria', async (_label, type) => {
    serves({ 'https://cdn.example.com/a': { status: 200, type, body: PNG } });

    const { result, uploads, rows } = await importFrom('https://cdn.example.com/a');

    expect(result).toEqual({ ok: false, error: 'unsupported_type' });
    expect(uploads).toEqual([]);
    expect(rows).toEqual([]);
  });

  it('rifiuta subito un corpo che si dichiara oltre il tetto', async () => {
    serves({
      'https://cdn.example.com/big.png': {
        status: 200,
        type: 'image/png',
        length: '99000000',
        body: PNG
      }
    });

    const { result, uploads } = await importFrom('https://cdn.example.com/big.png');

    expect(result).toEqual({ ok: false, error: 'too_large' });
    expect(uploads).toEqual([]);
  });

  it('rifiuta un corpo oltre il tetto anche quando il content-length mente', async () => {
    serves({
      'https://cdn.example.com/liar.png': {
        status: 200,
        type: 'image/png',
        length: '120',
        body: OVER_IMAGE_CEILING
      }
    });

    const { result, uploads } = await importFrom('https://cdn.example.com/liar.png');

    expect(result).toEqual({ ok: false, error: 'too_large' });
    expect(uploads).toEqual([]);
  });

  it('rifiuta un corpo oltre il tetto anche quando il content-length manca', async () => {
    serves({
      'https://cdn.example.com/nolength.png': {
        status: 200,
        type: 'image/png',
        body: OVER_IMAGE_CEILING
      }
    });

    const { result, uploads } = await importFrom('https://cdn.example.com/nolength.png');

    expect(result).toEqual({ ok: false, error: 'too_large' });
    expect(uploads).toEqual([]);
  });

  it('un video regge un peso che a un immagine sarebbe negato', async () => {
    serves({
      'https://cdn.example.com/clip.mp4': {
        status: 200,
        type: 'video/mp4',
        body: OVER_IMAGE_CEILING
      }
    });

    const { result, rows } = await importFrom('https://cdn.example.com/clip.mp4');

    expect(result).toMatchObject({ ok: true, media: { kind: 'video', mime: 'video/mp4' } });
    expect(rows[0].kind).toBe('video');
  });

  it('rifiuta un corpo vuoto invece di depositare un file da zero byte', async () => {
    serves({ 'https://cdn.example.com/empty.png': { status: 200, type: 'image/png' } });

    const { result, uploads } = await importFrom('https://cdn.example.com/empty.png');

    expect(result).toEqual({ ok: false, error: 'empty' });
    expect(uploads).toEqual([]);
  });

  it.each([
    ['un 404', 404],
    ['un 500', 500]
  ])('rifiuta %s invece di salvare la pagina di errore', async (_label, status) => {
    serves({ 'https://cdn.example.com/gone.png': { status, type: 'image/png', body: PNG } });

    const { result, uploads } = await importFrom('https://cdn.example.com/gone.png');

    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(uploads).toEqual([]);
  });

  it('rifiuta un host che non esiste', async () => {
    serves({});

    const { result } = await importFrom('https://nowhere.example.com/a.png');

    expect(result).toEqual({ ok: false, error: 'blocked_host' });
  });

  it('non lascia una riga in libreria quando lo Storage rifiuta il file', async () => {
    serves({ 'https://cdn.example.com/a.png': { status: 200, type: 'image/png', body: PNG } });

    const { result, rows } = await importFrom('https://cdn.example.com/a.png', { upload: 'bucket full' });

    expect(result).toEqual({ ok: false, error: 'store_failed' });
    expect(rows).toEqual([]);
  });

  it('dice store_failed quando la riga non si scrive, invece di un successo finto', async () => {
    serves({ 'https://cdn.example.com/a.png': { status: 200, type: 'image/png', body: PNG } });

    const { result } = await importFrom('https://cdn.example.com/a.png', { insert: 'violates check constraint' });

    expect(result).toEqual({ ok: false, error: 'store_failed' });
  });
});
