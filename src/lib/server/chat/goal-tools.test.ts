import { describe, expect, it } from 'vitest';
import { GOAL_TOOL_KEYS, createGoalTools } from './goal-tools';

/**
 * Un finto client Supabase largo quanto basta per queste quattro chiamate: `chat_goals` è una riga
 * sola, letta e riscritta per intero. Serve a testare la cosa che conta davvero — il RIFIUTO di
 * chiudere un obiettivo con un criterio ancora aperto — senza un database in mezzo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

function fakeSupabase(initial: Row | null) {
  const state: { row: Row | null } = { row: initial };
  const client = {
    from() {
      let kind: 'select' | 'insert' | 'update' = 'select';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let payload: any = null;
      const b = {
        select: () => b,
        insert: (p: Row) => {
          kind = 'insert';
          payload = p;
          return b;
        },
        update: (p: Row) => {
          kind = 'update';
          payload = p;
          return b;
        },
        eq: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: async () => {
          if (kind === 'insert') {
            state.row = { id: 'g-new', created_at: 'now', updated_at: 'now', laps: 0, ...payload };
            return { data: state.row, error: null };
          }
          if (kind === 'update') {
            state.row = state.row ? { ...state.row, ...payload } : null;
            return { data: state.row, error: null };
          }
          // Le letture chiedono sempre l'obiettivo aperto: una riga chiusa non risponde più.
          return { data: state.row?.status === 'open' ? state.row : null, error: null };
        }
      };
      return b;
    }
  };
  return { client: client as never, state };
}

const openGoal = (criteria: { id: string; text: string; status: string }[]) => ({
  id: 'g1',
  brand_id: 'b1',
  user_id: 'u1',
  thread_id: 't1',
  statement: 'Tutti gli articoli con copertina',
  criteria,
  status: 'open',
  laps: 0,
  source: 'agent',
  closing_note: null,
  created_at: 'now',
  updated_at: 'now'
});

const tools = (row: Row | null) => {
  const { client, state } = fakeSupabase(row);
  return {
    state,
    t: createGoalTools({ supabase: client, brandId: 'b1', userId: 'u1', threadId: 't1' })
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (tool: any, input: unknown) => tool.execute(input, {} as never);

describe('i tre tool dell’obiettivo', () => {
  it('sono esattamente quelli che il registro dichiara', () => {
    const { t } = tools(null);
    expect(Object.keys(t).sort()).toEqual([...GOAL_TOOL_KEYS].sort());
  });

  it('senza thread non si apre niente: un obiettivo appartiene a una conversazione', async () => {
    const { client } = fakeSupabase(null);
    const t = createGoalTools({ supabase: client, brandId: 'b1', userId: 'u1' });
    expect(await run(t.set_goal, { statement: 'qualcosa di lungo', criteria: ['uno'] })).toMatchObject({
      success: false
    });
  });
});

describe('set_goal', () => {
  it('apre l’obiettivo e numera i criteri', async () => {
    const { t } = tools(null);
    const r = await run(t.set_goal, {
      statement: 'Tutti gli articoli con copertina',
      criteria: ['copertina su tutti gli articoli', 'nessun articolo in bozza']
    });
    expect(r).toMatchObject({ success: true, created: true, progress: '0/2' });
    expect(r.criteria.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2']);
  });

  it('su un obiettivo già aperto aggiunge, senza riaprire quello che era chiuso', async () => {
    const { t } = tools(openGoal([{ id: 'c1', text: 'primo', status: 'done' }]));
    const r = await run(t.set_goal, { statement: 'stesso obiettivo', criteria: ['primo', 'secondo'] });
    expect(r.created).toBe(false);
    expect(r.criteria).toHaveLength(2);
    expect(r.criteria[0]).toMatchObject({ id: 'c1', status: 'done' });
    expect(r.progress).toBe('1/2');
  });
});

describe('update_goal', () => {
  it('chiude un criterio e dice cosa resta, invece di lasciar credere che sia finita', async () => {
    const { t } = tools(
      openGoal([
        { id: 'c1', text: 'primo', status: 'open' },
        { id: 'c2', text: 'copertine mancanti', status: 'open' }
      ])
    );
    const r = await run(t.update_goal, { done: ['c1'], note: 'fatto davvero' });
    expect(r).toMatchObject({ success: true, closed_now: 1, progress: '1/2' });
    expect(r.instruction).toContain('copertine mancanti');
  });

  it('quando l’ultimo criterio cade, manda a chiudere l’obiettivo', async () => {
    const { t } = tools(openGoal([{ id: 'c1', text: 'primo', status: 'open' }]));
    const r = await run(t.update_goal, { done: ['c1'] });
    expect(r.instruction).toContain('close_goal');
  });

  it('dice quali criteri NON è riuscito ad aggiungere invece di lasciarli sparire', async () => {
    const full = Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}`, text: `crit ${i}`, status: 'open' }));
    const { t } = tools(openGoal(full));
    const r = await run(t.update_goal, { add: ['uno di troppo'] });
    expect(r.not_added).toEqual(['uno di troppo']);
    expect(r.note).toContain('full');
  });

  it('senza obiettivo aperto non inventa niente', async () => {
    const { t } = tools(null);
    expect(await run(t.update_goal, { done: ['c1'] })).toMatchObject({ success: false });
  });
});

describe('close_goal', () => {
  it('RIFIUTA di dichiarare raggiunto un obiettivo con un criterio aperto', async () => {
    const { t, state } = tools(
      openGoal([
        { id: 'c1', text: 'primo', status: 'done' },
        { id: 'c2', text: 'secondo', status: 'open' }
      ])
    );
    const r = await run(t.close_goal, { outcome: 'met', summary: 'fatto tutto' });
    expect(r.success).toBe(false);
    expect(r.still_open).toHaveLength(1);
    // e soprattutto: la riga resta aperta, quindi il lavoro riprende
    expect(state.row.status).toBe('open');
  });

  it('chiude quando ogni criterio è chiuso o buttato', async () => {
    const { t, state } = tools(
      openGoal([
        { id: 'c1', text: 'primo', status: 'done' },
        { id: 'c2', text: 'secondo', status: 'dropped' }
      ])
    );
    const r = await run(t.close_goal, { outcome: 'met', summary: 'copertine sistemate' });
    expect(r).toMatchObject({ success: true, outcome: 'met' });
    expect(state.row.status).toBe('met');
  });

  it('abbandonare è sempre permesso: è il caso in cui l’obiettivo stesso non vale più', async () => {
    const { t, state } = tools(openGoal([{ id: 'c1', text: 'primo', status: 'open' }]));
    const r = await run(t.close_goal, { outcome: 'abandoned', summary: 'il cliente ha cambiato idea' });
    expect(r.success).toBe(true);
    expect(state.row.status).toBe('abandoned');
  });
});


/**
 * IL RIFIUTO DENTRO IL CICLO — la forma di `finish` della pagina /motion-video.
 *
 * Il caso (22/08 21:13:39): `render_motion_video` torna `retry: storyboard_first`, e nello stesso
 * turno `update_goal` chiude «Finished MP4 is rendered and attached to the gallery». Prima passava:
 * la spunta era una dichiarazione. Ora è un rifiuto che dice quale criterio, cosa manca, e le due
 * uscite.
 */
