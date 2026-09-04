import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }));
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test' } }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { assertPublicUrl, isPrivateAddress, safeFetchBytes } from './tool-guard';

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

  /**
   * IPv6 sa portarsi dentro un indirizzo IPv4 — mappato, 6to4, NAT64 — e quello che il kernel
   * chiama alla fine è l'IPv4 dentro, non il prefisso davanti. Leggere solo il prefisso dichiara
   * `::ffff:127.0.0.1` pubblico e apre una connessione sul loopback.
   */
  it('legge l IPv4 incapsulato in un IPv6, invece del prefisso che lo veste', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:192.168.1.1')).toBe(true);
    // La stessa cosa scritta in esadecimale, che è come il resolver la restituisce.
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('0:0:0:0:0:ffff:a9fe:a9fe')).toBe(true);
    // IPv4-compatible, deprecato ma ancora accettato da chi risolve.
    expect(isPrivateAddress('::127.0.0.1')).toBe(true);
    expect(isPrivateAddress('2002:7f00:1::')).toBe(true); // 6to4
    expect(isPrivateAddress('2002:a9fe:a9fe::')).toBe(true); // 6to4 sul metadata service
    expect(isPrivateAddress('64:ff9b::7f00:1')).toBe(true); // NAT64
    expect(isPrivateAddress('64:ff9b::127.0.0.1')).toBe(true);
  });

  it('un IPv4 pubblico incapsulato resta pubblico: la regola è quella dell IPv4, non il divieto del prefisso', () => {
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateAddress('::ffff:0808:0808')).toBe(false);
    expect(isPrivateAddress('2002:0808:0808::')).toBe(false);
    expect(isPrivateAddress('64:ff9b::8.8.8.8')).toBe(false);
  });
});

/**
 * La proprietà che conta davvero: il resolver restituisce i record AAAA così come sono, quindi un
 * nome pubblico con un AAAA `::ffff:127.0.0.1` arriva alla guardia in quella forma. Se il
 * classificatore lo chiama pubblico, la guardia apre la connessione al loopback.
 */
describe('assertPublicUrl davanti a un AAAA che incapsula un indirizzo privato', () => {
  const resolvesTo = (address: string, family: number) => {
    vi.mocked(lookup).mockImplementation((async () => [{ address, family }]) as never);
  };

  it.each([
    ['il loopback mappato', '::ffff:127.0.0.1'],
    ['il metadata service mappato', '::ffff:169.254.169.254'],
    ['una rete privata in 6to4', '2002:c0a8:101::'],
    ['il loopback via NAT64', '64:ff9b::7f00:1']
  ])('rifiuta un host il cui AAAA è %s', async (_label, address) => {
    resolvesTo(address, 6);

    await expect(assertPublicUrl(new URL('https://cdn.example.com/a.png'))).rejects.toThrow(
      /not reachable/i
    );
  });

  it('lascia passare un AAAA davvero pubblico', async () => {
    resolvesTo('2606:4700::1111', 6);

    await expect(assertPublicUrl(new URL('https://cdn.example.com/a.png'))).resolves.toBeUndefined();
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
