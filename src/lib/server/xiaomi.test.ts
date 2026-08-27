import { describe, it, expect, vi, beforeEach } from 'vitest';
import { satisfiesSchema } from './xiaomi';

// DeepSeek returns valid JSON but does NOT enforce the schema (json_object mode). This guard is
// what stops a partially-filled object from reaching a caller that assumes the contract held.
describe('satisfiesSchema (DeepSeek fall-through guard)', () => {
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
 * IL LAVORO DI SFONDO VA SU GEMINI FLASH.
 *
 * Qui c'era la suite che difendeva la deviazione su DeepSeek: più economico a parità di lavoro, con
 * ripiego su Gemini quando falliva. Il ripiego funzionava troppo bene — con la chiave a saldo zero
 * ogni chiamata faceva un tentativo condannato, aspettava il 402 e rifaceva il lavoro su Gemini,
 * decine di volte l'ora per ore, senza che niente si rompesse in superficie.
 *
 * Poi è arrivata una versione che faceva `readFileSync` di xiaomi.ts e cercava i nomi delle funzioni
 * DeepSeek nel sorgente: difendeva l'ORTOGRAFIA, non il comportamento. Sarebbe passata identica con
 * il lavoro di sfondo dirottato su un provider a pagamento sotto qualunque altro nome — ed era
 * legata alla directory da cui gira vitest.
 *
 * Questi invece guardano dove finisce davvero la chiamata: su `structuredGemini`, e su nient'altro
 * che parli con la rete.
 */
// vi.mock è issato in cima al file: i doppi vanno creati in vi.hoisted, o le factory girano prima
// che le const esistano.
const M = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  structuredGemini: vi.fn(async () => ({ plan: 'ok' })),
  structuredKie: vi.fn(),
  textKie: vi.fn(),
  // Nessuno importa più deepseek.ts dal router. Il mock sta qui perché se qualcuno lo
  // re-importasse, questi contatori lo direbbero invece di lasciarlo passare in silenzio.
  deepseekAlive: vi.fn(() => true),
  noteDeepseekFailure: vi.fn()
}));
const env = M.env;
vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('$lib/server/research', () => ({ structuredGemini: M.structuredGemini }));
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

  it('manda il lavoro strutturato a Gemini, e a nessun altro provider', async () => {
    expect(await callBackgroundWork()).toEqual({ plan: 'ok' });
    expect(M.structuredGemini).toHaveBeenCalledTimes(1);
    expect(M.structuredKie).not.toHaveBeenCalled();
    // structuredXiaomi vive dentro xiaomi.ts e non è mockabile: la sua unica traccia è la fetch.
    // Zero chiamate = nessun provider a pagamento è stato sfiorato, sotto QUALUNQUE nome.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ci va anche con GTM_PROVIDER=xiaomi: il pin batte la variabile d\'ambiente', async () => {
    expect(await callBackgroundWork({ GTM_PROVIDER: 'xiaomi', XIAOMI_MIMO_API_KEY: 'k' })).toEqual({ plan: 'ok' });
    expect(M.structuredGemini).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('non tocca DeepSeek: né la chiave, né una chiamata', async () => {
    await callBackgroundWork({ DEEPSEEK_API_KEY: 'chiave-viva' });
    expect(M.deepseekAlive).not.toHaveBeenCalled();
    expect(M.structuredGemini).toHaveBeenCalledTimes(1);
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
