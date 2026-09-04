import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * CARATTERIZZAZIONE DEL GIRO DEL SEO AGENT.
 *
 * Sesto dei dodici, stesso metodo: si aggancia `generateText` dell'SDK, il confine che
 * sopravvive alla riscrittura, e si fissa il comportamento di oggi prima di toccarlo.
 */

const { generateText, logAiCall, persistAgentRun, fetchUsdBudget, agentSessionWrites } = vi.hoisted(
  () => ({
    generateText: vi.fn(),
    logAiCall: vi.fn(),
    persistAgentRun: vi.fn(),
    fetchUsdBudget: vi.fn(),
    agentSessionWrites: [] as Array<Record<string, unknown>>
  })
);

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateText };
});

vi.mock('$lib/server/llm', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/llm')>('$lib/server/llm');
  return {
    ...actual,
    llmDefaultModel: () => 'gemini-3.7-flash',
    llmLanguageModel: () => ({ modelId: 'gemini-3.7-flash' })
  };
});

vi.mock('$lib/server/ai-log', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/ai-log')>('$lib/server/ai-log');
  return { ...actual, logAiCall };
});

vi.mock('$lib/server/agent-runs', () => ({ persistAgentRun }));

vi.mock('$lib/server/strategy-agent', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/strategy-agent')>('$lib/server/strategy-agent');
  return { ...actual, fetchUsdBudget };
});

vi.mock('$lib/server/dataforseo-tools', () => ({ createDataForSeoTools: () => ({}) }));

vi.mock('$lib/server/seo-metrics', () => ({ buildSeoMetrics: async () => ({ metrics: 'none' }) }));

vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table === 'agent_sessions') agentSessionWrites.push({ op: 'insert', ...row });
        return Promise.resolve({ error: null });
      },
      upsert: (row: Record<string, unknown>) => {
        if (table === 'agent_sessions') agentSessionWrites.push({ op: 'upsert', ...row });
        return Promise.resolve({ error: null });
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) })
    })
  })
}));

import { MAX_SEO_AGENT_STEPS, runSeoAgent, seoAgentEnabled } from './seo-agent';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

function stubSupabase(): AnyRec {
  const chain: AnyRec = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
        }
        if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: null, error: null });
        return () => chain;
      }
    }
  );
  return { from: () => chain };
}

const FINISH_INPUT = {
  notes: 'Grounded in the latest audit.',
  evaluation: { grade: 'B', summary: 'Solid base', strengths: ['brand'], weaknesses: ['thin pages'] },
  initiatives: [
    {
      type: 'blog' as const,
      title: 'Come si regola la macina',
      targetQuery: 'regolare macina espresso',
      rationale: 'query reale, zero copertura',
      effort: 'low' as const,
      impact: 'high' as const
    }
  ]
};

type ScriptedCall = { tool: string; input?: unknown };
type DriveRecord = {
  prepared: AnyRec[];
  calls: Array<{ tool: string; output: unknown }>;
  system: string;
  prompt: string;
  toolNames: string[];
};

function drive(script: ScriptedCall[], record: DriveRecord) {
  return async (options: AnyRec) => {
    record.system = String(options.system ?? '');
    record.prompt = String(options.prompt ?? '');
    record.toolNames = Object.keys(options.tools ?? {});

    const steps: AnyRec[] = [];
    for (const entry of script) {
      const prepared = (await options.prepareStep?.({ stepNumber: steps.length, steps })) ?? {};
      record.prepared.push(prepared);

      const impl = options.tools?.[entry.tool];
      const output = impl ? await impl.execute(entry.input ?? {}, {}) : { error: 'no such tool' };
      record.calls.push({ tool: entry.tool, output });

      const toolCalls = [{ toolName: entry.tool, input: entry.input ?? {}, type: 'tool-call' }];
      const toolResults = [{ toolName: entry.tool, output, type: 'tool-result' }];
      const usage = { inputTokens: 100, outputTokens: 40 };
      steps.push({ toolCalls, toolResults, text: '', usage });
      await options.onStepFinish?.({ toolCalls, toolResults, text: '', usage });

      const stops = (options.stopWhen ?? []) as Array<(a: AnyRec) => boolean | Promise<boolean>>;
      const verdicts = await Promise.all(stops.map((s) => s({ steps, stepNumber: steps.length })));
      if (verdicts.some(Boolean)) break;
    }
    return { text: '', totalUsage: { inputTokens: 100 * steps.length, outputTokens: 40 * steps.length }, steps };
  };
}

