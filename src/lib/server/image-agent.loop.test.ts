import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * CARATTERIZZAZIONE DEL GIRO DELL'IMAGE AGENT.
 *
 * Quarto dei dodici. `image-agent.test.ts` esercita già il giro attraverso un finto
 * `generateText`, che è il confine giusto: quei test valgono su entrambe le implementazioni e
 * restano il grosso della rete. Qui si aggiunge quello che nessuno guardava — l'elenco esatto
 * degli strumenti, come è fatto il messaggio che il modello riceve, cosa scrivono i tetti al
 * livello del tool (non del contatore), la riga di sessione, e il guardiano.
 */

const {
  generateText,
  logAiCall,
  renderPostImage,
  uploadPostImage,
  publishLibraryImageAsPostMedia,
  listBrandMedia,
  resolveUserTurnMediaParts,
  agentSessionWrites
} = vi.hoisted(() => ({
  generateText: vi.fn(),
  logAiCall: vi.fn(),
  renderPostImage: vi.fn(),
  uploadPostImage: vi.fn(),
  publishLibraryImageAsPostMedia: vi.fn(),
  listBrandMedia: vi.fn(),
  resolveUserTurnMediaParts: vi.fn(),
  agentSessionWrites: [] as Array<Record<string, unknown>>
}));

vi.mock('$env/dynamic/private', () => ({
  env: { GEMINI_API_KEY: 'test', LLM_API_KEY: 'test', LLM_DEFAULT_MODEL: 'gemini-3.7-flash' }
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateText };
});

vi.mock('$lib/media-parts', () => ({ resolveUserTurnMediaParts }));

vi.mock('$lib/server/content-preview', () => ({
  aspectRatioFor: () => '4:5',
  extractVisualPlaybook: () => '',
  loadBrandMoodImageUrls: async () => [],
  loadCompetitorThumbUrls: async () => [],
  renderPostImage,
  uploadPostImage
}));

vi.mock('$lib/server/brand-media', () => ({
  listBrandMedia,
  loadLibraryMediaParts: async () => [{ inlineData: { mimeType: 'image/png', data: 'BBBB' } }],
  publishLibraryImageAsPostMedia
}));

vi.mock('$lib/server/media-archive', () => ({ signKnowledgePaths: async () => [] }));
vi.mock('$lib/server/people', () => ({ signPersonImages: async () => [] }));
vi.mock('$lib/server/brand-context', () => ({ fetchImagePart: async () => null }));

vi.mock('$lib/server/credits', () => ({
  getCreditsUsage: async () => ({
    remaining: 500,
    used: 0,
    quota: 500,
    bonus: 0,
    percent: 0,
    periodStart: new Date(),
    periodEnd: new Date()
  })
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
          maybeSingle: async () => ({ data: { id: 'b1', plan: 'pro', activated_at: null, status: 'active' } })
        })
      })
    })
  })
}));

vi.mock('$lib/server/ai-log', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/ai-log')>('$lib/server/ai-log');
  return { ...actual, logAiCall };
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_AGENT_INSPECTS, MAX_AGENT_RENDERS, MAX_AGENT_STEPS, runImageAgent } from './image-agent';

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
  messages: AnyRec[];
  toolNames: string[];
};

function drive(script: ScriptedCall[], record: DriveRecord) {
  return async (options: AnyRec) => {
    record.system = String(options.system ?? '');
    record.messages = (options.messages ?? []) as AnyRec[];
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
    brief: 'Macine in acciaio su fondo crema',
    platform: 'instagram',
    aspectRatio: '4:5',
    deadlineMs: 60_000,
    ...over
  };
}

