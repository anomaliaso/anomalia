export interface ThreadMessage {
	id: string;
	role: string;
	content: unknown;
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
	const messages = [...projection.messages];
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
	return event.kind === 'message'
		? { kind: event.kind, message: event.message }
		: { kind: event.kind, progress: event.progress };
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
