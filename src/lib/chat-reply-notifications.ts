export type ReplyNoticeThread = {
	id: string;
	title: string;
	agent?: string | null;
	custom_agent_id?: string | null;
	agents?: Array<{ id: string; name: string; face: string; color: string }>;
	room_agents?: unknown;
	preview?: string | null;
};

export type ReplyNotice = {
	thread: ReplyNoticeThread;
	unreadCount: number;
};

export function getReplyNotices(
	threads: ReplyNoticeThread[],
	unread: Map<string, number>,
	activeThreadId: string | null,
	dismissed: Map<string, number> = new Map()
): ReplyNotice[] {
	const seen = new Set<string>();
	const notices: ReplyNotice[] = [];

	for (const thread of threads) {
		if (thread.id === activeThreadId || !unread.has(thread.id) || seen.has(thread.id)) continue;

		const unreadCount = Math.max(1, unread.get(thread.id) ?? 0);
		if ((dismissed.get(thread.id) ?? 0) >= unreadCount) continue;

		seen.add(thread.id);
		notices.push({ thread, unreadCount });
	}

	return notices;
}
