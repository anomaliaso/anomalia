/**
 * A maker turn, recorded as an ordinary chat thread — so the work shows up in the sidebar, can be
 * reopened, and the next turn knows what was just built.
 *
 * `open` before the turn (the row appears while the work is still streaming, which is what you want
 * if the tab is closed halfway), `close` after it with the reply the user watched. Both are
 * best-effort by construction: a creative turn must never fail because a thread row did not land.
 *
 * The thread carries `agent`, so reopening it continues with the matching specialist instead of the
 * generalist.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	applyChatStreamEvent,
	emptyStreamState,
	readSseEvents,
	type ChatStreamState,
	type StreamToolCallState
} from '$lib/chat-stream-events';
import {
	bindSurfaceThread,
	getOrCreateSurfaceThread,
	saveMessages,
	type ChatThreadRow
} from '$lib/server/chat/persistence';

export type SurfaceKind = 'motion' | 'media' | 'ugc';

/** First line of the brief, which is what a human scanning the sidebar actually reads. */
export function surfaceThreadTitle(prompt: string, fallback: string): string {
	const first = prompt.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
	return (first.slice(0, 80) || fallback).trim();
}

export async function openSurfaceTurn(
	supabase: SupabaseClient,
	opts: {
		brandId: string;
		userId: string;
		surface: SurfaceKind;
		agent: string;
		/** What the turn is working on, when it already exists. */
		key?: string | null;
		prompt: string;
		fallbackTitle: string;
		/** data: URLs the user attached, shown on their bubble on reload. */
		attachments?: string[];
	}
): Promise<ChatThreadRow | null> {
	try {
		const thread = await getOrCreateSurfaceThread(supabase, {
			brandId: opts.brandId,
			userId: opts.userId,
			surface: opts.surface,
			key: opts.key ?? null,
			title: surfaceThreadTitle(opts.prompt, opts.fallbackTitle),
			agent: opts.agent
		});
		if (!thread) return null;
		const attachments = (opts.attachments ?? []).slice(0, 4);
		// La domanda che non entra non deve portarsi via il thread: la risposta dell'agente vale più
		// della domanda, che l'utente ha appena scritto e ha ancora davanti.
		await saveMessages(
			supabase,
			opts.brandId,
			opts.userId,
			[{ role: 'user', content: opts.prompt }],
			thread.id,
			attachments.length ? { attachments } : undefined
		).catch((e) =>
			console.warn(`[surface-turn] prompt save failed: ${e instanceof Error ? e.message : String(e)}`)
		);
		return thread;
	} catch (e) {
		console.warn(`[surface-turn] open failed: ${e instanceof Error ? e.message : String(e)}`);
		return null;
	}
}

export type AssistantPart =
	| { type: 'text'; text: string }
	| {
			type: 'tool-call';
			toolCallId: string;
			toolName: string;
			/**
			 * `{}` significa una cosa sola: il tool non prende parametri. ASSENTE quando il tetto della
			 * riga li ha lasciati fuori — con un solo `{}` per i due casi, chi apriva una chip tardiva
			 * concludeva che l'agente avesse chiamato il tool senza argomenti.
			 */
			input?: unknown;
			/** Cosa ha risposto. Assente per una chiamata che non è mai tornata. */
			output?: unknown;
			errorText?: string;
	  };

/**
 * Quanto di un payload finisce nella riga salvata. I risultati non sono piccoli (un rapporto di
 * sotto-agente sono ottomila caratteri) e ogni turno riletto se li ricarica tutti: troncare e
 * DICHIARARLO conserva cosa ha risposto senza trasformare un thread lungo in un download.
 */
export const MAX_PERSISTED_PAYLOAD_CHARS = 4_000;

