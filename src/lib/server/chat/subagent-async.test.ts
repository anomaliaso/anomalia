/**
 * I SUB-AGENT SONO PROCESSI ASYNC, COME MOTION_WRITE.
 *
 * Prima: la run girava dentro il tool call del turno (generateText inline) — tab chiusa, lavoro
 * morto, e nessuno (utente né AI) sapeva cosa stesse facendo mentre girava. Ora la chat accoda un
 * job `subagent_run` e torna subito; il worker lo esegue fuori da ogni turno, riscrive il partial
 * sulla riga mentre gira (utente e AI lo leggono), e il risultato rientra come nuovo turno.
 */
import { describe, expect, it, vi } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { createSubagentTools, MAX_SUBAGENT_RUNS, SUBAGENT_JOB_TOOL, SUBAGENT_TOOL_KEYS } from './subagents';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const runSubagentRun = vi.fn();
vi.mock('./subagents', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  runSubagentRun: (...args: unknown[]) => runSubagentRun(...args)
}));
// CI non ha chiavi provider e il toolset vero trascina mezzo registry: il worker qui deve
// testare mirror e passthrough, il motore è runSubagentRun mockato e il set è vuoto.
vi.mock('$lib/server/chat/model', () => ({
  resolveChatModel: () => ({ provider: 'test', modelId: 'test-model', model: {}, callOptions: {} })
}));
vi.mock('$lib/server/chat/tools', () => ({ createChatTools: () => ({}) }));

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

/** La factory dei tool in mode `queued` (quello che la chat usa), su un supabase in memoria. */
function buildSubagentDispatchTestKit(tables: { chat_jobs?: Row[] } = {}) {
  const kit = createTestSupabase({
    brands: [{ id: 'b1', plan: 'pro', slug: 'acme', name: 'Acme' }],
    chat_jobs: tables.chat_jobs ?? []
  });
  const tools = createSubagentTools({
    supabase: kit.client,
    brandId: 'b1',
    tools: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: { provider: 'test', modelId: 'test-model', model: {}, callOptions: {} } as any,
    locale: 'it',
    userId: 'u1',
    threadId: 'thread-1',
    webHubEnabled: true,
    defaultAgent: 'content',
    origin: '',
    mode: 'queued'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  return { ...kit, tools };
}

describe('i tool di delega accodano e tornano SUBITO (mode queued)', () => {
  it('delegate_task: riga pending `subagent_run` con il brief, e nessuna run nel turno', async () => {
    const kit = buildSubagentDispatchTestKit();
    const { delegate_task } = kit.tools;

    const out = await delegate_task.execute(
      { role: 'research', title: 'Leggere il mercato', brief: 'Find the three nearest competitors.' },
      {}
    );

    expect(out.background).toBe(true);
    expect(out.job_id).toBeTruthy();
    expect(String(out.message)).toMatch(/END YOUR TURN/);
    expect(runSubagentRun).not.toHaveBeenCalled();

    const rows = kit.tables.get('chat_jobs') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].tool_name).toBe(SUBAGENT_JOB_TOOL);
    expect(rows[0].thread_id).toBe('thread-1');
    expect(rows[0].input_params.kind).toBe('single');
    expect(rows[0].input_params.role).toBe('research');
    expect(rows[0].input_params.brief).toMatch(/competitors/);
    expect(rows[0].input_params.report_locale).toBe('it');
  });

  it('run_task_pipeline: UNA riga kind=pipeline (le fasi girano dentro il worker)', async () => {
    const kit = buildSubagentDispatchTestKit();
    await kit.tools.run_task_pipeline.execute({ objective: 'Produce next week of posts, end to end.' }, {});
    const rows = kit.tables.get('chat_jobs') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].input_params.kind).toBe('pipeline');
    expect(rows[0].input_params.objective).toMatch(/next week/);
    expect(runSubagentRun).not.toHaveBeenCalled();
  });

  it('run_parallel_tasks: UNA riga kind=parallel con tutti i pezzi', async () => {
    const kit = buildSubagentDispatchTestKit();
    await kit.tools.run_parallel_tasks.execute(
      {
        role: 'compose',
        shared_context: 'Palette fixed by the brand kit.',
        tasks: [
          { title: 'Scene one', brief: 'Build the opening scene.' },
          { title: 'Scene two', brief: 'Build the closing scene.' }
        ]
      },
      {}
    );
    const rows = kit.tables.get('chat_jobs') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].input_params.kind).toBe('parallel');
    expect(rows[0].input_params.tasks).toHaveLength(2);
  });

  it('il budget conta DISPATCH: oltre il tetto la delega viene rifiutata', async () => {
    const kit = buildSubagentDispatchTestKit();
    for (let i = 0; i < MAX_SUBAGENT_RUNS; i++) {
      await kit.tools.delegate_task.execute(
        { role: 'research', title: `Dispatch ${i}`, brief: `Task number ${i} for the budget.` },
        {}
      );
    }
    const over = await kit.tools.delegate_task.execute(
      { role: 'research', title: 'One too many', brief: 'This dispatch must be refused.' },
      {}
    );
    expect(over.error).toMatch(/budget/);
    expect(kit.tables.get('chat_jobs')).toHaveLength(MAX_SUBAGENT_RUNS);
  });
});

