import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// GEMINI_TRANSPORT=kie fa uscire lo stesso Gemini Flash dal passthrough di kie.ai invece che
// dall'API di Google. Qui si difendono le tre cose che rendono la migrazione reversibile senza
// danni: il client giusto, le quattro superfici che NON devono spostarsi, e la fatturazione che
// non prezza mai una chiamata kie a listino Google.

const M = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));

const HERE = dirname(fileURLToPath(import.meta.url));

function setEnv(vars: Record<string, string | undefined>) {
  for (const k of Object.keys(M.env)) delete M.env[k];
  Object.assign(M.env, vars);
}

const KIE_ENV = { KIE_API_KEY: 'kie-test-key', GEMINI_API_KEY: 'google-test-key', GEMINI_TRANSPORT: 'kie' };

describe('lo scambio di trasporto', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv({});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('col default su openrouter il client NON e` quello di kie', async () => {
    setEnv({ OPENROUTER_API_KEY: 'o', KIE_API_KEY: 'kie-test-key' });
    const { geminiTransport, makeGenaiClient, isKieTransport, flashModelFor, geminiFlash } = await import('./gemini');
    // `geminiTransport()` risponde a una domanda sola: serve il passthrough di kie? Col testo su
    // openrouter no, e il client Google che torna e` ormai il parametro `ai` che i chiamanti
    // ignorano (`_ai` in structuredGemini/groundedGemini).
    expect(geminiTransport()).toBe('google');
    const ai = makeGenaiClient();
    expect(isKieTransport(ai)).toBe(false);
    expect(flashModelFor(ai)).toBe(geminiFlash());
  });

  it('senza KIE_API_KEY la rotta resta kie e lo dice: Google non e` piu` una rete', async () => {
    // Prima si ripiegava su Google. Google non e` piu` un endpoint, quindi l'unico ripiego e` kie
    // e una chiave mancante diventa un errore di chiave, non una deviazione silenziosa altrove.
    setEnv({ GEMINI_TRANSPORT: 'kie' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { geminiTransport } = await import('./gemini');
    expect(geminiTransport()).toBe('kie');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('su kie il client parla con api.kie.ai in Bearer, e manda l’id modello con i trattini', async () => {
    setEnv(KIE_ENV);
    const { makeGenaiClient, isKieTransport, flashModelFor, geminiFlash, kieFlashId } = await import('./gemini');
    const ai = makeGenaiClient();
    expect(isKieTransport(ai)).toBe(true);
    expect(flashModelFor(ai)).toBe(kieFlashId(geminiFlash()));
    expect(flashModelFor(ai)).toMatch(/^gemini-\d+-\d+-flash$/);

    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries())
      });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
    await ai.models.generateContent({
      model: flashModelFor(ai),
      contents: [{ role: 'user', parts: [{ text: 'ciao' }] }]
    });

    expect(seen).toHaveLength(1);
    // /v1 e non /v1beta: con la versione di default il passthrough risponde 404.
    expect(seen[0].url).toContain('https://api.kie.ai/gemini/v1/models/');
    expect(seen[0].url).toContain(':generateContent');
    expect(seen[0].headers.authorization).toBe('Bearer kie-test-key');
  });

  it('googleGenaiClient ignora GEMINI_TRANSPORT (è la porta delle superfici bloccate)', async () => {
    setEnv(KIE_ENV);
    const { googleGenaiClient, isKieTransport, flashModelFor, geminiFlash } = await import('./gemini');
    const ai = googleGenaiClient();
    expect(isKieTransport(ai)).toBe(false);
    expect(flashModelFor(ai)).toBe(geminiFlash());
  });
});

describe('le superfici sul centralino (non lo SDK Google)', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv({});
  });

  it('1. i media dentro i risultati dei tool: su kie il clip è rifiutato, non degradato', async () => {
    setEnv({ OPENROUTER_API_KEY: 'o' });
    const google = await import('./motion-video/reference-tools');
    expect(google.supportsClipInToolResult('gemini-3.7-flash')).toBe(true);
    // Nota: l'id che vuole kie passerebbe la vecchia regex — è esattamente il caso da fermare.
    expect(google.supportsClipInToolResult('gemini-3-7-flash')).toBe(true);

    vi.resetModules();
    setEnv(KIE_ENV);
    const kie = await import('./motion-video/reference-tools');
    expect(kie.supportsClipInToolResult('gemini-3.7-flash')).toBe(false);
    expect(kie.supportsClipInToolResult('gemini-3-7-flash')).toBe(false);
  });

  it('2. i giudici video passano dal centralino, non da googleGenaiClient', () => {
    const judges = ['motion-references.ts'];
    for (const f of judges) {
      const src = readFileSync(join(HERE, f), 'utf8');
      expect(src, f).not.toContain('googleGenaiClient(');
      expect(src, f).toMatch(/llmStructured|llmText|llmVideoReviewerModel/);
    }
  });

  it('3. la chat parla col centralino (llmLanguageModel / LLM_API_KEY), non con lo SDK Google', () => {
    const chat = readFileSync(join(HERE, 'chat/model.ts'), 'utf8');
    const llm = readFileSync(join(HERE, 'llm.ts'), 'utf8');
    expect(chat).not.toContain('env.GEMINI_TRANSPORT');
    expect(chat).not.toContain('makeGenaiClient');
    expect(chat).not.toContain('createGoogleGenerativeAI');
    expect(chat).toContain('llmLanguageModel');
    expect(chat).toContain('llmConfigured');
    // La chiave del loop lingua è LLM_API_KEY, letta in llm.ts.
    expect(llm).toContain('LLM_API_KEY');
  });

  it('4. Google Search nativo solo per GEO via llmText webSearch, non in chat', () => {
    const chat = readFileSync(join(HERE, 'chat/model.ts'), 'utf8');
    const research = readFileSync(join(HERE, 'research.ts'), 'utf8');
    const geo = readFileSync(join(HERE, 'geo.ts'), 'utf8');
    const llm = readFileSync(join(HERE, 'llm.ts'), 'utf8');
    expect(chat).not.toContain('googleSearch');
    expect(chat).not.toContain('webSearch');
    expect(research).toContain('webSearch: true');
    expect(research).toContain('llmGeminiSearchModel');
    expect(research).not.toContain('tools: [{ googleSearch');
    expect(geo).toContain('groundedGemini');
    expect(llm).toContain("engine: 'native'");
  });
});