/**
 * E un tetto per l'INTERO messaggio: quello per chiamata non basta, perché quaranta chiamate da
 * quattromila caratteri fanno una riga da centosessantamila, il salvataggio fallisce, e — vedi
 * `closeSurfaceTurn` — l'intera risposta dell'agente spariva con un warning nei log.
 *
 * Speso in ordine: le prime chiamate tengono i payload, le ultime restano chip nude. È l'ordine
 * giusto perché il principio di un turno è dove si capisce cosa l'agente ha deciso di fare.
 *
 * E si spende come un PREFISSO: il primo payload che non entra chiude il rubinetto per tutti quelli
 * dopo. Saltando quello troppo grande e continuando, la chip 12 poteva essere nuda e la 13 piena —
 * una traccia che si legge come se l'agente avesse smesso di lavorare a metà.
 */
export const MAX_PERSISTED_PAYLOAD_TOTAL = 24_000;

function clampPayload(value: unknown): unknown {
	if (value === undefined) return undefined;
	let raw: string;
	try {
		raw = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
	} catch {
		// Cicli o valori non serializzabili: meglio una nota che una riga che fa fallire il salvataggio.
		return '[unserializable]';
	}
	if (raw.length <= MAX_PERSISTED_PAYLOAD_CHARS) return value;
	return `${raw.slice(0, MAX_PERSISTED_PAYLOAD_CHARS)}…[+${raw.length - MAX_PERSISTED_PAYLOAD_CHARS}]`;
}

/**
 * Rebuild the turn as text and tool calls in the order they happened.
 *
 * Saving the accumulated text alone came out as one run-on paragraph: every status line the agent
 * writes BEFORE a tool call, glued together with the calls themselves gone.
 *
 * `textLen` is what makes this reconstructable — the stream records how long the transcript was when
 * each call fired, so the calls slot back between the lines that introduced them.
 */
export function assistantPartsFromStream(
	state: Pick<ChatStreamState, 'text' | 'tools'>,
	opts: { payloadBudget?: number } = {}
): AssistantPart[] {
	const text = state.text ?? '';
	/**
	 * `0` = solo le chip, nessun payload: il gradino di ripiego di `closeSurfaceTurn`.
	 *
	 * La trascrizione si scala dal budget invece di essere gratis, e non viene MAI tagliata — è la
	 * risposta. Un turno che ha scritto molto lascia meno spazio ai payload: è l'unico modo perché il
	 * tetto valga per la riga intera.
	 */
	let budget = (opts.payloadBudget ?? MAX_PERSISTED_PAYLOAD_TOTAL) - text.length;
	const spend = (value: unknown): unknown => {
		if (value === undefined) return undefined;
		const clamped = clampPayload(value);
		// Il costo è quello SERIALIZZATO, non `.length` della stringa: nel JSON ogni virgoletta e ogni a
		// capo diventano due caratteri, e un tetto di 24k contato sul crudo produceva righe da 48k.
		let cost: number;
		try {
			cost = JSON.stringify(clamped)?.length ?? 0;
		} catch {
			cost = Number.POSITIVE_INFINITY;
		}
		if (cost > budget) {
			// Prefisso, non "salta questo e prova il prossimo": vedi MAX_PERSISTED_PAYLOAD_TOTAL.
			budget = 0;
			return undefined;
		}
		budget -= cost;
		return clamped;
	};
	const calls = [...(state.tools ?? [])]
		.filter((t): t is StreamToolCallState => !!t?.toolCallId && !!t.toolName)
		.map((t) => ({ ...t, at: Math.max(0, Math.min(text.length, t.textLen ?? text.length)) }))
		.sort((a, b) => a.at - b.at);

	const parts: AssistantPart[] = [];
	let cursor = 0;
	const pushText = (slice: string) => {
		const trimmed = slice.trim();
		if (trimmed) parts.push({ type: 'text', text: trimmed });
	};
	for (const call of calls) {
		pushText(text.slice(cursor, call.at));
		cursor = Math.max(cursor, call.at);
		// Un tool senza parametri resta `{}`; dei parametri lasciati fuori dal tetto si OMETTE il campo,
		// come per l'output — sono due fatti diversi e devono leggersi diversi.
		const input = call.input === undefined ? {} : spend(call.input);
		const output = spend(call.output);
		// L'errore passa dal budget come tutto il resto: quaranta deleghe fallite scrivevano quaranta
		// volte duemila caratteri in una riga che il tetto credeva sotto la soglia.
		const errorText = call.errorText
			? (spend(String(call.errorText).slice(0, 2_000)) as string | undefined)
			: undefined;
		parts.push({
			type: 'tool-call',
			toolCallId: call.toolCallId,
			toolName: call.toolName,
			...(input === undefined ? {} : { input }),
			...(output === undefined ? {} : { output }),
			...(errorText === undefined ? {} : { errorText })
		});
	}
	pushText(text.slice(cursor));
	return parts;
}

