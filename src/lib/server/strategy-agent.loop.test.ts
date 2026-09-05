import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * CARATTERIZZAZIONE DEL GIRO DELLO STRATEGY AGENT.
 *
 * Stesso metodo del week planner: il comportamento di oggi è la specifica, e va fissato prima
 * che l'orchestratore esca dal framework. Il punto di aggancio è `generateText` dell'SDK — il
 * confine che sopravvive alla riscrittura — quindi questi test giudicano entrambe le
 * implementazioni senza una riga di differenza.
 *
 * Qui, a differenza del week planner, il guardiano di sessione BLOCCA davvero: `search_web` è
 * una ricerca a pagamento, e finché il brand non è stato letto la chiamata non parte.
 */

const {
  generateText,
  logAiCall,
  persistAgentRun,
  parallelVariants,
  groundedText,
  getCreditsUsage,
  agentSessionWrites
} = vi.hoisted(() => ({
  generateText: vi.fn(),
  logAiCall: vi.fn(),
  persistAgentRun: vi.fn(),
  parallelVariants: vi.fn(),
  groundedText: vi.fn(),
  getCreditsUsage: vi.fn(),
  agentSessionWrites: [] as Array<Record<string, unknown>>
}));

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

vi.mock('$lib/server/brand-context', () => ({ genaiClient: () => ({}) }));

vi.mock('$lib/server/ai-text', () => ({
  parallelVariants,
  aiStructured: vi.fn(),
  VARIANT_LENSES: ['contrarian', 'proof', 'community'],
  CREATIVE_TEMPERATURE: 0.9,
  PIN_GATEWAY: {}
}));

vi.mock('$lib/server/research', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/research')>('$lib/server/research');
  return { ...actual, groundedText };
});

vi.mock('$lib/server/credits', () => ({ getCreditsUsage }));

vi.mock('$lib/server/rubrics', () => ({ loadApprovedRubrics: async () => [] }));

vi.mock('$lib/server/strategy-agent-reads', () => ({
  readBrandStudioForAgent: async () => ({ studio: 'brand kit' }),
  readEditorialPlanForAgent: async () => ({ plan: 'active' }),
  readGtmForAgent: async () => ({ gtm: 'phase 1' }),
  readKnowledgeForAgent: async () => ({ docs: [] }),
  readLeadsForAgent: async () => ({ leads: [] }),
  readMediaForAgent: async () => ({ media: [] }),
  readRubricsForAgent: async () => ({ rubrics: [] }),
  readStrategyReportForAgent: async () => ({ report: 'none' })
}));

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
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 'b1', plan: 'pro', activated_at: null, status: 'active' }
          })
        })
      })
    })
  })
}));

import {
  MAX_STRATEGY_DRAFTS,
  MAX_STRATEGY_SEARCHES,
  MAX_STRATEGY_STEPS,
  STALL_STEP_THRESHOLD,
  runStrategyAgent
} from './strategy-agent';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Supabase finto: ogni catena risolve a `{ data: [] }`, ed è attendibile a qualunque punto. */
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

const CADENCE = '3/week';

function goodPlan(over: AnyRec = {}): AnyRec {
  return {
    strategy: 'Il banco di lavoro, quattro settimane',
    cadence: CADENCE,
    platform_mix: [{ platform: 'instagram', share: '100%', role: 'primary' }],
    weeks: Array.from({ length: 4 }, (_, i) => ({
      index: i,
      theme: `Settimana ${i + 1}`,
      focus: 'Gli strumenti del banco',
      rationale: 'Perché è quello che si vede',
      content_mix: [{ type: 'single_image', count: 3 }]
    })),
    ...over
  };
}

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
    userId: 'u1',
    brandId: 'b1',
    profile: { name: 'Demo Brand', about: 'caffè' },
    constraints: { allowedCadences: [CADENCE], platforms: ['instagram'], planTier: 'pro' },
    mode: 'propose',
    seedBrief: 'Il brand vende macinini.',
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
  getCreditsUsage.mockResolvedValue({
    remaining: 500,
    used: 0,
    quota: 500,
    bonus: 0,
    percent: 0,
    periodStart: new Date(),
    periodEnd: new Date()
  });
  parallelVariants.mockResolvedValue(goodPlan());
  groundedText.mockResolvedValue({
    text: 'risposta',
    citations: [{ title: 'Fonte', uri: 'https://esempio.it/a' }]
  });
});

