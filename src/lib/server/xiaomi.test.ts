import { describe, it, expect, vi, beforeEach } from 'vitest';
import { satisfiesSchema } from './xiaomi';

// Il secondario (MiMo via tool calling, Grok via kie) restituisce JSON valido ma NON impone lo
// schema al modo Google. Questa guardia è ciò che impedisce a un oggetto parzialmente riempito di
// arrivare a un chiamante che dà per buono il contratto — e se non regge, il ripiego va al gateway.
describe('satisfiesSchema (guardia di conformità sul secondario)', () => {
  const schema = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      items: { type: 'array', items: { type: 'string' } },
      meta: { type: 'object' }
    },
    required: ['summary', 'items']
  };

  it('accepts a complete object', () => {
    expect(satisfiesSchema({ summary: 'x', items: ['a'] }, schema)).toBe(true);
  });

  it('accepts an empty array for a required array field', () => {
    expect(satisfiesSchema({ summary: 'x', items: [] }, schema)).toBe(true);
  });

  it('rejects a missing required key', () => {
    expect(satisfiesSchema({ summary: 'x' }, schema)).toBe(false);
  });

  it('rejects null in a required key', () => {
    expect(satisfiesSchema({ summary: 'x', items: null }, schema)).toBe(false);
  });

  it('rejects a required array that came back as a string', () => {
    expect(satisfiesSchema({ summary: 'x', items: 'a, b' }, schema)).toBe(false);
  });

  it('rejects {} and null', () => {
    expect(satisfiesSchema({}, schema)).toBe(false);
    expect(satisfiesSchema(null, schema)).toBe(false);
  });

  it('handles array-root schemas', () => {
    expect(satisfiesSchema([1, 2], { type: 'array' })).toBe(true);
    expect(satisfiesSchema({ a: 1 }, { type: 'array' })).toBe(false);
  });

  it('accepts any non-empty object when the schema lists no required keys', () => {
    expect(satisfiesSchema({ a: 1 }, { type: 'object', properties: {} })).toBe(true);
  });
});

/**
 * IL LAVORO STRUTTURATO DI SFONDO VA SUL GATEWAY LLM (OpenAI-compatibile).
 *
 * Qui c'era la suite che difendeva la deviazione su DeepSeek, poi quella che difendeva Gemini Flash;
 * entrambe difendevano un TRASPORTO che oggi non esiste più. Il default di `aiStructured` non passa
 * né da Google né da nessun SDK per-famiglia: va dritto a `llmStructured` sul gateway, e il pseudo
 * provider 'gemini' è ormai solo il nome del ramo "gateway" dentro xiaomi.ts. Le varianti pin ne
 * ereditano la rotta; forzare `provider: 'xiaomi' | 'kie'` resta possibile come SECONDARIO, con il
 * gateway come rete di conformità allo schema.
 *
 * Come prima, questi test guardano dove finisce davvero la chiamata — sulla doppia `llmStructured`
 * mockata, oppure sulla fetch — e non l'ortografia del sorgente.
 */
// vi.mock è issato in cima al file: i doppi vanno creati in vi.hoisted, o le factory girano prima
// che le const esistano.
const M = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  llmStructured: vi.fn(async (_opts: { label?: string }) => ({ plan: 'ok' })),
  llmText: vi.fn(),
  llmImagesFromInline: vi.fn(() => undefined),
  structuredKie: vi.fn(),
  textKie: vi.fn(),
  // Nessuno importa più deepseek.ts dal router. Il mock sta qui perché se qualcuno lo
  // re-importasse, questi contatori lo direbbero invece di lasciarlo passare in silenzio.
  deepseekAlive: vi.fn(() => true),
  noteDeepseekFailure: vi.fn()
}));
const env = M.env;
vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('$lib/server/llm', () => ({
  llmStructured: M.llmStructured,
  llmText: M.llmText,
  llmImagesFromInline: M.llmImagesFromInline
}));
vi.mock('$lib/server/kie', () => ({ structuredKie: M.structuredKie, textKie: M.textKie }));
vi.mock('$lib/server/deepseek', () => ({
  DEEPSEEK_MODEL: 'deepseek-v4-flash',
  DEEPSEEK_PRO_MODEL: 'deepseek-v4-pro',
  deepseekAlive: M.deepseekAlive,
  noteDeepseekFailure: M.noteDeepseekFailure
}));
vi.mock('$lib/server/ai-log', () => ({
  logAiCall: vi.fn(),
  extractXiaomiUsage: () => ({}),
  extractGeminiUsage: () => ({}),
  requireBrandContext: () => 'brand-1'
}));

