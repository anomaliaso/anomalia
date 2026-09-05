import { describe, expect, it } from 'vitest';
import { DIAGNOSE_RADAR, GET_MARKET_FIELD, MARKET_FIELD_MAX } from './market';
import { BRAND_ENDPOINTS } from './index';

const MARKET = [GET_MARKET_FIELD, DIAGNOSE_RADAR];

describe('il contratto delle misure del mercato', () => {
  it('espone solo letture: guardare il campo non lo cambia', () => {
    for (const endpoint of MARKET) {
      expect(endpoint.method, endpoint.tool).toBe('GET');
      expect(endpoint.destructive, endpoint.tool).toBe(false);
    }
  });

  it('è registrato, o il tool MCP non nasce', () => {
    for (const endpoint of MARKET) {
      expect(BRAND_ENDPOINTS, endpoint.tool).toContain(endpoint);
    }
  });

  it('rifiuta un parametro che non dichiara invece di scartarlo in silenzio', () => {
    for (const endpoint of MARKET) {
      expect(endpoint.input.safeParse({ campo_che_non_esiste: 'x' }).success, endpoint.tool).toBe(false);
    }
  });

  it('la diagnosi del radar esce di casa, e lo dichiara', () => {
    expect(DIAGNOSE_RADAR.openWorld).toBe(true);
    expect(GET_MARKET_FIELD.openWorld).toBeUndefined();
  });

  it('get_market_field dichiara il tetto che la rotta applica in silenzio', () => {
    expect(GET_MARKET_FIELD.input.safeParse({ limit: MARKET_FIELD_MAX }).success).toBe(true);
    expect(GET_MARKET_FIELD.input.safeParse({ limit: MARKET_FIELD_MAX + 1 }).success).toBe(false);
    expect(GET_MARKET_FIELD.input.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('legge il limite dalla query string, dove arriva come stringa', () => {
    const parsed = GET_MARKET_FIELD.input.safeParse({ limit: '5' });
    expect(parsed.success && parsed.data).toEqual({ limit: 5 });
  });

  it('un campo mai osservato risponde comunque, a vuoto invece che con un errore', () => {
    expect(
      GET_MARKET_FIELD.output.safeParse({ topics: null, playbook: null, updatedAt: null, posts: [] }).success
    ).toBe(true);
  });

  it('un post del campo porta il suo teardown, e il teardown può mancare', () => {
    const post = {
      id: 'mp-1',
      platform: 'threads',
      url: 'https://threads.net/x',
      account_key: 'threads:tizio',
      content: 'un post',
      media_type: 'text',
      engagement: 420,
      published_at: '2026-09-01T08:00:00Z',
      query: 'crm agenzie',
      relevance: 0.7,
      discoveredAt: '2026-09-02T08:00:00Z',
      teardown: null
    };
    expect(GET_MARKET_FIELD.output.safeParse({ topics: null, playbook: null, updatedAt: null, posts: [post] }).success).toBe(true);

    const teardown = {
      market_post_id: 'mp-1',
      tone_of_voice: 'amico che ti avverte',
      communication: 'prima persona, frasi corte',
      format: 'lista numerata',
      hook_type: 'promessa di un errore da evitare',
      spread_strategy: ['chiama in causa una categoria'],
      ragebait: 4,
      ragebait_levers: ['hot take'],
      why_it_spread: 'dice una cosa che nessuno dice',
      transferable: ['aprire con il costo'],
      avoid: null
    };
    expect(
      GET_MARKET_FIELD.output.safeParse({ topics: null, playbook: null, updatedAt: null, posts: [{ ...post, teardown }] }).success
    ).toBe(true);
    expect(
      GET_MARKET_FIELD.output.safeParse({ topics: null, playbook: null, updatedAt: null, posts: [{ query: 'x', relevance: 1 }] }).success
    ).toBe(false);
  });

  it('una fonte del radar dice quanti item ha trovato, o perché non ne ha trovati', () => {
    const base = {
      enabled: true,
      plan: 'pro',
      proLeads: true,
      scrapecreatorsConfigured: true,
      platforms: { reddit: true },
      engagePlatforms: ['reddit'],
      note: 'x'
    };
    const found = { kind: 'rss', value: 'https://x.it/feed', active: true, allowedByPlan: true, enabled: true, platform: null, items: 3 };
    expect(DIAGNOSE_RADAR.output.safeParse({ ...base, sources: [found] }).success).toBe(true);
    expect(
      DIAGNOSE_RADAR.output.safeParse({ ...base, sources: [{ ...found, items: 0, skipped: 'source is off' }] }).success
    ).toBe(true);
    expect(
      DIAGNOSE_RADAR.output.safeParse({ ...base, sources: [{ ...found, items: 0, error: 'HTTP 503' }] }).success
    ).toBe(true);
    const { items: _omitted, ...senzaConto } = found;
    expect(DIAGNOSE_RADAR.output.safeParse({ ...base, sources: [senzaConto] }).success).toBe(false);
  });
});
