/**
 * One private Realtime channel per brand, shared by the whole app shell.
 *
 * It carries everything that answers "what is happening elsewhere right now":
 *  • presence       — who else is connected, and what they are looking at
 *  • thread-changed — a chat message was written (server, on every save)
 *  • turn-state     — a conversation started or stopped generating (DB trigger, migration 0138)
 *
 * One channel, not three: they share an audience (the brand's members) and a lifetime (the shell),
 * so extra subscriptions would buy nothing.
 *
 * The topic is `brand:<uuid>` and the channel is private, so joining is gated by the RLS policies
 * in migration 0137 — knowing a brand UUID is not enough to watch a team work.
 */
import { browser } from '$app/environment';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '$lib/supabase/client';
import { shouldCoalesceBrandConnect } from '$lib/realtime/brand-channel-policy';
import {
	dedupePresence,
	peersHere,
	type PresencePeer,
	type PresenceWhere
} from '$lib/realtime/presence-peers';
import { clearRemoteBusyThreads, setThreadRemoteBusy } from '$lib/stores/chat-session';
import type { ChunkPosition } from '$lib/chat-live-join';

/** Un chunk vivo di un turno kit, con la posizione da cui continua (null da un server più vecchio). */
export type KitStreamChunk = {
	runId: string;
	threadId: string;
	chunk: unknown;
	at: ChunkPosition | null;
};

export type { PresencePeer } from '$lib/realtime/presence-peers';

type Me = { userId: string; name: string; avatar: string | null };

/** Statuses that mean a turn still owes an answer. Everything else clears the thread. */
const LIVE_STATUS = new Set(['pending', 'running']);

/** Fires when a thread this client can see starts generating somewhere else. */
type TurnListener = (threadId: string, live: boolean) => void;

class BrandChannel {
	/** Everyone else on this brand right now — one entry per person, not per tab. */
	peers = $state<PresencePeer[]>([]);

	#where = $state<PresenceWhere>({ path: '', threadId: null });

	#channel: RealtimeChannel | null = null;
	#brandId: string | null = null;
	#slug: string | null = null;
	#me: Me | null = null;
	#threadListeners = new Set<(threadId: string, hasAssistantReply: boolean) => void>();
	#connectedListeners = new Set<() => void>();
	#turnListeners = new Set<TurnListener>();
	#kitStreamListeners = new Set<(payload: KitStreamChunk) => void>();
	#kitStreamDoneListeners = new Set<(payload: { runId: string; threadId: string }) => void>();
	/**
	 * Bumped on every disconnect / brand switch so an in-flight connect (paused on getSession)
	 * cannot finish by attaching listeners to a channel another call already subscribed.
	 */
	#gen = 0;
	/** Coalesces overlapping connect() calls for the same brand while auth/subscribe is in flight. */
	#connectPromise: Promise<void> | null = null;

