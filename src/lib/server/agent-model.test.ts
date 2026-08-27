import { beforeEach, describe, expect, it, vi } from 'vitest';

// $env/dynamic/private is resolved by the SvelteKit plugin; give the unit test a plain object
// whose values we flip per case. AGENT_PROVIDER is read at module load, so every case that
// changes it re-imports the module.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

type AgentModelModule = typeof import('./strategy-agent');

async function load(overrides: Record<string, string | undefined>): Promise<AgentModelModule> {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, overrides);
  vi.resetModules();
  return (await import('./strategy-agent')) as AgentModelModule;
}

const BOTH = { GEMINI_API_KEY: 'g-key', DEEPSEEK_API_KEY: 'd-key' };

describe('which model runs the text agents', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('runs on Gemini when nothing is configured to say otherwise', async () => {
    const { agentModel } = await load(BOTH);
    expect(agentModel().provider).toBe('gemini');
  });

  it('bills the Gemini model id it actually built, not a hardcoded one', async () => {
    const { agentModel } = await load({ ...BOTH, GEMINI_FLASH: 'gemini-3.7-flash' });
    const m = agentModel();
    expect(m.provider).toBe('gemini');
    expect(m.modelId).toBe('gemini-3.7-flash');
  });

  it('still lets AGENT_PROVIDER=deepseek force DeepSeek without a deploy', async () => {
    const { agentModel } = await load({ ...BOTH, AGENT_PROVIDER: 'deepseek' });
    expect(agentModel().provider).toBe('deepseek');
  });

  it('falls back to DeepSeek when there is no Gemini key at all', async () => {
    const { agentModel } = await load({ DEEPSEEK_API_KEY: 'd-key' });
    expect(agentModel().provider).toBe('deepseek');
  });

  it('offers the other provider as the fallback, in both directions', async () => {
    const gemFirst = await load(BOTH);
    expect(gemFirst.agentModel().provider).toBe('gemini');
    expect(gemFirst.agentFallbackModel()?.provider).toBe('deepseek');

    const dsFirst = await load({ ...BOTH, AGENT_PROVIDER: 'deepseek' });
    expect(dsFirst.agentModel().provider).toBe('deepseek');
    expect(dsFirst.agentFallbackModel()?.provider).toBe('gemini');
  });

  it('has no fallback when only one provider is configured', async () => {
    const { agentFallbackModel } = await load({ GEMINI_API_KEY: 'g-key' });
    expect(agentFallbackModel()).toBeNull();
  });
});

describe('withAgentFallback', () => {
  it('retries on the other provider when the primary dies before any tool ran', async () => {
    const { withAgentFallback } = await load(BOTH);
    const seen: string[] = [];

    const out = await withAgentFallback('test', async (m) => {
      seen.push(m.provider);
      if (m.provider === 'gemini') throw new Error('429 quota');
      return 'ok';
    });

    expect(out).toBe('ok');
    expect(seen).toEqual(['gemini', 'deepseek']);
  });

  // The gate that makes the retry safe: these loops propose plans, edit scheduled posts and
  // spend credits. Once a tool has run, re-running would apply those effects a second time.
  it('does NOT retry once a tool has run — the error propagates instead', async () => {
    const { withAgentFallback } = await load(BOTH);
    const seen: string[] = [];

    await expect(
      withAgentFallback('test', async (m, markDirty) => {
        seen.push(m.provider);
        markDirty();
        throw new Error('died halfway through, after editing posts');
      })
    ).rejects.toThrow('died halfway');

    expect(seen).toEqual(['gemini']);
  });

  it('propagates the error when there is nothing to fall back to', async () => {
    const { withAgentFallback } = await load({ GEMINI_API_KEY: 'g-key' });
    const seen: string[] = [];

    await expect(
      withAgentFallback('test', async (m) => {
        seen.push(m.provider);
        throw new Error('503');
      })
    ).rejects.toThrow('503');

    expect(seen).toEqual(['gemini']);
  });

  /**
   * LA CHIAVE MORTA. "Configurata" non ha mai voluto dire "ha credito": il fallback partiva perché
   * DEEPSEEK_API_KEY esisteva, incassava un 402 e faceva fallire lo stesso il run — una rete di
   * salvataggio che garantisce di non salvare, una chiamata condannata più tardi. Ora un 401/402
   * spegne DeepSeek per il processo, e il tentativo successivo non c'è proprio.
   */
  it('smette di offrire DeepSeek come rete dopo un 402 sulla chiave', async () => {
    const mod = await load(BOTH);
    expect(mod.agentFallbackModel()?.provider).toBe('deepseek');

    const seen: string[] = [];
    await expect(
      mod.withAgentFallback('test', async (m) => {
        seen.push(m.provider);
        if (m.provider === 'gemini') throw new Error('503');
        throw Object.assign(new Error('Insufficient Balance'), { statusCode: 402 });
      })
    ).rejects.toThrow('Insufficient Balance');
    expect(seen).toEqual(['gemini', 'deepseek']);

    // Stesso processo, stessa chiave: il secondo run non ha più niente su cui ripiegare.
    expect(mod.agentFallbackModel()).toBeNull();
    const seenAgain: string[] = [];
    await expect(
      mod.withAgentFallback('test', async (m) => {
        seenAgain.push(m.provider);
        throw new Error('503');
      })
    ).rejects.toThrow('503');
    expect(seenAgain).toEqual(['gemini']);
  });

  it('un 429 invece non spegne niente: quello vale la pena ritentarlo', async () => {
    const mod = await load(BOTH);
    await expect(
      mod.withAgentFallback('test', async (m) => {
        if (m.provider === 'gemini') throw new Error('503');
        throw Object.assign(new Error('rate limited'), { statusCode: 429 });
      })
    ).rejects.toThrow('rate limited');
    expect(mod.agentFallbackModel()?.provider).toBe('deepseek');
  });

  it('never touches the fallback when the primary succeeds', async () => {
    const { withAgentFallback } = await load(BOTH);
    const seen: string[] = [];

    const out = await withAgentFallback('test', async (m) => {
      seen.push(m.provider);
      return 42;
    });

    expect(out).toBe(42);
    expect(seen).toEqual(['gemini']);
  });
});

describe('per-step pricing follows the model that actually ran', () => {
  it('prices a fallback step on the fallback provider, not the primary', async () => {
    const { addStrategyStepCost, agentModel, agentFallbackModel, createStrategyBudget } =
      await load(BOTH);
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

    const onPrimary = createStrategyBudget({});
    addStrategyStepCost(onPrimary, usage, agentModel());

    const onFallback = createStrategyBudget({});
    addStrategyStepCost(onFallback, usage, agentFallbackModel()!);

    // DeepSeek is roughly an order of magnitude cheaper; the two must not come out equal, or the
    // run's budget is being spent against the wrong price list.
    expect(onPrimary.usdSpent).toBeGreaterThan(0);
    expect(onFallback.usdSpent).toBeGreaterThan(0);
    expect(onFallback.usdSpent).not.toBeCloseTo(onPrimary.usdSpent, 6);
  });
});
