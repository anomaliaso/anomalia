import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * CARATTERIZZAZIONE DEL GIRO DEL WEEK PLANNER.
 *
 * Non c'è una versione precedente da confrontare: la storia del repository è un solo commit. Il
 * comportamento di oggi È la specifica, e questi test lo fissano PRIMA che l'orchestratore esca
 * dal framework — la sequenza dei tool, quante volte si paga un modello, cosa finisce in
 * `agent_runs`, cosa esce quando il giro non chiude.
 *
 * Il punto di aggancio è `generateText` dell'SDK, non `harnessGenerateText`: è l'unico confine
 * che sopravvive alla riscrittura, quindi gli stessi test valgono su entrambe le implementazioni.
 */

const {
  generateText,
  logAiCall,
  persistAgentRun,
  draftWeekSeeds,
  loadActivePlan,
  weekMixForSpan,
  loadBatchFeasibilityContext,
  fetchUsdBudget,
  groundedText,
  loadKnownSubreddits,
  agentSessionWrites
} = vi.hoisted(() => ({
  generateText: vi.fn(),
  logAiCall: vi.fn(),
  persistAgentRun: vi.fn(),
  draftWeekSeeds: vi.fn(),
  loadActivePlan: vi.fn(),
  weekMixForSpan: vi.fn(),
  loadBatchFeasibilityContext: vi.fn(),
  fetchUsdBudget: vi.fn(),
  groundedText: vi.fn(),
  loadKnownSubreddits: vi.fn(),
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

vi.mock('$lib/server/editorial-plan', () => ({ loadActivePlan, weekMixForSpan }));

vi.mock('$lib/server/content-preview', () => ({ draftWeekSeeds }));

vi.mock('$lib/server/rubrics-feasibility', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/server/rubrics-feasibility')>('$lib/server/rubrics-feasibility');
  return { ...actual, loadBatchFeasibilityContext };
});

vi.mock('$lib/server/strategy-agent', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/strategy-agent')>('$lib/server/strategy-agent');
  return { ...actual, fetchUsdBudget };
});

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

vi.mock('$lib/server/research', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/research')>('$lib/server/research');
  return { ...actual, groundedText };
});

vi.mock('$lib/server/platform-hygiene', () => ({
  loadKnownSubreddits,
  knownSubredditsBlock: (subs: string[]) => `KNOWN SUBREDDITS: ${subs.join(', ')}`
}));

vi.mock('$lib/server/disruptive-ideas', () => ({
  createDisruptiveIdeaTools: () => ({})
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
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) })
    })
  })
}));

import { MAX_WEEK_PLANNER_DRAFTS, MAX_WEEK_PLANNER_RESEARCH, MAX_WEEK_PLANNER_STEPS, runWeekPlannerAgent } from './week-planner-agent';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Supabase finto: qualunque catena risolve a `{ data: [] }`. I tool che leggono non sono il soggetto. */
function stubSupabase(): AnyRec {
  const chain: AnyRec = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: null, error: null });
        return () => chain;
      }
    }
  );
  return { from: () => chain };
}

type ScriptedCall = { tool: string; input?: unknown };
type DriveRecord = {
  prepared: AnyRec[];
  calls: Array<{ tool: string; output: unknown }>;
  system: string;
  prompt: string;
  toolNames: string[];
  meta: AnyRec;
};

/**
 * Il giro dell'SDK, ridotto a ciò che l'orchestratore osserva: `prepareStep` prima dello step,
 * il tool eseguito attraverso le opzioni che l'orchestratore ha davvero passato, `onStepFinish`
 * dopo, e le `stopWhen` valutate alla fine dello step come fa l'SDK.
 */
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

function seed(over: AnyRec = {}): AnyRec {
  return {
    id: 's1',
    platform: 'instagram',
    platforms: ['instagram'],
    format: 'single_image',
    media: 'image',
    day: 'Monday',
    time: '09:00',
    angle: 'la delega a se stessi',
    pillar: 'burocrazia',
    subject: 'scrivania',
    setting: 'ufficio',
    props: '',
    product: '',
    person: '',
    ...over
  };
}

