import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

/**
 * Il caso vero: una foto importata da un cliente, 7,4 MB, sopra il tetto della parte inline.
 * Prima tornava `null`, la lista a valle restava vuota e `refine_media` rispondeva
 * `source_not_found` — l'agente leggeva «non c'è» e RIGENERAVA da zero, che è il danno che quel
 * tool esiste per impedire.
 *
 * Il tetto non si alza: si ridimensiona prima di spedire. Il render esce comunque alla dimensione
 * del modello, quindi la piena risoluzione della sorgente non la vede nessuno.
 */
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

import { IMAGE_PART_MAX_BYTES, IMAGE_PART_MAX_EDGE } from '$lib/raster-image';
import { fetchImagePart, imagePartFor } from './brand-context';

const PUBLIC_ORIGIN = 'https://cdn.example.com';
const BIG_PHOTO_PATH = '/customer-photo.jpg';
const SMALL_PHOTO_PATH = '/thumb.jpg';
const BEYOND_CEILING_PATH = '/master.jpg';
const NOT_AN_IMAGE_PATH = '/brief.pdf';

/** Le misure del caso in produzione: 7,4 MB, appena sopra il tetto di 6 MB. */
const BIG_PHOTO = { width: 3400, height: 2550, quality: 92 };

const SMALL_PHOTO = { width: 800, height: 600, quality: 80 };

/** 24 MB: oltre il tetto di ciò che accettiamo di decodificare, quindi nemmeno scaricato. */
const BEYOND_CEILING = { width: 5600, height: 4200, quality: 95 };

let server: Server;
let origin: string;
let photos: Record<string, Buffer>;

const realFetch = globalThis.fetch;

function noisyJpeg(spec: { width: number; height: number; quality: number }): Promise<Buffer> {
  return sharp({
    create: {
      width: spec.width,
      height: spec.height,
      channels: 3,
      noise: { type: 'gaussian', mean: 128, sigma: 90 }
    }
  })
    .jpeg({ quality: spec.quality })
    .toBuffer();
}

function resolvingPublicHostToLocalServer(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const target = url.origin === PUBLIC_ORIGIN ? `${origin}${url.pathname}${url.search}` : String(input);
    return realFetch(target, init);
  }) as typeof fetch;
}

beforeAll(async () => {
  const [big, small, beyond] = await Promise.all([
    noisyJpeg(BIG_PHOTO),
    noisyJpeg(SMALL_PHOTO),
    noisyJpeg(BEYOND_CEILING)
  ]);
  photos = {
    [BIG_PHOTO_PATH]: big,
    [SMALL_PHOTO_PATH]: small,
    [BEYOND_CEILING_PATH]: beyond
  };

  server = createServer((req, res) => {
    const bytes = photos[req.url ?? ''];
    if (bytes) {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) });
      res.end(bytes);
      return;
    }
    if (req.url === NOT_AN_IMAGE_PATH) {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end('%PDF-1.4');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  globalThis.fetch = resolvingPublicHostToLocalServer();
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('una foto più grande del tetto della parte inline', () => {
  it('la sorgente pesa davvero più del tetto', () => {
    expect(photos[BIG_PHOTO_PATH].length).toBeGreaterThan(IMAGE_PART_MAX_BYTES);
  });

  it('arriva al modello ridimensionata, non sparisce', async () => {
    const part = await fetchImagePart(`${PUBLIC_ORIGIN}${BIG_PHOTO_PATH}`);

    expect(part).not.toBeNull();
    const bytes = Buffer.from(part!.inlineData.data, 'base64');
    expect(bytes.length).toBeLessThanOrEqual(IMAGE_PART_MAX_BYTES);

    const meta = await sharp(bytes).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(IMAGE_PART_MAX_EDGE);
  }, 60_000);

  it('resta la stessa foto: proporzioni invariate', async () => {
    const part = await fetchImagePart(`${PUBLIC_ORIGIN}${BIG_PHOTO_PATH}`);
    const meta = await sharp(Buffer.from(part!.inlineData.data, 'base64')).metadata();

    expect((meta.width ?? 0) / (meta.height ?? 1)).toBeCloseTo(BIG_PHOTO.width / BIG_PHOTO.height, 2);
  }, 60_000);

  it('una foto già sotto il tetto passa intatta, senza ricomprimerla', async () => {
    const part = await fetchImagePart(`${PUBLIC_ORIGIN}${SMALL_PHOTO_PATH}`);

    expect(Buffer.from(part!.inlineData.data, 'base64')).toEqual(photos[SMALL_PHOTO_PATH]);
  }, 60_000);
});

describe('il motivo per cui una parte manca non si butta via', () => {
  it('un file oltre il tetto di ciò che decodifichiamo dice too_large', async () => {
    const outcome = await imagePartFor(`${PUBLIC_ORIGIN}${BEYOND_CEILING_PATH}`);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('too_large');
  }, 60_000);

  it('un PDF non è un file troppo grande: dice not_an_image', async () => {
    const outcome = await imagePartFor(`${PUBLIC_ORIGIN}${NOT_AN_IMAGE_PATH}`);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('not_an_image');
  });

  it('un file che non esiste non è né troppo grande né non-immagine', async () => {
    const outcome = await imagePartFor(`${PUBLIC_ORIGIN}/assente.jpg`);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe('fetch_failed');
  });
});
