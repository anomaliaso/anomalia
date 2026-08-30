import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	appendRunProgress,
	appendThreadEvent,
	messageEvent,
	progressEvent,
	pruneRunProgress,
	supersedeEvent,
	threadMessageRows
} from './thread-events';

const row = {
	id: 'message-1',
	role: 'assistant',
	content: 'done',
	tool_calls: null,
	created_at: '2026-08-30T10:00:00.000Z'
};

describe('thread event writer', () => {
	it('builds a complete idempotent message event', () => {
		expect(messageEvent('thread-1', row, 'run-1:assistant')).toEqual({
			threadId: 'thread-1',
			sourceKey: 'run-1:assistant',
			kind: 'message',
			payload: row
		});
	});

	it('builds absolute progress and branch events', () => {
    expect(progressEvent('thread-1', 'run-1:progress:2', { runId: 'run-1', status: 'running', text: 'half' })).toEqual({
		threadId: 'thread-1',
		sourceKey: 'run-1:progress:2',
		kind: 'progress',
    payload: { runId: 'run-1', status: 'running', text: 'half' }
		});
		expect(supersedeEvent('thread-1', 'redo-1', ['message-1'])).toEqual({
		threadId: 'thread-1',
		sourceKey: 'redo-1',
		kind: 'messages_superseded',
		payload: { messageIds: ['message-1'] }
		});
	});

	it('calls the serialized database append primitive', async () => {
		const rpc = vi.fn(async () => ({
			data: [{ thread_id: 'thread-1', seq: 4, source_key: 'run-1:assistant', kind: 'message', payload: row }],
			error: null
		}));

		await appendThreadEvent({ rpc } as unknown as SupabaseClient, messageEvent('thread-1', row, 'run-1:assistant'));

		expect(rpc).toHaveBeenCalledWith('append_thread_event', {
			p_thread_id: 'thread-1',
			p_source_key: 'run-1:assistant',
			p_kind: 'message',
			p_payload: row
		});
	});

	it('projects message events and removes superseded rows', () => {
		const projected = threadMessageRows([
			{ thread_id: 'thread-1', seq: 1, source_key: 'm-1', kind: 'message', payload: row },
			{
				thread_id: 'thread-1',
				seq: 2,
				source_key: 'm-2',
				kind: 'message',
				payload: { ...row, id: 'message-2', content: 'new' }
			},
			{
				thread_id: 'thread-1',
				seq: 3,
				source_key: 'redo-1',
				kind: 'messages_superseded',
				payload: { messageIds: ['message-1'] }
			}
		]);

		expect(projected).toEqual([{ ...row, id: 'message-2', content: 'new' }]);
	});

	it('projects a page whose progress events were pruned', () => {
		expect(
			threadMessageRows([
				{ thread_id: 'thread-1', seq: 1, source_key: 'm-1', kind: 'message', payload: row },
				{ thread_id: 'thread-1', seq: 3, source_key: 'm-3', kind: 'message', payload: { ...row, id: 'message-3' } }
			])
		).toHaveLength(2);
	});

	it('refuses to project two events that claim the same source key', () => {
		expect(
			threadMessageRows([
				{ thread_id: 'thread-1', seq: 1, source_key: 'm-1', kind: 'message', payload: row },
				{ thread_id: 'thread-1', seq: 2, source_key: 'm-1', kind: 'message', payload: { ...row, id: 'message-2' } }
			])
		).toBeNull();
	});
});

describe('run progress lane', () => {
	it('appends an absolute snapshot under a per-tick source key', async () => {
		const rpc = vi.fn(async () => ({
			data: [{ thread_id: 'thread-1', seq: 9, source_key: 'run-1:progress:3', kind: 'progress', payload: {} }],
			error: null
		}));

		const seq = await appendRunProgress({ rpc } as unknown as SupabaseClient, 'thread-1', 3, {
			runId: 'run-1',
			status: 'running',
			text: 'half a sentence'
		});

		expect(seq).toBe(9);
		expect(rpc).toHaveBeenCalledWith('append_thread_event', {
			p_thread_id: 'thread-1',
			p_source_key: 'run-1:progress:3',
			p_kind: 'progress',
			p_payload: { runId: 'run-1', status: 'running', text: 'half a sentence' }
		});
	});

	it('replays one tick to the same sequence instead of appending twice', async () => {
		const rpc = vi.fn(async () => ({
			data: [{ thread_id: 'thread-1', seq: 9, source_key: 'run-1:progress:3', kind: 'progress', payload: {} }],
			error: null
		}));
		const db = { rpc } as unknown as SupabaseClient;
		const snapshot = { runId: 'run-1', status: 'running', text: 'half a sentence' };

		expect(await appendRunProgress(db, 'thread-1', 3, snapshot)).toBe(9);
		expect(await appendRunProgress(db, 'thread-1', 3, snapshot)).toBe(9);
	});

	it('prunes only the progress of the finished run', async () => {
		const filters: [string, unknown][] = [];
		const query = {
			eq(column: string, value: unknown) {
				filters.push([column, value]);
				return this;
			},
			then(resolve: (value: { error: null }) => void) {
				resolve({ error: null });
			}
		};
		const from = vi.fn(() => ({ delete: () => query }));

		await pruneRunProgress({ from } as unknown as SupabaseClient, 'thread-1', 'run-1');

		expect(from).toHaveBeenCalledWith('thread_events');
		expect(filters).toEqual([
			['thread_id', 'thread-1'],
			['kind', 'progress'],
			['payload->>runId', 'run-1']
		]);
	});

	it('never fails a turn because pruning failed', async () => {
		const from = vi.fn(() => {
			throw new Error('database gone');
		});

		await expect(
			pruneRunProgress({ from } as unknown as SupabaseClient, 'thread-1', 'run-1')
		).resolves.toBeUndefined();
	});
});
