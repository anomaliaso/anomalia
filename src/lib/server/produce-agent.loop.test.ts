import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * CARATTERIZZAZIONE DEI DUE GIRI DEL PRODUCE AGENT.
 *
 * Quinto dei dodici, ed è il primo con DUE giri nello stesso file: il writer (`produce`) e il
 * giudice (`produce_reviewer`), che si passano il batch fino a quattro volte. Il metodo è lo
 * stesso — si aggancia `generateText` dell'SDK, il confine che sopravvive alla riscrittura — ma
 * qui il finto modello deve rispondere in modo diverso a seconda di chi lo chiama.
 */

const {
  generateText,
  logAiCall,
  persistAgentRun,
  renderPreviewImages,
  collectBatchReviewImages,
  groundedText,
  loadOwnPostHistory,
  agentSessionWrites
} = vi.hoisted(() => ({
  generateText: vi.fn(),
  logAiCall: vi.fn(),
  persistAgentRun: vi.fn(),
  renderPreviewImages: vi.fn(),
  collectBatchReviewImages: vi.fn(),
  groundedText: vi.fn(),
  loadOwnPostHistory: vi.fn(),
  agentSessionWrites: [] as Array<Record<string, unknown>>
}));

vi.mock('$env/dynamic/private', () => ({ env: { KIE_API_KEY: 'test-kie' } }));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateText };
});

vi.mock('$lib/server/llm', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/llm')>('$lib/server/llm');
  return {
    ...actual,
    llmConfigured: () => true,
    llmDefaultModel: () => 'gemini-3.7-flash',
    llmLanguageModel: () => ({ modelId: 'gemini-3.7-flash' })
  };
});

vi.mock('$lib/server/ai-log', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/ai-log')>('$lib/server/ai-log');
  return { ...actual, logAiCall };
});

vi.mock('$lib/server/agent-runs', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/agent-runs')>('$lib/server/agent-runs');
  return { ...actual, persistAgentRun };
});

vi.mock('$lib/server/kie', () => ({
  KIE_MODEL: 'grok-4-6',
  KIE_GROK_NO_STORE: { store: false },
  kieFetch: () => globalThis.fetch
}));

vi.mock('$lib/server/research', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/research')>('$lib/server/research');
  return { ...actual, groundedText };
});

vi.mock('$lib/server/own-post-history', () => ({ loadOwnPostHistory }));

vi.mock('$lib/server/brand-context', () => ({
  fetchImagePart: async () => null,
  genaiClient: () => ({}),
  makeGenaiClient: () => ({})
}));

vi.mock('$lib/server/market-references', () => ({
  ensureMarketReferences: async () => [],
  formatMarketBrief: () => 'MARKET'
}));

vi.mock('$lib/server/thematic-calendar', () => ({ upcomingTimelyHooks: async () => '' }));

