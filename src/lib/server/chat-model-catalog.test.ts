import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const rows = vi.hoisted(() => ({ current: [] as Array<{ model_id: string; position: number }>, error: null as unknown }));

vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () =>
    ({
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          then: (resolve: (v: unknown) => unknown) => resolve({ data: rows.current, error: rows.error })
        };
        return q;
      }
    }) as unknown as SupabaseClient
}));

vi.mock('$lib/server/llm', () => ({ llmModels: () => envModels.current }));

const envModels = vi.hoisted(() => ({ current: [] as string[] }));

import { __resetGatewayModels, ensureGatewayModels } from './openrouter-models';
import { newModelsForCatalog } from './chat-model-catalog';

const raw = (id: string, created: number) => ({
  id,
  name: id,
  created,
  context_length: 200_000,
  supported_parameters: ['tools'],
  architecture: { input_modalities: ['text', 'image'] },
  pricing: { prompt: '0.000001', completion: '0.000002' }
});

const LIVE = {
  data: [
    raw('google/gemini-3.7-flash', 1_000),
    raw('google/gemini-3.8-flash', 2_000),
    raw('google/gemini-3.8-flash:batch', 2_000),
    raw('sakana/sakana-namazu', 9_000),
    raw('anthropic/claude-opus-5', 500)
  ]
};

const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => LIVE })) as unknown as typeof fetch;

beforeEach(async () => {
  __resetGatewayModels();
  await ensureGatewayModels({ fetchImpl, baseUrl: 'https://openrouter.ai/api/v1' });
});

describe('le uscite nuove che entrano in vetrina', () => {
  it('prende il piu\' recente di un vendor che la vetrina gia\' segue', () => {
    expect(newModelsForCatalog(['google/gemini-3.7-flash'])).toEqual(['google/gemini-3.8-flash']);
  });

  /** Seguire un vendor e` una scelta editoriale: la fa la tabella, non OpenRouter. */
  it('ignora un vendor che nessuno ha messo in vetrina', () => {
    expect(newModelsForCatalog(['google/gemini-3.7-flash'])).not.toContain('sakana/sakana-namazu');
  });

  it('non propone niente quando la vetrina ha gia\' il piu\' recente', () => {
    expect(newModelsForCatalog(['google/gemini-3.8-flash', 'anthropic/claude-opus-5'])).toEqual([]);
  });
});

describe('chi decide la vetrina', () => {
  it('la tabella vince su LLM_MODELS', async () => {
    rows.current = [{ model_id: 'anthropic/claude-opus-5', position: 10 }];
    envModels.current = ['google/gemini-3.7-flash'];
    vi.resetModules();

    const { chatModelChoices } = await import('./chat-models');
    const ids = (await chatModelChoices({ fetchImpl, baseUrl: 'https://openrouter.ai/api/v1' })).map((c) => c.id);

    expect(ids).toContain('anthropic/claude-opus-5');
    expect(ids).not.toContain('google/gemini-3.7-flash');
  });

  it('senza righe in tabella comanda LLM_MODELS', async () => {
    rows.current = [];
    envModels.current = ['google/gemini-3.7-flash'];
    vi.resetModules();

    const { chatModelChoices } = await import('./chat-models');
    const ids = (await chatModelChoices({ fetchImpl, baseUrl: 'https://openrouter.ai/api/v1' })).map((c) => c.id);

    expect(ids).toContain('google/gemini-3.7-flash');
  });
});
