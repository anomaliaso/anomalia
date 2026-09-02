import { describe, it, expect, beforeEach } from 'vitest';
import { __resetGatewayModels, ensureGatewayModels } from './openrouter-models';
import { chatModelChoices } from './chat-models';

const raw = (id: string, name: string, opts: { tools?: boolean; image?: boolean } = {}) => ({
  id,
  name,
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
    raw('vendor/not-featured', 'Non in vetrina')
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
