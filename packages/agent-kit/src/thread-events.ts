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

export interface ThreadEventReduction {
	projection: ThreadProjection;
	applied: readonly ThreadEvent[];
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
	const messages = [...projection.messages.filter((message) => !supersededIds.has(message.id))];
	const progress = { ...projection.progress };
	const sourceEvents = { ...projection.sourceEvents };
	const applied: ThreadEvent[] = [];
	let cursor = projection.cursor;
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

		if (event.kind === 'message') {
			putMessage(messages, event.message, supersededIds);
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
		conflict
	};
}

/**
 * Il messaggio si SOSTITUISCE al suo posto, non si accoda: la riga dell'assistente nasce vuota e
 * viene riscritta a ogni checkpoint del battito, quindi un secondo evento sullo stesso id è la
 * stessa bolla più avanti nel lavoro — non una bolla nuova, e non una bolla in fondo al thread.
 */
function putMessage(
	messages: ThreadMessage[],
	message: ThreadMessage,
	supersededIds: ReadonlySet<string>
): void {
	if (supersededIds.has(message.id)) return;

	const at = messages.findIndex((existing) => existing.id === message.id);
	if (at < 0) {
		messages.push(message);
		return;
	}

	messages[at] = message;
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
