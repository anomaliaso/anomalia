import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SPECIALISTS } from '@anomalia/agent-contracts/specs';
import type { AgentRuntime, RunEvent, ToolResult } from '@anomalia/agent-kit';
import { runTurn, type TurnInput } from './turn';

/** Un finto db minimo: una tabella in memoria che applica davvero eq/insert/update. */
function fakeDb() {
	const rows: Record<string, unknown>[] = [];
	let seq = 0;
	const client = {
		from: () => ({
			insert: (values: Record<string, unknown>) => ({
				select: () => ({
					single: async () => {
						const row = { id: `run-${++seq}`, state: 'queued', ...values };
						rows.push(row);
						return { data: { ...row }, error: null };
					}
				})
			}),
			// lettura: select('state').eq('id', x).single()
			select: () => {
				const filters: Array<[string, unknown]> = [];
				const chain = {
					eq: (col: string, val: unknown) => {
						filters.push([col, val]);
						return chain;
					},
					single: async () => {
						const row = rows.find((r) => filters.every(([c, v]) => r[c] === v));
						return row
							? { data: { ...row }, error: null }
							: { data: null, error: { message: 'no rows' } };
					}
				};
				return chain;
			},
			// scrittura: update(v).eq().eq().select() → thenable con ARRAY (come PostgREST)
			update: (values: Record<string, unknown>) => {
				const filters: Array<[string, unknown]> = [];
				const chain = {
					eq: (col: string, val: unknown) => {
						filters.push([col, val]);
						return chain;
					},
					select: async () => {
						const matched = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
						for (const row of matched) Object.assign(row, values);
						return { data: matched.map((r) => ({ ...r })), error: null };
					}
				};
				return chain;
			}
		})
	};
	return { client: client as unknown as SupabaseClient, rows };
}

/** Un runtime a copione: emette gli eventi che gli dai e basta. */
function scriptedRuntime(events: RunEvent[]): AgentRuntime {
	return {
		describe: () => ({ id: 'scripted', adapterVersion: '0', capabilities: { streaming: true, tools: true } }),
		// eslint-disable-next-line @typescript-eslint/require-await
		run: async function* () {
			for (const e of events) yield e;
		},
		abort: async () => {}
	};
}

const ok: ToolResult = { content: [{ type: 'text', text: 'ok' }] };

function input(): TurnInput {
	return {
		spec: SPECIALISTS[0],
		brandId: 'b1',
		threadId: null,
		userId: 'u1',
		locale: 'it',
		messages: [],
		tools: [],
		extras: { memoryMd: '', fileIndex: '' },
		limits: { maxSteps: 10, tokenBudget: 100_000, deadlineMs: 60_000 },
		model: { provider: 'kie', id: 'default' }
	};
}

describe('turn — le tre uscite di un turno', () => {
	it('reply → done, e il messaggio è il payload', async () => {
		const { client, rows } = fakeDb();
		const rt = scriptedRuntime([
			{ type: 'tool_call', id: 't1', call: { name: 'reply', args: { message: 'fatto: post 42', delivered: ['42'] } } },
			{ type: 'tool_result', id: 't1', result: ok },
			{ type: 'done', reason: 'completed' }
		]);
		const out = await runTurn(client, rt, async () => ok, input());
		expect(out.reason).toBe('reply');
		expect(out.reply).toEqual({ message: 'fatto: post 42', delivered: ['42'], source: 'reply' });
		expect(rows[0].state).toBe('done');
	});

	it('ask_user → waiting_input PERSISTITO, con la domanda salvata', async () => {
		const { client, rows } = fakeDb();
		const rt = scriptedRuntime([
			{ type: 'tool_call', id: 't1', call: { name: 'ask_user', args: { question: 'quale palette?' } } },
			{ type: 'tool_result', id: 't1', result: ok },
			{ type: 'done', reason: 'completed' }
		]);
		const out = await runTurn(client, rt, async () => ok, input());
		expect(out.reason).toBe('waiting_input');
		expect(out.question).toEqual({ question: 'quale palette?' });
		expect(rows[0].state).toBe('waiting_input');
		expect(out.reply).toBeNull();
	});


	it('prosa senza reply → il testo È il messaggio (source: text), risolto QUI per ogni superficie', async () => {
		const { client, rows } = fakeDb();
		const rt = scriptedRuntime([
			{ type: 'text', text: 'Ciao! ' },
			{ type: 'text', text: 'Come posso aiutarti?' },
			{ type: 'done', reason: 'completed' }
		]);
		const out = await runTurn(client, rt, async () => ok, input());
		expect(out.reply).toEqual({
			message: 'Ciao! Come posso aiutarti?',
			delivered: [],
			source: 'text'
		});
		expect(rows[0].state).toBe('done');
	});

	it('il ripiego di testo NON scatta su step_limit: lì la reason è l\'informazione', async () => {
		const { client } = fakeDb();
		const rt = scriptedRuntime([
			{ type: 'text', text: 'appunti' },
			{ type: 'done', reason: 'step_limit' }
		]);
		const out = await runTurn(client, rt, async () => ok, input());
		expect(out.reply).toBeNull();
	});

	it('nessun atto terminale + step_limit → failed, e reply è null (tocca al ripiego onesto)', async () => {
		const { client, rows } = fakeDb();
		const rt = scriptedRuntime([
			{ type: 'text', text: 'appunti di lavoro' },
			{ type: 'done', reason: 'step_limit' }
		]);
		const out = await runTurn(client, rt, async () => ok, input());
		expect(out.reason).toBe('step_limit');
		expect(out.reply).toBeNull();
		expect(rows[0].state).toBe('failed');
	});

	it('un runtime che esplode lascia il run aborted e rilancia', async () => {
		const { client, rows } = fakeDb();
		const rt: AgentRuntime = {
			describe: () => ({ id: 'boom', adapterVersion: '0', capabilities: { streaming: true, tools: true } }),
			// eslint-disable-next-line @typescript-eslint/require-await
			run: async function* () {
				yield { type: 'text', text: 'parto...' } as RunEvent;
				throw new Error('kaboom');
			},
			abort: async () => {}
		};
		await expect(runTurn(client, rt, async () => ok, input())).rejects.toThrow('kaboom');
		expect(rows[0].state).toBe('aborted');
	});

	it('gli eventi arrivano a onEvent nell\'ordine, per chi streama', async () => {
		const { client } = fakeDb();
		const rt = scriptedRuntime([
			{ type: 'text', text: 'a' },
			{ type: 'text', text: 'b' },
			{ type: 'done', reason: 'completed' }
		]);
		const seen: string[] = [];
		await runTurn(client, rt, async () => ok, input(), (e) => seen.push(e.type));
		expect(seen).toEqual(['text', 'text', 'done']);
	});
});