function feasibilityCtx(over: AnyRec = {}): AnyRec {
  return {
    expectedSeedCount: 1,
    selectedPlatforms: ['instagram'],
    products: [],
    people: [],
    mediaIds: new Set<string>(),
    rubrics: [],
    ...over
  };
}

function baseOpts(over: AnyRec = {}): AnyRec {
  return {
    supabase: stubSupabase(),
    userId: 'u1',
    brandId: 'b1',
    profile: { name: 'Demo Brand' },
    platforms: ['instagram'],
    count: 1,
    weekIndex: 0,
    deadlineMs: 60_000,
    ...over
  };
}

function newRecord(): DriveRecord {
  return { prepared: [], calls: [], system: '', prompt: '', toolNames: [], meta: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  agentSessionWrites.length = 0;
  fetchUsdBudget.mockResolvedValue(2);
  loadActivePlan.mockResolvedValue({ id: 'plan-1' });
  weekMixForSpan.mockReturnValue([{ type: 'single_image', count: 1 }]);
  loadBatchFeasibilityContext.mockResolvedValue(feasibilityCtx());
  loadKnownSubreddits.mockResolvedValue([]);
  draftWeekSeeds.mockResolvedValue({ theme: 'Tema', rationale: 'Perché', doDont: 'DO/DON\'T', seeds: [seed()] });
  groundedText.mockResolvedValue({ text: 'risposta', citations: [{ title: 'Fonte', uri: 'https://esempio.it/a' }] });
});

