import { describe, expect, it } from 'vitest';
import { getReplyNotices, type ReplyNoticeThread } from './chat-reply-notifications';

const thread = (id: string): ReplyNoticeThread => ({
	id,
	title: id,
	agent: 'analyst',
	preview: `reply from ${id}`
});

describe('getReplyNotices', () => {
	it('shows each unread reply once, except the active chat', () => {
		const threads = [thread('active'), thread('other'), thread('third'), thread('other')];
		const unread = new Map([
			['active', 4],
			['other', 2],
			['third', 1]
		]);

		expect(getReplyNotices(threads, unread, 'active')).toEqual([
			{ thread: threads[1], unreadCount: 2 },
			{ thread: threads[2], unreadCount: 1 }
		]);
	});

	it('does not create notices for read threads', () => {
		expect(getReplyNotices([thread('read')], new Map(), null)).toEqual([]);
	});

	it('hides a notice the user dismissed, until a newer reply arrives', () => {
		const threads = [thread('one')];
		const dismissed = new Map([['one', 2]]);

		expect(getReplyNotices(threads, new Map([['one', 2]]), null, dismissed)).toEqual([]);
		expect(getReplyNotices(threads, new Map([['one', 3]]), null, dismissed)).toEqual([
			{ thread: threads[0], unreadCount: 3 }
		]);
	});
});
