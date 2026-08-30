import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	appendThreadEvent,
	messageEvent,
	progressEvent,
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

	it('refuses to project an incomplete event page', () => {
		expect(
			threadMessageRows([
				{ thread_id: 'thread-1', seq: 1, source_key: 'm-1', kind: 'message', payload: row },
				{ thread_id: 'thread-1', seq: 3, source_key: 'm-3', kind: 'message', payload: { ...row, id: 'message-3' } }
			])
		).toBeNull();
	});
});
