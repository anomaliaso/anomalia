import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { env } from '$env/dynamic/private';
import { dmAgents, dmMarker, dmNames, dmReplyBackMessage } from '$lib/chat-dm';

// Persistence e queue mockati: il test guarda COSA il tool salva e accoda, non il database.
const saveMessages = vi.fn(async () => ['m1']);
const getThread = vi.fn(async (): Promise<Record<string, unknown> | null> => ({ id: 'main-thread', agent: 'analyst', custom_agent_id: null }));
// `create_group_chat` apre un thread nuovo: qui basta che ne torni uno con un id.
let createdThreads = 0;
const createThread = vi.fn(async (_s: unknown, _b: string, _u: string, title: string, _p: unknown, agent: string | null) => ({
	id: `room-${++createdThreads}`,
	title,
	agent
}));
vi.mock('./persistence', () => ({ saveMessages, getThread, createThread }));
const markThreadRead = vi.fn(async () => undefined);
vi.mock('./unread', () => ({ markThreadRead }));
const kickChatQueueWork = vi.fn(async () => undefined);
const threadHasActiveChatResponse = vi.fn(async () => false);
vi.mock('./queue', () => ({ kickChatQueueWork, threadHasActiveChatResponse }));
// Il goal è mockato, non il database: il test decide se il thread ha un obiettivo aperto.
const loadOpenGoal = vi.fn(async () => null);
vi.mock('./goal', () => ({ loadOpenGoal }));

const { createAgentDmTools, getOrCreateDmThread, DM_SENDS_PER_TURN } = await import('./agent-dm-tools');
const { ROOM_MAX_MEMBERS } = await import('./room');
const { claimQueuedFollowUps } = await import('./mid-turn-mailbox');
const { subagentToolNames } = await import('./subagents');

// ── Supabase finto: chat_threads con .contains sul marcatore, chat_jobs come lista ────────────
type ThreadRow = { id: string; brand_id: string; user_id: string; title: string; room_agents: unknown; created_at: string };

function fakeDb() {
	const threads: ThreadRow[] = [];
	const jobs: Array<Record<string, unknown>> = [];
	const roomUpdates: Array<{ id: string; room_agents: unknown }> = [];
	let seq = 0;

	const matches = (row: ThreadRow, dm: string[]) => {
		const pair = dmAgents(row.room_agents);
		// Come il containment jsonb: tutti gli elementi cercati presenti, ordine irrilevante.
		return !!pair && dm.every((k) => pair.includes(k));
	};

	const supabase = {
		from: (table: string) => {
			if (table === 'chat_threads') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => ({
								contains: (_col: string, val: { dm: string[] }) => ({
									limit: () => ({
										maybeSingle: async () => ({ data: threads.find((t) => matches(t, val.dm)) ?? null })
									})
								})
							})
						})
					}),
					insert: (row: Record<string, unknown>) => ({
						select: () => ({
							single: async () => {
								const created: ThreadRow = {
									id: `dm-${++seq}`,
									created_at: new Date().toISOString(),
									...(row as Omit<ThreadRow, 'id' | 'created_at'>)
								};
								threads.push(created);
								return { data: created, error: null };
							}
						})
					}),
					// `setThreadRoomAgents`: update + tre eq (id, brand, user). Registra la roster
					// scritta, che è l'unica cosa che rende una stanza una stanza.
					update: (patch: Record<string, unknown>) => ({
						eq: (_c: string, id: string) => ({
							eq: () => ({
								eq: async () => {
									roomUpdates.push({ id, room_agents: patch.room_agents });
									return { error: null };
								}
							})
						})
					})
				};
			}
			if (table === 'chat_jobs') {
				return {
					insert: async (row: Record<string, unknown>) => {
						jobs.push(row);
						return { error: null };
					}
				};
			}
			if (table === 'custom_agent_schedules') {
				return {
					select: () => ({
						eq: () => ({
							eq: () => ({
								maybeSingle: async () => ({
									data: { id: '11111111-2222-3333-4444-555555555555', name: 'Chief of Staff', agent: null }
								})
							})
						})
					})
				};
			}
			throw new Error(`unexpected table ${table}`);
		}
	} as never;

	return { supabase, threads, jobs, roomUpdates };
}

