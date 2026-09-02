import type { SupabaseClient } from '@supabase/supabase-js';
import {
	emptyThreadProjection,
	reduceThreadEvents,
	type ThreadEvent,
	type ThreadMessage,
	type ThreadProgress
} from '@anomalia/agent-kit';

export type ThreadEventInput = {
	threadId: string;
	sourceKey: string;
	kind: ThreadEvent['kind'];
	payload: ThreadMessage | ThreadProgress | { messageIds: readonly string[] };
};

export type StoredThreadEvent = {
	thread_id: string;
	seq: number;
	source_key: string;
	kind: ThreadEvent['kind'];
	payload: unknown;
};

export async function loadThreadEvents(
	db: SupabaseClient,
	threadId: string,
	afterSeq = 0,
	limit = 100_000
): Promise<StoredThreadEvent[] | null> {
	try {
		const pageSize = 2_000;
		const events: StoredThreadEvent[] = [];
		let cursor = afterSeq;
		for (;;) {
			const { data, error } = await db
				.from('thread_events')
				.select('thread_id, seq, source_key, kind, payload')
				.eq('thread_id', threadId)
				.gt('seq', cursor)
				.order('seq', { ascending: true })
				.limit(Math.min(pageSize, limit - events.length));
			if (error) return null;
			const page = (data ?? []) as StoredThreadEvent[];
			events.push(...page);
			if (page.length < pageSize || events.length >= limit) return events.length >= limit ? null : events;
			cursor = page[page.length - 1].seq;
		}
	} catch {
		return null;
	}
}

export function messageEvent(
	threadId: string,
	message: ThreadMessage,
	sourceKey: string
): ThreadEventInput {
	return { threadId, sourceKey, kind: 'message', payload: message };
}

export function progressEvent(
	threadId: string,
	sourceKey: string,
	progress: ThreadProgress
): ThreadEventInput {
	return { threadId, sourceKey, kind: 'progress', payload: progress };
}

export function supersedeEvent(
	threadId: string,
	sourceKey: string,
	messageIds: readonly string[]
): ThreadEventInput {
	return { threadId, sourceKey, kind: 'messages_superseded', payload: { messageIds } };
}

export async function appendThreadEvent(
	db: SupabaseClient,
	event: ThreadEventInput
): Promise<StoredThreadEvent> {
	const { data, error } = await db.rpc('append_thread_event', {
		p_thread_id: event.threadId,
		p_source_key: event.sourceKey,
		p_kind: event.kind,
		p_payload: event.payload
	});
	if (error) throw new Error(`thread event append failed: ${error.message}`);
	const row = Array.isArray(data) ? data[0] : data;
	if (!row) throw new Error('thread event append returned no row');
	return row as StoredThreadEvent;
}

export async function appendRunProgress(
	db: SupabaseClient,
	threadId: string,
	tick: number,
	progress: ThreadProgress
): Promise<number> {
	const event = progressEvent(threadId, `${progress.runId}:progress:${tick}`, progress);
	const stored = await appendThreadEvent(db, event);
	return stored.seq;
}

export async function pruneRunProgress(
	db: SupabaseClient,
	threadId: string,
	runId: string
): Promise<void> {
	try {
		await db
			.from('thread_events')
			.delete()
			.eq('thread_id', threadId)
			.eq('kind', 'progress')
			.eq('payload->>runId', runId);
	} catch {
		return;
	}
}

export type ThreadProjectionRows = {
	messages: Record<string, unknown>[];
	progress: Record<string, ThreadProgress>;
	cursor: number;
};

/**
 * Il carico a freddo e il tail live si riducono con LA STESSA funzione, e leggono lo stesso log:
 * è l'unico modo perché una scheda aperta a metà turno veda ciò che una scheda viva sta
 * accumulando. Prima di qui il freddo proiettava solo i `message` e buttava via i `progress`, e
 * il parziale ricompariva solo al poke successivo — cioè la ricarica mostrava meno di quanto il
 * database avesse già.
 */
export function threadProjectionRows(events: readonly StoredThreadEvent[]): ThreadProjectionRows | null {
	const result = reduceThreadEvents(emptyThreadProjection(), events.map(asThreadEvent));
	if (result.conflict) return null;
	return {
		messages: result.projection.messages.filter((m) => m.superseded !== true) as Record<string, unknown>[],
		progress: { ...result.projection.progress },
		cursor: result.projection.cursor
	};
}

function asThreadEvent(event: StoredThreadEvent): ThreadEvent {
	if (event.kind === 'message') {
		return { seq: event.seq, sourceKey: event.source_key, kind: 'message', message: event.payload as ThreadMessage };
	}
	if (event.kind === 'progress') {
		return { seq: event.seq, sourceKey: event.source_key, kind: 'progress', progress: event.payload as ThreadProgress };
	}
	return {
		seq: event.seq,
		sourceKey: event.source_key,
		kind: 'messages_superseded',
		messageIds: ((event.payload as { messageIds?: unknown }).messageIds ?? []) as string[]
	};
}

export function threadMessageRows(events: readonly StoredThreadEvent[]): Record<string, unknown>[] | null {
	return threadProjectionRows(events)?.messages ?? null;
}
