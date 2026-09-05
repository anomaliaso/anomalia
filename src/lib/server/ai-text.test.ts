import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfiesSchema } from './ai-text';

const HERE = dirname(fileURLToPath(import.meta.url));

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
 * Qui c'era la suite che difendeva la deviazione su DeepSeek, poi quella su Gemini Flash, poi
 * quella su MiMo: tutte difendevano un TRASPORTO che non esiste più. Restano DUE strade, e sono i
 * due endpoint del registro: il gateway (`llmStructured`) e kie (`structuredKie`), con il gateway
 * come rete di conformità allo schema. Il pseudo provider 'gemini' si chiamava così mentendo — ora
 * si chiama 'gateway', che è l'endpoint che sceglie davvero.
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
vi.mock('$lib/server/llm', async () => ({
  ...(await vi.importActual<typeof import('$lib/server/llm')>('$lib/server/llm')),
  llmStructured: M.llmStructured,
  llmText: M.llmText,
  llmImagesFromInline: M.llmImagesFromInline
}));
vi.mock('$lib/server/kie', () => ({ structuredKie: M.structuredKie, textKie: M.textKie }));
vi.mock('$lib/server/deepseek', () => ({
  DEEPSEEK_MODEL: 'deepseek-v4-flash',
  deepseekAlive: M.deepseekAlive,
  noteDeepseekFailure: M.noteDeepseekFailure
}));
vi.mock('$lib/server/ai-log', () => ({
  logAiCall: vi.fn(),
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
    const { aiStructured, PIN_GATEWAY } = await import('./ai-text');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return aiStructured<any>({} as any, 'prompt', SCHEMA, undefined, 'return_plan', { brandId: 'b', ...PIN_GATEWAY });
  }

  it('manda il lavoro strutturato al gateway LLM, e a nessun altro endpoint', async () => {
    expect(await callBackgroundWork()).toEqual({ plan: 'ok' });
    expect(M.llmStructured).toHaveBeenCalledTimes(1);
    expect(M.llmStructured.mock.calls[0][0]).toMatchObject({ label: 'return_plan' });
    expect(M.structuredKie).not.toHaveBeenCalled();
    // Zero fetch = nessun endpoint a pagamento è stato sfiorato, sotto QUALUNQUE nome.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ci va anche con GTM_PROVIDER=xiaomi: un endpoint morto non sposta niente', async () => {
    expect(await callBackgroundWork({ GTM_PROVIDER: 'xiaomi' })).toEqual({ plan: 'ok' });
    expect(M.llmStructured).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forzare provider:"kie" usa il secondario, e se fallisce ripiega sul gateway', async () => {
    M.structuredKie.mockRejectedValueOnce(new Error('boom'));
    const { aiStructured } = await import('./ai-text');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await aiStructured<any>({} as any, 'prompt', SCHEMA, undefined, 'return_plan', {
      brandId: 'b',
      provider: 'kie'
    });
    expect(M.structuredKie).toHaveBeenCalledTimes(1);
    expect(M.llmStructured).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ plan: 'ok' });
  });

  it('MiMo non è più un secondario: nessun fornitore fuori da gateway e kie', async () => {
    const src = readFileSync(join(HERE, 'ai-text.ts'), 'utf8');
    expect(src).not.toContain('api.xiaomimimo.com');
    expect(src).not.toContain('structuredXiaomi');
    expect(src).not.toContain('textXiaomi');
  });

  it('non tocca DeepSeek: né la chiave, né una chiamata', async () => {
    await callBackgroundWork({ DEEPSEEK_API_KEY: 'chiave-viva' });
    expect(M.deepseekAlive).not.toHaveBeenCalled();
    expect(M.llmStructured).toHaveBeenCalledTimes(1);
  });
});

/**
 * La manopola dei giudici arrivava fino a QUI e finiva nel nulla: `aiStructured` la destrutturava
 * in `_thinkingLevel` e non la passava a nessuno. Un operatore che abbassava
 * GEMINI_JUDGE_THINKING_LEVEL vedeva la stessa spesa e lo stesso ragionamento di prima, senza un
 * errore da nessuna parte.
 */
describe('lo sforzo di ragionamento chiesto da un giudice', () => {
  const SCHEMA = { type: 'object' as const, properties: { plan: { type: 'string' } }, required: ['plan'] };

  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('arriva al gateway invece di fermarsi negli opts', async () => {
    const { aiStructured, PIN_GATEWAY } = await import('./ai-text');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await aiStructured<any>({} as any, 'prompt', SCHEMA, undefined, 'return_plan', {
      brandId: 'b',
      ...PIN_GATEWAY,
      reasoningEffort: 'low'
    });
    expect(M.llmStructured.mock.calls[0][0]).toMatchObject({ reasoningEffort: 'low' });
  });

  it('senza richiesta il gateway decide da sé: nessuno sforzo inventato qui', async () => {
    const { aiStructured, PIN_GATEWAY } = await import('./ai-text');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await aiStructured<any>({} as any, 'prompt', SCHEMA, undefined, 'return_plan', { brandId: 'b', ...PIN_GATEWAY });
    expect(M.llmStructured.mock.calls[0][0].reasoningEffort).toBeUndefined();
  });

  it('judgeReasoningEffort legge la variabile a ogni chiamata, e ripiega su high', async () => {
    const { judgeReasoningEffort } = await import('./ai-text');
    expect(judgeReasoningEffort()).toBe('high');
    env.GEMINI_JUDGE_THINKING_LEVEL = 'low';
    expect(judgeReasoningEffort()).toBe('low');
    env.GEMINI_JUDGE_THINKING_LEVEL = 'MEDIUM';
    expect(judgeReasoningEffort()).toBe('medium');
    expect(judgeReasoningEffort('low')).toBe('low');
    delete env.GEMINI_JUDGE_THINKING_LEVEL;
    for (const junk of ['1024', 'off', 'max', '', undefined, null]) {
      expect(judgeReasoningEffort(junk)).toBe('high');
    }
  });
});

describe('satisfiesSchema (guardia del ripiego kie → gateway)', () => {
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


/**
 * La riga stampata al boot è la prima cosa che si legge quando qualcosa non torna, e per mesi ha
 * detto `gemini (gemini-3.7-flash)` mentre la chiamata andava al gateway: manda la diagnosi dalla
 * parte sbagliata prima ancora che cominci. Dica chi serve il testo DAVVERO, o taccia.
 */
describe('textRouteLabel — chi serve il testo, per il log di boot', () => {
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    vi.resetModules();
  });

  it('senza rotte forzate nomina il gateway e i suoi modelli, mai un id Gemini', async () => {
    Object.assign(env, { LLM_API_KEY: 'k', LLM_DEFAULT_MODEL: 'z-ai/glm-5.3-flash' });
    const { textRouteLabel } = await import('./ai-text');
    expect(textRouteLabel()).toBe('openrouter.ai (z-ai/glm-5.3-flash)');
  });

  it('una rotta deviata su kie lo dice, col modello che kie riceverà', async () => {
    Object.assign(env, { LLM_API_KEY: 'k', AI_ROUTE_TEXT: 'grok@kie', KIE_API_KEY: 'k' });
    const { textRouteLabel } = await import('./ai-text');
    expect(textRouteLabel()).toBe('kie (grok-4-5)');
  });

  it('senza la chiave del centralino annuncia il guasto, non un modello', async () => {
    const { textRouteLabel } = await import('./ai-text');
    expect(textRouteLabel()).toBe('not configured (LLM_API_KEY missing)');
  });
});
