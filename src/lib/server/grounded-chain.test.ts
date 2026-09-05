import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ordine della catena di grounding in groundedText(): Exa, poi Tavily. Né Google né DeepSeek sono
// nella catena. Google è uscito per il prezzo (~$0.07 a risposta contro $0.005-0.008) e qui nessuno
// misura CHI ha risposto — quando conta il motore si chiama groundedGemini. DeepSeek è uscito per
// un motivo diverso e più importante: lì la risposta la GENERA un modello DeepSeek, e ogni parola
// che il prodotto scrive passa dal gateway. Resta come sonda di citazioni in geo.ts, dove è il
// soggetto della misura e non il suo autore. Ogni provider è mockato: si controlla
// l'instradamento, non i provider.

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const calls: string[] = [];
const answers: Record<string, { text: string; citations: Array<{ uri: string; title: string }> }> = {
  exa: { text: '', citations: [] },
  tavily: { text: '', citations: [] }
};

vi.mock('$lib/server/exa', () => ({
  exaConfigured: () => true,
  exaGroundedAnswer: async () => {
    calls.push('exa');
    return answers.exa;
  }
}));
vi.mock('$lib/server/tavily', () => ({
  tavilyConfigured: () => true,
  tavilyGroundedAnswer: async () => {
    calls.push('tavily');
    return answers.tavily;
  }
}));
vi.mock('$lib/server/citation-probe', () => ({
  deepseekSearchConfigured: () => true,
  deepseekGroundedAnswer: async () => {
    calls.push('deepseek');
    return answers.deepseek;
  }
}));
vi.mock('$lib/server/ai-log', () => ({
  logAiCall: () => {},
  extractGeminiUsage: () => ({}),
  requireBrandContext: () => 'brand-1'
}));

const { groundedText } = await import('./research');

/** Client fasullo: se groundedText lo tocca, la chiamata a pagamento su Google è tornata. */
function googleSpy() {
  return {
    models: {
      generateContent: async () => {
        calls.push('google');
        return { text: 'google answer', candidates: [{ groundingMetadata: { groundingChunks: [] } }] };
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('groundedText provider order', () => {
  beforeEach(() => {
    calls.length = 0;
    answers.exa = { text: '', citations: [] };
    answers.tavily = { text: '', citations: [] };
  });

  it('answers on Exa and never touches Google', async () => {
    answers.exa = { text: 'exa answer', citations: [{ uri: 'https://e.dev', title: 'E' }] };
    const res = await groundedText(googleSpy(), 'question');
    expect(res.text).toBe('exa answer');
    expect(res.citations).toEqual([{ uri: 'https://e.dev', title: 'E' }]);
    expect(calls).toEqual(['exa']);
  });

  it('falls through to Tavily when Exa comes back empty', async () => {
    answers.tavily = { text: 'tavily answer', citations: [{ uri: 'https://t.dev', title: 'T' }] };
    const res = await groundedText(googleSpy(), 'question');
    expect(res.text).toBe('tavily answer');
    expect(calls).toEqual(['exa', 'tavily']);
  });

  it('non chiama DeepSeek: qui si genera, e generare passa dal gateway', async () => {
    answers.tavily = { text: 'tavily answer', citations: [] };
    await groundedText(googleSpy(), 'question');
    expect(calls).not.toContain('deepseek');
  });

  it('returns empty — never a Google call — when every provider is silent', async () => {
    const res = await groundedText(googleSpy(), 'question');
    expect(res).toEqual({ text: '', citations: [] });
    expect(calls).toEqual(['exa', 'tavily']);
    expect(calls).not.toContain('google');
  });
});