describe('check_subagent legge il partial che il worker sta scrivendo', () => {
  it('ritorna status, coda del testo vivo e tool call con stato', async () => {
    const kit = buildSubagentDispatchTestKit({
      chat_jobs: [
        {
          id: 'job-live',
          brand_id: 'b1',
          user_id: 'u1',
          thread_id: 'thread-1',
          tool_name: SUBAGENT_JOB_TOOL,
          status: 'running',
          created_at: iso(60_000),
          input_params: { kind: 'single' },
          partial: {
            text: 'Reading competitor posts… found 12, still pricing.',
            tools: [
              { toolCallId: 't1', toolName: 'search_web', status: 'done' },
              { toolCallId: 't2', toolName: 'read_posts', status: 'running' }
            ],
            reasoning: '',
            at: Date.now()
          }
        }
      ]
    });
    const out = await kit.tools.check_subagent.execute({ job_id: 'job-live' }, {});
    expect(out.status).toBe('running');
    expect(out.progress).toMatch(/competitor posts/);
    expect(out.tools).toEqual(['search_web:done', 'read_posts:running']);
    expect(String(out.note)).toMatch(/not poll/i);
  });

  it('il job finito porta anche il risultato', async () => {
    const kit = buildSubagentDispatchTestKit({
      chat_jobs: [
        {
          id: 'job-done',
          brand_id: 'b1',
          user_id: 'u1',
          thread_id: 'thread-1',
          tool_name: SUBAGENT_JOB_TOOL,
          status: 'done',
          created_at: iso(600_000),
          input_params: { kind: 'single' },
          result: { report: 'FINDINGS — done.' }
        }
      ]
    });
    const out = await kit.tools.check_subagent.execute({ job_id: 'job-done' }, {});
    expect(out.result).toMatchObject({ report: 'FINDINGS — done.' });
  });

  it('il job di un altro utente non esiste', async () => {
    const kit = buildSubagentDispatchTestKit();
    const out = await kit.tools.check_subagent.execute({ job_id: 'missing' }, {});
    expect(out.error).toMatch(/not yours|No such/);
  });
});

describe('il worker esegue il job e il partial finisce sulla riga', () => {
  it('runSubagentJob: mirror del partial + risultato passthrough', async () => {
    const kit = buildSubagentDispatchTestKit({
      chat_jobs: [
        {
          id: 'job-w',
          brand_id: 'b1',
          user_id: 'u1',
          thread_id: 'thread-1',
          tool_name: SUBAGENT_JOB_TOOL,
          status: 'running',
          created_at: iso(5_000),
          input_params: { kind: 'single' }
        }
      ]
    });
    runSubagentRun.mockReset();
    // Il motore (verissimo altrove) qui è un finto che "streamma": piega lo stato e chiama onProgress.
    runSubagentRun.mockImplementation(async (ctx: any, args: any) => {
      ctx.onProgress({ text: 'start', tools: [], reasoning: '', failed: false }, true);
      ctx.onProgress({ text: 'working', tools: [{ toolCallId: 't1', toolName: 'read_posts', status: 'running', textLen: 7 }], reasoning: '', failed: false });
      return { role: args.role, agent: args.agent, title: args.title, report: 'FINDINGS — ok.', steps: 2, tools_used: ['read_posts'] };
    });

    const { runSubagentJob } = await import('./subagent-jobs');
    const cancel = { assertActive: vi.fn(async () => {}), signal: null } as any;
    const res = await runSubagentJob(
      kit.client,
      { id: 'job-w', brand_id: 'b1', user_id: 'u1', thread_id: 'thread-1' },
      {
        kind: 'single',
        role: 'research',
        agent: 'content',
        title: 'Leggere il mercato',
        brief: 'Find competitors.',
        report_locale: 'it',
        report_origin: '',
        subagent: { locale: 'it', webHubEnabled: true, defaultAgent: 'content' }
      },
      cancel
    );

    expect(res.report).toMatch(/FINDINGS/);
    expect(runSubagentRun).toHaveBeenCalledTimes(1);
    const row = (kit.tables.get('chat_jobs') ?? []).find((r) => r.id === 'job-w');
    expect(row).toBeTruthy();
    expect(row!.partial.text).toBe('working');
    expect(row!.partial.tools.map((t: Row) => t.toolName)).toContain('read_posts');
    expect(row!.partial.at).toBeGreaterThan(0);
  });
});

describe('il rientro porta il rapporto, non un JSON', () => {
  it('single: titolo, ruolo e report', async () => {
    const { buildToolJobSummary } = await import('./job-summaries');
    const s = buildToolJobSummary(SUBAGENT_JOB_TOOL, {
      kind: 'single',
      role: 'research',
      title: 'Leggere il mercato',
      report: 'FINDINGS — three competitors found.'
    }, 'en');
    expect(s).toMatch(/Sub-agent "Leggere il mercato"/);
    expect(s).toMatch(/FINDINGS — three competitors found/);
  });

  it('pipeline: verdetto e fasi', async () => {
    const { buildToolJobSummary } = await import('./job-summaries');
    const s = buildToolJobSummary(SUBAGENT_JOB_TOOL, {
      kind: 'pipeline',
      verdict: 'pass',
      repaired: false,
      phases: [{ role: 'execute', title: 'Esecuzione', report: 'DONE — post created.' }]
    }, 'en');
    expect(s).toMatch(/verdict: \*\*pass\*\*/);
    expect(s).toMatch(/\[execute\]/);
  });
});

describe('perimetro e allowlist', () => {
  it('check_subagent fa parte dei tool di delega ed è mai visto da un sub-agent', () => {
    expect(SUBAGENT_TOOL_KEYS).toContain('check_subagent');
  });

  it('subagent_run è reclamabile dal drain dei tool job', async () => {
    const { EXECUTABLE_TOOL_JOBS } = await import('./job-executor');
    expect(EXECUTABLE_TOOL_JOBS).toContain(SUBAGENT_JOB_TOOL);
  });
});