function baseOpts(over: AnyRec = {}): AnyRec {
  return {
    supabase: stubSupabase(),
    brand: { id: 'b1', name: 'Demo Brand', website: 'https://demo.example' },
    deadlineMs: 60_000,
    ...over
  };
}

function newRecord(): DriveRecord {
  return { prepared: [], calls: [], system: '', prompt: '', toolNames: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  agentSessionWrites.length = 0;
  fetchUsdBudget.mockResolvedValue(5);
});

describe('acceso di default', () => {
  it('si spegne solo con SEO_AGENT_ENABLED=false', () => {
    expect(seoAgentEnabled()).toBe(true);
  });
});

describe('il tavolo dei tool offerto al modello', () => {
  it('è esattamente questo elenco, più quelli di DataForSEO', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: FINISH_INPUT }], rec));

    await runSeoAgent(baseOpts() as never);

    expect(rec.toolNames.sort()).toEqual(
      ['finish', 'read_existing_plan', 'read_gsc_summary', 'read_latest_audit', 'read_seo_metrics'].sort()
    );
  });

  it('il prompt cambia col modo: `more` chiede iniziative nuove e distinte', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: FINISH_INPUT }], rec));

    await runSeoAgent(baseOpts({ mode: 'more', count: 4 }) as never);

    expect(rec.prompt).toContain('4 NEW initiatives distinct from the existing plan');
  });

  it('in modo `plan` chiede una valutazione aggiornata', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: FINISH_INPUT }], rec));

    await runSeoAgent(baseOpts() as never);

    expect(rec.prompt).toContain('updated evaluation and prioritized initiatives');
  });
});

describe('il percorso che chiude', () => {
  it('finish restituisce valutazione e iniziative normalizzate', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'read_latest_audit', input: {} }, { tool: 'finish', input: FINISH_INPUT }], rec)
    );

    const out = await runSeoAgent(baseOpts() as never);

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(out?.evaluation.grade).toBe('B');
    expect(out?.initiatives).toHaveLength(1);
    expect(out?.initiatives[0].targetQuery).toBe('regolare macina espresso');
    expect(rec.calls[1].output).toMatchObject({ ok: true });
  });

  it('registra la corsa come `finished` e logga la chiamata riuscita', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: FINISH_INPUT }], rec));

    await runSeoAgent(baseOpts() as never);

    expect(persistAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b1', agent: 'seo', mode: 'plan', status: 'finished', finishedOk: true })
    );
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ label: 'seoAgent', ok: true }));
  });

  it('lascia una riga di sessione leggibile su agent_sessions', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: FINISH_INPUT }], rec));

    await runSeoAgent(baseOpts() as never);

    const finishedRow = agentSessionWrites.find((r) => r.status === 'finished');
    expect(finishedRow).toMatchObject({ agent: 'seo', surface: 'batch', brand_id: 'b1', mode: 'plan' });
  });
});

describe('quando non chiude', () => {
  it('senza finish la corsa è fallita e non torna niente', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'read_latest_audit', input: {} }], rec));

    const out = await runSeoAgent(baseOpts() as never);

    expect(out).toBeNull();
    expect(persistAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'seo', status: 'failed', finishedOk: false })
    );
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ label: 'seoAgent', ok: false }));
  });

  it('un modello che esplode non propaga: la corsa torna null', async () => {
    generateText.mockImplementation(async () => {
      throw new Error('gateway giù');
    });

    const out = await runSeoAgent(baseOpts() as never);

    expect(out).toBeNull();
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ label: 'seoAgent', ok: false, error: 'gateway giù' }));
  });

  it('si ferma al tetto degli step', async () => {
    const rec = newRecord();
    const script = Array.from({ length: MAX_SEO_AGENT_STEPS + 5 }, (_, i) => ({
      tool: 'read_seo_metrics',
      input: { note: `giro ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await runSeoAgent(baseOpts() as never);

    expect(rec.calls.length).toBeLessThanOrEqual(MAX_SEO_AGENT_STEPS);
  });
});

describe('il budget scritto nel system di ogni step', () => {
  it('porta i contatori e il tempo che resta', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: FINISH_INPUT }], rec));

    await runSeoAgent(baseOpts() as never);

    expect(String(rec.prepared[0].system)).toContain('usd_remaining≈');
    expect(String(rec.prepared[0].system)).toContain('time_left≈');
  });
});
