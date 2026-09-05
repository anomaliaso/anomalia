import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Live-shaped kie Responses API payload (verified 2026-07-29).
const LIVE_KIE_RESPONSE = {
  status: 'completed',
  object: 'response',
  model: 'grok-4.5',
  credits_consumed: 0.03,
  usage: {
    input_tokens: 259,
    output_tokens: 5,
    total_tokens: 264,
    output_tokens_details: { reasoning_tokens: 0 }
  },
  output: [
    {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: '{"answer":42}' }]
    }
  ]
};

describe('extractKieUsage', () => {
  it('maps credits_consumed to flat USD at $5/1000 credits', async () => {
    const { extractKieUsage, KIE_CREDIT_USD } = await import('./kie');
    expect(KIE_CREDIT_USD).toBe(0.005);
    const usage = extractKieUsage(LIVE_KIE_RESPONSE);
    expect(usage).toMatchObject({ inputTokens: 259, outputTokens: 5, providerCredits: 0.03, flatCostUsd: 0.00015 });
  });
});

describe('extractKieText', () => {
  it('reads output_text from the Responses API output array', async () => {
    const { extractKieText } = await import('./kie');
    expect(extractKieText(LIVE_KIE_RESPONSE)).toBe('{"answer":42}');
    expect(extractKieText({ code: 500, msg: 'fail' })).toBe('');
  });
});

describe('aiStructured: ripiego dal secondario sul gateway LLM', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Il ripiego di kie NON è più Gemini via SDK Google: è il gateway OpenAI-compatibile
   * (`llmStructured`). Per questo la chiave e l'id default del gateway vanno stubbati, e non si
   * mocca `$lib/server/llm`: la prova del comportamento vero è che parte una fetch verso
   * `<LLM_BASE_URL>/responses` (l'SDK usa l'endpoint Responses) con l'id `LLM_DEFAULT_MODEL`.
   */
  const GATEWAY_RESPONSE = {
    id: 'resp-test',
    object: 'response',
    status: 'completed',
    model: 'google/gemini-2.5-flash',
    output: [
      {
        type: 'message',
        id: 'msg-test',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '{"plan":"from-gateway"}', annotations: [] }]
      }
    ],
    usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 }
  };

  it('falls back to the LLM gateway when kie returns an empty object', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(GATEWAY_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchSpy);
    vi.doMock('$env/dynamic/private', () => ({
      env: {
        // KIE_API_KEY serve a route('text') per accettare GTM_PROVIDER=kie come endpoint reale.
        GTM_PROVIDER: 'kie',
        KIE_API_KEY: 'test-key',
        // Il gateway è la rete di conformità: senza chiave/default la ripartenza muore su llm_unconfigured.
        LLM_API_KEY: 'llm-key',
        LLM_DEFAULT_MODEL: 'google/gemini-2.5-flash',
        LLM_BASE_URL: 'http://gateway.local/v1'
      }
    }));
    vi.doMock('$lib/server/kie', () => ({
      structuredKie: vi.fn().mockResolvedValue({}),
      textKie: vi.fn().mockResolvedValue('')
    }));

    const { structuredKie } = await import('./kie');
    const { aiStructured } = await import('./ai-text');

    const result = await aiStructured<{ plan: string }>(
      'prompt',
      { type: 'object', properties: { plan: { type: 'string' } } },
      'system',
      'test_tool'
    );

    expect(structuredKie).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string | URL, RequestInit];
    expect(String(url)).toBe('http://gateway.local/v1/responses');
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('authorization')).toBe('Bearer llm-key');
    expect(JSON.parse(String(init.body)).model).toBe('google/gemini-2.5-flash');
    expect(result).toEqual({ plan: 'from-gateway' });
  });
});
