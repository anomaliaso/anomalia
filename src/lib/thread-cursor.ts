import {
	reduceThreadEvents,
	type ThreadEvent,
	type ThreadMessage,
	type ThreadProgress,
	type ThreadProjection
} from '@anomalia/agent-kit/thread-events';

export type RawThreadEvent = {
	thread_id: string;
	seq: number;
	source_key: string;
	kind: ThreadEvent['kind'];
	payload: unknown;
};

export type ThreadCursorFold = {
	projection: ThreadProjection;
	hasMessage: boolean;
	seeded: boolean;
};

export function foldThreadCursor(
	projection: ThreadProjection,
	events: readonly RawThreadEvent[]
): ThreadCursorFold {
	const result = reduceThreadEvents(projection, events.map(toThreadEvent));
	return {
		projection: result.projection,
		hasMessage: result.applied.some((event) => event.kind === 'message'),
		seeded: projection.cursor === 0
	};
}

export function latestRunProgress(projection: ThreadProjection, runId: string): ThreadProgress | null {
	return projection.progress[runId] ?? null;
}

export function seedThreadProjection(
	progress: Readonly<Record<string, ThreadProgress>>,
	cursor: number
): ThreadProjection {
	return { cursor, messages: [], progress: { ...progress }, sourceEvents: {} };
}

function toThreadEvent(raw: RawThreadEvent): ThreadEvent {
	const base = { seq: raw.seq, sourceKey: raw.source_key };
	if (raw.kind === 'message') {
		return { ...base, kind: 'message', message: raw.payload as ThreadMessage };
	}
	if (raw.kind === 'progress') {
		return { ...base, kind: 'progress', progress: raw.payload as ThreadProgress };
	}
	const messageIds = (raw.payload as { messageIds?: unknown } | null)?.messageIds;
	return {
		...base,
		kind: 'messages_superseded',
		messageIds: Array.isArray(messageIds) ? (messageIds as string[]) : []
	};
}