describe('il tavolo dei tool offerto al modello', () => {
  it('è esattamente questo elenco', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_variants', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runStrategyAgent(baseOpts() as never);

    expect(rec.toolNames.sort()).toEqual(
      [
        'check_feasibility',
        'draft_variants',
        'finish',
        'read_brand',
        'read_brand_studio',
        'read_competitors',
        'read_editorial_plan',
        'read_gtm',
        'read_knowledge',
        'read_leads',
        'read_media',
        'read_post_history',
        'read_radar',
        'read_rubrics',
        'read_strategy_report',
        'repair_plan',
        'search_web'
      ].sort()
    );
  });

  it('il prompt di apertura dice di leggere il brand prima di pagare una ricerca', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_variants', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runStrategyAgent(baseOpts() as never);

    expect(rec.prompt).toContain('before any paid search');
    expect(rec.prompt).toContain('Il brand vende macinini.');
  });
});

describe('il percorso che chiude', () => {
  it('una bozza, un finish: una sola generazione di varianti', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive(
        [
          { tool: 'read_brand_studio', input: {} },
          { tool: 'draft_variants', input: { brief: 'quattro settimane' } },
          { tool: 'check_feasibility', input: { plan: goodPlan() } },
          { tool: 'finish', input: { notes: 'piano pronto' } }
        ],
        rec
      )
    );

    const out = await runStrategyAgent(baseOpts() as never);

    expect(parallelVariants).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(out.plan.weeks).toHaveLength(4);
    expect(out.notes).toBe('piano pronto');
    expect(out.credits).toBe(Math.round(out.costUsd * 100));
    expect(rec.calls.find((c) => c.tool === 'check_feasibility')?.output).toMatchObject({ ok: true });
    expect(rec.calls.find((c) => c.tool === 'finish')?.output).toMatchObject({ ok: true });
  });

  it('registra la corsa come `finished` e logga la chiamata riuscita', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_variants', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runStrategyAgent(baseOpts() as never);

    expect(persistAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: 'b1',
        agent: 'strategy',
        mode: 'propose',
        status: 'finished',
        finishedOk: true,
        notes: 'ok'
      })
    );
    expect(logAiCall).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'strategy-agent', ok: true, context: 'strategy-agent', brandId: 'b1' })
    );
  });

  it('lascia una riga di sessione leggibile su agent_sessions', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_variants', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runStrategyAgent(baseOpts() as never);

    const finishedRow = agentSessionWrites.find((r) => r.status === 'finished');
    expect(finishedRow).toMatchObject({ agent: 'strategy', surface: 'batch', brand_id: 'b1', mode: 'propose' });
    expect(Number(finishedRow?.event_count)).toBeGreaterThan(0);
  });
});

