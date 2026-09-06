import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_SUPABASE_URL: 'https://example.supabase.co' } }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) =>
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
      ? [{ address: host, family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }]
  )
}));

import { fetchImagePart } from './brand-context';

const PUBLIC_ORIGIN = 'https://cdn.example.com';
const SECRET = 'INTERNAL-ONLY-PAYLOAD';
const SECRET_PATH = '/latest/meta-data/iam/credentials';
const IMAGE_PATH = '/photo.jpg';
const REDIRECTING_PATH = '/moved.jpg';

let server: Server;
let origin: string;
let hits: string[] = [];

const realFetch = globalThis.fetch;

function resolvingPublicHostToLocalServer(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const target = url.origin === PUBLIC_ORIGIN ? `${origin}${url.pathname}${url.search}` : String(input);
    return realFetch(target, init);
  }) as typeof fetch;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');

    if (req.url === SECRET_PATH) {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(SECRET);
      return;
    }
    if (req.url === REDIRECTING_PATH) {
      res.writeHead(302, { location: `${origin}${SECRET_PATH}` });
      res.end();
      return;
    }
    if (req.url === IMAGE_PATH) {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end('REAL-PHOTO-BYTES');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  globalThis.fetch = resolvingPublicHostToLocalServer();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('fetchImagePart', () => {
  it('non apre un socket verso il loopback', async () => {
    hits = [];
    const part = await fetchImagePart(`${origin}${SECRET_PATH}`);

    expect(hits).toEqual([]);
    expect(part).toBeNull();
  });

  it('non segue un redirect da un host pubblico verso il loopback', async () => {
    hits = [];
    const part = await fetchImagePart(`${PUBLIC_ORIGIN}${REDIRECTING_PATH}`);

    expect(hits).not.toContain(SECRET_PATH);
    expect(part).toBeNull();
  });

  it('continua a leggere una miniatura su una CDN pubblica', async () => {
    hits = [];
    const part = await fetchImagePart(`${PUBLIC_ORIGIN}${IMAGE_PATH}`);

    expect(part?.inlineData.mimeType).toBe('image/jpeg');
    expect(Buffer.from(part!.inlineData.data, 'base64').toString()).toBe('REAL-PHOTO-BYTES');
  });
});
