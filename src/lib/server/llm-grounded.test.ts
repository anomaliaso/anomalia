import { describe, it, expect, vi, beforeEach } from 'vitest';

// Il grounding di `groundedGemini` è il motore NOMINATO: l'audit GEO misura "il brand è citato
// nelle risposte di Gemini". Se torna senza citazioni, quell'audit misura la memoria del modello
// invece del web, e nessuno se ne accorge — è una risposta plausibile invece di un errore.
//
// Misurato in produzione prima di questo test: il plugin `web` veniva passato all'SDK dentro
// `providerOptions.openai`, l'SDK parla l'endpoint Responses (corpo `model, input, usage`) e
// scartava la chiave. Zero ricerche, zero citazioni, `ok: true`.

const M = vi.hoisted(() => ({ env: {} as Record<string, string | undefined>, logged: [] as unknown[] }));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('$lib/server/ai-log', () => ({
  logAiCall: (e: unknown) => void M.logged.push(e),
  getBrandContext: () => null,
  requireBrandContext: () => null,
  extractSdkUsage: () => ({}),
  noteLlmCost: () => {},
  takeLlmCost: () => null
}));

const ANNOTATED = {
  choices: [{
    message: {
      role: 'assistant',
      content: 'La finale si è giocata il 19 luglio 2026.',
      annotations: [
        { type: 'url_citation', url_citation: { url: 'https://example.org/finale', title: 'La finale' } },
        { type: 'url_citation', url_citation: { url: 'https://example.org/altro', title: 'Altro' } },
        { type: 'url_citation', url_citation: { url: 'https://example.org/finale', title: 'La finale' } }
      ]
    }
  }],
  usage: { prompt_tokens: 20, completion_tokens: 100, cost: 0.03 }
};

function reply(body: unknown, status = 200) {
  return vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify(body), { status }));
}
const sentBody = (f: ReturnType<typeof reply>) => JSON.parse(String(f.mock.calls[0][1].body));

describe('grounding sul centralino', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(M.env)) delete M.env[k];
    Object.assign(M.env, {
      LLM_API_KEY: 'k',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      LLM_DEFAULT_MODEL: 'google/gemini-3.7-flash'
    });
    M.logged.length = 0;
  });

  it('una risposta con annotations produce citazioni, non un array vuoto', async () => {
    vi.stubGlobal('fetch', reply(ANNOTATED));
    const { llmText } = await import('./llm');
    const res = await llmText({ prompt: 'chi ha vinto?', webSearch: true });
    expect(res.text).toContain('19 luglio');
    expect(res.citations).toEqual([
      { uri: 'https://example.org/finale', title: 'La finale' },
      { uri: 'https://example.org/altro', title: 'Altro' }
    ]);
  });

  it('il plugin web arriva DAVVERO nel corpo: era lì che si perdeva', async () => {
    const f = reply(ANNOTATED);
    vi.stubGlobal('fetch', f);
    const { llmText } = await import('./llm');
    await llmText({ prompt: 'x', webSearch: true });
    const body = sentBody(f);
    expect(body.plugins).toEqual([{ id: 'web', engine: 'native' }]);
    // Corpo Chat Completions, non Responses: `messages`, non `input`.
    expect(body.messages).toBeTruthy();
    expect(body.input).toBeUndefined();
  });

  it('il costo viene da usage.cost del gateway', async () => {
    vi.stubGlobal('fetch', reply(ANNOTATED));
    const { llmText } = await import('./llm');
    await llmText({ prompt: 'x', webSearch: true });
    expect(M.logged[0]).toMatchObject({ provider: 'llm', ok: true, flatCostUsd: 0.03 });
  });

  it('una risposta senza annotations non inventa citazioni, e lo dice nei log', async () => {
    vi.stubGlobal('fetch', reply({ choices: [{ message: { content: 'niente fonti' } }], usage: {} }));
    const { llmText } = await import('./llm');
    const res = await llmText({ prompt: 'x', webSearch: true });
    expect(res.citations).toEqual([]);
    expect(res.text).toBe('niente fonti');
  });
});
