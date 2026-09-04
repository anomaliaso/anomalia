import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * CARATTERIZZAZIONE DEL GIRO DEL DIRECTOR.
 *
 * Terzo dei dodici, stesso metodo: il comportamento di oggi è la specifica e va fissato prima
 * che l'orchestratore esca dal framework, agganciando `generateText` dell'SDK — il confine che
 * sopravvive alla riscrittura.
 *
 * Il Director è l'unico dei tre finora che parla al modello per `messages` invece che per
 * `prompt`, perché gli allega le immagini renderizzate; ed è l'unico che riprova su un secondo
 * provider quando il primo muore.
 */

const {
  generateText,
  logAiCall,
  groundedText,
  structured,
  renderPreviewImages,
  collectBatchReviewImages,
  agentSessionWrites
} = vi.hoisted(() => ({
  generateText: vi.fn(),
  logAiCall: vi.fn(),
  groundedText: vi.fn(),
  structured: vi.fn(),
  renderPreviewImages: vi.fn(),
  collectBatchReviewImages: vi.fn(),
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

vi.mock('./ai-log', async () => {
  const actual = await vi.importActual<typeof import('./ai-log')>('./ai-log');
  return { ...actual, logAiCall };
});

vi.mock('./research', () => ({ groundedText, structured }));

vi.mock('./content-preview', () => ({
  renderPreviewImages,
  collectBatchReviewImages,
  platformPlaybook: () => 'PLAYBOOK'
}));

vi.mock('./kie', () => ({
  KIE_MODEL: 'grok-4-6',
  KIE_GROK_NO_STORE: { store: false },
  kieFetch: () => globalThis.fetch
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

import { runDirector } from './director';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const MAX_STEPS = 8;
const SEARCH_BUDGET = 2;
const REWRITE_BUDGET = 3;
const RERENDER_BUDGET = 2;

function post(over: AnyRec = {}): AnyRec {
  return {
    platform: 'instagram',
    format: 'single_image',
    media: 'image',
    caption: 'La ghiera del macinino non resta mai ferma.',
    image_prompt: 'macine in acciaio su fondo crema',
    imageUrl: 'https://cdn.example/a.png',
    ...over
  };
}

type ScriptedCall = { tool: string; input?: unknown };
type DriveRecord = {
  calls: Array<{ tool: string; output: unknown }>;
  system: string;
  messages: AnyRec[];
  toolNames: string[];
  providerOptions: AnyRec;
};

function drive(script: ScriptedCall[], record: DriveRecord, text = '') {
  return async (options: AnyRec) => {
    record.system = String(options.system ?? '');
    record.messages = (options.messages ?? []) as AnyRec[];
    record.toolNames = Object.keys(options.tools ?? {});
    record.providerOptions = options.providerOptions ?? {};

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
    return { text, usage: { inputTokens: 900, outputTokens: 120 }, steps };
  };
}

function baseOpts(over: AnyRec = {}): AnyRec {
  return {
    supabase: {},
    userId: 'u1',
    brandId: 'b1',
    profile: { name: 'Demo Brand', visual_style: 'risografia', language: 'italiano' },
    posts: [post()],
    brief: 'La settimana del banco',
    ...over
  };
}

function newRecord(): DriveRecord {
  return { calls: [], system: '', messages: [], toolNames: [], providerOptions: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  agentSessionWrites.length = 0;
  collectBatchReviewImages.mockResolvedValue([
    { label: 'POST 0', inlineData: { mimeType: 'image/png', data: 'AAAA' } }
  ]);
  groundedText.mockResolvedValue({ text: 'risposta verificata', citations: [{ uri: 'https://esempio.it/a' }] });
  structured.mockResolvedValue({ caption: 'Didascalia riscritta.' });
  renderPreviewImages.mockResolvedValue(undefined);
});

describe('un batch vuoto', () => {
  it('non chiama nessun modello', async () => {
    generateText.mockImplementation(drive([], newRecord()));

    const log = await runDirector(baseOpts({ posts: [] }) as never);

    expect(log).toEqual({ steps: [], summary: '(empty batch)' });
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe('quello che il modello riceve', () => {
  it('offre esattamente questi tool', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { summary: 'tutto a posto' } }], rec));

    await runDirector(baseOpts() as never);

    expect(rec.toolNames.sort()).toEqual(
      ['finish', 'flag_for_user', 'rerender_image', 'rewrite_caption', 'search_web'].sort()
    );
  });

  it('allega ogni immagine dopo la sua etichetta, dentro un solo messaggio utente', async () => {
    const rec = newRecord();
    collectBatchReviewImages.mockResolvedValue([
      { label: 'POST 0', inlineData: { mimeType: 'image/png', data: 'AAAA' } },
      { label: 'POST 0 slide 2', inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } }
    ]);
    generateText.mockImplementation(drive([{ tool: 'finish', input: { summary: 'ok' } }], rec));

    await runDirector(baseOpts() as never);

    expect(rec.messages).toHaveLength(1);
    expect(rec.messages[0].role).toBe('user');
    const content = rec.messages[0].content as AnyRec[];
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('BATCH BRIEF: La settimana del banco');
    expect(content[0].text).toContain('BRAND VISUAL BRIEF');
    expect(content.slice(1)).toEqual([
      { type: 'text', text: '[POST 0]' },
      { type: 'image', image: 'data:image/png;base64,AAAA' },
      { type: 'text', text: '[POST 0 slide 2]' },
      { type: 'image', image: 'data:image/jpeg;base64,BBBB' }
    ]);
  });

  it('dice a kie di non conservare gli item fra uno step e l altro', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { summary: 'ok' } }], rec));

    await runDirector(baseOpts() as never);

    expect(rec.providerOptions).toMatchObject({ openai: { store: false } });
  });
});

