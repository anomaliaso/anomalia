import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ordine della catena di grounding in groundedText(): Exa, poi DeepSeek, poi Tavily. Google NON è
// più nella catena — costava ~$0.07 a risposta contro $0.005-0.008, e qui nessuno misura CHI ha
// risposto (quando conta il motore si chiama groundedGemini). Ogni provider è mockato: si controlla
// l'instradamento, non i provider.

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const calls: string[] = [];
const answers: Record<string, { text: string; citations: Array<{ uri: string; title: string }> }> = {
  deepseek: { text: '', citations: [] },
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
vi.mock('$lib/server/deepseek-search', () => ({
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
    answers.deepseek = { text: '', citations: [] };
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

  it('falls through to DeepSeek when Exa comes back empty', async () => {
    answers.deepseek = { text: 'deepseek answer', citations: [{ uri: 'https://d.dev', title: 'D' }] };
    const res = await groundedText(googleSpy(), 'question');
    expect(res.text).toBe('deepseek answer');
    expect(calls).toEqual(['exa', 'deepseek']);
  });

  it('keeps walking the chain in order: exa → deepseek → tavily', async () => {
    answers.tavily = { text: 'tavily answer', citations: [] };
    const res = await groundedText(googleSpy(), 'question');
    expect(res.text).toBe('tavily answer');
    expect(calls).toEqual(['exa', 'deepseek', 'tavily']);
  });

  it('returns empty — never a Google call — when every provider is silent', async () => {
    const res = await groundedText(googleSpy(), 'question');
    expect(res).toEqual({ text: '', citations: [] });
    expect(calls).toEqual(['exa', 'deepseek', 'tavily']);
    expect(calls).not.toContain('google');
  });
});
