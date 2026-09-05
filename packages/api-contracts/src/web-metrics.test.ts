import { describe, expect, it } from 'vitest';
import { GET_BACKLINKS, GET_GSC, GET_RANKS } from './web-metrics';
import { BRAND_ENDPOINTS } from './index';

const WEB_METRICS = [GET_GSC, GET_RANKS, GET_BACKLINKS];

describe('il contratto delle misure del web', () => {
  it('espone solo letture: un numero non si sposta passando da qui', () => {
    for (const endpoint of WEB_METRICS) {
      expect(endpoint.method, endpoint.tool).toBe('GET');
      expect(endpoint.destructive, endpoint.tool).toBe(false);
    }
  });

  it('è registrato, o il tool MCP non nasce', () => {
    for (const endpoint of WEB_METRICS) {
      expect(BRAND_ENDPOINTS, endpoint.tool).toContain(endpoint);
    }
  });

  it('non chiede niente oltre al brand, e rifiuta il resto', () => {
    for (const endpoint of WEB_METRICS) {
      expect(endpoint.input.safeParse({}).success, endpoint.tool).toBe(true);
      expect(endpoint.input.safeParse({ campo_che_non_esiste: 'x' }).success, endpoint.tool).toBe(false);
    }
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

  it('una keyword mai controllata resta una riga, con la posizione a null', () => {
    const tracked = {
      id: 'kw-1',
      keyword: 'crm agenzie',
      locale: 'it-IT',
      device: 'desktop',
      source: 'manual',
      active: true,
      position: null,
      prevPosition: null,
      delta: null,
      url: null,
      checkedAt: null,
      hasAiOverview: false
    };
    expect(GET_RANKS.output.safeParse({ keywords: [tracked] }).success).toBe(true);
    expect(GET_RANKS.output.safeParse({ keywords: [{ ...tracked, position: 3, prevPosition: 7, delta: 4 }] }).success).toBe(true);
    expect(GET_RANKS.output.safeParse({ keywords: [{ id: 'kw-1', keyword: 'x' }] }).success).toBe(false);
  });

  it('backlinks dice se la rete è sbloccata, non solo cosa contiene', () => {
    const empty = {
      enabled: false,
      planAllowed: false,
      unlocked: false,
      outgoing: [],
      incoming: [],
      opportunities: [],
      stats: { outgoingCount: 0, incomingCount: 0, openGive: 0, openReceive: 0 }
    };
    expect(GET_BACKLINKS.output.safeParse(empty).success).toBe(true);
    const { unlocked: _omitted, ...senzaVerdetto } = empty;
    expect(GET_BACKLINKS.output.safeParse(senzaVerdetto).success).toBe(false);
  });

  it('un piazzamento arriva anche senza il nome del partner, che è un arricchimento', () => {
    const placement = {
      id: 'p-1',
      sourceBrandId: 'b-1',
      sourceArticleId: null,
      targetBrandId: 'b-2',
      targetArticleId: null,
      targetUrl: 'https://altro.it/post',
      anchorText: null,
      status: 'live',
      createdAt: '2026-09-01T08:00:00Z'
    };
    const summary = {
      enabled: true,
      planAllowed: true,
      unlocked: true,
      outgoing: [placement],
      incoming: [{ ...placement, partnerName: 'Altro Brand' }],
      opportunities: [
        {
          id: 'o-1',
          direction: 'give',
          partnerBrandId: 'b-2',
          partnerBrandName: 'Altro Brand',
          partnerArticleId: null,
          partnerUrl: 'https://altro.it/post',
          partnerTitle: null,
          relevance: 0.8,
          suggestedAnchor: null,
          rationale: null,
          status: 'open',
          createdAt: '2026-09-01T08:00:00Z'
        }
      ],
      stats: { outgoingCount: 1, incomingCount: 1, openGive: 1, openReceive: 0 }
    };
    expect(GET_BACKLINKS.output.safeParse(summary).success).toBe(true);
    expect(
      GET_BACKLINKS.output.safeParse({
        ...summary,
        opportunities: [{ ...summary.opportunities[0], direction: 'sideways' }]
      }).success
    ).toBe(false);
  });
});
