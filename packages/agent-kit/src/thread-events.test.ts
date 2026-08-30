import { describe, expect, it } from 'vitest';
import { emptyThreadProjection, reduceThreadEvents, type ThreadEvent } from './index';

const message = (seq: number, id: string, content: string): ThreadEvent => ({
	seq,
	sourceKey: `message:${id}`,
	kind: 'message',
	message: { id, role: 'assistant', content }
});

const progress = (seq: number, runId: string, status: string): ThreadEvent => ({
	seq,
	sourceKey: `progress:${runId}:${status}`,
	kind: 'progress',
	progress: { runId, status }
});

const superseded = (seq: number, ids: string[]): ThreadEvent => ({
	seq,
	sourceKey: `superseded:${seq}`,
	kind: 'messages_superseded',
	messageIds: ids
});

describe('thread event reducer', () => {
	it('orders events and projects messages and latest progress', () => {
		const result = reduceThreadEvents(emptyThreadProjection(), [
			progress(3, 'run-1', 'completed'),
			message(2, 'message-1', 'done'),
			progress(1, 'run-1', 'running')
		]);

		expect(result.conflict).toBeNull();
		expect(result.projection.cursor).toBe(3);
		expect(result.projection.messages).toEqual([
			{ id: 'message-1', role: 'assistant', content: 'done' }
		]);
		expect(result.projection.progress).toEqual({
			'run-1': { runId: 'run-1', status: 'completed' }
		});
		expect(Object.keys(result.projection.sourceEvents)).toEqual([
			'progress:run-1:running',
			'message:message-1',
			'progress:run-1:completed'
		]);
	});

	it('ignores events already applied and duplicates in the same batch', () => {
		const existing = {
			cursor: 1,
			messages: [{ id: 'message-1', role: 'user', content: 'hello' }],
			progress: { 'run-1': { runId: 'run-1', status: 'running' } },
			sourceEvents: {}
		};
		const next = message(2, 'message-2', 'world');

		const result = reduceThreadEvents(existing, [next, message(1, 'message-1', 'changed'), next]);

		expect(result.conflict).toBeNull();
		expect(result.applied).toEqual([next]);
		expect(result.projection).toEqual({
			cursor: 2,
			messages: [
				{ id: 'message-1', role: 'user', content: 'hello' },
				{ id: 'message-2', role: 'assistant', content: 'world' }
			],
			progress: { 'run-1': { runId: 'run-1', status: 'running' } },
			sourceEvents: { [next.sourceKey]: next }
		});
	});

	it('applies events across a pruned sequence', () => {
		const result = reduceThreadEvents(emptyThreadProjection(), [
			message(1, 'message-1', 'first'),
			message(3, 'message-3', 'third'),
			message(4, 'message-4', 'fourth')
		]);

		expect(result.conflict).toBeNull();
		expect(result.applied).toEqual([
			message(1, 'message-1', 'first'),
			message(3, 'message-3', 'third'),
			message(4, 'message-4', 'fourth')
		]);
		expect(result.projection.cursor).toBe(4);
		expect(result.projection.messages).toEqual([
			{ id: 'message-1', role: 'assistant', content: 'first' },
			{ id: 'message-3', role: 'assistant', content: 'third' },
			{ id: 'message-4', role: 'assistant', content: 'fourth' }
		]);
	});

	it('does not mutate the input projection', () => {
		const initial = emptyThreadProjection();

		reduceThreadEvents(initial, [message(1, 'message-1', 'hello')]);

		expect(initial).toEqual(emptyThreadProjection());
	});

	it('reports a source-key conflict instead of applying a different payload', () => {
		const first = message(1, 'message-1', 'hello');
		const result = reduceThreadEvents(emptyThreadProjection(), [
			first,
			{ ...message(2, 'message-2', 'changed'), sourceKey: first.sourceKey }
		]);

		expect(result.conflict).toMatchObject({ sourceKey: first.sourceKey });
		expect(result.projection.cursor).toBe(1);
		expect(result.projection.messages).toEqual([first.message]);
	});

	it('deduplicates the same payload even when a repeated event has another sequence', () => {
		const first = message(1, 'message-1', 'hello');
		const result = reduceThreadEvents(emptyThreadProjection(), [first, { ...first, seq: 2 }]);

		expect(result.conflict).toBeNull();
		expect(result.projection.cursor).toBe(1);
		expect(result.projection.messages).toEqual([first.message]);
	});

	it('hides messages through an ordered supersede event', () => {
		const result = reduceThreadEvents(emptyThreadProjection(), [
			message(1, 'message-1', 'old'),
			message(2, 'message-2', 'new'),
			superseded(3, ['message-1'])
		]);

		expect(result.projection.messages).toEqual([
			{ id: 'message-2', role: 'assistant', content: 'new' }
		]);
	});
});
