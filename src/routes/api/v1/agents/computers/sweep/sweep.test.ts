import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recoverDeadPartial } from '$lib/server/agent-kit-recover';

/**
 * Caso 1 del censimento avversario: il reaper indovinava se `onFinish` aveva già salvato con un
 * `.ilike('content', primi-40-char%')` non-escapato — un incipit con `%`/`_` faceva match a caso.
 * Fisso vero: il marcatore `partial_saved_msg_id` (0219) fa da interruttore, l'ilike resta solo
 * come palliativo per le righe senza marcatore, ora con le wildcard escapate.
 */

type Row = Record<string, unknown>;

/** Un finto client minimo — solo le catene che `recoverDeadPartial` usa davvero. */
function fakeDb(seed: { agent_kit_runs?: Row[]; chat_messages?: Row[] }) {
	const tables: Record<string, Row[]> = {
		agent_kit_runs: (seed.agent_kit_runs ?? []).map((r) => ({ ...r })),
		chat_messages: (seed.chat_messages ?? []).map((r) => ({ ...r }))
	};

	// PostgREST ILIKE: % = qualunque sequenza, _ = un carattere, \X = X letterale.
	function ilikeToRegExp(pattern: string): RegExp {
		let re = '';
		for (let i = 0; i < pattern.length; i++) {
			const c = pattern[i];
			if (c === '\\' && i + 1 < pattern.length) {
				re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			} else if (c === '%') {
				re += '.*';
			} else if (c === '_') {
				re += '.';
			} else {
				re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			}
		}
		return new RegExp(`^${re}$`, 's');
	}

	function from(name: string) {
		const table = (tables[name] ??= []);
		let mode: 'select' | 'update' | 'insert' = 'select';
		let payload: Row | undefined;
		const filters: Array<(r: Row) => boolean> = [];

		function matched(): Row[] {
			return table.filter((r) => filters.every((f) => f(r)));
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const api: any = {
			select: () => api,
			insert: (p: Row) => {
				mode = 'insert';
				payload = p;
				return api;
			},
			eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
			gte: (c: string, v: string) => (filters.push((r) => String(r[c] ?? '') >= v), api),
			ilike: (c: string, pattern: string) => {
				const re = ilikeToRegExp(pattern);
				filters.push((r) => re.test(String(r[c] ?? '')));
				return api;
			},
			limit: () => api,
			maybeSingle: async () => {
				if (mode === 'insert' && payload) {
					const row = { id: `msg-${table.length + 1}`, ...payload };
					table.push(row);
					return { data: row, error: null };
				}
				const hits = matched();
				return { data: hits[0] ? { ...hits[0] } : null, error: null };
			},
			// `insert({...})` senza `.select()`/`.maybeSingle()` in coda (com'è nel codice vero): il
			// query builder di supabase-js è thenable, l'`await` diretto è ciò che esegue la insert.
			then(resolve: (v: { data: Row[] | null; error: null }) => unknown, reject?: (e: unknown) => void) {
				if (mode === 'insert' && payload) {
					const row = { id: `msg-${table.length + 1}`, ...payload };
					table.push(row);
					return Promise.resolve(resolve({ data: [row], error: null })).catch(reject);
				}
				return Promise.resolve(resolve({ data: matched(), error: null })).catch(reject);
			}
		};
		return api;
	}

	return { tables, client: { from } as unknown as SupabaseClient };
}

describe('recoverDeadPartial', () => {
	it('marcatore valorizzato → non ricontrolla nulla, non inserisce (già salvato da onFinish)', async () => {
		const db = fakeDb({
			agent_kit_runs: [
				{ id: 'run-1', brand_id: 'b1', user_id: 'u1', thread_id: 't1', partial: { text: 'ciao' }, partial_saved_msg_id: 'saved-1' }
			]
		});

		await recoverDeadPartial(db.client, 'run-1');

		expect(db.tables.chat_messages).toHaveLength(0);
	});

	it('incipit con % e _ letterali: senza escape avrebbe fatto match su testo estraneo, con l’escape no', async () => {
		// L'incipit contiene wildcard LIKE vere: `%` e `_`. "50XX di scontoZoggi…" combacia col
		// pattern NON escapato (`50.* di sconto.oggi.*`, `%`→.* e `_`→.) ma non è affatto lo stesso
		// messaggio — è solo un falso positivo. PRIMA del fix (ilike sul testo grezzo), il reaper lo
		// trovava e saltava il recupero in silenzio: il turno interrotto restava perso.
		const text = '50% di sconto_oggi';
		const db = fakeDb({
			agent_kit_runs: [
				{ id: 'run-1', brand_id: 'b1', user_id: 'u1', thread_id: 't1', partial: { text }, partial_saved_msg_id: null }
			],
			chat_messages: [
				{
					id: 'existing-unrelated',
					thread_id: 't1',
					role: 'assistant',
					content: '50XX di scontoZoggi ma è un turno completamente diverso',
					created_at: new Date().toISOString()
				}
			]
		});

		await recoverDeadPartial(db.client, 'run-1');

		// Il recupero DEVE inserire: il messaggio "esistente" non è un vero doppione, solo un
		// falso positivo della vecchia ilike non escapata.
		expect(db.tables.chat_messages).toHaveLength(2);
		const inserted = db.tables.chat_messages.find((m) => m.id !== 'existing-unrelated');
		expect(String(inserted?.content)).toContain(text);
	});

	it('vero doppione salvato PRIMA che il reaper potesse scattare (≥10\' fa): non duplica', async () => {
		// Il reaper prende solo run col battito fermo da ≥10 minuti, e l'ultimo battito precede di
		// un attimo il saveMessages di onFinish: quando questa funzione gira, il messaggio vero è
		// SEMPRE vecchio di almeno dieci minuti. Con la vecchia finestra `now - 5'` il guard non
		// poteva scattare mai e il partial finiva in chat come secondo messaggio monco.
		const text = 'la palette scelta è quella scura, coerente col resto del feed';
		const runStart = new Date(Date.now() - 20 * 60_000).toISOString();
		const savedAt = new Date(Date.now() - 11 * 60_000).toISOString();
		const db = fakeDb({
			agent_kit_runs: [
				{
					id: 'run-1',
					brand_id: 'b1',
					user_id: 'u1',
					thread_id: 't1',
					created_at: runStart,
					partial: { text },
					partial_saved_msg_id: null
				}
			],
			chat_messages: [{ id: 'already-saved', thread_id: 't1', role: 'assistant', content: text, created_at: savedAt }]
		});

		await recoverDeadPartial(db.client, 'run-1');

		expect(db.tables.chat_messages).toHaveLength(1); // niente doppione
	});

	it('un messaggio nato PRIMA di questo run non è un doppione: il recupero inserisce lo stesso', async () => {
		// L'ancora è la nascita del run: una risposta identica di un turno precedente non deve
		// far saltare il recupero di questo.
		const text = 'la palette scelta è quella scura, coerente col resto del feed';
		const db = fakeDb({
			agent_kit_runs: [
				{
					id: 'run-1',
					brand_id: 'b1',
					user_id: 'u1',
					thread_id: 't1',
					created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
					partial: { text },
					partial_saved_msg_id: null
				}
			],
			chat_messages: [
				{
					id: 'turno-vecchio',
					thread_id: 't1',
					role: 'assistant',
					content: text,
					created_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString()
				}
			]
		});

		await recoverDeadPartial(db.client, 'run-1');

		expect(db.tables.chat_messages).toHaveLength(2);
	});

	it('schema senza la colonna 0219 (produzione oggi): il recupero funziona lo stesso', async () => {
		// La riga NON ha `partial_saved_msg_id` — è lo schema reale finché la 0219 non è applicata.
		// Con la select che nominava quella colonna, PostgREST rispondeva 42703, `run` era null e
		// il recupero usciva muto: il testo prodotto spariva e nemmeno un log lo diceva.
		const text = 'il piano è pronto, ecco i tre pilastri';
		const db = fakeDb({
			agent_kit_runs: [
				{
					id: 'run-1',
					brand_id: 'b1',
					user_id: 'u1',
					thread_id: 't1',
					created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
					partial: { text }
				}
			]
		});

		await recoverDeadPartial(db.client, 'run-1');

		expect(db.tables.chat_messages).toHaveLength(1);
		expect(String(db.tables.chat_messages[0].content)).toContain(text);
	});

	it('un run morto a metà tool effettoso: la riga recuperata porta la tool call, non solo il testo', async () => {
		const db = fakeDb({
			agent_kit_runs: [
				{
					id: 'run-1',
					brand_id: 'b1',
					user_id: 'u1',
					thread_id: 't1',
					created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
					partial: {
						text: 'Genero la grafica.',
						tools: [
							{ toolCallId: 'c1', toolName: 'content_generate_image', status: 'running', textLen: 18, input: { prompt: 'p' } }
						]
					},
					partial_saved_msg_id: null
				}
			]
		});

		await recoverDeadPartial(db.client, 'run-1');

		expect(db.tables.chat_messages).toHaveLength(1);
		const toolCalls = db.tables.chat_messages[0].tool_calls as Array<{ type: string; toolCallId?: string }>;
		expect(toolCalls.some((p) => p.type === 'tool-call' && p.toolCallId === 'c1')).toBe(true);
	});

	it('un run morto prima di scrivere testo ma con una tool call in volo: si recupera lo stesso', async () => {
		const db = fakeDb({
			agent_kit_runs: [
				{
					id: 'run-1',
					brand_id: 'b1',
					user_id: 'u1',
					thread_id: 't1',
					created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
					partial: {
						text: '',
						tools: [{ toolCallId: 'c1', toolName: 'motion_render', status: 'running', textLen: 0, input: {} }]
					},
					partial_saved_msg_id: null
				}
			]
		});

		await recoverDeadPartial(db.client, 'run-1');

		expect(db.tables.chat_messages).toHaveLength(1);
		const toolCalls = db.tables.chat_messages[0].tool_calls as Array<{ toolCallId?: string }>;
		expect(toolCalls.some((p) => p.toolCallId === 'c1')).toBe(true);
	});

	it('errore di lettura: no-op, ma loggato — non un silenzio', async () => {
		const errs: unknown[][] = [];
		const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errs.push(a));
		const client = {
			from: () => ({
				select: () => ({
					eq: () => ({
						maybeSingle: async () => ({ data: null, error: { code: '42703', message: 'column does not exist' } })
					})
				})
			})
		} as unknown as SupabaseClient;

		await recoverDeadPartial(client, 'run-1');

		expect(errs).toHaveLength(1);
		spy.mockRestore();
	});

	it('il parziale recuperato porta le tool call, con argomenti e nell’ordine dello stream', async () => {
		// Senza, la continuazione ricarica la storia da chat_messages e riparte senza sapere di
		// aver già letto/scritto/chiamato: rifà da capo (due run recuperati, 5 tool call a testa).
		const db = fakeDb({
			agent_kit_runs: [
				{
					id: 'run-1',
					brand_id: 'b1',
					user_id: 'u1',
					thread_id: 't1',
					created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
					partial: {
						text: 'guardo il pianopoi scrivo',
						tools: [
							{ toolCallId: 'c1', toolName: 'brand_read', input: { path: 'brand/studio.md' }, textLen: 15, status: 'done' },
							{ toolCallId: 'c2', toolName: 'brand_write', input: { path: 'work/nota.md' }, textLen: 25, status: 'done' }
						]
					}
				}
			]
		});

		await recoverDeadPartial(db.client, 'run-1');

		const saved = db.tables.chat_messages[0] as { tool_calls?: Array<Record<string, unknown>> };
		const calls = (saved.tool_calls ?? []).filter((p) => p.type === 'tool-call');
		expect(calls.map((c) => c.toolName)).toEqual(['brand_read', 'brand_write']);
		expect(calls[0].input).toEqual({ path: 'brand/studio.md' });
		expect(calls[1].input).toEqual({ path: 'work/nota.md' });
	});

	it('turno ucciso dopo le tool call ma prima di una riga di testo: il lavoro non sparisce', async () => {
		// Quattro run abortiti (uno da 47 minuti) non hanno lasciato NIENTE in chat: il guard
		// usciva su `!text` anche quando le tool call c'erano tutte.
		const db = fakeDb({
			agent_kit_runs: [
				{
					id: 'run-1',
					brand_id: 'b1',
					user_id: 'u1',
					thread_id: 't1',
					created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
					partial: { text: '', tools: [{ toolCallId: 'c1', toolName: 'render_motion_video', input: { id: 'v1' }, textLen: 0 }] }
				}
			]
		});

		await recoverDeadPartial(db.client, 'run-1');

		expect(db.tables.chat_messages).toHaveLength(1);
		const saved = db.tables.chat_messages[0] as { tool_calls?: Array<Record<string, unknown>> };
		expect((saved.tool_calls ?? []).filter((p) => p.type === 'tool-call')).toHaveLength(1);
	});

	it('run senza thread_id/partial → no-op silenzioso', async () => {
		const db = fakeDb({ agent_kit_runs: [{ id: 'run-1', brand_id: 'b1', user_id: 'u1', thread_id: null, partial: null }] });

		await recoverDeadPartial(db.client, 'run-1');

		expect(db.tables.chat_messages).toHaveLength(0);
	});
});