const toolOpts = (supabase: never) => ({
	supabase,
	brandId: 'b1',
	userId: 'u1',
	threadId: 'main-thread',
	origin: 'http://localhost:5173',
	locale: 'it'
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (tools: any, input: Record<string, unknown>) => tools.message_agent.execute(input, {} as never);

beforeEach(() => {
	saveMessages.mockClear();
	kickChatQueueWork.mockClear();
	loadOpenGoal.mockResolvedValue(null);
	getThread.mockResolvedValue({ id: 'main-thread', agent: 'analyst', custom_agent_id: null });
});

describe('marcatore DM ($lib/chat-dm)', () => {
	it('un array (room) non è mai un DM; l’oggetto {dm:[a,b]} sì', () => {
		expect(dmAgents(['motion', 'analyst'])).toBeNull();
		expect(dmAgents({ dm: ['motion', 'analyst'] })).toEqual(['motion', 'analyst']);
		expect(dmAgents({ dm: ['motion'] })).toBeNull();
		expect(dmAgents(null)).toBeNull();
	});

	it('la coppia è ordinata: (A,B) e (B,A) producono lo stesso marcatore', () => {
		const ab = dmMarker({ key: 'analyst', name: 'Analyst' }, { key: 'content', name: 'Content' });
		const ba = dmMarker({ key: 'content', name: 'Content' }, { key: 'analyst', name: 'Analyst' });
		expect(ab.dm).toEqual(ba.dm);
		expect(dmNames(ab)).toEqual({ analyst: 'Analyst', content: 'Content' });
	});
});

describe('getOrCreateDmThread — UN thread per coppia, per sempre', () => {
	it('secondo invio (anche a ruoli invertiti) ritrova lo stesso thread', async () => {
		const { supabase, threads } = fakeDb();
		const a = { key: 'analyst', name: 'Analyst', agent: 'analyst' as const, customAgentId: null };
		const b = { key: 'content', name: 'Content Creator', agent: 'content' as const, customAgentId: null };
		const t1 = await getOrCreateDmThread(supabase, { brandId: 'b1', userId: 'u1', a, b });
		const t2 = await getOrCreateDmThread(supabase, { brandId: 'b1', userId: 'u1', a: b, b: a });
		expect(t1?.id).toBe(t2?.id);
		expect(threads.length).toBe(1);
		expect(threads[0].title).toContain('⇄');
		// Nasce letto (0207): il primo messaggio deve avere un "prima" per accendere il badge.
		expect(markThreadRead).toHaveBeenCalled();
	});
});

describe('message_agent — invio, await, budget', () => {
	it('salva il messaggio firmato, accoda il turno del destinatario con agente forzato; await:false non chiede il ritorno', async () => {
		const { supabase, jobs } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await exec(tools, { to: 'content', message: 'Servono 3 reel entro venerdì' });
		expect(out.success).toBe(true);
		expect(out.dm_thread_id).toBeTruthy();
		// La riga user nel thread DM è firmata con il mittente (speaker → chat_messages.name).
		expect(saveMessages).toHaveBeenCalledWith(
			expect.anything(), 'b1', 'u1',
			[{ role: 'user', content: 'Servono 3 reel entro venerdì' }],
			out.dm_thread_id,
			{ speaker: 'analyst' }
		);
		const params = jobs[0].input_params as Record<string, unknown>;
		expect(params.dm).toBe(true);
		expect(params.agent).toBe('content');
		expect(params.speaker).toBe('content');
		expect(params.from_speaker).toBe('analyst');
		expect(params.reply_to_thread).toBeUndefined();
		// L'output NON eco-a il corpo del messaggio: se lo facesse, il modello tenderebbe a
		// ricopiarlo nella chat principale — che il chip racconta già (sintomo del proprietario).
		expect(JSON.stringify(out)).not.toContain('Servono 3 reel');
	});

	it('Anomalia non e\u2019 un destinatario: il rifiuto dice al modello di andare dallo specialista', async () => {
		const { supabase, jobs } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		for (const to of ['auto', 'Anomalia']) {
			const out = await exec(tools, { to, message: 'pensaci tu' });
			expect(out.success).toBeUndefined();
			expect(String(out.error)).toContain('does not receive agent messages');
			// L\u2019errore deve indicare la strada, non solo chiudere la porta.
			expect(String(out.error)).toContain('content');
		}
		// Niente thread, niente turno accodato, e il budget del turno non e\u2019 stato speso.
		expect(jobs.length).toBe(0);
		expect(saveMessages).not.toHaveBeenCalled();
		const ok = await exec(tools, { to: 'content', message: 'questo invece passa' });
		expect(ok.success).toBe(true);
	});

	it('await:true non versa più la risposta nel thread con l\'utente', async () => {
		const { supabase, jobs } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await exec(tools, { to: 'content', message: 'Dammi lo stato', await: true });
		expect(out.success).toBe(true);
		expect((jobs[0].input_params as Record<string, unknown>).reply_to_thread).toBeUndefined();
		expect(String(out.hint ?? '')).not.toContain('📩');
	});

	it('idempotenza del thread: due messaggi allo stesso agente = stesso dm_thread_id', async () => {
		const { supabase } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		const one = await exec(tools, { to: 'content', message: 'primo' });
		const two = await exec(tools, { to: 'content', message: 'secondo' });
		expect(one.dm_thread_id).toBe(two.dm_thread_id);
	});

	it('budget per turno e dedupe del messaggio identico', async () => {
		const { supabase } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		expect((await exec(tools, { to: 'content', message: 'ciao' })).success).toBe(true);
		// Identico → rifiutato senza consumare budget in più.
		expect((await exec(tools, { to: 'content', message: 'ciao' })).error).toMatch(/twice|due/i);
		expect((await exec(tools, { to: 'motion', message: 'x' })).success).toBe(true);
		expect((await exec(tools, { to: 'ugc', message: 'y' })).success).toBe(true);
		// Quarto invio: oltre DM_SENDS_PER_TURN.
		const over = await exec(tools, { to: 'web', message: 'z' });
		expect(over.error).toContain(String(DM_SENDS_PER_TURN));
	});

	it('destinatario ignoto e auto-messaggio vengono rifiutati', async () => {
		const { supabase } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		expect((await exec(tools, { to: 'reparto-inesistente', message: 'x' })).error).toBeTruthy();
		expect((await exec(tools, { to: 'analyst', message: 'x' })).error).toBeTruthy();
	});

	it('dentro un thread DM si rifiuta: la risposta È già il messaggio (niente ping-pong)', async () => {
		const { supabase, jobs } = fakeDb();
		getThread.mockResolvedValue({ id: 'dm-1', agent: null, custom_agent_id: null, room_agents: { dm: ['analyst', 'content'] } });
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await exec(tools, { to: 'motion', message: 'x' });
		expect(out.error).toBeTruthy();
		expect(jobs.length).toBe(0);
	});
});

describe('consegna via mailbox (await:true) e perimetro', () => {
	const fakeJobs = (rows: Array<{ id: string; status: string; input_params: Record<string, unknown> }>) =>
		({
			from: () => ({
				select: () => {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const q: any = {
						eq: () => q,
						order: () => q,
						limit: async () => ({
							data: rows.filter((r) => r.status === 'pending').map((r) => ({ id: r.id, input_params: r.input_params }))
						})
					};
					return q;
				},
				update: () => ({
					eq: (_c: string, val: string) => ({
						eq: () => ({
							select: () => ({
								maybeSingle: async () => {
									const row = rows.find((r) => r.id === val);
									if (!row || row.status !== 'pending') return { data: null };
									row.status = 'done';
									return { data: { id: row.id } };
								}
							})
						})
					})
				})
			})
		}) as never;

	it('il riassunto di ritorno (riga semplice) VIENE assorbito; il job dm:true NO', async () => {
		const back = dmReplyBackMessage('Content Creator', 'Fatti i 3 reel, due in review.', 'it');
		const rows = [
			{ id: 'r1', status: 'pending', input_params: { user_message: back } },
			{ id: 'd1', status: 'pending', input_params: { user_message: 'msg per il DM', dm: true, agent: 'content' } }
		];
		const claims = await claimQueuedFollowUps(fakeJobs(rows), { userId: 'u1', threadId: 'main-thread' });
		expect(claims.map((c) => c.id)).toEqual(['r1']);
		expect(claims[0].text).toContain('Content Creator');
		// Il job DM resta pending: girerà come turno intero con l'agente forzato.
		expect(rows[1].status).toBe('pending');
	});

	it('message_agent non arriva mai ai sotto-agenti (chi parla è uno solo)', () => {
		const names = subagentToolNames('execute', 'content', ['message_agent', 'read_posts', 'create_post']);
		expect(names).not.toContain('message_agent');
	});
});

/**
 * IL FAN-OUT — una azione con N destinatari, e il conto che non cambia.
 *
 * Due regole diverse che è facile confondere in una sola:
 *  - CHI decide (`because_user_asked`): scrivere a più colleghi è una cosa che chiede l'utente.
 *  - QUANTO costa (`DM_SENDS_PER_TURN`): il tetto si conta in DESTINATARI, perché ogni
 *    destinatario è un turno accodato e pagato, che stia in una chiamata o in tre.
 * Se un giorno la seconda venisse contata in chiamate, un fan-out da tre × tre chiamate farebbe
 * nove turni con lo stesso tetto scritto in faccia: è quello che questi test impediscono.
 */
describe('message_agent — fan-out esplicito', () => {
	it('più destinatari senza il perché sono un rifiuto, e il rifiuto dice di sceglierne UNO', async () => {
		const { supabase, jobs } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await exec(tools, { to: ['content', 'motion'], message: 'stato dei reel' });
		expect(out.error).toBe('fan_out_needs_the_user');
		expect(String(out.hint)).toContain('ONE agent');
		// Niente di parziale: nessun messaggio, nessun turno, nessun budget speso.
		expect(jobs.length).toBe(0);
		expect(saveMessages).not.toHaveBeenCalled();
	});

	it('col perché dell’utente parte UNA azione con N destinatari: N thread, N turni, un solo output', async () => {
		const { supabase, jobs } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await exec(tools, {
			to: ['content', 'motion'],
			message: 'stato dei reel entro oggi',
			because_user_asked: 'chiedi a Content e Motion a che punto sono'
		});
		expect(out.success).toBe(true);
		expect(out.sends.map((s: { to: string }) => s.to)).toEqual(['content', 'motion']);
		// Thread distinti: un fan-out non è una chat di gruppo, sono N conversazioni a due.
		expect(new Set(out.sends.map((s: { dm_thread_id: string }) => s.dm_thread_id)).size).toBe(2);
		expect(jobs.length).toBe(2);
		expect(jobs.map((j) => (j.input_params as Record<string, unknown>).speaker)).toEqual(['content', 'motion']);
		// Con più destinatari la forma piatta NON c'è: chi legge deve guardare `sends`.
		expect(out.dm_thread_id).toBeUndefined();
	});

	it('IL TETTO SI CONTA IN DESTINATARI, non in chiamate — e il fan-out oltre budget non parte a metà', async () => {
		const { supabase, jobs } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		expect((await exec(tools, { to: 'content', message: 'uno' })).success).toBe(true);
		expect((await exec(tools, { to: 'motion', message: 'due' })).success).toBe(true);
		// Restano 1 destinatario di budget su DM_SENDS_PER_TURN: una lista da 2 non ci sta.
		const over = await exec(tools, {
			to: ['web', 'ugc'],
			message: 'tre',
			because_user_asked: "l'utente ha detto di chiedere a entrambi"
		});
		expect(String(over.error)).toContain(String(DM_SENDS_PER_TURN));
		// Tutto-o-niente: nessuno dei due è partito.
		expect(jobs.length).toBe(2);
	});

	it('con un obiettivo aperto il fan-out senza perché è orchestrazione, non rumore', async () => {
		const { supabase, jobs } = fakeDb();
		loadOpenGoal.mockResolvedValue({ id: 'g1', status: 'open', description: 'prepara il lancio' });
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await exec(tools, { to: ['content', 'motion'], message: 'il lancio serve a entrambi: parti' });
		expect(out.success).toBe(true);
		expect(jobs.length).toBe(2);
	});

	it('un destinatario solo tiene la forma di sempre: la chip in chat non impara niente', async () => {		const { supabase } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await exec(tools, { to: 'content', message: 'ciao' });
		// I tre campi che ChatDmChip legge (e che stanno nelle tool-call già salvate).
		expect(out.dm_thread_id).toBeTruthy();
		expect(out.to).toBe('content');
		expect(out.to_name).toBeTruthy();
		expect(out.sends).toHaveLength(1);
	});

	it('lo stesso destinatario ripetuto nella lista è UN destinatario: non serve il perché e non costa due', async () => {
		const { supabase, jobs } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await exec(tools, { to: ['content', 'content'], message: 'ciao' });
		expect(out.success).toBe(true);
		expect(jobs.length).toBe(1);
	});

	it('in un fan-out un destinatario rifiutato non ferma gli altri, ma resta scritto in `failed`', async () => {
		const { supabase, jobs } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await exec(tools, {
			to: ['content', 'auto'],
			message: 'x',
			because_user_asked: 'chiedi a tutti e due'
		});
		expect(out.success).toBe(true);
		expect(out.sends).toHaveLength(1);
		expect(out.failed).toHaveLength(1);
		expect(String(out.failed[0].error)).toContain('does not receive agent messages');
		expect(jobs.length).toBe(1);
	});
});

/**
 * `create_group_chat` — la stanza si APRE, non si anima.
 *
 * Il controllo che conta è che aprirla non accodi NIENTE: la macchina delle room fa parlare
 * qualcuno solo quando c'è una persona che ha appena scritto, e un tool che aprisse una stanza
 * facendo partire N turni sarebbe il fan-out di prima senza nessuno dei suoi freni.
 */
describe('create_group_chat', () => {
	const prevFlag = env.GROUP_CHATS;
	beforeEach(() => {
		env.GROUP_CHATS = 'true';
		createThread.mockClear();
	});
	afterEach(() => {
		env.GROUP_CHATS = prevFlag;
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const room = (tools: any, input: Record<string, unknown>) => tools.create_group_chat.execute(input, {} as never);

	it('apre il thread con la roster, e NON accoda nessun turno: la stanza parla quando scrive l’utente', async () => {
		const { supabase, jobs, roomUpdates } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await room(tools, { members: ['motion', 'web'], title: 'Reel + pagina prodotto' });
		expect(out.success).toBe(true);
		expect(out.thread_id).toBeTruthy();
		expect(out.members.map((m: { key: string }) => m.key)).toEqual(['motion', 'web']);
		expect(roomUpdates).toEqual([{ id: out.thread_id, room_agents: ['motion', 'web'] }]);
		// Il punto di tutto il tool: zero turni pagati.
		expect(jobs.length).toBe(0);
		expect(saveMessages).not.toHaveBeenCalled();
		// E l'hint non lascia credere che una conversazione sia partita.
		expect(String(out.hint)).toContain('Nobody has spoken');
	});

	it('una stanza per turno', async () => {
		const { supabase } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		expect((await room(tools, { members: ['motion', 'web'], title: 'una' })).success).toBe(true);
		expect(String((await room(tools, { members: ['ugc', 'content'], title: 'due' })).error)).toContain('One group chat per turn');
	});

	it('feature spenta: il tool non si offre affatto — niente stanze da promettere', async () => {
		env.GROUP_CHATS = '';
		const { supabase } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		// Non "c'è e fallisce": non c'è. Un tool che risponde sempre "non qui" fa promettere
		// all'utente una stanza che non si aprirà, e si paga in token a ogni turno.
		expect('create_group_chat' in tools).toBe(false);
		// E il DM resta, che è l'unica strada vera verso un collega quando le stanze non ci sono.
		expect('message_agent' in tools).toBe(true);
	});

	it('meno di due membri validi non è una stanza (e i nomi inventati si scartano, non alzano)', async () => {
		const { supabase } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await room(tools, { members: ['motion', 'reparto-inesistente'], title: 'x' });
		expect(String(out.error)).toContain('at least 2 valid members');
		expect(createThread).not.toHaveBeenCalled();
	});

	it('la stanza si taglia al tetto dei membri, come dappertutto', async () => {
		const { supabase, roomUpdates } = fakeDb();
		const tools = createAgentDmTools(toolOpts(supabase));
		await room(tools, { members: ['content', 'motion', 'web', 'analyst', 'ugc'], title: 'tutti' });
		expect((roomUpdates[0].room_agents as string[]).length).toBe(ROOM_MAX_MEMBERS);
	});

	it('dentro un DM fra agenti si rifiuta: lì non c’è nessun utente che possa animare la stanza', async () => {
		const { supabase } = fakeDb();
		getThread.mockResolvedValue({ id: 'dm-1', agent: null, custom_agent_id: null, room_agents: { dm: ['analyst', 'content'] } });
		const tools = createAgentDmTools(toolOpts(supabase));
		const out = await room(tools, { members: ['motion', 'web'], title: 'x' });
		expect(String(out.error)).toContain('private agent chat');
		expect(createThread).not.toHaveBeenCalled();
	});

	it('non arriva mai ai sotto-agenti', () => {
		const names = subagentToolNames('execute', 'content', ['create_group_chat', 'read_posts']);
		expect(names).not.toContain('create_group_chat');
	});
});
