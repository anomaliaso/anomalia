import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_SUPABASE_URL: 'https://test.supabase.co' } }));

const STORAGE_ORIGIN = 'https://test.supabase.co';

import { zipPostMedia } from './download-post-media';

const SECRET = 'INTERNAL-ONLY-PAYLOAD';
const SECRET_PATH = '/latest/meta-data/iam/credentials';
const STORAGE_PATH = '/storage/v1/object/public/media/u/photo.jpg';
const REDIRECTING_PATH = '/storage/v1/object/public/media/u/moved.jpg';

let server: Server;
let origin: string;
let hits: string[] = [];

const realFetch = globalThis.fetch;

function resolvingStorageHostToLocalServer(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const target = url.origin === STORAGE_ORIGIN ? `${origin}${url.pathname}${url.search}` : String(input);
    return realFetch(target, init);
  }) as typeof fetch;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');

    if (req.url === SECRET_PATH) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(SECRET);
      return;
    }
    if (req.url === REDIRECTING_PATH) {
      res.writeHead(302, { location: `${origin}${SECRET_PATH}` });
      res.end();
      return;
    }
    if (req.url === STORAGE_PATH) {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end('PHOTO-BYTES');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  globalThis.fetch = resolvingStorageHostToLocalServer();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(media: { media_url?: string; media_urls?: string[] }) {
  return [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', platform: 'instagram', ...media }];
}

describe('zipPostMedia', () => {
  it('non recupera un media_url puntato al loopback', async () => {
    hits = [];
    const result = await zipPostMedia(post({ media_url: `${origin}${SECRET_PATH}` }));

    expect(hits).toEqual([]);
    expect(result).toMatchObject({ status: 404 });
  });

  it('non recupera un media_urls puntato al loopback', async () => {
    hits = [];
    const result = await zipPostMedia(post({ media_urls: [`${origin}${SECRET_PATH}`] }));

    expect(hits).toEqual([]);
    expect(result).toMatchObject({ status: 404 });
  });

  it('non segue un redirect dallo storage verso il loopback', async () => {
    hits = [];
    const result = await zipPostMedia(post({ media_url: `${STORAGE_ORIGIN}${REDIRECTING_PATH}` }));

    expect(hits).not.toContain(SECRET_PATH);
    expect('zip' in result && Buffer.from(result.zip).includes(SECRET)).toBe(false);
  });

  it('impacchetta un media dello storage', async () => {
    const result = await zipPostMedia(post({ media_url: `${STORAGE_ORIGIN}${STORAGE_PATH}` }));

    expect(result).toMatchObject({ count: 1 });
    expect('zip' in result && Buffer.from(result.zip).includes('PHOTO-BYTES')).toBe(true);
  });

  it('dice nello zip quali file ha saltato invece di consegnarne uno più magro in silenzio', async () => {
    const result = await zipPostMedia(
      post({ media_urls: [`${STORAGE_ORIGIN}${STORAGE_PATH}`, `${origin}${SECRET_PATH}`] })
    );

    const text = 'zip' in result ? Buffer.from(result.zip).toString('latin1') : '';
    expect(text).toContain('SKIPPED.txt');
    expect(text).toContain(SECRET_PATH);
  });
});
