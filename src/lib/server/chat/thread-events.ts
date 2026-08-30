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

export function threadMessageRows(events: readonly StoredThreadEvent[]): Record<string, unknown>[] | null {
	const converted: ThreadEvent[] = events.map((event) => {
		if (event.kind === 'message') {
			return {
				seq: event.seq,
				sourceKey: event.source_key,
				kind: event.kind,
				message: event.payload as ThreadMessage
			};
		}
		if (event.kind === 'progress') {
			return {
				seq: event.seq,
				sourceKey: event.source_key,
				kind: event.kind,
				progress: event.payload as ThreadProgress
			};
		}
		return {
			seq: event.seq,
			sourceKey: event.source_key,
			kind: event.kind,
			messageIds: ((event.payload as { messageIds?: unknown }).messageIds ?? []) as string[]
		};
	});
	const result = reduceThreadEvents(emptyThreadProjection(), converted);
	if (result.conflict) return null;
	return result.projection.messages.filter((message) => message.superseded !== true) as Record<string, unknown>[];
}
