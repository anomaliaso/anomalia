import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * La vetrina viene dalla TABELLA quando c'e`, e da `LLM_MODELS` quando non c'e`. Qui si prova il
 * secondo caso, quindi la tabella deve essere davvero assente — non "assente sul database che
 * questa macchina riesce a raggiungere". Senza questo mock la suite passava solo finche' la
 * migration non era applicata, e ha iniziato a fallire il giorno in cui lo e` stata.
 */
vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => {
    throw new Error('nessun catalogo in questo test');
  }
}));
import { __resetGatewayModels, ensureGatewayModels } from './openrouter-models';
import { chatModelChoices } from './chat-models';

const raw = (id: string, name: string, opts: { tools?: boolean; image?: boolean; created?: number } = {}) => ({
  id,
  name,
  created: opts.created ?? 0,
  context_length: 200_000,
  supported_parameters: opts.tools === false ? [] : ['tools', 'reasoning'],
  architecture: { input_modalities: opts.image === false ? ['text'] : ['text', 'image'] },
  pricing: { prompt: '0.000001', completion: '0.000002' }
});

const LIVE = {
  data: [
    raw('anthropic/claude-opus-5', 'Claude Opus 5'),
    raw('openai/gpt-5.6-sol', 'GPT-5.6 Sol'),
    raw('deepseek/deepseek-v4-flash-vision-exp', 'DeepSeek V4 Flash'),
    raw('someone/deprecated-text-model', 'Solo testo', { tools: false, image: false }),
    raw('vendor/not-featured', 'Non in vetrina'),
    raw('google/gemini-3.7-flash', 'Gemini 3.7 Flash', { created: 1_000 }),
    raw('google/gemini-3.8-flash', 'Gemini 3.8 Flash', { created: 2_000 }),
    raw('google/gemini-3.8-flash:batch', 'Gemini 3.8 Flash (batch)', { created: 2_000 })
  ]
};

const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => LIVE })) as unknown as typeof fetch;

beforeEach(async () => {
  __resetGatewayModels();
  await ensureGatewayModels({ fetchImpl, baseUrl: 'https://openrouter.ai/api/v1' });
});

describe('catalogo della chat', () => {
  it('offre solo modelli che il gateway serve davvero, adesso', async () => {
    const ids = (await chatModelChoices({ configured: [] })).map((c) => c.id);
    expect(ids).toContain('anthropic/claude-opus-5');
    expect(ids).toContain('openai/gpt-5.6-sol');
    // In vetrina ci sono anche modelli che questo gateway non ha: non si mostrano invece di
    // fallire al primo turno.
    expect(ids).not.toContain('x-ai/grok-4.6');
    // Non in vetrina e non configurato: fuori.
    expect(ids).not.toContain('vendor/not-featured');
  });

  /** Un modello messo in LLM_MODELS dall'operatore è una scelta esplicita: sta nel menu. */
  it('include quello che l\'operatore ha configurato, anche se non è in vetrina', async () => {
    const ids = (await chatModelChoices({ configured: ['vendor/not-featured'] })).map((c) => c.id);
    expect(ids).toContain('vendor/not-featured');
  });

  /**
   * Il modello uscito stamattina non aspetta un deploy per entrare nel menu: di ogni vendor in
   * vetrina il piu` recente che il gateway serve entra da solo.
   */
  it('aggiunge da se\' il modello piu\' recente di ogni vendor in vetrina', async () => {
    const ids = (await chatModelChoices({ configured: [] })).map((c) => c.id);
    expect(ids).toContain('google/gemini-3.8-flash');
  });

  it('non scambia una variante per un modello nuovo', async () => {
    const ids = (await chatModelChoices({ configured: [] })).map((c) => c.id);
    expect(ids).not.toContain('google/gemini-3.8-flash:batch');
  });

  it('non offre un modello che non sa usare i tool o leggere immagini', async () => {
    const ids = (await chatModelChoices({ configured: ['someone/deprecated-text-model'] })).map((c) => c.id);
    expect(ids).not.toContain('someone/deprecated-text-model');
  });

  it('porta prezzo e contesto, così il menu non deve indovinarli', async () => {
    const opus = (await chatModelChoices({ configured: [] })).find((c) => c.id === 'anthropic/claude-opus-5');
    expect(opus).toMatchObject({ label: 'Claude Opus 5', contextLength: 200_000, inputUsdPerM: 1, outputUsdPerM: 2 });
  });

  it('senza listino raggiungibile il menu resta vuoto invece di mentire', async () => {
    __resetGatewayModels();
    const bad = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    await ensureGatewayModels({ fetchImpl: bad, baseUrl: 'https://openrouter.ai/api/v1' });
    expect(await chatModelChoices({ configured: [], fetchImpl: bad, baseUrl: 'https://openrouter.ai/api/v1' })).toEqual([]);
  });
});