describe('update_goal — una spunta senza lavoro dietro viene rifiutata', () => {
  const goal = () =>
    openGoal([
      { id: 'c1', text: 'Finished MP4 is rendered and attached to the gallery', status: 'open' },
      { id: 'c2', text: 'MP4 rendered via render_motion_video', status: 'open' }
    ]);
  const tools = () => {
    const { client } = fakeSupabase(goal());
    return createGoalTools({ supabase: client, brandId: 'b1', userId: 'u1', threadId: 't1' });
  };
  const turn = (calls: Array<{ name: string; output: unknown }>) => [
    {
      role: 'assistant',
      content: calls.map((c, i) => ({ type: 'tool-call', toolCallId: `t${i}`, toolName: c.name, input: {} }))
    },
    {
      role: 'tool',
      content: calls.map((c, i) => ({ type: 'tool-result', toolCallId: `t${i}`, toolName: c.name, output: c.output }))
    }
  ];

  const onlyReads = turn([
    { name: 'read_file', output: { content: '…' } },
    { name: 'list_motion_videos', output: { videos: [] } },
    { name: 'render_motion_video', output: { retry: 'storyboard_first' } }
  ]);

  it('dice quale criterio, perché, e le due uscite', async () => {
    const t = tools();
    const out = await t.update_goal.execute({ done: ['c1'] }, { messages: onlyReads });
    expect(out.success).toBe(false);
    expect(out.error).toBe('not_backed_by_work');
    expect(out.refused[0].id).toBe('c1');
    expect(out.instruction).toContain('drop');
  });

  it('il criterio che NOMINA lo strumento lo dice per nome', async () => {
    const t = tools();
    const out = await t.update_goal.execute({ done: ['c2'] }, { messages: onlyReads });
    expect(out.refused[0].why).toContain('render_motion_video');
  });

  it('con una scrittura riuscita nel turno la spunta passa', async () => {
    const t = tools();
    const ok = turn([{ name: 'render_motion_video', output: { url: 'https://x/y.mp4' } }]);
    const out = await t.update_goal.execute({ done: ['c1'] }, { messages: ok });
    expect(out.success).toBe(true);
    expect(out.closed_now).toBe(1);
  });

  it('il budget dei rifiuti è dichiarato: al terzo tentativo registra', async () => {
    const t = tools();
    expect((await t.update_goal.execute({ done: ['c1'] }, { messages: onlyReads })).success).toBe(false);
    expect((await t.update_goal.execute({ done: ['c1'] }, { messages: onlyReads })).success).toBe(false);
    // Rifiutare all'infinito brucia il turno senza salvare niente (stessa ragione di agent.ts).
    expect((await t.update_goal.execute({ done: ['c1'] }, { messages: onlyReads })).success).toBe(true);
  });

  it('un drop non viene mai rifiutato: è l uscita onesta', async () => {
    const t = tools();
    const out = await t.update_goal.execute({ drop: ['c1'], note: 'impossibile' }, { messages: onlyReads });
    expect(out.success).toBe(true);
  });

  // Il motore kit esegue questi tool FUORI dal ciclo dell'AI SDK, quindi `opts.messages` arriva
  // vuoto: senza i fatti del turno da un'altra strada, il rifiuto non avrebbe niente da guardare.
  it('i fatti del turno arrivano anche da chi non ha `messages`', async () => {
    const { client } = fakeSupabase(goal());
    const reading = createGoalTools({
      supabase: client,
      brandId: 'b1',
      userId: 'u1',
      threadId: 't1',
      succeededThisTurn: () => ['brand_read', 'query', 'set_goal']
    });
    const refused = await reading.update_goal.execute({ done: ['c1'] }, { messages: [] });
    expect(refused.success).toBe(false);
    expect(refused.error).toBe('not_backed_by_work');

    const { client: client2 } = fakeSupabase(goal());
    const producing = createGoalTools({
      supabase: client2,
      brandId: 'b1',
      userId: 'u1',
      threadId: 't1',
      succeededThisTurn: () => ['brand_read', 'motion_render']
    });
    const passed = await producing.update_goal.execute({ done: ['c1'] }, { messages: [] });
    expect(passed.success).toBe(true);
  });
});

