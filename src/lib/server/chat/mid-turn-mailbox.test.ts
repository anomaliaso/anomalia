import { describe, expect, it, vi, beforeEach } from 'vitest';

const saveMessages = vi.fn(async () => ['m1']);
vi.mock('./persistence', () => ({ saveMessages }));

const { claimQueuedFollowUps, createMidTurnMailbox } = await import('./mid-turn-mailbox');

type Row = { id: string; status: string; input_params: Record<string, unknown> };

/**
 * chat_jobs finto con lo stato in memoria: la select filtra i pending, l'update fa il claim
 * atomico (pending→done) come farebbe Postgres — un solo vincitore per riga.
 */
function fakeJobs(rows: Row[]) {
	return {
		from: () => ({
			select: () => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const q: any = {
					eq: () => q,
					order: () => q,
					limit: async () => ({
						data: rows
							.filter((r) => r.status === 'pending')
							.map((r) => ({ id: r.id, input_params: r.input_params }))
					})
				};
				return q;
			},
			update: () => ({
				eq: (col: string, val: string) => ({
					eq: (_col2: string, wantStatus: string) => ({
						select: () => ({
							maybeSingle: async () => {
								const row = rows.find((r) => r.id === val);
								if (!row || row.status !== wantStatus) return { data: null };
								row.status = 'done';
								return { data: { id: row.id } };
							}
						})
					})
				})
			})
		})
	} as never;
}

beforeEach(() => {
	saveMessages.mockClear();
});

describe('claimQueuedFollowUps — la cassetta si consuma UNA volta', () => {
	it('reclama un follow-up pending e lo marca done: il drain non lo rilancerà come turno', async () => {
		const rows: Row[] = [{ id: 'j1', status: 'pending', input_params: { user_message: 'anche in inglese!' } }];
		const supabase = fakeJobs(rows);
		const first = await claimQueuedFollowUps(supabase, { userId: 'u', threadId: 't' });
		expect(first).toEqual([{ id: 'j1', text: 'anche in inglese!', alreadySaved: false }]);
		expect(rows[0].status).toBe('done');
		// Seconda chiamata (step successivo): niente da reclamare — consumato una volta sola.
		expect(await claimQueuedFollowUps(supabase, { userId: 'u', threadId: 't' })).toEqual([]);
	});

	it('NON tocca continuazioni, turni schedulati o messaggi con documenti — quelli sono turni interi', async () => {
		const rows: Row[] = [
			{ id: 'c1', status: 'pending', input_params: { user_message: 'Keep working…', continuation: true } },
			{ id: 's1', status: 'pending', input_params: { user_message: 'Weekly review', scheduled: true } },
			{ id: 'd1', status: 'pending', input_params: { user_message: 'leggi questo', documents: [{ id: 'x' }] } }
		];
		expect(await claimQueuedFollowUps(fakeJobs(rows), { userId: 'u', threadId: 't' })).toEqual([]);
		expect(rows.every((r) => r.status === 'pending')).toBe(true);
	});

	it('perdere la corsa col drain non è un errore: la riga già presa non viene assorbita', async () => {
		// Il drain l\'ha già portata a running: il claim pending→done non matcha e si passa oltre.
		const rows: Row[] = [{ id: 'j1', status: 'running', input_params: { user_message: 'ciao' } }];
		// La select del fake filtra i pending, ma simuliamo la finestra: riga listata e poi rubata.
		const listed: Row[] = [{ id: 'j1', status: 'running', input_params: { user_message: 'ciao' } }];
		const supabase = {
			from: () => ({
				select: () => {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const q: any = {
						eq: () => q,
						order: () => q,
						limit: async () => ({ data: listed.map((r) => ({ id: r.id, input_params: r.input_params })) })
					};
					return q;
				},
				update: () => ({
					eq: () => ({
						eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null }) }) })
					})
				})
			})
		} as never;
		expect(await claimQueuedFollowUps(supabase, { userId: 'u', threadId: 't' })).toEqual([]);
		void rows;
	});
});

