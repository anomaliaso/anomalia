import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * CARATTERIZZAZIONE DEL GIRO DEL PIANIFICATORE UGC.
 *
 * Ottavo dei dodici, e uno dei due che **restano**: la produzione UGC è il prodotto, non il
 * framework. Si aggancia `generateText` dell'SDK — il confine che sopravvive alla riscrittura —
 * e si fissa il comportamento di oggi prima di toccarlo.
 */

const { generateText, logAiCall, readMediaForAgent, resolveBrandImageIds, agentSessionWrites } =
  vi.hoisted(() => ({
    generateText: vi.fn(),
    logAiCall: vi.fn(),
    readMediaForAgent: vi.fn(),
    resolveBrandImageIds: vi.fn(),
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

vi.mock('$lib/server/strategy-agent-reads', () => ({ readMediaForAgent }));

vi.mock('$lib/server/brand-media', () => ({ resolveBrandImageIds }));

vi.mock('$lib/server/wall-digest', () => ({ trendingWallDigestSection: async () => '' }));

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

import { UGC_PLAN_MAX_STEPS, planUgcClipsWithTools } from './ugc-plan-agent';

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

function clip(over: AnyRec = {}): AnyRec {
  return {
    hook: 'Non riuscivo a tenere la macina ferma nemmeno un giorno.',
    body: 'Ho provato a segnare la ghiera col pennarello e in tre giorni si era spostata di due tacche, poi ho scoperto il fermo.',
    cta: 'Se ti succede, guarda il fermo.',
    setting: 'cucina di casa',
    format: 'talking_head',
    hook_visual: 'la mano che gira la ghiera in primo piano',
    ...over
  };
}

type ScriptedCall = { tool: string; input?: unknown };
type DriveRecord = {
  calls: Array<{ tool: string; output: unknown }>;
  system: string;
  prompt: string;
  toolNames: string[];
  abortSignal: unknown;
};

function drive(script: ScriptedCall[], record: DriveRecord) {
  return async (options: AnyRec) => {
    record.system = String(options.system ?? '');
    record.prompt = String(options.prompt ?? '');
    record.toolNames = Object.keys(options.tools ?? {});
    record.abortSignal = options.abortSignal;

    const steps: AnyRec[] = [];
    for (const entry of script) {
      await options.prepareStep?.({ stepNumber: steps.length, steps });

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
    brandId: 'b1',
    userId: 'u1',
    prompt: 'Tre clip sul fermo della ghiera',
    count: 1,
    assignmentLines: 'clip 1 — prodotto: macinino',
    brand: { name: 'Demo Brand', offerings: [], people: [], products: [] },
    ...over
  };
}

function newRecord(): DriveRecord {
  return { calls: [], system: '', prompt: '', toolNames: [], abortSignal: undefined };
}

beforeEach(() => {
  vi.clearAllMocks();
  agentSessionWrites.length = 0;
  readMediaForAgent.mockResolvedValue({ media: [] });
  resolveBrandImageIds.mockResolvedValue(['https://cdn.example/m1.png']);
});

describe('il tavolo dei tool offerto al modello', () => {
  it('porta le letture di contesto del brand, il banco idee, read_media e submit', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'submit_ugc_scripts', input: { clips: [clip()] } }], rec));

    await planUgcClipsWithTools(baseOpts() as never);

    expect(rec.toolNames).toContain('read_brand_studio');
    expect(rec.toolNames).toContain('read_knowledge');
    expect(rec.toolNames).toContain('read_media');
    expect(rec.toolNames).toContain('submit_ugc_scripts');
    expect(rec.toolNames).toContain('read_disruptive_ideas');
  });

  it('il conteggio richiesto arriva nel system e nel prompt', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'submit_ugc_scripts', input: { clips: [clip(), clip()] } }], rec)
    );

    await planUgcClipsWithTools(baseOpts({ count: 2 }) as never);

    expect(rec.system).toContain('Demo Brand');
    expect(rec.prompt).toContain('Tre clip sul fermo della ghiera');
    expect(rec.prompt).toContain('clip 1 — prodotto: macinino');
  });

  it('il segnale di annullamento del chiamante arriva all SDK', async () => {
    const rec = newRecord();
    const controller = new AbortController();
    generateText.mockImplementation(drive([{ tool: 'submit_ugc_scripts', input: { clips: [clip()] } }], rec));

    await planUgcClipsWithTools(baseOpts({ abortSignal: controller.signal }) as never);

    expect(rec.abortSignal).toBe(controller.signal);
  });
});

