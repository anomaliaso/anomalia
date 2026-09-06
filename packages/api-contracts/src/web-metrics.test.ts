import { describe, expect, it } from 'vitest';
import { GET_GSC } from './web-metrics';
import { BRAND_ENDPOINTS } from './index';

describe('il contratto delle misure del web', () => {
  it('espone solo letture: un numero non si sposta passando da qui', () => {
    expect(GET_GSC.method).toBe('GET');
    expect(GET_GSC.destructive).toBe(false);
  });

  it('è registrato, o il tool MCP non nasce', () => {
    expect(BRAND_ENDPOINTS).toContain(GET_GSC);
  });

  it('non chiede niente oltre al brand, e rifiuta il resto', () => {
    expect(GET_GSC.input.safeParse({}).success).toBe(true);
    expect(GET_GSC.input.safeParse({ campo_che_non_esiste: 'x' }).success).toBe(false);
  });

  it('gsc distingue "mai collegato" da "collegato e a zero"', () => {
    const disconnected = {
      connected: false,
      configured: true,
      siteUrl: null,
      syncedAt: null,
      lastError: null,
      clicks28d: 0,
      impressions28d: 0,
      topQueries: [],
      topPages: []
    };
    expect(GET_GSC.output.safeParse(disconnected).success).toBe(true);
    expect(GET_GSC.output.safeParse({ ...disconnected, connected: true, siteUrl: 'https://x.it' }).success).toBe(true);
    const { connected: _omitted, ...senzaStato } = disconnected;
    expect(GET_GSC.output.safeParse(senzaStato).success).toBe(false);
  });

  it('una query di gsc porta clic, impression e posizione media', () => {
    const row = { query: 'crm agenzie', clicks: 12, impressions: 340, position: 4.2 };
    expect(GET_GSC.output.safeParse({
      connected: true,
      configured: true,
      siteUrl: 'https://x.it',
      syncedAt: '2026-09-01T08:00:00Z',
      lastError: null,
      clicks28d: 12,
      impressions28d: 340,
      topQueries: [row],
      topPages: [{ page: 'https://x.it/a', clicks: 12, impressions: 340, position: 4.2 }]
    }).success).toBe(true);
    expect(GET_GSC.output.safeParse({
      connected: true,
      configured: true,
      siteUrl: null,
      syncedAt: null,
      lastError: null,
      clicks28d: 0,
      impressions28d: 0,
      topQueries: [{ query: 'crm agenzie', clicks: 12 }],
      topPages: []
    }).success).toBe(false);
  });
});
