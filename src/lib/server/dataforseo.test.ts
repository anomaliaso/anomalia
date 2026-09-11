import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {
  DATAFORSEO_USERNAME: 'user',
  DATAFORSEO_PASSWORD: 'pass'
};
vi.mock('$env/dynamic/private', () => ({ env }));

const logAiCall = vi.fn();
vi.mock('$lib/server/ai-log', () => ({ logAiCall }));

const { declareUnavailable, fetchKeywordGap, fetchSearchPerformance } = await import('./dataforseo');
const { createDataForSeoTools } = await import('./dataforseo-tools');

/** The body DataForSEO really returns when the account balance is spent (captured 2026-09-11). */
const PAYMENT_REQUIRED = {
  status_code: 20000,
  status_message: 'Ok.',
  tasks: [{ status_code: 40200, status_message: 'Payment Required.', result: null }]
};

function answers(...responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(call++, responses.length - 1)];
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response;
  });
}

describe('quando DataForSEO rifiuta, chi legge lo sa', () => {
  beforeEach(() => {
    logAiCall.mockClear();
  });

  it('402: il risultato dichiara il rifiuto invece di sembrare «nessun gap trovato»', async () => {
    vi.stubGlobal('fetch', answers({ status: 402, body: PAYMENT_REQUIRED }));

    const result = await declareUnavailable(async () => ({
      gaps: await fetchKeywordGap('brand.com', 'rival.com')
    }));

    expect(result.gaps).toEqual([]);
    expect(result.unavailable).toBeTruthy();
    expect(result.unavailable).toContain('Payment Required');
  });

  it('una risposta buona non porta nessuna dichiarazione da leggere', async () => {
    vi.stubGlobal('fetch', answers({ status: 200, body: { tasks: [{ status_code: 20000, result: [{ items: [] }] }] } }));

    const result = await declareUnavailable(async () => ({
      gaps: await fetchKeywordGap('brand.com', 'rival.com')
    }));

    expect(result).not.toHaveProperty('unavailable');
  });

  it('il rifiuto sul task viaggia su HTTP 200: non può passare per «nessun dato»', async () => {
    vi.stubGlobal('fetch', answers({ status: 200, body: PAYMENT_REQUIRED }));

    const result = await declareUnavailable(async () => ({
      gaps: await fetchKeywordGap('brand.com', 'rival.com')
    }));

    expect(result.unavailable).toContain('Payment Required');
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('una risposta che cambia forma non passa per «nessun dato»', async () => {
    vi.stubGlobal('fetch', answers({ status: 200, body: { tasks: [] } }));

    const result = await declareUnavailable(async () => ({
      gaps: await fetchKeywordGap('brand.com', 'rival.com')
    }));

    expect(result.unavailable).toContain('unreadable response');
  });

  it('ai_calls porta il messaggio del fornitore, non solo lo status', async () => {
    vi.stubGlobal('fetch', answers({ status: 402, body: PAYMENT_REQUIRED }));

    await fetchKeywordGap('brand.com', 'rival.com').catch(() => []);

    expect(logAiCall).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining('Payment Required') })
    );
  });

  it('mezza risposta non diventa una diagnosi: senza overview nessun pannello a zero', async () => {
    vi.stubGlobal(
      'fetch',
      answers(
        { status: 402, body: PAYMENT_REQUIRED },
        { status: 200, body: { tasks: [{ status_code: 20000, result: [{ items: [{ keyword_data: { keyword: 'scarpe' } }] }] }] } }
      )
    );

    expect(await fetchSearchPerformance('brand.com')).toBeNull();
  });
});

/**
 * Il lettore vero è il modello che scrive l'analisi SEO del cliente. Se il tool gli passa una lista
 * vuota, lui scrive «non hai keyword»: è la risposta sbagliata, ed è indistinguibile da quella
 * giusta. Ogni tool del pacchetto deve dire che il fornitore non ha risposto.
 */
describe('il pacchetto tool dichiara il rifiuto a ogni strumento', () => {
  const tools = createDataForSeoTools({ defaultUrl: 'brand.com', allowHistory: true, maxCalls: 99 });

  beforeEach(() => {
    vi.stubGlobal('fetch', answers({ status: 402, body: PAYMENT_REQUIRED }));
  });

  const inputs: Record<string, unknown> = {
    dfs_domain_overview: {},
    dfs_search_performance: {},
    dfs_keyword_metrics: { keywords: ['scarpe'] },
    dfs_keyword_suggestions: { seed: 'scarpe' },
    dfs_keyword_gap: { competitorUrl: 'rival.com' },
    dfs_serp: { keyword: 'scarpe' },
    dfs_backlinks: {},
    dfs_traffic_history: {},
    dfs_backlink_history: {}
  };

  for (const [key, input] of Object.entries(inputs)) {
    it(`${key} non risponde «nessun dato» quando il dato è stato rifiutato`, async () => {
      const result = await tools[key as keyof typeof tools].execute!(input as never, {} as never);
      expect(result, key).toHaveProperty('unavailable');
      expect(String((result as { unavailable: string }).unavailable), key).toContain('Payment Required');
    });
  }
});
