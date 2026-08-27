import { describe, expect, it, vi, beforeEach } from 'vitest';

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

describe('aiStructured kie fallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('falls back to Gemini when kie returns an empty object', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: { GTM_PROVIDER: 'kie', KIE_API_KEY: 'test-key', GEMINI_API_KEY: 'test' }
    }));
    vi.doMock('$lib/server/kie', () => ({
      structuredKie: vi.fn().mockResolvedValue({}),
      textKie: vi.fn().mockResolvedValue('')
    }));
    vi.doMock('$lib/server/research', () => ({
      structuredGemini: vi.fn().mockResolvedValue({ plan: 'from-gemini' })
    }));

    const { structuredKie } = await import('./kie');
    const { structuredGemini } = await import('./research');
    const { aiStructured } = await import('./xiaomi');

    const ai = {} as import('@google/genai').GoogleGenAI;
    const result = await aiStructured<{ plan: string }>(
      ai,
      'prompt',
      { type: 'object', properties: { plan: { type: 'string' } } },
      'system',
      'test_tool'
    );

    expect(structuredKie).toHaveBeenCalled();
    expect(structuredGemini).toHaveBeenCalled();
    expect(result).toEqual({ plan: 'from-gemini' });
  });
});