describe('il contesto che il planner carica prima di parlare col modello', () => {
  it('carica piano attivo e contesto di fattibilità con il conteggio e le piattaforme del batch', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_seeds', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'fatto' } }], rec)
    );

    await runWeekPlannerAgent(baseOpts({ count: 3, platforms: ['instagram', 'x'], weeks: 2 }) as never);

    expect(loadActivePlan).toHaveBeenCalledWith(expect.anything(), 'b1');
    expect(loadBatchFeasibilityContext).toHaveBeenCalledWith(
      expect.anything(),
      'b1',
      expect.objectContaining({ expectedSeedCount: 3, selectedPlatforms: ['instagram', 'x'], weekIndex: 0, weeks: 2 })
    );
    expect(weekMixForSpan).toHaveBeenCalledWith({ id: 'plan-1' }, 0, 2);
  });

  it('non carica i subreddit quando reddit non è fra le piattaforme', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { notes: 'x' } }], rec));
    draftWeekSeeds.mockResolvedValue({ theme: '', rationale: '', doDont: '', seeds: [seed()] });

    await expect(runWeekPlannerAgent(baseOpts() as never)).rejects.toThrow();
    expect(loadKnownSubreddits).not.toHaveBeenCalled();
  });

  it('carica i subreddit e li mette nel prompt quando reddit è fra le piattaforme', async () => {
    const rec = newRecord();
    loadKnownSubreddits.mockResolvedValue(['r/italia']);
    loadBatchFeasibilityContext.mockResolvedValue(feasibilityCtx({ selectedPlatforms: ['reddit'] }));
    draftWeekSeeds.mockResolvedValue({
      theme: '',
      rationale: '',
      doDont: '',
      seeds: [seed({ platform: 'reddit', platforms: ['reddit'], title: 'T', subreddit: 'italia' })]
    });
    generateText.mockImplementation(
      drive([{ tool: 'draft_seeds', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runWeekPlannerAgent(baseOpts({ platforms: ['reddit'] }) as never);

    expect(loadKnownSubreddits).toHaveBeenCalledWith(expect.anything(), 'b1');
    expect(rec.prompt).toContain('KNOWN SUBREDDITS: r/italia');
  });
});

describe('il tavolo dei tool offerto al modello', () => {
  it('è esattamente questo elenco', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_seeds', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runWeekPlannerAgent(baseOpts() as never);

    expect(rec.toolNames.sort()).toEqual(
      [
        'check_batch_feasibility',
        'draft_seeds',
        'finish',
        'read_brand_studio',
        'read_competitors',
        'read_editorial_plan',
        'read_gtm',
        'read_knowledge',
        'read_leads',
        'read_media',
        'read_post_history',
        'read_rubrics',
        'read_strategy_report',
        'repair_seeds',
        'research'
      ].sort()
    );
  });
});

describe('il percorso che chiude', () => {
  it('una bozza, un controllo, finish: una sola chiamata al modello di bozza', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive(
        [
          { tool: 'read_rubrics', input: {} },
          { tool: 'draft_seeds', input: { brief: 'una settimana' } },
          { tool: 'check_batch_feasibility', input: { seeds: [{}] } },
          { tool: 'finish', input: { notes: 'settimana pronta' } }
        ],
        rec
      )
    );

    const out = await runWeekPlannerAgent(baseOpts() as never);

    expect(draftWeekSeeds).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(out.strategy.seeds).toHaveLength(1);
    expect(out.notes).toBe('settimana pronta');
    expect(out.costUsd).toBeGreaterThan(0);
    expect(rec.calls.find((c) => c.tool === 'check_batch_feasibility')?.output).toMatchObject({ ok: true });
    expect(rec.calls.find((c) => c.tool === 'finish')?.output).toMatchObject({ ok: true });
  });

  it('registra la corsa come `finished` e logga la chiamata riuscita', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_seeds', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runWeekPlannerAgent(baseOpts() as never);

    expect(persistAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: 'b1',
        agent: 'week_planner',
        mode: 'week_0',
        status: 'finished',
        finishedOk: true,
        notes: 'ok'
      })
    );
    const run = persistAgentRun.mock.calls[0][0];
    expect(run.steps).toHaveLength(2);
    expect(run.steps[0].toolCalls[0].name).toBe('draft_seeds');
    expect(logAiCall).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'week-planner-agent', ok: true, context: 'week-planner-agent', brandId: 'b1' })
    );
  });

  it('lascia una riga di sessione leggibile su agent_sessions', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_seeds', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runWeekPlannerAgent(baseOpts() as never);

    const finishedRow = agentSessionWrites.find((r) => r.status === 'finished');
    expect(finishedRow).toMatchObject({ agent: 'week_planner', surface: 'batch', brand_id: 'b1', mode: '0' });
    expect(Number(finishedRow?.event_count)).toBeGreaterThan(0);
  });
});