/**
 * LE DUE REGOLE CHE ERANO IN CONFLITTO CON IL RESTO DEL PROMPT, inchiodate dove sono finite.
 *
 * `GOAL_BLOCK` non sta più in agents.ts: le regole vivono nelle descrizioni dei tre tool, che il
 * modello riceve comunque a ogni passo. Le due qui sotto sono chiusure di conflitti misurati, e
 * senza un controllo tornerebbero alla versione di prima al primo riassunto ben intenzionato.
 *
 * 1. «un criterio non viene MAI dal tuo mestiere» contraddiceva la riga READY in cima alle
 *    CAPABILITIES di ogni mestiere («drafts sitting in pending with caption AND visual»,
 *    «RENDERED to MP4»), che è uno standard di mestiere e vale per qualunque richiesta di quel
 *    mestiere. Seguite entrambe alla lettera portano ad azioni diverse. Vince READY: è la
 *    definizione di consegnato, e senza di essa un obiettivo si chiude su un abbozzo.
 * 2. «finché l'obiettivo è aperto non chiedi il permesso di andare avanti» contraddiceva il
 *    cancello di decisione di WORK_ETHIC_BLOCK (pubblicare, spendere oltre, distruggere, pagare).
 *    Vince il cancello: quelle azioni sono irreversibili, e un obiettivo aperto non le autorizza.
 *
 * Il controllo guarda la descrizione VERA che il modello riceve, non il sorgente.
 */
describe('le regole del goal che chiudono un conflitto restano scritte', () => {
	const setGoal = createGoalTools({
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		supabase: fakeSupabase(null) as any,
		brandId: 'b1',
		userId: 'u1',
		threadId: 't1'
	}).set_goal;
	const d = String(setGoal.description);

	it('la riga READY del mestiere è una FONTE di criteri, non uno standard da scartare', () => {
		expect(d).toContain('READY line');
		// E la regola generale resta, altrimenti si torna a fare criteri di ogni buona abitudine.
		expect(d).toContain('completely different request');
	});

	it("un obiettivo aperto non autorizza il cancello di decisione", () => {
		expect(d).toContain('YOU DO NOT ASK PERMISSION TO CARRY ON');
		expect(d).toContain('THE ONE EXCEPTION');
		expect(d).toMatch(/publishing or going live/);
	});
});
