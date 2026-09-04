import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }));
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test' } }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { isPrivateAddress, safeFetchBytes } from './tool-guard';

describe('isPrivateAddress', () => {
  it('blocks every range an SSRF payload would aim at', () => {
    // The cloud metadata endpoint is the one that actually leaks credentials.
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('192.168.0.1')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('100.64.0.1')).toBe(true); // CGNAT
    expect(isPrivateAddress('0.0.0.0')).toBe(true);
    expect(isPrivateAddress('224.0.0.1')).toBe(true); // multicast
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
  });

  it('allows public addresses, including the ones adjacent to blocked ranges', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
    // 172.15 and 172.32 sit just outside the private /12 — a sloppy regex catches these.
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('192.169.0.1')).toBe(false);
    expect(isPrivateAddress('169.253.0.1')).toBe(false);
    expect(isPrivateAddress('100.63.0.1')).toBe(false);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });
});

/**
 * Lo schema ammesso è un PARAMETRO della guardia, non un `if` nel chiamante: chi importa da un
 * agente esterno pretende https su ogni hop, chi archivia una CDN di piattaforma accetta ancora
 * http. Due politiche, una sola guardia — e il redirect le deve rispettare entrambe.
 */
describe('lo schema ammesso da safeFetchBytes', () => {
  const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

  function servesRedirectToHttp() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) => {
        const url = String(input);
        if (url === 'https://cdn.example.com/a.png') {
          return new Response(null, { status: 302, headers: { location: 'http://cdn.example.com/a.png' } });
        }
        return new Response(new Uint8Array(PNG), { status: 200, headers: { 'content-type': 'image/png' } });
      })
    );
  }

  beforeEach(() => {
    vi.mocked(lookup).mockImplementation((async () => [{ address: '93.184.216.34', family: 4 }]) as never);
    servesRedirectToHttp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rifiuta un redirect che scende a http quando il chiamante chiede 'https-only'", async () => {
    await expect(
      safeFetchBytes('https://cdn.example.com/a.png', { maxBytes: 1_000_000, scheme: 'https-only' })
    ).rejects.toThrow(/https/i);
  });

  it('segue lo stesso redirect quando il chiamante accetta http', async () => {
    const res = await safeFetchBytes('https://cdn.example.com/a.png', { maxBytes: 1_000_000 });

    expect(res.url).toBe('http://cdn.example.com/a.png');
    expect(res.mime).toBe('image/png');
  });
});
