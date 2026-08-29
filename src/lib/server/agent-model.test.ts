import { beforeEach, describe, expect, it, vi } from 'vitest';

// $env/dynamic/private is resolved by the SvelteKit plugin; give the unit test a plain object
// whose values we flip per case, like llm.test.ts does. There is ONE provider now: the
// OpenAI-compatible gateway. AGENT_PROVIDER, DEEPSEEK_* e compagnia non esistono più, quindi le
// variabili che contano sono LLM_API_KEY / LLM_DEFAULT_MODEL (più LLM_BASE_URL quando serve).
//
// Il client @ai-sdk/openai è mockato per intero: nessuna rete, ma baseURL, apiKey e l'id passato
// al modello restano osservabili — che è esattamente il contratto di agentModel().
const M = vi.hoisted(() => {
  const env: Record<string, string | undefined> = {};
  // Ogni createOpenAI(...) fatto da llmClient(), nell'ordine: il modulo cachea il client, quindi
  // in un run pulito ce ne aspettiamo uno solo con quegli argomenti.
  const clientOpts: Array<Record<string, unknown>> = [];
  // Ogni id passato alla factory del client, cioè ogni LanguageModel costruito.
  const modelIds: string[] = [];
  const createOpenAI = vi.fn((opts: Record<string, unknown>) => {
    clientOpts.push(opts);
    return (id: string) => {
      modelIds.push(id);
      return { modelId: id };
    };
  });
  return { env, createOpenAI, clientOpts, modelIds };
});
const env = M.env;
vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: M.createOpenAI }));

// Ogni test re-importa l'intero grafo di strategy-agent (mezzo modulo server): sotto carico i 5s
// di default non bastano nemmeno per fare il primo import. Nessuna rete, solo esecuzione pesante.
vi.setConfig({ testTimeout: 60_000 });

type AgentModelModule = typeof import('./strategy-agent');

async function load(overrides: Record<string, string | undefined> = {}): Promise<AgentModelModule> {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, { LLM_API_KEY: 'sk-test', LLM_DEFAULT_MODEL: 'z-ai/glm-5.3-flash', ...overrides });
  M.clientOpts.length = 0;
  M.modelIds.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
  return (await import('./strategy-agent')) as AgentModelModule;
}