	/** Peers looking at the same page or the same chat thread as the user. */
	get here(): PresencePeer[] {
		return peersHere(this.peers, this.#where);
	}

	async connect(brandId: string, brandSlug: string, me: Me): Promise<void> {
		if (!browser || !brandId || !me.userId) return;

		// The shell effect re-runs on every navigation (fresh `extras` object). While the first
		// connect is still awaiting getSession, #channel is null — without this coalesce a second
		// call would channel() the already-subscribed topic and throw on presence.on().
		if (
			shouldCoalesceBrandConnect(this.#brandId, brandId, !!this.#channel, !!this.#connectPromise)
		) {
			this.#me = me;
			this.#slug = brandSlug;
			if (this.#connectPromise) await this.#connectPromise;
			return;
		}

		this.disconnect();
		this.#brandId = brandId;
		this.#slug = brandSlug;
		this.#me = me;

		const gen = this.#gen;
		const run = this.#open(brandId, me, gen);
		this.#connectPromise = run;
		try {
			await run;
		} finally {
			if (this.#connectPromise === run) this.#connectPromise = null;
		}
	}

	/** Called on navigation and whenever the open chat thread changes. */
	setLocation(path: string, threadId: string | null): void {
		if (this.#where.path === path && this.#where.threadId === threadId) return;
		this.#where = { path, threadId };
		void this.#track();
	}

	/** Returns an unsubscribe function. */
	onThreadChanged(fn: (threadId: string, hasAssistantReply: boolean) => void): () => void {
		this.#threadListeners.add(fn);
		return () => {
			this.#threadListeners.delete(fn);
		};
	}

	onConnected(fn: () => void): () => void {
		this.#connectedListeners.add(fn);
		return () => {
			this.#connectedListeners.delete(fn);
		};
	}

	/** Notified when any visible thread starts or stops generating. Returns an unsubscribe. */
	onTurnState(fn: TurnListener): () => void {
		this.#turnListeners.add(fn);
		return () => {
			this.#turnListeners.delete(fn);
		};
	}

	/**
	 * One `ai` v6 UI message chunk mirrored live from an agent-kit turn (live.ts). The caller
	 * filters by `runId` itself — this channel carries every run in the brand, not just the one
	 * a given tab cares about. Returns an unsubscribe.
	 */
	onKitStream(fn: (payload: KitStreamChunk) => void): () => void {
		this.#kitStreamListeners.add(fn);
		return () => {
			this.#kitStreamListeners.delete(fn);
		};
	}

	/** The mirror reader for a kit run finished draining. Returns an unsubscribe. */
	onKitStreamDone(fn: (payload: { runId: string; threadId: string }) => void): () => void {
		this.#kitStreamDoneListeners.add(fn);
		return () => {
			this.#kitStreamDoneListeners.delete(fn);
		};
	}

	disconnect(): void {
		this.#gen += 1;
		const channel = this.#channel;
		this.#channel = null;
		this.#brandId = null;
		this.#slug = null;
		this.peers = [];
		clearRemoteBusyThreads();
		// removeChannel (not bare unsubscribe) drops the topic from the client registry so a later
		// channel() call creates a fresh instance we can still attach presence callbacks to.
		if (channel) {
			void createSupabaseBrowserClient().removeChannel(channel);
		}
	}

	async #open(brandId: string, me: Me, gen: number): Promise<void> {
		const supabase = createSupabaseBrowserClient();
		const { data } = await supabase.auth.getSession();
		const token = data.session?.access_token;
		// A private channel without a user token is refused by the policy, so there is nothing to
		// subscribe to — bail rather than retry a connection that cannot succeed.
		if (!token) return;
		if (!this.#stillCurrent(brandId, gen)) return;

		await supabase.realtime.setAuth(token);
		if (!this.#stillCurrent(brandId, gen)) return;

		// A prior disconnect may still be tearing the topic down asynchronously. Wait it out so
		// channel() does not hand back a joining/joined instance we cannot rebind.
		await this.#evictTopic(supabase, brandId);
		if (!this.#stillCurrent(brandId, gen)) return;

		const channel = supabase.channel(`brand:${brandId}`, {
			config: { private: true, presence: { key: me.userId } }
		});
		this.#channel = channel;

		channel.on('presence', { event: 'sync' }, () => this.#readPresence());
		channel.on('broadcast', { event: 'thread-changed' }, ({ payload }) => {
			const event = payload as { threadId?: unknown; hasAssistantReply?: unknown } | null;
			const id = event?.threadId;
			if (typeof id === 'string' && id) {
				const hasAssistantReply = event?.hasAssistantReply === true;
				for (const fn of this.#threadListeners) fn(id, hasAssistantReply);
			}
		});

		channel.on('broadcast', { event: 'turn-state' }, ({ payload }) => {
			const p = payload as { threadId?: unknown; status?: unknown } | null;
			if (typeof p?.threadId !== 'string' || !p.threadId) return;
			this.#applyTurnState(p.threadId, LIVE_STATUS.has(String(p.status)));
		});

		channel.on('broadcast', { event: 'kit_stream' }, ({ payload }) => {
			const p = payload as
				| { runId?: unknown; threadId?: unknown; chunk?: unknown; at?: ChunkPosition }
				| null;
			if (typeof p?.runId !== 'string' || typeof p?.threadId !== 'string') return;
			for (const fn of this.#kitStreamListeners) {
				fn({ runId: p.runId, threadId: p.threadId, chunk: p.chunk, at: p.at ?? null });
			}
		});

		channel.on('broadcast', { event: 'kit_stream_done' }, ({ payload }) => {
			const p = payload as { runId?: unknown; threadId?: unknown } | null;
			if (typeof p?.runId !== 'string' || typeof p?.threadId !== 'string') return;
			for (const fn of this.#kitStreamDoneListeners) fn({ runId: p.runId, threadId: p.threadId });
		});

		channel.subscribe((status) => {
			// Fires again after every reconnect, and neither presence nor the turn map survives one:
			// re-track AND re-read the running turns, or a turn that ended during the outage keeps
			// its dot forever.
			if (status === 'SUBSCRIBED') {
				void this.#track();
				void this.#hydrateRuns();
				for (const fn of this.#connectedListeners) fn();
			}
		});
	}

	#stillCurrent(brandId: string, gen: number): boolean {
		return this.#gen === gen && this.#brandId === brandId;
	}

	async #evictTopic(supabase: SupabaseClient, brandId: string): Promise<void> {
		const topic = `realtime:brand:${brandId}`;
		const existing = supabase.getChannels().find((c) => c.topic === topic);
		if (existing) await supabase.removeChannel(existing);
	}

	#applyTurnState(threadId: string, live: boolean): void {
		setThreadRemoteBusy(threadId, live);
		for (const fn of this.#turnListeners) fn(threadId, live);
	}

	/**
	 * Read the turns already in flight when this client shows up. Broadcast only carries
	 * transitions, so a tab opened mid-turn would otherwise see nothing until that turn ended.
	 */
	async #hydrateRuns(): Promise<void> {
		const slug = this.#slug;
		if (!slug) return;
		try {
			const res = await fetch(`/app/${slug}/chat?running=1`, { cache: 'no-store' });
			if (!res.ok) return;
			const { threadIds } = (await res.json()) as { threadIds?: unknown };
			if (!Array.isArray(threadIds)) return;
			clearRemoteBusyThreads();
			for (const id of threadIds) {
				if (typeof id === 'string' && id) this.#applyTurnState(id, true);
			}
		} catch {
			/* the per-thread job poll is still underneath */
		}
	}

	async #track(): Promise<void> {
		const me = this.#me;
		if (!this.#channel || !me) return;
		try {
			await this.#channel.track({ ...me, ...this.#where });
		} catch {
			/* a dropped beat self-heals on the next sync */
		}
	}

	#readPresence(): void {
		if (!this.#channel) return;
		this.peers = dedupePresence(
			this.#channel.presenceState<Partial<PresencePeer>>(),
			this.#me?.userId ?? null,
			this.#where
		);
	}
}

/** One shell, one brand at a time — a singleton is the honest shape here. */
export const brandChannel = new BrandChannel();