vi.mock('$lib/server/strategy-agent-reads', () => ({
  readBrandStudioForAgent: async () => ({ studio: 'brand kit' }),
  readEditorialPlanForAgent: async () => ({ plan: 'active' }),
  readGtmForAgent: async () => ({ gtm: 'phase 1' }),
  readKnowledgeForAgent: async () => ({ docs: [] }),
  readLeadsForAgent: async () => ({ leads: [] }),
  readMediaForAgent: async () => ({ media: [] }),
  readRubricsForAgent: async () => ({ rubrics: [] }),
  readStrategyReportForAgent: async () => ({ report: 'none' }),
  readVisualInsightsForAgent: async () => ''
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

vi.mock('$lib/server/content-preview', async () => {
  const actual =
    await vi.importActual<typeof import('$lib/server/content-preview')>('$lib/server/content-preview');
  return { ...actual, renderPreviewImages, collectBatchReviewImages };
});

import { PRODUCE_AGENT_MAX_STEPS, PRODUCE_MAX_ROUNDS, runProduceAgentLoop } from './produce-agent';

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

const SEED = {
  id: 's1',
  platform: 'instagram',
  platforms: ['instagram'],
  format: 'single_image',
  media: 'image' as const,
  day: 'Monday',
  time: '09:00',
  angle: 'la ghiera che non resta ferma',
  pillar: 'strumenti',
  subject: 'macine',
  setting: 'banco',
  props: '',
  product: '',
  person: ''
};

const STRATEGY = {
  theme: 'Il banco di lavoro',
  rationale: 'Gli strumenti raccontano il mestiere',
  doDont: 'DO concreto. DON\'T slogan.',
  seeds: [SEED]
};

const CRAFT = {
  index: 0,
  caption: 'Le macine piane da 64mm, e perché la ghiera non resta mai ferma.',
  image_prompt: 'macine in acciaio su fondo crema, risografia',
  justification: 'lo strumento è il contenuto'
};

type ScriptedCall = { tool: string; input?: unknown };
type TurnRecord = {
  agent: string;
  system: string;
  messages: AnyRec[];
  toolNames: string[];
  calls: Array<{ tool: string; output: unknown }>;
};

const turns: TurnRecord[] = [];

/** Un giro dell'SDK. `agent` è dedotto dal tavolo: solo il giudice ha `approve`. */
function drive(script: ScriptedCall[], text = '') {
  return async (options: AnyRec) => {
    const toolNames = Object.keys(options.tools ?? {});
    const rec: TurnRecord = {
      agent: toolNames.includes('approve') ? 'produce_reviewer' : 'produce',
      system: String(options.system ?? ''),
      messages: (options.messages ?? []) as AnyRec[],
      toolNames,
      calls: []
    };
    turns.push(rec);

    const steps: AnyRec[] = [];
    for (const entry of script) {
      await options.prepareStep?.({ stepNumber: steps.length, steps });

      const impl = options.tools?.[entry.tool];
      const output = impl ? await impl.execute(entry.input ?? {}, {}) : { error: 'no such tool' };
      rec.calls.push({ tool: entry.tool, output });

      const toolCalls = [{ toolName: entry.tool, input: entry.input ?? {}, type: 'tool-call' }];
      const toolResults = [{ toolName: entry.tool, output, type: 'tool-result' }];
      const usage = { inputTokens: 100, outputTokens: 40 };
      steps.push({ toolCalls, toolResults, text: '', usage });
      await options.onStepFinish?.({ toolCalls, toolResults, text: '', usage });

      const stops = (options.stopWhen ?? []) as Array<(a: AnyRec) => boolean | Promise<boolean>>;
      const verdicts = await Promise.all(stops.map((s) => s({ steps, stepNumber: steps.length })));
      if (verdicts.some(Boolean)) break;
    }
    return {
      text,
      totalUsage: { inputTokens: 100 * steps.length, outputTokens: 40 * steps.length },
      steps,
      response: { messages: [] }
    };
  };
}

const writerSubmits = () =>
  drive([
    { tool: 'submit_batch', input: { posts: [CRAFT], batch_justification: 'crescita organica' } },
    { tool: 'finish', input: { notes: 'fatto' } }
  ]);

const reviewerApproves = () => drive([{ tool: 'approve', input: { summary: 'buono' } }]);
const reviewerRejects = (feedback: string) =>
  drive([{ tool: 'request_changes', input: { summary: 'no', feedback } }]);

function baseOpts(over: AnyRec = {}): AnyRec {
  return {
    supabase: stubSupabase(),
    userId: 'u1',
    brandId: 'b1',
    profile: { name: 'Demo Brand' },
    strategy: STRATEGY,
    prefs: {},
    timezone: 'Europe/Rome',
    deadlineMs: 60_000,
    ...over
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  turns.length = 0;
  agentSessionWrites.length = 0;
  renderPreviewImages.mockResolvedValue(undefined);
  collectBatchReviewImages.mockResolvedValue([
    { label: 'POST 0', inlineData: { mimeType: 'image/png', data: 'AAAA' } }
  ]);
  groundedText.mockResolvedValue({ text: 'risposta', citations: [{ uri: 'https://esempio.it/a' }] });
  loadOwnPostHistory.mockResolvedValue([]);
});

describe('il giro completo, scritto e approvato', () => {
  it('scrive, renderizza, fa giudicare e chiude in un round', async () => {
    generateText.mockImplementationOnce(writerSubmits()).mockImplementationOnce(reviewerApproves());

    const out = await runProduceAgentLoop(baseOpts() as never);

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(turns.map((t) => t.agent)).toEqual(['produce', 'produce_reviewer']);
    expect(renderPreviewImages).toHaveBeenCalledTimes(1);
    expect(out?.approved).toBe(true);
    expect(out?.rounds).toBe(1);
    expect(out?.posts?.[0].caption).toBe(CRAFT.caption);
  });

  it('registra una corsa e logga entrambe le chiamate', async () => {
    generateText.mockImplementationOnce(writerSubmits()).mockImplementationOnce(reviewerApproves());

    await runProduceAgentLoop(baseOpts() as never);

    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ label: 'produce-agent', context: 'produce-agent' }));
    expect(logAiCall).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'produce-reviewer', context: 'produce-reviewer' })
    );
    expect(persistAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b1', agent: 'produce', finishedOk: true })
    );
  });

  it('lascia una riga di sessione per lo scrittore e una per il giudice', async () => {
    generateText.mockImplementationOnce(writerSubmits()).mockImplementationOnce(reviewerApproves());

    await runProduceAgentLoop(baseOpts() as never);

    const rows = agentSessionWrites.filter((r) => r.status === 'finished');
    expect(rows.some((r) => r.agent === 'produce' && r.surface === 'batch')).toBe(true);
    expect(rows.some((r) => r.agent === 'produce_reviewer' && r.surface === 'batch')).toBe(true);
  });
});