describe('gli strumenti che cambiano il batch', () => {
  it('rewrite_caption sostituisce la didascalia del post', async () => {
    const rec = newRecord();
    const opts = baseOpts();
    generateText.mockImplementation(
      drive(
        [
          { tool: 'rewrite_caption', input: { index: 0, instruction: 'togli la promessa' } },
          { tool: 'finish', input: { summary: 'riscritta una didascalia' } }
        ],
        rec
      )
    );

    const log = await runDirector(opts as never);

    expect(opts.posts[0].caption).toBe('Didascalia riscritta.');
    expect(rec.calls[0].output).toMatchObject({ ok: true });
    expect(log.steps[0]).toMatchObject({ tool: 'rewrite_caption' });
  });

  it('una riscrittura fallita lascia la didascalia com era', async () => {
    const rec = newRecord();
    const opts = baseOpts();
    const original = opts.posts[0].caption;
    structured.mockResolvedValue({ caption: '   ' });
    generateText.mockImplementation(
      drive([{ tool: 'rewrite_caption', input: { index: 0, instruction: 'x' } }, { tool: 'finish', input: { summary: 'ok' } }], rec)
    );

    await runDirector(opts as never);

    expect(opts.posts[0].caption).toBe(original);
    expect(rec.calls[0].output).toMatchObject({ error: 'rewrite failed — caption unchanged' });
  });

  it('rerender_image appende la nota alla brief e rirenderizza', async () => {
    const rec = newRecord();
    const opts = baseOpts();
    generateText.mockImplementation(
      drive(
        [
          { tool: 'rerender_image', input: { index: 0, note: 'meno contrasto' } },
          { tool: 'finish', input: { summary: 'ok' } }
        ],
        rec
      )
    );

    await runDirector(opts as never);

    expect(opts.posts[0].image_prompt).toContain('ART DIRECTOR NOTE (apply this): meno contrasto');
    expect(renderPreviewImages).toHaveBeenCalledTimes(1);
  });

  it('rerender_image rifiuta un post di solo testo', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'rerender_image', input: { index: 0, note: 'x' } }, { tool: 'finish', input: { summary: 'ok' } }], rec)
    );

    await runDirector(baseOpts({ posts: [post({ media: 'text' })] }) as never);

    expect(rec.calls[0].output).toMatchObject({ error: 'bad index or text-only post' });
    expect(renderPreviewImages).not.toHaveBeenCalled();
  });

  it('flag_for_user segna il post senza toccarne il contenuto', async () => {
    const rec = newRecord();
    const opts = baseOpts();
    generateText.mockImplementation(
      drive(
        [
          { tool: 'flag_for_user', input: { index: 0, reason: 'claim al limite' } },
          { tool: 'finish', input: { summary: 'ok' } }
        ],
        rec
      )
    );

    await runDirector(opts as never);

    expect(opts.posts[0].__attention).toBe('claim al limite');
    expect(rec.calls[0].output).toMatchObject({ ok: true });
  });

  it('un indice inesistente non rompe il giro', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'flag_for_user', input: { index: 9, reason: 'x' } }, { tool: 'finish', input: { summary: 'ok' } }], rec)
    );

    await runDirector(baseOpts() as never);

    expect(rec.calls[0].output).toMatchObject({ error: 'bad index' });
  });
});

