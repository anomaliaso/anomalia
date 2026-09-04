/**
 * Il crawler apre socket verso indirizzi che gli detta il materiale che sta leggendo: la pagina
 * dice dove sono le immagini, il redirect dice dove andare, il catalogo dice da dove leggere. La
 * guardia che aveva confrontava NOMI, e un nome pubblico il cui record DNS risponde 127.0.0.1 è
 * una stringa innocua: non c'è confronto di stringhe che possa vederlo.
 *
 * Qui si prova la sola cosa che conta — che il socket non si apra — su ognuna delle porte da cui
 * il package esce davvero.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { extractColorsFromImage, fetchPage, fetchShopifyProducts, loadPageHtml } from './crawl';

const PUBLIC_ADDRESS = '93.184.216.34';
const LOOPBACK = '127.0.0.1';
const METADATA = '169.254.169.254';

const REBIND = 'https://rebind.example.com';
const PUBLIC_SITE = 'https://example.com';

function resolvesTo(byHost: Record<string, string>) {
  vi.mocked(lookup).mockImplementation((async (host: string) => {
    const address = byHost[host];
    if (!address) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return [{ address, family: address.includes(':') ? 6 : 4 }];
  }) as never);
}

/** Ogni indirizzo risponde, così ciò che ferma la richiesta può essere solo la guardia. */
function servesEverything(redirects: Record<string, string> = {}) {
  const dialled: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = String(input);
      dialled.push(url);

      const location = redirects[url];
      if (location) return new Response(null, { status: 302, headers: { location } });

      return new Response('<html><body>' + 'x'.repeat(200) + '</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    })
  );

  return dialled;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('il crawler non dialoga un nome pubblico che risolve in rete privata', () => {
  it('fetchPage non apre il socket', async () => {
    resolvesTo({ 'rebind.example.com': LOOPBACK });
    const dialled = servesEverything();

    expect(await fetchPage(`${REBIND}/`)).toBe('');
    expect(dialled).toEqual([]);
  });

  it('fetchPage non segue un redirect che ci finisce dentro', async () => {
    resolvesTo({ 'example.com': PUBLIC_ADDRESS, 'rebind.example.com': METADATA });
    const dialled = servesEverything({ [`${PUBLIC_SITE}/`]: `${REBIND}/latest/meta-data/` });

    expect(await fetchPage(`${PUBLIC_SITE}/`)).toBe('');
    expect(dialled).toEqual([`${PUBLIC_SITE}/`]);
  });

  it('loadPageHtml non apre il socket', async () => {
    resolvesTo({ 'rebind.example.com': LOOPBACK });
    const dialled = servesEverything();

    expect(await loadPageHtml(`${REBIND}/`)).toBe('');
    expect(dialled).toEqual([]);
  });

  it('extractColorsFromImage non apre il socket', async () => {
    resolvesTo({ 'rebind.example.com': LOOPBACK });
    const dialled = servesEverything();

    expect(await extractColorsFromImage(`${REBIND}/logo.png`)).toEqual([]);
    expect(dialled).toEqual([]);
  });

  it('fetchShopifyProducts non apre il socket', async () => {
    resolvesTo({ 'rebind.example.com': LOOPBACK });
    const dialled = servesEverything();

    expect(await fetchShopifyProducts(`${REBIND}/`)).toEqual([]);
    expect(dialled).toEqual([]);
  });
});

/**
 * `lookup` restituisce i record VERBATIM, quindi un nome può consegnare un indirizzo in una di
 * queste forme senza che nessuno lo abbia scritto a mano. La tabella dei pattern era ferma alle
 * forme che si digitano.
 */
describe('le forme che un resolver può consegnare', () => {
  const REFUSED = {
    CGNAT: '100.64.0.1',
    'multicast/riservati': '239.255.255.250',
    'IPv4-mapped': '::ffff:127.0.0.1',
    'IPv4-compatible': '::169.254.169.254',
    '6to4': '2002:7f00:1::',
    NAT64: '64:ff9b::7f00:1'
  };

  for (const [shape, address] of Object.entries(REFUSED)) {
    it(`rifiuta ${shape} (${address})`, async () => {
      resolvesTo({ 'rebind.example.com': address });
      const dialled = servesEverything();

      expect(await fetchPage(`${REBIND}/`)).toBe('');
      expect(dialled).toEqual([]);
    });
  }

  it('basta un solo record privato fra due perché il nome sia rifiutato', async () => {
    vi.mocked(lookup).mockImplementation((async () => [
      { address: PUBLIC_ADDRESS, family: 4 },
      { address: LOOPBACK, family: 4 }
    ]) as never);
    const dialled = servesEverything();

    expect(await fetchPage(`${REBIND}/`)).toBe('');
    expect(dialled).toEqual([]);
  });
});

describe('il crawler continua a leggere i siti veri', () => {
  it('fetchPage legge un nome che risolve su un indirizzo pubblico', async () => {
    resolvesTo({ 'example.com': PUBLIC_ADDRESS });
    const dialled = servesEverything();

    expect(await fetchPage(`${PUBLIC_SITE}/`)).toContain('<html>');
    expect(dialled).toEqual([`${PUBLIC_SITE}/`]);
  });

  it('fetchPage segue un redirect verso un altro indirizzo pubblico', async () => {
    resolvesTo({ 'example.com': PUBLIC_ADDRESS, 'cdn.example.net': PUBLIC_ADDRESS });
    const dialled = servesEverything({ [`${PUBLIC_SITE}/`]: 'https://cdn.example.net/' });

    expect(await fetchPage(`${PUBLIC_SITE}/`)).toContain('<html>');
    expect(dialled).toEqual([`${PUBLIC_SITE}/`, 'https://cdn.example.net/']);
  });

  it('un nome che non risolve non si dialoga', async () => {
    resolvesTo({});
    const dialled = servesEverything();

    expect(await fetchPage('https://nowhere.example/')).toBe('');
    expect(dialled).toEqual([]);
  });
});