describe('la consegna', () => {
  it('submit_ugc_scripts fissa le clip e chiude il giro', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive(
        [
          { tool: 'submit_ugc_scripts', input: { clips: [clip()] } },
          { tool: 'read_media', input: { query: 'mai eseguito' } }
        ],
        rec
      )
    );

    const out = await planUgcClipsWithTools(baseOpts() as never);

    expect(rec.calls).toHaveLength(1);
    expect(out.clips).toHaveLength(1);
    expect(out.clips[0].hook).toBe(clip().hook);
    expect(out.toolsUsed).toEqual(['submit_ugc_scripts']);
  });

  it('taglia le clip in eccesso al numero chiesto', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'submit_ugc_scripts', input: { clips: [clip(), clip(), clip()] } }], rec)
    );

    const out = await planUgcClipsWithTools(baseOpts({ count: 1 }) as never);

    expect(out.clips).toHaveLength(1);
  });

  it('i media_ids scelti diventano URL veri, al massimo sei', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive(
        [
          {
            tool: 'submit_ugc_scripts',
            input: { clips: [clip()], media_ids: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'] }
          }
        ],
        rec
      )
    );

    const out = await planUgcClipsWithTools(baseOpts() as never);

    expect(resolveBrandImageIds).toHaveBeenCalledWith(expect.anything(), 'b1', [
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6'
    ]);
    expect(out.mediaUrls).toEqual(['https://cdn.example/m1.png']);
  });

  it('senza media_ids non si va a risolvere niente', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'submit_ugc_scripts', input: { clips: [clip()] } }], rec));

    const out = await planUgcClipsWithTools(baseOpts() as never);

    expect(resolveBrandImageIds).not.toHaveBeenCalled();
    expect(out.mediaUrls).toEqual([]);
  });
});

describe('le spie che accendono i chip nella UI', () => {
  it('ogni tool annuncia l inizio e la fine', async () => {
    const rec = newRecord();
    const started: string[] = [];
    const done: string[] = [];
    generateText.mockImplementation(
      drive(
        [
          { tool: 'read_media', input: { query: 'schermate' } },
          { tool: 'submit_ugc_scripts', input: { clips: [clip()] } }
        ],
        rec
      )
    );

    await planUgcClipsWithTools(
      baseOpts({
        onToolStart: ({ toolName }: AnyRec) => started.push(toolName),
        onTool: ({ toolName }: AnyRec) => done.push(toolName)
      }) as never
    );

    expect(started).toEqual(['read_media', 'submit_ugc_scripts']);
    expect(done).toEqual(['read_media', 'submit_ugc_scripts']);
  });
});

describe('quando non consegna', () => {
  it('senza submit torna zero clip e la chiamata è registrata come fallita', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'read_media', input: { query: 'x' } }], rec));

    const out = await planUgcClipsWithTools(baseOpts() as never);

    expect(out.clips).toEqual([]);
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ label: 'ugc-plan-agent', ok: false }));
  });

  it('un modello che esplode non propaga: il chiamante riceve zero clip', async () => {
    generateText.mockImplementation(async () => {
      throw new Error('gateway giù');
    });

    const out = await planUgcClipsWithTools(baseOpts() as never);

    expect(out.clips).toEqual([]);
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ label: 'ugc-plan-agent', ok: false }));
  });

  it('si ferma al tetto degli step', async () => {
    const rec = newRecord();
    const script = Array.from({ length: UGC_PLAN_MAX_STEPS + 4 }, (_, i) => ({
      tool: 'read_media',
      input: { query: `giro ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await planUgcClipsWithTools(baseOpts() as never);

    expect(rec.calls.length).toBeLessThanOrEqual(UGC_PLAN_MAX_STEPS);
  });
});

describe('la traccia della corsa', () => {
  it('lascia una riga di sessione leggibile su agent_sessions', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'submit_ugc_scripts', input: { clips: [clip()] } }], rec));

    await planUgcClipsWithTools(baseOpts() as never);

    const finishedRow = agentSessionWrites.find((r) => r.status === 'finished');
    expect(finishedRow).toMatchObject({ agent: 'ugc_plan', surface: 'batch', brand_id: 'b1', mode: '1' });
  });

  it('logga il conto delle clip e dei media nel contesto', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'submit_ugc_scripts', input: { clips: [clip()], media_ids: ['m1'] } }], rec)
    );

    await planUgcClipsWithTools(baseOpts() as never);

    expect(logAiCall).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'ugc-plan-agent', ok: true, context: expect.stringContaining('clips1') })
    );
  });
});