describe('i tetti per strumento', () => {
  it('la ricerca si ferma al suo tetto e non interroga il web una volta in più', async () => {
    const rec = newRecord();
    const script = Array.from({ length: SEARCH_BUDGET + 1 }, (_, i) => ({
      tool: 'search_web',
      input: { query: `domanda ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await runDirector(baseOpts() as never);

    expect(groundedText).toHaveBeenCalledTimes(SEARCH_BUDGET);
    expect(rec.calls[SEARCH_BUDGET].output).toMatchObject({
      error: 'budget exhausted for search_web — wrap up with finish()'
    });
  });

  it('la riscrittura si ferma al suo tetto', async () => {
    const rec = newRecord();
    const script = Array.from({ length: REWRITE_BUDGET + 1 }, (_, i) => ({
      tool: 'rewrite_caption',
      input: { index: 0, instruction: `nota ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await runDirector(baseOpts() as never);

    expect(structured).toHaveBeenCalledTimes(REWRITE_BUDGET);
    expect(rec.calls[REWRITE_BUDGET].output).toMatchObject({
      error: 'budget exhausted for rewrite_caption — wrap up with finish()'
    });
  });

  it('il rirender si ferma al suo tetto', async () => {
    const rec = newRecord();
    const script = Array.from({ length: RERENDER_BUDGET + 1 }, (_, i) => ({
      tool: 'rerender_image',
      input: { index: 0, note: `nota ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await runDirector(baseOpts() as never);

    expect(renderPreviewImages).toHaveBeenCalledTimes(RERENDER_BUDGET);
    expect(rec.calls[RERENDER_BUDGET].output).toMatchObject({
      error: 'budget exhausted for rerender_image — wrap up with finish()'
    });
  });

  it('si ferma al tetto degli step', async () => {
    const rec = newRecord();
    const script = Array.from({ length: MAX_STEPS + 4 }, (_, i) => ({
      tool: 'flag_for_user',
      input: { index: 0, reason: `motivo ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await runDirector(baseOpts() as never);

    expect(rec.calls).toHaveLength(MAX_STEPS);
  });
});

describe('come si chiude', () => {
  it('finish detta il riassunto', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'finish', input: { summary: '  Controllato tutto.  ' } }], rec));

    const log = await runDirector(baseOpts() as never);

    expect(log.summary).toBe('Controllato tutto.');
  });

  it('senza finish ripiega sulla prosa con cui il modello ha chiuso', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'flag_for_user', input: { index: 0, reason: 'x' } }], rec, 'Batch ok.'));

    const log = await runDirector(baseOpts() as never);

    expect(log.summary).toBe('Batch ok.');
  });

  it('senza finish e senza prosa lo dice', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'flag_for_user', input: { index: 0, reason: 'x' } }], rec, ''));

    const log = await runDirector(baseOpts() as never);

    expect(log.summary).toBe('Review ended at step budget.');
  });
});