describe('i due tavoli', () => {
  it('lo scrittore ha submit_batch e finish, il giudice approve e request_changes', async () => {
    generateText.mockImplementationOnce(writerSubmits()).mockImplementationOnce(reviewerApproves());

    await runProduceAgentLoop(baseOpts() as never);

    const writer = turns[0];
    expect(writer.toolNames).toContain('submit_batch');
    expect(writer.toolNames).toContain('finish');
    expect(writer.toolNames).toContain('read_brand_studio');
    expect(writer.toolNames).toContain('search_web');
    expect(writer.toolNames).not.toContain('approve');

    const reviewer = turns[1];
    expect(reviewer.toolNames.sort()).toEqual(['approve', 'request_changes', 'search_web'].sort());
  });

  it('il giudice riceve ogni immagine dopo la sua etichetta', async () => {
    generateText.mockImplementationOnce(writerSubmits()).mockImplementationOnce(reviewerApproves());

    await runProduceAgentLoop(baseOpts() as never);

    const content = turns[1].messages[0].content as AnyRec[];
    expect(content[0].type).toBe('text');
    expect(content.slice(1)).toEqual([
      { type: 'text', text: '[POST 0]' },
      { type: 'image', image: 'data:image/png;base64,AAAA' }
    ]);
  });

  it('il budget delle ricerche è scritto nel system di ogni step dello scrittore', async () => {
    let stepSystem = '';
    generateText
      .mockImplementationOnce(async (options: AnyRec) => {
        stepSystem = String((await options.prepareStep?.({ stepNumber: 0, steps: [] }))?.system ?? '');
        await options.tools.submit_batch.execute({ posts: [CRAFT], batch_justification: 'x' }, {});
        return { text: '', totalUsage: {}, steps: [], response: { messages: [] } };
      })
      .mockImplementationOnce(reviewerApproves());

    await runProduceAgentLoop(baseOpts() as never);

    expect(stepSystem).toContain('searches_used=0/');
    expect(stepSystem).toContain('remaining_sec≈');
  });
});

describe('il rimpallo fra scrittore e giudice', () => {
  it('un rifiuto rimanda allo scrittore, e la seconda approvazione chiude in due round', async () => {
    generateText
      .mockImplementationOnce(writerSubmits())
      .mockImplementationOnce(reviewerRejects('gli hashtag sono generici'))
      .mockImplementationOnce(writerSubmits())
      .mockImplementationOnce(reviewerApproves());

    const out = await runProduceAgentLoop(baseOpts() as never);

    expect(generateText).toHaveBeenCalledTimes(4);
    expect(out?.rounds).toBe(2);
    expect(out?.approved).toBe(true);
    expect(renderPreviewImages).toHaveBeenCalledTimes(2);
  });

  it('quattro rifiuti di fila spediscono comunque, non approvato', async () => {
    for (let i = 0; i < PRODUCE_MAX_ROUNDS; i++) {
      generateText.mockImplementationOnce(writerSubmits()).mockImplementationOnce(reviewerRejects('ancora no'));
    }

    const out = await runProduceAgentLoop(baseOpts() as never);

    expect(out?.rounds).toBe(PRODUCE_MAX_ROUNDS);
    expect(out?.approved).toBe(false);
    expect(out?.posts).toHaveLength(1);
  });

  it('uno scrittore che non consegna fa ripiegare sul percorso legacy', async () => {
    generateText.mockImplementationOnce(drive([{ tool: 'read_brand_studio', input: {} }]));

    const out = await runProduceAgentLoop(baseOpts() as never);

    expect(out).toBeNull();
    expect(renderPreviewImages).not.toHaveBeenCalled();
  });

  it('un giudice senza verdetto esplicito approva, per non bloccare il batch', async () => {
    generateText
      .mockImplementationOnce(writerSubmits())
      .mockImplementationOnce(drive([{ tool: 'search_web', input: { query: 'x' } }], 'niente da dire'));

    const out = await runProduceAgentLoop(baseOpts() as never);

    expect(out?.approved).toBe(true);
    expect(out?.reviewSummary).toBe('niente da dire');
  });
});

