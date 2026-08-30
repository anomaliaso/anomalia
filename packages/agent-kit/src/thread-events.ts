export interface ThreadMessage {
	id: string;
	role: string;
	content: unknown;
	[key: string]: unknown;
}

export interface ThreadProgress {
	runId: string;
	status: string;
	[key: string]: unknown;
}

type ThreadEventBase = {
	seq: number;
	sourceKey: string;
};

export type ThreadEvent =
	| (ThreadEventBase & {
			kind: 'message';
			message: ThreadMessage;
		})
	| (ThreadEventBase & {
			kind: 'progress';
			progress: ThreadProgress;
		})
	| (ThreadEventBase & {
			kind: 'messages_superseded';
			messageIds: readonly string[];
		});

export interface ThreadProjection {
	cursor: number;
	messages: readonly ThreadMessage[];
	progress: Readonly<Record<string, ThreadProgress>>;
	sourceEvents: Readonly<Record<string, ThreadEvent>>;
}

export interface ThreadEventGap {
	from: number;
	to: number;
}

export interface ThreadEventReduction {
	projection: ThreadProjection;
	applied: readonly ThreadEvent[];
	gap: ThreadEventGap | null;
	conflict: ThreadEventConflict | null;
}

export interface ThreadEventConflict {
	sourceKey: string;
	existing: ThreadEvent;
	incoming: ThreadEvent;
}

export function emptyThreadProjection(): ThreadProjection {
	return { cursor: 0, messages: [], progress: {}, sourceEvents: {} };
}

export function reduceThreadEvents(
	projection: ThreadProjection,
	events: readonly ThreadEvent[]
): ThreadEventReduction {
	const ordered = [...events].sort((left, right) => left.seq - right.seq);
	const supersededIds = new Set(
		Object.values(projection.sourceEvents)
			.filter((event): event is Extract<ThreadEvent, { kind: 'messages_superseded' }> => event.kind === 'messages_superseded')
			.flatMap((event) => event.messageIds)
	);
	const messages = projection.messages.filter((message) => !supersededIds.has(message.id));
	const progress = { ...projection.progress };
	const sourceEvents = { ...projection.sourceEvents };
	const applied: ThreadEvent[] = [];
	let cursor = projection.cursor;
	let gap: ThreadEventGap | null = null;
	let conflict: ThreadEventConflict | null = null;

	for (const event of ordered) {
		const existing = sourceEvents[event.sourceKey];
		if (existing) {
			if (stableSerialize(eventPayload(existing)) !== stableSerialize(eventPayload(event))) {
				conflict = { sourceKey: event.sourceKey, existing, incoming: event };
				break;
			}
			continue;
		}

		if (event.seq <= cursor) {
			continue;
		}

		const expected = cursor + 1;
		if (event.seq > expected) {
			gap = { from: expected, to: event.seq - 1 };
			break;
		}

		if (event.kind === 'message') {
			messages.push(event.message);
		}

		if (event.kind === 'progress') {
			progress[event.progress.runId] = event.progress;
		}

		if (event.kind === 'messages_superseded') {
			for (const id of event.messageIds) supersededIds.add(id);
			for (let index = messages.length - 1; index >= 0; index--) {
				if (supersededIds.has(messages[index].id)) messages.splice(index, 1);
			}
		}

		sourceEvents[event.sourceKey] = event;
		applied.push(event);
		cursor = event.seq;
	}

	return {
		projection: { cursor, messages, progress, sourceEvents },
		applied,
		gap,
		conflict
	};
}

function eventPayload(event: ThreadEvent): unknown {
	if (event.kind === 'message') return { kind: event.kind, message: event.message };
	if (event.kind === 'progress') return { kind: event.kind, progress: event.progress };
	return { kind: event.kind, messageIds: event.messageIds };
}

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value as Record<string, unknown>)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}
