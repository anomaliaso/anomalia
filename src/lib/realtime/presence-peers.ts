/**
 * Pure shaping of a Realtime presence state into "who else is here".
 *
 * Kept out of the channel class so it can be tested without a socket or a rune: the two rules
 * below are the whole feature, and both are easy to get subtly wrong.
 */

export type PresencePeer = {
	userId: string;
	name: string;
	avatar: string | null;
	/** Route they have open. */
	path: string;
	/** Chat thread they have open, which on desktop is NOT in the URL. */
	threadId: string | null;
};

export type PresenceWhere = { path: string; threadId: string | null };

/** Same page, or same conversation — the thread check is what makes the desktop chat work. */
export function sharesLocation(peer: PresencePeer, where: PresenceWhere): boolean {
	if (where.threadId && peer.threadId === where.threadId) return true;
	return !!where.path && peer.path === where.path;
}

function toPeer(raw: Partial<PresencePeer> | null | undefined): PresencePeer | null {
	if (!raw || typeof raw.userId !== 'string' || !raw.userId) return null;
	return {
		userId: raw.userId,
		name: typeof raw.name === 'string' && raw.name ? raw.name : 'Utente',
		avatar: typeof raw.avatar === 'string' && raw.avatar ? raw.avatar : null,
		path: typeof raw.path === 'string' ? raw.path : '',
		threadId: typeof raw.threadId === 'string' && raw.threadId ? raw.threadId : null
	};
}

/**
 * Flatten presence state to one row per PERSON.
 *
 * Someone with three tabs open is one teammate, not a crowd — and when their tabs disagree about
 * location, the tab that matches the viewer wins, so "who is on this page with me" stays true for
 * a colleague who has this page open in a background tab.
 */
export function dedupePresence(
	state: Record<string, Array<Partial<PresencePeer>>>,
	selfUserId: string | null,
	where: PresenceWhere
): PresencePeer[] {
	const byUser = new Map<string, PresencePeer>();
	for (const metas of Object.values(state ?? {})) {
		for (const meta of metas ?? []) {
			const peer = toPeer(meta);
			if (!peer || peer.userId === selfUserId) continue;
			const seen = byUser.get(peer.userId);
			if (!seen || sharesLocation(peer, where)) byUser.set(peer.userId, peer);
		}
	}
	return [...byUser.values()];
}

export function peersHere(peers: PresencePeer[], where: PresenceWhere): PresencePeer[] {
	return peers.filter((p) => sharesLocation(p, where));
}