describe('il ripiego di provider', () => {
  it('se kie muore lo scrittore rifà il round su Gemini', async () => {
    generateText
      .mockImplementationOnce(async () => {
        throw new Error('kie out of credits');
      })
      .mockImplementationOnce(writerSubmits())
      .mockImplementationOnce(reviewerApproves());

    const out = await runProduceAgentLoop(baseOpts() as never);

    expect(generateText).toHaveBeenCalledTimes(3);
    expect(out?.approved).toBe(true);
    const rows = agentSessionWrites.filter((r) => r.agent === 'produce');
    expect(rows.some((r) => r.status === 'failed' && r.provider === 'kie')).toBe(true);
    expect(rows.some((r) => r.status === 'finished' && r.provider === 'llm')).toBe(true);
  });
});

describe('i tetti', () => {
  it('lo scrittore si ferma al tetto degli step', async () => {
    const script = Array.from({ length: PRODUCE_AGENT_MAX_STEPS + 5 }, (_, i) => ({
      tool: 'read_knowledge',
      input: { limit: (i % 20) + 1 }
    }));
    generateText.mockImplementationOnce(drive(script));

    const out = await runProduceAgentLoop(baseOpts() as never);

    expect(out).toBeNull();
    expect(turns[0].calls.length).toBeLessThanOrEqual(PRODUCE_AGENT_MAX_STEPS);
  });
});

describe('il guardiano di sessione, che il framework applicava in silenzio', () => {
  // `produce` è fra gli agenti che devono ancorarsi al brand prima di pagare una ricerca:
  // `search_web` non parte finché `read_brand_studio` non è tornato.
  it('non lascia partire una ricerca a pagamento prima che il brand sia stato letto', async () => {
    generateText.mockImplementationOnce(
      drive([
        { tool: 'search_web', input: { query: 'subito al web' } },
        { tool: 'submit_batch', input: { posts: [CRAFT], batch_justification: 'x' } },
        { tool: 'finish', input: { notes: 'ok' } }
      ])
    ).mockImplementationOnce(reviewerApproves());

    await runProduceAgentLoop(baseOpts() as never);

    expect(groundedText).not.toHaveBeenCalled();
    expect(turns[0].calls[0].output).toMatchObject({
      blocked_by: 'steward',
      code: 'search_before_brand',
      ran: false,
      next_tool: 'read_brand_studio'
    });
  });

  it('dopo la lettura del brand la ricerca parte', async () => {
    generateText.mockImplementationOnce(
      drive([
        { tool: 'read_brand_studio', input: {} },
        { tool: 'search_web', input: { query: 'adesso sì' } },
        { tool: 'submit_batch', input: { posts: [CRAFT], batch_justification: 'x' } },
        { tool: 'finish', input: { notes: 'ok' } }
      ])
    ).mockImplementationOnce(reviewerApproves());

    await runProduceAgentLoop(baseOpts() as never);

    expect(groundedText).toHaveBeenCalledTimes(1);
  });

  // Il giudice NON è fra quegli agenti: la sua ricerca parte subito, ed è giusto così — non ha
  // un tavolo di letture del brand da chiamare prima.
  it('il giudice può cercare subito', async () => {
    generateText
      .mockImplementationOnce(writerSubmits())
      .mockImplementationOnce(
        drive([
          { tool: 'search_web', input: { query: 'verifica' } },
          { tool: 'approve', input: { summary: 'ok' } }
        ])
      );

    await runProduceAgentLoop(baseOpts() as never);

    expect(groundedText).toHaveBeenCalledTimes(1);
    expect(turns[1].calls[0].output).not.toMatchObject({ blocked_by: 'steward' });
  });
});