describe('routing del lavoro strutturato', () => {
  const SCHEMA = { type: 'object' as const, properties: { plan: { type: 'string' } }, required: ['plan'] };
  const fetchSpy = vi.fn();

  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubGlobal('fetch', fetchSpy);
  });

  async function callBackgroundWork(overrides: Record<string, string | undefined> = {}) {
    Object.assign(env, overrides);
    const { aiStructured, PIN_GEMINI } = await import('./xiaomi');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return aiStructured<any>({} as any, 'prompt', SCHEMA, undefined, 'return_plan', { brandId: 'b', ...PIN_GEMINI });
  }

  it('manda il lavoro strutturato al gateway LLM, e a nessun altro endpoint', async () => {
    expect(await callBackgroundWork()).toEqual({ plan: 'ok' });
    expect(M.llmStructured).toHaveBeenCalledTimes(1);
    expect(M.llmStructured.mock.calls[0][0]).toMatchObject({ label: 'return_plan' });
    expect(M.structuredKie).not.toHaveBeenCalled();
    // structuredXiaomi vive dentro xiaomi.ts e non è mockabile: la sua unica traccia è la fetch.
    // Zero chiamate = nessun endpoint a pagamento è stato sfiorato, sotto QUALUNQUE nome.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ci va anche con GTM_PROVIDER=xiaomi: il pin batte la variabile d\'ambiente', async () => {
    expect(await callBackgroundWork({ GTM_PROVIDER: 'xiaomi', XIAOMI_MIMO_API_KEY: 'k' })).toEqual({ plan: 'ok' });
    expect(M.llmStructured).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forzare provider:"xiaomi" parla con MiMo, e se fallisce ripiega sul gateway', async () => {
    fetchSpy.mockResolvedValue(new Response('boom', { status: 500 }));
    const { aiStructured } = await import('./xiaomi');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await aiStructured<any>({} as any, 'prompt', SCHEMA, undefined, 'return_plan', {
      brandId: 'b',
      provider: 'xiaomi'
    });
    // Il secondario parte davvero — la fetch è il fiato di structuredXiaomi...
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.xiaomimimo.com');
    // ...e il ripiego non è più Gemini ma il gateway LLM.
    expect(M.llmStructured).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ plan: 'ok' });
  });

  it('non tocca DeepSeek: né la chiave, né una chiamata', async () => {
    await callBackgroundWork({ DEEPSEEK_API_KEY: 'chiave-viva' });
    expect(M.deepseekAlive).not.toHaveBeenCalled();
    expect(M.llmStructured).toHaveBeenCalledTimes(1);
  });
});

describe('satisfiesSchema (xiaomi/kie fall-through guard)', () => {
  const brandProfile = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      language: { type: 'string' },
      brand_colors: { type: 'array' },
      target_audience: { type: 'string' }
    },
    required: ['name', 'language', 'brand_colors', 'target_audience']
  };

  it('rejects the partial profile that broke onboarding (no name)', () => {
    expect(
      satisfiesSchema(
        {
          language: 'Chinese',
          brand_colors: ['#4A6CF7', '#E8F1FF'],
          target_audience: 'Sviluppatori, aziende e ricercatori'
        },
        brandProfile
      )
    ).toBe(false);
  });

  it('accepts the same profile once name is present', () => {
    expect(
      satisfiesSchema(
        {
          name: 'DeepSeek',
          language: 'Chinese',
          brand_colors: ['#4A6CF7'],
          target_audience: 'Sviluppatori'
        },
        brandProfile
      )
    ).toBe(true);
  });

  it('rejects a required array delivered as a string', () => {
    expect(
      satisfiesSchema(
        { name: 'X', language: 'Italian', brand_colors: '#fff', target_audience: 'y' },
        brandProfile
      )
    ).toBe(false);
  });
});