describe('la fatturazione di una chiamata passata da kie', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv({ GEMINI_API_KEY: 'g' });
  });

  it('non prezza mai a listino Google: 16 volte il costo reale, e senza errori', async () => {
    const { computeCostUsd } = await import('./ai-log');
    const { GEMINI_FLASH, kieFlashId } = await import('./gemini');
    const usage = { ms: 0, ok: true, inputTokens: 100_000, outputTokens: 10_000, thinkingTokens: 20_000 };
    const google = computeCostUsd({ label: 'x', provider: 'gemini', model: GEMINI_FLASH, ...usage });
    const kie = computeCostUsd({ label: 'x', provider: 'gemini', model: kieFlashId(GEMINI_FLASH), ...usage });
    expect(google).toBeCloseTo((100_000 * 1.5 + 30_000 * 7.5) / 1e6, 6);
    expect(kie).toBeCloseTo((100_000 * 0.225 + 30_000 * 1.125) / 1e6, 6);
    expect(kie! * 6).toBeLessThan(google!);
  });

  it('kie non ha il tier di cache: i token ripetuti costano pieni (e più che su Google)', async () => {
    const { computeCostUsd } = await import('./ai-log');
    const { GEMINI_FLASH, kieFlashId } = await import('./gemini');
    const cached = { ms: 0, ok: true, inputTokens: 100_000, cachedTokens: 100_000, outputTokens: 0 };
    const google = computeCostUsd({ label: 'x', provider: 'gemini', model: GEMINI_FLASH, ...cached })!;
    const kie = computeCostUsd({ label: 'x', provider: 'gemini', model: kieFlashId(GEMINI_FLASH), ...cached })!;
    expect(kie).toBeGreaterThan(google);
  });

  it('un id kie senza tariffa vale null — un buco che si interroga, non un numero sbagliato', async () => {
    const { computeCostUsd } = await import('./ai-log');
    const cost = computeCostUsd({
      label: 'x', provider: 'gemini', model: 'gemini-9-9-flash', ms: 0, ok: true,
      inputTokens: 1000, outputTokens: 1000
    });
    expect(cost).toBeNull();
  });

  it('legge i thinking token anche quando kie li chiama thinkingTokenCount', async () => {
    const { extractGeminiUsage } = await import('./ai-log');
    const kie = extractGeminiUsage({
      usageMetadata: { promptTokenCount: 13, candidatesTokenCount: 15, thinkingTokenCount: 333, totalTokenCount: 361 }
    });
    expect(kie?.thinkingTokens).toBe(333);
    const google = extractGeminiUsage({
      usageMetadata: { promptTokenCount: 13, candidatesTokenCount: 15, thoughtsTokenCount: 333 }
    });
    expect(google?.thinkingTokens).toBe(333);
  });

  it('i crediti kie del turno di chat arrivano fino alla riga di log', async () => {
    const inserted: Record<string, unknown>[] = [];
    vi.doMock('$lib/server/supabase-admin', () => ({
      createAdminClient: () => ({ from: () => ({ insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; } }) })
    }));
    vi.resetModules();
    const log = await import('./ai-log');
    await log.withBrandContext('brand-1', async () => {
      log.noteKieCredits(0.42);
      log.logAiCall({ label: 'chat', provider: 'kie', model: 'grok-4-6', ms: 10, ok: true, inputTokens: 100, outputTokens: 10 });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(inserted[0]?.provider_credits).toBe(0.42);
    vi.doUnmock('$lib/server/supabase-admin');
  });
});

describe('la rete di sicurezza sullo structured output', () => {
  it('aiStructured passa da llmStructured sul centralino, non dallo SDK Google', () => {
    const src = readFileSync(join(HERE, 'xiaomi.ts'), 'utf8');
    expect(src).toContain('llmStructured');
    expect(src).not.toContain('createGoogleGenerativeAI');
    expect(src).toContain('falling back to the LLM gateway');
  });
});
