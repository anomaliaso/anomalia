import { describe, expect, it } from 'vitest';
import { emptyThreadProjection } from '@anomalia/agent-kit';
import { foldThreadCursor, latestRunProgress, seedThreadProjection, type RawThreadEvent } from './thread-cursor';

const message = (seq: number, id: string): RawThreadEvent => ({
	thread_id: 'thread-1',
	seq,
	source_key: `message:${id}`,
	kind: 'message',
	payload: { id, role: 'assistant', content: 'hi' }
});

const progress = (seq: number, runId: string, status: string): RawThreadEvent => ({
	thread_id: 'thread-1',
	seq,
	source_key: `progress:${runId}:${seq}`,
	kind: 'progress',
	payload: { runId, status, text: `text-${seq}` }
});

describe('foldThreadCursor', () => {
	it('ignores events at or below the current cursor', () => {
		const seeded = foldThreadCursor(emptyThreadProjection(), [progress(1, 'run-1', 'running')]);

		const result = foldThreadCursor(seeded.projection, [progress(1, 'run-1', 'running')]);

		expect(result.projection.cursor).toBe(1);
		expect(result.hasMessage).toBe(false);
	});

	it('keeps the newest progress per runId', () => {
		const result = foldThreadCursor(emptyThreadProjection(), [
			progress(3, 'run-1', 'completed'),
			progress(1, 'run-1', 'running'),
			progress(2, 'run-1', 'running')
		]);

		expect(latestRunProgress(result.projection, 'run-1')).toEqual({
			runId: 'run-1',
			status: 'completed',
			text: 'text-3'
		});
	});

	it('reports a page holding a message event so the caller reloads', () => {
		const result = foldThreadCursor(emptyThreadProjection(), [
			progress(1, 'run-1', 'running'),
			message(2, 'message-1')
		]);

		expect(result.hasMessage).toBe(true);
		expect(result.projection.cursor).toBe(2);
	});

	it('does not report a reload for a page carrying only progress', () => {
		const result = foldThreadCursor(emptyThreadProjection(), [progress(1, 'run-1', 'running')]);

		expect(result.hasMessage).toBe(false);
	});

	it('folds a pruned, non-contiguous sequence', () => {
		const result = foldThreadCursor(emptyThreadProjection(), [
			message(1, 'message-1'),
			progress(7, 'run-1', 'running'),
			progress(12, 'run-1', 'completed')
		]);

		expect(result.projection.cursor).toBe(12);
		expect(result.projection.messages).toHaveLength(1);
		expect(latestRunProgress(result.projection, 'run-1')?.status).toBe('completed');
	});

	it('returns null progress for a runId never seen', () => {
		expect(latestRunProgress(emptyThreadProjection(), 'run-x')).toBeNull();
	});

	it('ignores events at or below a cursor seeded from the server', () => {
		const seeded = seedThreadProjection({}, 5);

		const result = foldThreadCursor(seeded, [progress(3, 'run-1', 'running')]);

		expect(result.projection.cursor).toBe(5);
		expect(latestRunProgress(result.projection, 'run-1')).toBeNull();
	});

	it('returns the newest snapshot for a run seeded from the server', () => {
		const seeded = seedThreadProjection(
			{ 'run-1': { runId: 'run-1', status: 'running', text: 'partial-3' } },
			3
		);

		expect(latestRunProgress(seeded, 'run-1')).toEqual({
			runId: 'run-1',
			status: 'running',
			text: 'partial-3'
		});
	});

	it('marks the first fold of a thread as a seeding, not as news', () => {
		const first = foldThreadCursor(emptyThreadProjection(), [
			{ thread_id: 't1', seq: 1, source_key: 'm-1', kind: 'message', payload: { id: 'm-1' } }
		]);
		expect(first.seeded).toBe(true);
		expect(first.hasMessage).toBe(true);

		const second = foldThreadCursor(first.projection, [
			{ thread_id: 't1', seq: 2, source_key: 'm-2', kind: 'message', payload: { id: 'm-2' } }
		]);
		expect(second.seeded).toBe(false);
		expect(second.hasMessage).toBe(true);
	});
});