describe('which model runs the text agents', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('builds an @ai-sdk/openai model against LLM_BASE_URL/LLM_API_KEY with id LLM_DEFAULT_MODEL', async () => {
    const { agentModel } = await load({ LLM_BASE_URL: 'http://gateway.local/v1' });
    const m = agentModel();
    expect(m.provider).toBe('llm');
    expect(m.modelId).toBe('z-ai/glm-5.3-flash');
    // Il client del gateway nasce esattamente una volta, puntato al base URL giusto con la chiave giusta.
    expect(M.clientOpts).toHaveLength(1);
    expect(M.clientOpts[0]).toMatchObject({
      baseURL: 'http://gateway.local/v1',
      apiKey: 'sk-test',
      name: 'llm'
    });
    // Il LanguageModel porta con sé l'id fatturato: billing ids derivano da qui.
    expect(M.modelIds).toEqual(['z-ai/glm-5.3-flash']);
    expect((m.model as { modelId?: string }).modelId).toBe('z-ai/glm-5.3-flash');
  });

  it("billing ids come straight from LLM_DEFAULT_MODEL, whatever it is — nothing hardcoded", async () => {
    const mod = await load({ LLM_DEFAULT_MODEL: 'openai/gpt-5.6-sol' });
    const m = mod.agentModel();
    expect(m.modelId).toBe('openai/gpt-5.6-sol');
    expect(mod.STRATEGY_AGENT_MODEL()).toBe('openai/gpt-5.6-sol');
    expect(M.modelIds).toEqual(['openai/gpt-5.6-sol']);
  });

  it('throws llm_unconfigured when LLM_DEFAULT_MODEL is unset', async () => {
    const { agentModel } = await load({ LLM_DEFAULT_MODEL: undefined });
    expect(() => agentModel()).toThrow('llm_unconfigured');
  });

  it('still refuses to build anything without an API key', async () => {
    const { agentModel } = await load({ LLM_API_KEY: undefined });
    expect(() => agentModel()).toThrow(/LLM_API_KEY/);
  });

  it('AGENT_PROVIDER is gone: forcing deepseek changes nothing, there is one pipe', async () => {
    const { agentModel } = await load({ AGENT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd-key' });
    const m = agentModel();
    expect(m.provider).toBe('llm');
    expect(m.modelId).toBe('z-ai/glm-5.3-flash');
  });

  it('has no fallback model anymore, whoever is configured', async () => {
    const full = await load({ GEMINI_API_KEY: 'g-key', DEEPSEEK_API_KEY: 'd-key' });
    expect(full.agentFallbackModel()).toBeNull();

    const bare = await load({ LLM_DEFAULT_MODEL: undefined });
    expect(bare.agentFallbackModel()).toBeNull();
  });
});

describe('withAgentFallback — a single provider, the retry path exists but has nowhere to go', () => {
  /**
   * Il meccanismo di ripiego è rimasto nel codice (fallback = agentFallbackModel(); if (!dirty &&
   * !fallback) …), ma agentFallbackModel() ora ritorna SEMPRE null: il retry è strutturalmente
   * morto. Questi test lo descrivono fedelmente — un giro solo, errori propagati — senza inventare
   * un secondo provider che non c'è più.
   */
  it('runs once on the primary and returns its value untouched', async () => {
    const { withAgentFallback, agentModel } = await load();
    const seen: Array<{ provider: string; modelId: string }> = [];

    const out = await withAgentFallback('test', async (m) => {
      seen.push({ provider: m.provider, modelId: m.modelId });
      return 'ok';
    });

    expect(out).toBe('ok');
    expect(seen).toEqual([{ provider: 'llm', modelId: 'z-ai/glm-5.3-flash' }]);
    expect(agentModel().modelId).toBe('z-ai/glm-5.3-flash');
  });

  it('propagates errors when the call fails — no second attempt, even before any tool ran', async () => {
    const { withAgentFallback } = await load();
    let runs = 0;

    await expect(
      withAgentFallback('test', async () => {
        runs += 1;
        throw new Error('503 from the gateway');
      })
    ).rejects.toThrow('503 from the gateway');

    expect(runs).toBe(1);
  });

  it('markDirty stays in the contract but cannot change the outcome — the fallback is dead code', async () => {
    const { withAgentFallback } = await load();
    let runs = 0;

    await expect(
      withAgentFallback('test', async (_m, markDirty) => {
        runs += 1;
        markDirty();
        throw new Error('died halfway through, after editing posts');
      })
    ).rejects.toThrow('died halfway through');

    expect(runs).toBe(1);
  });
});

describe('per-step pricing follows the gateway id that actually ran', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

  it('prices a step on the modelId it was handed — the RATES entry must follow the gateway id', async () => {
    const { addStrategyStepCost, agentModel, createStrategyBudget } = await load();

    const fast = createStrategyBudget({});
    addStrategyStepCost(fast, usage, agentModel()); // z-ai/glm-5.3-flash

    const sol = await load({ LLM_DEFAULT_MODEL: 'openai/gpt-5.6-sol' });
    const pro = sol.createStrategyBudget({});
    sol.addStrategyStepCost(pro, usage, sol.agentModel()); // openai/gpt-5.6-sol

    // $0.075+$0.25/M contro $2+$10/M: due listini diversi sullo stesso tubo. Se tornassero uguali,
    // il budget del run starebbe spendendo contro il prezzo sbagliato.
    expect(fast.usdSpent).toBeCloseTo(0.325, 6);
    expect(pro.usdSpent).toBeCloseTo(12, 6);
  });

  it('falls back to the primary model when `ran` is omitted', async () => {
    const { addStrategyStepCost, createStrategyBudget } = await load();
    const budget = createStrategyBudget({});
    addStrategyStepCost(budget, usage);
    expect(budget.usdSpent).toBeCloseTo(0.325, 6);
  });

  it('counts tokens even when the gateway id has no rate: cost_usd null must not eat the counters', async () => {
    const { addStrategyStepCost, createStrategyBudget } = await load();
    const budget = createStrategyBudget({});
    addStrategyStepCost(budget, usage, { model: null!, provider: 'llm', modelId: 'mai-visto/sul-gateway' });
    expect(budget.tokensIn).toBe(1_000_000);
    expect(budget.tokensOut).toBe(1_000_000);
    expect(budget.usdSpent).toBe(0);
  });

  it('ignores a step with no usage at all', async () => {
    const { addStrategyStepCost, createStrategyBudget } = await load();
    const budget = createStrategyBudget({});
    addStrategyStepCost(budget, undefined);
    expect(budget.tokensIn).toBe(0);
    expect(budget.tokensOut).toBe(0);
    expect(budget.usdSpent).toBe(0);
  });
});