/** Write the assistant reply the user just watched stream in. */
export async function closeSurfaceTurn(
	supabase: SupabaseClient,
	thread: ChatThreadRow | null,
	opts: { brandId: string; userId: string; state: Pick<ChatStreamState, 'text' | 'tools'> }
): Promise<void> {
	if (!thread) return;
	const parts = assistantPartsFromStream(opts.state);
	if (!parts.length) return;

	const write = async (content: AssistantPart[]) =>
		saveMessages(
			supabase,
			opts.brandId,
			opts.userId,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			[{ role: 'assistant', content: content as any }],
			thread.id
		);

	/**
	 * TRE GRADINI, e il terzo è il motivo per cui esistono gli altri due: la risposta dell'agente è la
	 * cosa che NON si può perdere, i dettagli dei tool sono un di più. Con un solo tentativo dentro un
	 * `catch`, un turno lungo che non entrava lasciava l'utente con la sola propria domanda.
	 *
	 * I gradini funzionano solo perché `saveMessages` alza SE E SOLO SE la riga non è entrata: finché
	 * ingoiava l'errore del database la scala era codice morto, e se potesse alzare per qualcosa DOPO
	 * l'insert riprovare scriverebbe una seconda risposta identica sotto la prima.
	 */
	try {
		await write(parts);
		return;
	} catch (e) {
		console.warn(`[surface-turn] full save failed: ${e instanceof Error ? e.message : String(e)}`);
	}
	try {
		await write(assistantPartsFromStream(opts.state, { payloadBudget: 0 }));
		console.warn('[surface-turn] saved without tool payloads');
		return;
	} catch (e) {
		console.warn(`[surface-turn] chips-only save failed: ${e instanceof Error ? e.message : String(e)}`);
	}
	const text = (opts.state.text ?? '').trim();
	if (!text) {
		console.error('[surface-turn] reply LOST: nessun testo da salvare');
		return;
	}
	try {
		await write([{ type: 'text', text }]);
		console.warn('[surface-turn] saved text only');
	} catch (e) {
		console.error(`[surface-turn] reply LOST: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** Point a keyless thread at the thing the turn produced, so the next turn continues it. */
export async function keySurfaceTurn(
	supabase: SupabaseClient,
	thread: ChatThreadRow | null,
	opts: { brandId: string; userId: string; key: string }
): Promise<void> {
	if (!thread || thread.surface_key) return;
	await bindSurfaceThread(supabase, thread.id, opts.brandId, opts.userId, opts.key).catch(
		() => undefined
	);
}

/**
 * Collect the assistant text off a UI message stream, for the surfaces with no designer-job mirror to
 * piggyback on. `consumeSseStream` gets its own tee'd copy from the AI SDK, so reading it here costs
 * the client nothing and cannot stall it. A parse failure loses the transcript, never the turn.
 */
export function collectSurfaceReply(): {
	consumeSseStream: (args: { stream: ReadableStream<string | Uint8Array> }) => Promise<void>;
	state: () => ChatStreamState;
} {
	const state = emptyStreamState();
	return {
		state: () => state,
		consumeSseStream: async ({ stream }) => {
			try {
				const reader = stream.getReader();
				const decoder = new TextDecoder();
				let buffered = '';
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffered += typeof value === 'string' ? value : decoder.decode(value, { stream: true });
					const { events, rest } = readSseEvents(buffered);
					buffered = rest;
					for (const evt of events) applyChatStreamEvent(state, evt);
				}
			} catch (e) {
				console.warn(`[surface-turn] collect failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	};
}
