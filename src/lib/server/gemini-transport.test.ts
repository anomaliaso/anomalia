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

  it('senza GEMINI_TRANSPORT resta su Google', async () => {
    setEnv({ GEMINI_API_KEY: 'google-test-key', KIE_API_KEY: 'kie-test-key' });
    const { geminiTransport, makeGenaiClient, isKieTransport, flashModelFor, geminiFlash } = await import('./gemini');
    expect(geminiTransport()).toBe('google');
    const ai = makeGenaiClient();
    expect(isKieTransport(ai)).toBe(false);
    expect(flashModelFor(ai)).toBe(geminiFlash());
  });

  it('senza KIE_API_KEY non si sposta niente, anche se l’env dice kie', async () => {
    setEnv({ GEMINI_API_KEY: 'google-test-key', GEMINI_TRANSPORT: 'kie' });
    const { geminiTransport, makeGenaiClient, isKieTransport } = await import('./gemini');
    expect(geminiTransport()).toBe('google');
    expect(isKieTransport(makeGenaiClient())).toBe(false);
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

describe('le quattro superfici che restano su Google', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv({});
  });

  it('1. i media dentro i risultati dei tool: su kie il clip è rifiutato, non degradato', async () => {
    setEnv({ GEMINI_API_KEY: 'g' });
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

  it('2. i giudici video costruiscono il client con googleGenaiClient(), non con quello condiviso', () => {
    const judges = [
      'video-review.ts',
      'motion-references.ts',
      'motion-video/reference-fidelity.ts',
      'motion-video/craft-review.ts'
    ];
    for (const f of judges) {
      const src = readFileSync(join(HERE, f), 'utf8');
      // Passano fps: 4 apposta, e kie ignora videoMetadata.fps (388 token di prompt contro 1627).
      expect(src, f).toContain('fps: 4');
      expect(src, f).toContain('googleGenaiClient()');
      expect(src, f).not.toContain('genaiClient()');
    }
  });

  it('3. la chat non ha un interruttore di trasporto da sbagliare', async () => {
    const src = readFileSync(join(HERE, 'chat/model.ts'), 'utf8');
    // 79.6s al primo token contro 4.7s: il trasporto kie non deve nemmeno essere leggibile da qui.
    expect(src).not.toContain('env.GEMINI_TRANSPORT');
    expect(src).not.toContain('makeGenaiClient');
    expect(src).toContain('createGoogleGenerativeAI');
  });

  it('4. il grounding con citazioni scavalca il client kie e chiama Google', async () => {
    setEnv(KIE_ENV);
    vi.doMock('$lib/server/ai-log', () => ({
      logAiCall: vi.fn(),
      extractGeminiUsage: () => ({}),
      requireBrandContext: () => 'brand-1'
    }));
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: 'risposta' }] },
              groundingMetadata: { groundingChunks: [{ web: { uri: 'https://a.dev', title: 'A' } }], webSearchQueries: ['q'] }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    const { makeGenaiClient } = await import('./gemini');
    const { groundedGemini } = await import('./research');
    const res = await groundedGemini(makeGenaiClient(), 'domanda');
    expect(res.citations).toEqual([{ uri: 'https://a.dev', title: 'A' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('kie.ai');
    expect(calls[0]).toContain('generativelanguage.googleapis.com');
    vi.unstubAllGlobals();
    vi.doUnmock('$lib/server/ai-log');
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
  beforeEach(() => {
    vi.resetModules();
    setEnv(KIE_ENV);
  });

  it('su kie una risposta non conforme viene ritentata una volta su Google', async () => {
    const structuredGemini = vi.fn();
    vi.doMock('$lib/server/research', () => ({ structuredGemini }));
    vi.doMock('$lib/server/ai-log', () => ({
      logAiCall: vi.fn(),
      extractXiaomiUsage: () => ({}),
      extractGeminiUsage: () => ({}),
      requireBrandContext: () => 'brand-1'
    }));
    const { makeGenaiClient, isKieTransport } = await import('./gemini');
    const { aiStructured, PIN_GEMINI } = await import('./xiaomi');
    const SCHEMA = { type: 'object', properties: { plan: { type: 'string' } }, required: ['plan'] };

    // kie tronca: finishReason STOP, parts vuoto, res.text undefined → il chiamante vede {}.
    structuredGemini.mockResolvedValueOnce({}).mockResolvedValueOnce({ plan: 'ok' });
    const kieClient = makeGenaiClient();
    const out = await aiStructured(kieClient, 'prompt', SCHEMA, undefined, 'return_plan', { brandId: 'b', ...PIN_GEMINI });

    expect(out).toEqual({ plan: 'ok' });
    expect(structuredGemini).toHaveBeenCalledTimes(2);
    expect(isKieTransport(structuredGemini.mock.calls[0][0])).toBe(true);
    expect(isKieTransport(structuredGemini.mock.calls[1][0])).toBe(false);
    vi.doUnmock('$lib/server/research');
    vi.doUnmock('$lib/server/ai-log');
  });

  it('su Google non ritenta niente: una chiamata sola, come prima', async () => {
    setEnv({ GEMINI_API_KEY: 'g' });
    const structuredGemini = vi.fn().mockResolvedValue({});
    vi.doMock('$lib/server/research', () => ({ structuredGemini }));
    vi.doMock('$lib/server/ai-log', () => ({
      logAiCall: vi.fn(),
      extractXiaomiUsage: () => ({}),
      extractGeminiUsage: () => ({}),
      requireBrandContext: () => 'brand-1'
    }));
    const { makeGenaiClient } = await import('./gemini');
    const { aiStructured, PIN_GEMINI } = await import('./xiaomi');
    const SCHEMA = { type: 'object', properties: { plan: { type: 'string' } }, required: ['plan'] };
    const out = await aiStructured(makeGenaiClient(), 'prompt', SCHEMA, undefined, 'return_plan', { brandId: 'b', ...PIN_GEMINI });
    expect(out).toEqual({});
    expect(structuredGemini).toHaveBeenCalledTimes(1);
    vi.doUnmock('$lib/server/research');
    vi.doUnmock('$lib/server/ai-log');
  });
});