function newRecord(): DriveRecord {
  return { prepared: [], calls: [], system: '', messages: [], toolNames: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  agentSessionWrites.length = 0;
  renderPostImage.mockResolvedValue('data:image/png;base64,AAAA');
  uploadPostImage.mockResolvedValue('https://cdn.example/img.png');
  publishLibraryImageAsPostMedia.mockResolvedValue({ publicUrl: 'https://cdn.example/lib.png' });
  listBrandMedia.mockResolvedValue([]);
  resolveUserTurnMediaParts.mockResolvedValue([]);
});

describe('quello che il modello riceve', () => {
  it('offre esattamente questi tool', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'finish', input: { imagePrompt: 'p', notes: 'n', imageUrl: 'https://cdn.example/img.png' } }], rec)
    );

    await runImageAgent(baseOpts() as never);

    expect(rec.toolNames.sort()).toEqual(
      ['finish', 'inspect_assets', 'render_image', 'search_assets', 'use_asset_as_is'].sort()
    );
  });

  it('apre con la brief e allega i media che la brief stessa linka', async () => {
    const rec = newRecord();
    resolveUserTurnMediaParts.mockResolvedValue([
      { type: 'image', image: 'data:image/png;base64,LINKED' }
    ]);
    generateText.mockImplementation(
      drive([{ tool: 'finish', input: { imagePrompt: 'p', notes: 'n', imageUrl: 'https://cdn.example/img.png' } }], rec)
    );

    await runImageAgent(baseOpts() as never);

    expect(resolveUserTurnMediaParts).toHaveBeenCalledWith('Macine in acciaio su fondo crema');
    expect(rec.messages).toHaveLength(1);
    const content = rec.messages[0].content as AnyRec[];
    expect(content[0].text).toContain('Macine in acciaio su fondo crema');
    expect(content[1]).toEqual({ type: 'image', image: 'data:image/png;base64,LINKED' });
  });
});

