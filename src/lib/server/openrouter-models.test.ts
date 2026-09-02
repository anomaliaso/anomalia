import { describe, it, expect, beforeEach } from 'vitest';
import { __resetGatewayModels, ensureGatewayModels, gatewayModel, gatewayRate } from './openrouter-models';

const MODELS = {
  data: [
    {
      id: 'anthropic/claude-opus-5',
      name: 'Claude Opus 5',
      context_length: 1_000_000,
      supported_parameters: ['tools', 'reasoning'],
      architecture: { input_modalities: ['text', 'image'] },
      pricing: { prompt: '0.000005', completion: '0.000025', input_cache_read: '0.0000005' }
    },
    {
      id: 'someone/text-only-no-tools',
      name: 'Text only',
      context_length: 8000,
      supported_parameters: [],
      architecture: { input_modalities: ['text'] },
      pricing: { prompt: '0.000001', completion: '0.000002' }
    }
  ]
};

function fetchImpl(body: unknown = MODELS, status = 200) {
  return (async () => ({ ok: status < 300, status, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(() => __resetGatewayModels());

describe('catalogo dei modelli del gateway', () => {
  it('trasforma il prezzo per token in dollari per milione', async () => {
    await ensureGatewayModels({ fetchImpl: fetchImpl(), baseUrl: 'https://openrouter.ai/api/v1' });
    expect(gatewayRate('anthropic/claude-opus-5')).toEqual({ input: 5, cachedInput: 0.5, output: 25 });
  });

  /**
   * Il bridge dell'harness scrive `llm/<id>` e il vecchio ponte scriveva `openrouter/<id>`: è lo
   * stesso modello allo stesso prezzo, e senza questo la riga più cara del prodotto resta a zero.
   */
  it('riconosce l\'id anche sotto i prefissi di trasporto', async () => {
    await ensureGatewayModels({ fetchImpl: fetchImpl(), baseUrl: 'https://openrouter.ai/api/v1' });
    expect(gatewayRate('llm/anthropic/claude-opus-5')?.input).toBe(5);
    expect(gatewayRate('openrouter/anthropic/claude-opus-5')?.input).toBe(5);
  });

  it('senza cache prezzata resta null, non zero', async () => {
    expect(gatewayRate('anthropic/claude-opus-5')).toBeNull();
    await ensureGatewayModels({ fetchImpl: fetchImpl(), baseUrl: 'https://openrouter.ai/api/v1' });
    expect(gatewayRate('mai/visto')).toBeNull();
  });

  it('un gateway irraggiungibile non fa esplodere il log', async () => {
    await expect(
      ensureGatewayModels({ fetchImpl: fetchImpl({}, 500), baseUrl: 'https://openrouter.ai/api/v1' })
    ).resolves.toBeUndefined();
    expect(gatewayRate('anthropic/claude-opus-5')).toBeNull();
  });

  // Gli agenti chiamano tool e leggono immagini: un modello senza quelle due cose non è una scelta,
  // è un turno che muore a metà.
  it('il picker vede solo i modelli che sanno usare i tool e leggere immagini', async () => {
    await ensureGatewayModels({ fetchImpl: fetchImpl(), baseUrl: 'https://openrouter.ai/api/v1' });
    expect(gatewayModel('anthropic/claude-opus-5')?.usable).toBe(true);
    expect(gatewayModel('someone/text-only-no-tools')?.usable).toBe(false);
    expect(gatewayModel('anthropic/claude-opus-5')?.contextLength).toBe(1_000_000);
  });
});