describe('i tetti che proteggono il budget del giro', () => {
  it('rifiuta la bozza oltre il tetto e non genera varianti una volta in più', async () => {
    const rec = newRecord();
    const script = Array.from({ length: MAX_STRATEGY_DRAFTS + 1 }, (_, i) => ({
      tool: 'draft_variants',
      input: { brief: `brief ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await runStrategyAgent(baseOpts() as never);

    expect(parallelVariants).toHaveBeenCalledTimes(MAX_STRATEGY_DRAFTS);
    expect(rec.calls[MAX_STRATEGY_DRAFTS].output).toMatchObject({ error: expect.stringContaining('budget') });
  });

  it('rifiuta la ricerca oltre il tetto e non interroga il web una volta in più', async () => {
    const rec = newRecord();
    const script = [
      { tool: 'read_brand_studio', input: {} },
      ...Array.from({ length: MAX_STRATEGY_SEARCHES + 1 }, (_, i) => ({
        tool: 'search_web',
        input: { query: `domanda ${i}` }
      }))
    ];
    generateText.mockImplementation(drive(script, rec));

    await expect(runStrategyAgent(baseOpts() as never)).rejects.toThrow(
      'Strategy agent finished without a plan'
    );

    expect(groundedText).toHaveBeenCalledTimes(MAX_STRATEGY_SEARCHES);
    const last = rec.calls[rec.calls.length - 1].output as AnyRec;
    expect(last.error).toContain('budget exhausted');
  });

  it('si ferma dopo cinque step identici di fila', async () => {
    const rec = newRecord();
    const script = Array.from({ length: STALL_STEP_THRESHOLD + 6 }, () => ({
      tool: 'read_gtm',
      input: { which: 'both' }
    }));
    generateText.mockImplementation(drive(script, rec));

    await expect(runStrategyAgent(baseOpts() as never)).rejects.toThrow();

    expect(rec.calls).toHaveLength(STALL_STEP_THRESHOLD);
  });

  it('si ferma al tetto degli step', async () => {
    const rec = newRecord();
    const script = Array.from({ length: MAX_STRATEGY_STEPS + 5 }, (_, i) => ({
      tool: 'read_knowledge',
      input: { limit: (i % 50) + 1 }
    }));
    generateText.mockImplementation(drive(script, rec));

    await expect(runStrategyAgent(baseOpts() as never)).rejects.toThrow();
    expect(rec.calls.length).toBeLessThanOrEqual(MAX_STRATEGY_STEPS);
  });
});

describe('il cancello di fattibilità', () => {
  it('finish rifiuta un piano che viola ancora, e la corsa esce in ripiego', async () => {
    const rec = newRecord();
    const broken = goodPlan({ weeks: [{ index: 0, theme: '', focus: '', content_mix: [] }] });
    parallelVariants.mockResolvedValue(broken);
    generateText.mockImplementation(
      drive([{ tool: 'draft_variants', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'chiudo' } }], rec)
    );

    const out = await runStrategyAgent(baseOpts() as never);

    const finish = rec.calls.find((c) => c.tool === 'finish')?.output as AnyRec;
    expect(finish.error).toBe('Plan still has feasibility violations');
    expect(finish.violations.length).toBeGreaterThan(0);
    expect(out.notes).toBe('Agent ended without finish; using last draft.');
    expect(persistAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'fallback', finishedOk: false, violations: expect.any(Array) })
    );
  });

  it('senza nessun piano la corsa fallisce e viene registrata come fallita', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'read_brand_studio', input: {} }], rec));

    await expect(runStrategyAgent(baseOpts() as never)).rejects.toThrow(
      'Strategy agent finished without a plan'
    );
    expect(persistAgentRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', finishedOk: false }));
  });

  it('repair_plan rimette in piedi un piano rotto senza ripassare dal generatore', async () => {
    const rec = newRecord();
    parallelVariants.mockResolvedValue(goodPlan({ weeks: [{ index: 0, theme: '', focus: '', content_mix: [] }] }));
    generateText.mockImplementation(
      drive(
        [
          { tool: 'draft_variants', input: { brief: 'b' } },
          { tool: 'repair_plan', input: { patch: goodPlan(), reason: 'settimane vuote' } },
          { tool: 'finish', input: { notes: 'riparato' } }
        ],
        rec
      )
    );

    const out = await runStrategyAgent(baseOpts() as never);

    expect(parallelVariants).toHaveBeenCalledTimes(1);
    expect(rec.calls[1].output).toMatchObject({ ok: true, reason: 'settimane vuote' });
    expect(out.notes).toBe('riparato');
  });
});

describe('le citazioni', () => {
  it('quelle della ricerca finiscono nel risultato', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive(
        [
          { tool: 'read_brand_studio', input: {} },
          { tool: 'search_web', input: { query: 'quanto costa un macinino' } },
          { tool: 'draft_variants', input: { brief: 'b' } },
          { tool: 'finish', input: { notes: 'ok' } }
        ],
        rec
      )
    );

    const out = await runStrategyAgent(baseOpts() as never);

    expect(out.citations).toEqual([{ title: 'Fonte', uri: 'https://esempio.it/a' }]);
  });
});

describe('il guardiano di sessione, che il framework applicava in silenzio', () => {
  // Questa è la regola che sul week planner non esisteva: `search_web` è una ricerca a
  // pagamento, e finché il brand non è stato letto la query NON parte. Il modello riceve
  // un'istruzione, non un errore, perché un errore lo farebbe ritentare.
  it('non lascia partire una ricerca a pagamento prima che il brand sia stato letto', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'search_web', input: { query: 'subito al web' } }], rec)
    );

    await expect(runStrategyAgent(baseOpts() as never)).rejects.toThrow();

    expect(groundedText).not.toHaveBeenCalled();
    expect(rec.calls[0].output).toMatchObject({
      blocked_by: 'steward',
      code: 'search_before_brand',
      ran: false,
      next_tool: 'read_brand_studio'
    });
  });

  it('dopo la lettura del brand la ricerca parte', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive(
        [
          { tool: 'read_brand_studio', input: {} },
          { tool: 'search_web', input: { query: 'adesso sì' } }
        ],
        rec
      )
    );

    await expect(runStrategyAgent(baseOpts() as never)).rejects.toThrow();

    expect(groundedText).toHaveBeenCalledTimes(1);
    expect(rec.calls[1].output).toMatchObject({ text: 'risposta' });
  });

  it('avvisa nel system che la ricerca a pagamento è chiusa finché non si legge il brand', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'read_gtm', input: {} }, { tool: 'read_gtm', input: { which: 'active' } }], rec)
    );

    await expect(runStrategyAgent(baseOpts() as never)).rejects.toThrow();

    expect(String(rec.prepared[1].system)).toContain('read_brand_studio');
  });
});

describe('il budget scritto nel system di ogni step', () => {
  it('porta i contatori che il modello deve vedere', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_variants', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runStrategyAgent(baseOpts() as never);

    const system = String(rec.prepared[0].system);
    expect(system).toContain('searches_left=');
    expect(system).toContain('drafts_left=');
    expect(system).toContain('repairs_left=');
    expect(system).toContain('time_left≈');
  });
});