describe('i tetti, visti dal tool e non dal contatore', () => {
  it('il rirender si ferma al tetto e non paga un rendering in più', async () => {
    const rec = newRecord();
    const script = Array.from({ length: MAX_AGENT_RENDERS + 1 }, (_, i) => ({
      tool: 'render_image',
      input: { prompt: `prompt ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await runImageAgent(baseOpts() as never);

    expect(renderPostImage).toHaveBeenCalledTimes(MAX_AGENT_RENDERS);
    expect(rec.calls[MAX_AGENT_RENDERS].output).toMatchObject({ error: expect.stringContaining('budget') });
  });

  it('l ispezione si ferma al suo tetto', async () => {
    const rec = newRecord();
    listBrandMedia.mockResolvedValue([
      { id: 'm1', title: 'Macine', kind: 'image', description: '', tags: [], path: 'p/1' }
    ]);
    const script = [
      { tool: 'search_assets', input: { query: 'macine' } },
      ...Array.from({ length: MAX_AGENT_INSPECTS + 1 }, () => ({
        tool: 'inspect_assets',
        input: { ids: ['library:m1'] }
      }))
    ];
    generateText.mockImplementation(drive(script, rec));

    await runImageAgent(baseOpts() as never);

    const last = rec.calls[rec.calls.length - 1].output as AnyRec;
    expect(last.error).toContain('budget');
  });

  it('si ferma al tetto degli step', async () => {
    const rec = newRecord();
    const script = Array.from({ length: MAX_AGENT_STEPS + 5 }, (_, i) => ({
      tool: 'search_assets',
      input: { query: `cerca ${i}` }
    }));
    generateText.mockImplementation(drive(script, rec));

    await runImageAgent(baseOpts() as never);

    expect(rec.calls.length).toBeLessThanOrEqual(MAX_AGENT_STEPS);
  });
});

describe('la foto di libreria usata così com è', () => {
  it('rifiuta un id che non è di libreria', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'use_asset_as_is', input: { id: 'mood:x' } }], rec)
    );

    await runImageAgent(baseOpts() as never);

    expect(rec.calls[0].output).toMatchObject({ error: 'id must be a library asset (library:...)' });
    expect(publishLibraryImageAsPostMedia).not.toHaveBeenCalled();
  });

  it('pubblicata, diventa il risultato e la sorgente è la libreria', async () => {
    const rec = newRecord();
    listBrandMedia.mockResolvedValue([
      { id: 'm1', title: 'Macine', kind: 'image', description: '', tags: [], path: 'p/1' }
    ]);
    generateText.mockImplementation(
      drive(
        [
          { tool: 'search_assets', input: { query: 'macine' } },
          { tool: 'use_asset_as_is', input: { id: 'library:m1' } }
        ],
        rec
      )
    );

    const out = await runImageAgent(baseOpts() as never);

    expect(rec.calls[1].output).toMatchObject({ ok: true, imageUrl: 'https://cdn.example/lib.png' });
    expect(out.source).toBe('library');
    expect(out.imageUrl).toBe('https://cdn.example/lib.png');
  });
});

describe('quando il giro non conclude niente', () => {
  it('torna la brief come prompt e lo dice nelle note', async () => {
    const rec = newRecord();
    generateText.mockImplementation(drive([{ tool: 'search_assets', input: { query: 'niente' } }], rec));

    const out = await runImageAgent(baseOpts() as never);

    expect(out.imageUrl).toBeUndefined();
    expect(out.imagePrompt).toBe('Macine in acciaio su fondo crema');
    expect(out.notes).toBe('Image agent finished without a result.');
  });
});

describe('la traccia della corsa', () => {
  it('lascia una riga di sessione leggibile su agent_sessions', async () => {
    const rec = newRecord();
    generateText.mockImplementation(
      drive([{ tool: 'finish', input: { imagePrompt: 'p', notes: 'n', imageUrl: 'https://cdn.example/img.png' } }], rec)
    );

    await runImageAgent(baseOpts() as never);

    const finishedRow = agentSessionWrites.find((r) => r.status === 'finished');
    expect(finishedRow).toMatchObject({ agent: 'image', surface: 'batch', brand_id: 'b1', mode: 'instagram' });
    expect(Number(finishedRow?.event_count)).toBeGreaterThan(0);
  });
});

describe('il guardiano di sessione, che il framework applicava in silenzio', () => {
  it('toglie dal tavolo il rendering dopo due fallimenti di fila', async () => {
    const rec = newRecord();
    renderPostImage.mockResolvedValue(null);
    generateText.mockImplementation(
      drive(
        [
          { tool: 'render_image', input: { prompt: 'a' } },
          { tool: 'render_image', input: { prompt: 'b' } },
          { tool: 'render_image', input: { prompt: 'c' } }
        ],
        rec
      )
    );

    await runImageAgent(baseOpts() as never);

    expect(rec.calls[0].output).toMatchObject({ error: 'render_image returned no image' });
    expect(rec.calls[1].output).toMatchObject({ error: 'render_image returned no image' });
    expect(rec.calls[2].output).toMatchObject({ blocked_by: 'steward', ran: false, do_not_retry: true });
    expect(renderPostImage).toHaveBeenCalledTimes(2);
  });
});
// `harness/index` riesporta `harness/run`, che importa `chat/model` e `chat/controller`: chi
// prende la traccia dall'indice si porta dentro la chat e `$lib/agent` senza usarli. I moduli
// foglia non li toccano, e questo test è l'unica cosa che impedisce di «riordinare» l'import.
describe('da dove arriva la traccia', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/server/image-agent.ts'), 'utf8');

  it('l image agent guida l SDK e non passa dall indice del framework', () => {
    expect(src).toMatch(/await generateText\(/);
    expect(src).not.toContain('harnessGenerateText(');
    expect(src).not.toMatch(/from '\$lib\/server\/harness'/);
    expect(src).toMatch(/from '\$lib\/server\/harness\/session'/);
    expect(src).toMatch(/from '\$lib\/server\/harness\/persist'/);
  });
});
