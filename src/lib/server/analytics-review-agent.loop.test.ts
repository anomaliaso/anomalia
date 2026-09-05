import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * CARATTERIZZAZIONE DEL GIRO DELL'ANALYTICS REVIEW AGENT.
 *
 * Settimo dei dodici, stesso metodo: si aggancia `generateText` dell'SDK — il confine che
 * sopravvive alla riscrittura — e si fissa il comportamento di oggi prima di toccarlo.
 *
 * È l'agente con il tavolo più largo della serie: propone, riscrive e rischedula cose vere.
 * Qui non si esercitano quelle scritture (hanno i loro test); si esercita il GIRO che le guida.
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

vi.mock('$lib/server/brand-context', () => ({ genaiClient: () => ({}) }));

vi.mock('$lib/server/seo-metrics', () => ({ buildSeoMetrics: async () => ({}) }));

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

import { MAX_ANALYTICS_REVIEW_STEPS, runAnalyticsReviewAgent } from './analytics-review-agent';

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
    brand: { id: 'b1', name: 'Demo Brand', slug: 'demo', timezone: 'Europe/Rome', content_prefs: {} },
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
  fetchUsdBudget.mockResolvedValue(4);
});

describe('il tavolo dei tool offerto al modello', () => {
  it('è esattamente questo elenco', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { notes: 'nulla da cambiare' } }], rec));

    await runAnalyticsReviewAgent(baseOpts() as never);

    expect(rec.toolNames.sort()).toEqual(
      [
        'adjust_active_week',
        'finish',
        'propose_editorial_revision',
        'propose_gtm_adjustment',
        'read_performance',
        'read_plans',
        'remember_lesson',
        'reschedule_pending_post',
        'revise_draft_article',
        'rewrite_pending_post'
      ].sort()
    );
  });

  it('il system porta la disciplina sull evidenza e il digest', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { notes: 'ok' } }], rec));

    await runAnalyticsReviewAgent(baseOpts() as never);

    expect(rec.system).toContain('EVIDENCE DISCIPLINE');
    expect(rec.system).toContain('Current digest:');
    expect(rec.system).toContain('Demo Brand');
  });

  it('la guida dell owner finisce nel system quando c è', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { notes: 'ok' } }], rec));

    await runAnalyticsReviewAgent(baseOpts({ guidance: 'guarda i salvataggi, non le impression' }) as never);

    expect(rec.system).toContain('Owner guidance: guarda i salvataggi, non le impression');
  });
});

describe('il percorso che chiude', () => {
  it('finish restituisce le note e il conto delle azioni', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'read_performance', input: {} }, { tool: 'finish', input: { notes: '  Niente da cambiare.  ' } }], rec)
    );

    const out = await runAnalyticsReviewAgent(baseOpts() as never);

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(out?.notes).toBe('Niente da cambiare.');
    expect(out?.actions).toEqual([]);
    expect(rec.calls[1].output).toMatchObject({ ok: true, actions: 0 });
  });

  it('registra la corsa come `finished` e logga la chiamata riuscita', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { notes: 'ok' } }], rec));

    await runAnalyticsReviewAgent(baseOpts() as never);

    expect(persistAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: 'b1',
        agent: 'analytics_review',
        mode: 'weekly',
        status: 'finished',
        finishedOk: true
      })
    );
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ label: 'analyticsReviewAgent', ok: true }));
  });

  it('lascia una riga di sessione leggibile su agent_sessions', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { notes: 'ok' } }], rec));

    await runAnalyticsReviewAgent(baseOpts() as never);

    const finishedRow = agentSessionWrites.find((r) => r.status === 'finished');
    expect(finishedRow).toMatchObject({
      agent: 'analytics_review',
      surface: 'batch',
      brand_id: 'b1',
      mode: 'weekly'
    });
  });

  it('il modo scelto dal chiamante arriva alla riga di corsa', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { notes: 'ok' } }], rec));

    await runAnalyticsReviewAgent(baseOpts({ mode: 'monthly' }) as never);

    expect(persistAgentRun).toHaveBeenCalledWith(expect.objectContaining({ mode: 'monthly' }));
  });
});

describe('quando non chiude', () => {
  it('senza finish e senza azioni la corsa è fallita e non torna niente', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'read_performance', input: {} }], rec));

    const out = await runAnalyticsReviewAgent(baseOpts() as never);

    expect(out).toBeNull();
    expect(persistAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'analytics_review', status: 'failed', finishedOk: false })
    );
  });

  it('un modello che esplode non propaga', async () => {
    generateText.mockImplementation(async () => {
      throw new Error('gateway giù');
    });

    const out = await runAnalyticsReviewAgent(baseOpts() as never);

    expect(out).toBeNull();
    expect(logAiCall).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'analyticsReviewAgent', ok: false, error: 'gateway giù' })
    );
  });

  it('si ferma al tetto degli step', async () => {
    const rec = newRecord();
    const script = Array.from({ length: MAX_ANALYTICS_REVIEW_STEPS + 5 }, (_, i) => ({
      tool: 'read_plans',
      input: { note: `giro ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await runAnalyticsReviewAgent(baseOpts() as never);

    expect(rec.calls.length).toBeLessThanOrEqual(MAX_ANALYTICS_REVIEW_STEPS);
  });
});

describe('il budget scritto nel system di ogni step', () => {
  it('porta i contatori e il tempo che resta', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { notes: 'ok' } }], rec));

    await runAnalyticsReviewAgent(baseOpts() as never);

    expect(String(rec.prepared[0].system)).toContain('usd_remaining≈');
    expect(String(rec.prepared[0].system)).toContain('time_left≈');
  });
});

// `harness/index` riesporta `harness/run`, che importa `chat/model` e `chat/controller`: chi
// prende la traccia dall'indice si porta dentro la chat e `$lib/agent` senza usarli. I moduli
// foglia non li toccano, e questo test è l'unica cosa che impedisce di «riordinare» l'import.
describe('da dove arriva la traccia', () => {
  it('l analytics review guida l SDK e non passa dall indice del framework', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/lib/server/analytics-review-agent.ts'), 'utf8');
    expect(src).toMatch(/await generateText\(/);
    expect(src).not.toContain('harnessGenerateText(');
    expect(src).not.toMatch(/from '\$lib\/server\/harness'/);
    expect(src).toMatch(/from '\$lib\/server\/harness\/session'/);
  });
});