describe('createMidTurnMailbox — il follow-up entra nello step, e resta nei successivi', () => {
	it('appende il messaggio assorbito in fondo al contesto e lo salva subito nel thread', async () => {
		const rows: Row[] = [{ id: 'j1', status: 'pending', input_params: { user_message: 'più corto!' } }];
		const mailbox = createMidTurnMailbox(fakeJobs(rows), { brandId: 'b', userId: 'u', threadId: 't', jobId: 'turn1' });

		const base = [{ role: 'user' as const, content: 'scrivi un articolo' }];
		const step1 = await mailbox.prepareStep({ messages: base });
		expect(step1.messages).toHaveLength(2);
		expect(step1.messages?.[1]).toEqual({ role: 'user', content: 'più corto!' });
		expect(saveMessages).toHaveBeenCalledWith(
			expect.anything(),
			'b',
			'u',
			[{ role: 'user', content: 'più corto!' }],
			't'
		);
		expect(mailbox.absorbedCount()).toBe(1);
	});

	it('ai@7 porta avanti l’override: lo step dopo riceve il follow-up già dentro e la mailbox non lo riappende', async () => {
		const rows: Row[] = [{ id: 'j1', status: 'pending', input_params: { user_message: 'più corto!' } }];
		const mailbox = createMidTurnMailbox(fakeJobs(rows), { brandId: 'b', userId: 'u', threadId: 't', jobId: 'turn1' });

		const base = [{ role: 'user' as const, content: 'scrivi un articolo' }];
		const step1 = await mailbox.prepareStep({ messages: base });
		expect(step1.messages).toHaveLength(2);

		const carriedForward = [...(step1.messages ?? []), { role: 'assistant' as const, content: 'Ecco.' }];
		const step2 = await mailbox.prepareStep({ messages: carriedForward });
		expect(step2).toEqual({});
		expect(saveMessages).toHaveBeenCalledTimes(1);
	});

	it('un follow-up reclamato in uno step senza messaggi non si perde: entra allo step successivo', async () => {
		const rows: Row[] = [{ id: 'j1', status: 'pending', input_params: { user_message: 'aggiungi le fonti' } }];
		const mailbox = createMidTurnMailbox(fakeJobs(rows), { brandId: 'b', userId: 'u', threadId: 't' });

		expect(await mailbox.prepareStep({})).toEqual({});
		const step2 = await mailbox.prepareStep({
			messages: [{ role: 'user' as const, content: 'scrivi un articolo' }]
		});
		expect(step2.messages).toHaveLength(2);
		expect(step2.messages?.[1]).toEqual({ role: 'user', content: 'aggiungi le fonti' });
		expect(mailbox.absorbedCount()).toBe(1);
	});

	it('senza follow-up non tocca niente — e un errore DB degrada a turno normale', async () => {
		const broken = {
			from: () => ({
				select: () => {
					throw new Error('boom');
				}
			})
		} as never;
		const mailbox = createMidTurnMailbox(broken, { brandId: 'b', userId: 'u', threadId: 't' });
		expect(await mailbox.prepareStep({ messages: [] })).toEqual({});
		expect(mailbox.absorbedCount()).toBe(0);
	});
});

describe('un messaggio già a terra non viene salvato una seconda volta', () => {
	it('con user_message_saved la riga user non si riscrive: entra nel contesto e basta', async () => {
		const rows: Row[] = [
			{
				id: 'j1',
				status: 'pending',
				input_params: { user_message: 'no, in inglese!', user_message_saved: true }
			}
		];
		const mailbox = createMidTurnMailbox(fakeJobs(rows), {
			brandId: 'b',
			userId: 'u',
			threadId: 't'
		});

		const patch = await mailbox.prepareStep({ messages: [{ role: 'user', content: 'ciao' }] });

		expect(patch.messages?.at(-1)).toEqual({ role: 'user', content: 'no, in inglese!' });
		expect(mailbox.absorbedCount()).toBe(1);
		expect(saveMessages).not.toHaveBeenCalled();
	});

	it('senza la flag la riga si salva, come prima', async () => {
		const rows: Row[] = [
			{ id: 'j1', status: 'pending', input_params: { user_message: 'no, in inglese!' } }
		];
		const mailbox = createMidTurnMailbox(fakeJobs(rows), {
			brandId: 'b',
			userId: 'u',
			threadId: 't'
		});

		await mailbox.prepareStep({ messages: [{ role: 'user', content: 'ciao' }] });

		expect(saveMessages).toHaveBeenCalledTimes(1);
	});
});