describe('i tetti che proteggono il budget del batch', () => {
  it('rifiuta la bozza oltre il tetto e non paga il modello una volta in più', async () => {
    const rec = newRecord();
    const script = Array.from({ length: MAX_WEEK_PLANNER_DRAFTS + 1 }, () => ({
      tool: 'draft_seeds',
      input: { brief: 'ancora' }
    }));
    generateText.mockImplementation(drive(script, rec));

    await expect(runWeekPlannerAgent(baseOpts() as never)).resolves.toBeTruthy();

    expect(draftWeekSeeds).toHaveBeenCalledTimes(MAX_WEEK_PLANNER_DRAFTS);
    expect(rec.calls[MAX_WEEK_PLANNER_DRAFTS].output).toMatchObject({ error: expect.stringContaining('budget') });
  });

  it('rifiuta la ricerca oltre il tetto e non interroga il web una volta in più', async () => {
    const rec = newRecord();
    fetchUsdBudget.mockResolvedValue(50);
    const script = [
      { tool: 'draft_seeds', input: { brief: 'b' } },
      ...Array.from({ length: MAX_WEEK_PLANNER_RESEARCH + 1 }, (_, i) => ({
        tool: 'research',
        input: { question: `domanda numero ${i}` }
      }))
    ];
    generateText.mockImplementation(drive(script, rec));

    await runWeekPlannerAgent(baseOpts() as never);

    expect(groundedText).toHaveBeenCalledTimes(MAX_WEEK_PLANNER_RESEARCH);
    const last = rec.calls[rec.calls.length - 1].output as AnyRec;
    expect(last.error).toContain('Research budget spent');
  });

  it('si ferma dopo quattro step identici di fila, prima del tetto', async () => {
    const rec = newRecord();
    fetchUsdBudget.mockResolvedValue(50);
    const script = [
      { tool: 'draft_seeds', input: { brief: 'b' } },
      ...Array.from({ length: 10 }, () => ({ tool: 'research', input: { question: 'sempre la stessa' } }))
    ];
    generateText.mockImplementation(drive(script, rec));

    await runWeekPlannerAgent(baseOpts() as never);

    expect(groundedText).toHaveBeenCalledTimes(4);
  });

  it('si ferma al tetto degli step', async () => {
    const rec = newRecord();
    const script = Array.from({ length: MAX_WEEK_PLANNER_STEPS + 5 }, (_, i) => ({
      tool: 'read_knowledge',
      input: { limit: (i % 30) + 1 }
    }));
    generateText.mockImplementation(drive(script, rec));

    await expect(runWeekPlannerAgent(baseOpts() as never)).rejects.toThrow(
      'Week planner agent finished without seeds'
    );
    expect(rec.calls.length).toBeLessThanOrEqual(MAX_WEEK_PLANNER_STEPS);
  });
});

describe('il cancello di fattibilità', () => {
  it('finish rifiuta i seed che violano ancora, e non chiude la corsa', async () => {
    const rec = newRecord();
    loadBatchFeasibilityContext.mockResolvedValue(feasibilityCtx({ expectedSeedCount: 3 }));
    generateText.mockImplementation(
      drive([{ tool: 'draft_seeds', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'chiudo' } }], rec)
    );

    const out = await runWeekPlannerAgent(baseOpts({ count: 3 }) as never);

    const finish = rec.calls.find((c) => c.tool === 'finish')?.output as AnyRec;
    expect(finish.error).toBe('Seeds still have feasibility violations');
    expect(finish.violations.length).toBeGreaterThan(0);
    expect(out.notes).toBe('Agent ended without finish; using last draft.');
    expect(persistAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'fallback', finishedOk: false, violations: expect.any(Array) })
    );
  });

  it('chiude da solo quando il giro finisce con seed che passano', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'draft_seeds', input: { brief: 'b' } }], rec));

    const out = await runWeekPlannerAgent(baseOpts() as never);

    expect(out.notes).toBe('Auto-closed: seeds passed feasibility.');
    expect(persistAgentRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'finished', finishedOk: true }));
  });

  it('senza nessun seed la corsa fallisce e viene registrata come fallita', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'read_brand_studio', input: {} }], rec));

    await expect(runWeekPlannerAgent(baseOpts() as never)).rejects.toThrow(
      'Week planner agent finished without seeds'
    );
    expect(persistAgentRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', finishedOk: false }));
  });
});