describe('il ripiego di provider, che è il punto del Director', () => {
  it('se kie muore rifà la review su Gemini e azzera il log parziale', async () => {
    const rec = newRecord();
    generateText
      .mockImplementationOnce(async (options: AnyRec) => {
        await options.tools.flag_for_user.execute({ index: 0, reason: 'parziale' }, {});
        throw new Error('kie out of credits');
      })
      .mockImplementationOnce(drive([{ tool: 'finish', input: { summary: 'rifatta su Gemini' } }], rec));

    const log = await runDirector(baseOpts() as never);

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(log.summary).toBe('rifatta su Gemini');
    expect(log.steps.map((s) => s.tool)).toEqual(['finish']);
    expect(logAiCall).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'director', ok: true, provider: 'llm', model: 'gemini-3.7-flash' })
    );
  });

  it('ogni tentativo lascia la sua riga di sessione', async () => {
    const rec = newRecord();
    generateText
      .mockImplementationOnce(async () => {
        throw new Error('kie down');
      })
      .mockImplementationOnce(drive([{ tool: 'finish', input: { summary: 'ok' } }], rec));

    await runDirector(baseOpts() as never);

    const rows = agentSessionWrites.filter((r) => r.agent === 'director');
    expect(rows.some((r) => r.status === 'failed' && r.provider === 'kie')).toBe(true);
    expect(rows.some((r) => r.status === 'finished' && r.provider === 'llm')).toBe(true);
  });

  it('se anche Gemini muore il batch esce comunque, con la nota del fallimento', async () => {
    generateText.mockImplementation(async () => {
      throw new Error('tutto giù');
    });

    const log = await runDirector(baseOpts() as never);

    expect(log.summary).toContain('(director failed: tutto giù');
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ label: 'director', ok: false }));
  });
});

describe('il guardiano di sessione, che il framework applicava in silenzio', () => {
  // Il tetto di `search_web` è 2: la terza e la quarta chiamata tornano un errore, e a quel
  // punto il guardiano toglie lo strumento dal tavolo invece di lasciare che il modello continui
  // a bussare a una porta chiusa. Il risultato che vede il modello è un'istruzione, non un
  // errore, perché un errore lo farebbe ritentare.
  it('toglie dal tavolo uno strumento che ha fallito due volte di fila', async () => {
    const rec = newRecord();
    const script = Array.from({ length: SEARCH_BUDGET + 3 }, (_, i) => ({
      tool: 'search_web',
      input: { query: `domanda ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await runDirector(baseOpts() as never);

    expect(groundedText).toHaveBeenCalledTimes(SEARCH_BUDGET);
    expect(rec.calls[SEARCH_BUDGET].output).toMatchObject({ error: expect.stringContaining('budget exhausted') });
    expect(rec.calls[SEARCH_BUDGET + 1].output).toMatchObject({ error: expect.stringContaining('budget exhausted') });
    expect(rec.calls[SEARCH_BUDGET + 2].output).toMatchObject({
      blocked_by: 'steward',
      code: 'error_retry',
      ran: false,
      do_not_retry: true
    });
  });

  it('un tool che solleva davvero fa cadere il tentativo, e il Director ripiega sull altro provider', async () => {
    const rec = newRecord();
    groundedText.mockRejectedValue(new Error('rete giù'));
    generateText.mockImplementation(drive([{ tool: 'search_web', input: { query: 'a' } }], rec));

    const log = await runDirector(baseOpts() as never);

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(log.summary).toContain('(director failed: rete giù');
  });
});