describe('una storia senza fonte letta davvero', () => {
  const storySeed = seed({
    format: 'carousel',
    slide_count: 2,
    beats: [
      { shows: 'entra', who: 'Marco allo sportello', thinks: 'non ce la faccio' },
      { shows: 'esce', who: 'Marco fuori', thinks: 'devo tornare' }
    ]
  });

  it('sul ripiego toglie la storia e tiene il post', async () => {
    const rec = newRecord();
    draftWeekSeeds.mockResolvedValue({
      theme: '',
      rationale: '',
      doDont: '',
      seeds: [{ ...storySeed, sourced_from: 'Linee guida CNOPD' }]
    });
    loadBatchFeasibilityContext.mockResolvedValue(feasibilityCtx({ expectedSeedCount: 2 }));
    generateText.mockImplementation(drive([{ tool: 'draft_seeds', input: { brief: 'b' } }], rec));

    const out = await runWeekPlannerAgent(baseOpts({ count: 2 }) as never);

    expect(out.notes).toBe('Agent ended without finish; using last draft.');
    expect(out.strategy.seeds[0].beats).toBeUndefined();
    expect(out.strategy.seeds[0].sourced_from).toBeUndefined();
  });

  it('una fonte che punta a una pagina davvero letta passa il cancello', async () => {
    const rec = newRecord();
    fetchUsdBudget.mockResolvedValue(50);
    draftWeekSeeds.mockResolvedValue({
      theme: '',
      rationale: '',
      doDont: '',
      seeds: [{ ...storySeed, sourced_from: 'racconto su https://esempio.it/a' }]
    });
    generateText.mockImplementation(
      drive(
        [
          { tool: 'research', input: { question: 'come lo raccontano?' } },
          { tool: 'draft_seeds', input: { brief: 'b' } },
          { tool: 'check_batch_feasibility', input: { seeds: [{}] } },
          { tool: 'finish', input: { notes: 'storia ancorata' } }
        ],
        rec
      )
    );

    const out = await runWeekPlannerAgent(baseOpts() as never);

    expect(rec.calls.find((c) => c.tool === 'check_batch_feasibility')?.output).toMatchObject({ ok: true });
    expect(out.strategy.seeds[0].beats).toHaveLength(2);
  });
});

describe('la chiusura forzata quando il tempo o i soldi finiscono', () => {
  it('con una bozza in mano e il deadline vicino, lo step successivo può solo chiudere', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_seeds', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runWeekPlannerAgent(baseOpts({ deadlineMs: 1_000 }) as never);

    expect(rec.prepared[1]).toMatchObject({ toolChoice: { type: 'tool', toolName: 'finish' } });
  });

  it('senza niente in mano non forza la chiusura', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'read_brand_studio', input: {} }, { tool: 'read_gtm', input: {} }], rec)
    );

    await expect(runWeekPlannerAgent(baseOpts({ deadlineMs: 1_000 }) as never)).rejects.toThrow();
    expect(rec.prepared[1]?.toolChoice).toBeUndefined();
  });

  it('il budget di ogni step è scritto nel system che il modello vede', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'draft_seeds', input: { brief: 'b' } }, { tool: 'finish', input: { notes: 'ok' } }], rec)
    );

    await runWeekPlannerAgent(baseOpts() as never);

    expect(String(rec.prepared[0].system)).toContain('drafts_left=');
    expect(String(rec.prepared[0].system)).toContain('time_left≈');
  });
});

describe('il guardiano di sessione, che il framework applicava in silenzio', () => {
  it('toglie dal tavolo un tool che ha fallito due volte di fila', async () => {
    const rec = newRecord();
    fetchUsdBudget.mockResolvedValue(0.001);
    generateText.mockImplementation(
      drive(
        [
          { tool: 'research', input: { question: 'a' } },
          { tool: 'research', input: { question: 'b' } },
          { tool: 'research', input: { question: 'c' } }
        ],
        rec
      )
    );

    await expect(runWeekPlannerAgent(baseOpts() as never)).rejects.toThrow();

    expect(rec.calls[0].output).toMatchObject({ error: 'USD budget too low for research' });
    expect(rec.calls[1].output).toMatchObject({ error: 'USD budget too low for research' });
    expect(rec.calls[2].output).toMatchObject({ blocked_by: 'steward', ran: false });
  });

  it('ricorda al modello di leggere il brand quando non lo ha ancora fatto', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive(
        [
          { tool: 'read_gtm', input: {} },
          { tool: 'read_gtm', input: {} },
          { tool: 'draft_seeds', input: { brief: 'b' } },
          { tool: 'finish', input: { notes: 'ok' } }
        ],
        rec
      )
    );

    await runWeekPlannerAgent(baseOpts() as never);

    expect(String(rec.prepared[2].system)).toContain('read_brand_studio');
  });
});
