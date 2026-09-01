import { beforeEach, describe, expect, it, vi } from 'vitest';

const watchToolJobs = vi.fn();
const isWatchingToolJobs = vi.fn(() => false);

vi.mock('$lib/stores/chat-session', () => ({
	readPersistedSession: vi.fn(() => null),
	hydrateSessionFromStorage: vi.fn(),
	beginJobPolling: vi.fn(),
	watchToolJobs: (...args: unknown[]) => watchToolJobs(...args),
	isWatchingToolJobs: () => isWatchingToolJobs(),
	getSession: vi.fn(() => null)
}));

vi.mock('$lib/stores/chat', () => ({ refreshThreads: vi.fn() }));

import { createLifecycle } from './lifecycle.svelte';

function lifecycle(loading = false) {
	return createLifecycle({
		brandSlug: () => 'anomalia',
		threadId: () => 'thread-1',
		pendingSeed: () => [],
		loading: () => loading,
		messages: () => [],
		setMessages: vi.fn(),
		handled: () => null,
		touchHandled: vi.fn(),
		finalize: vi.fn(async () => {}),
		send: vi.fn(async () => {})
	});
}

function respondWithJobs(jobs: unknown[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ jobs }), { status: 200 }))
	);
}

/**
 * Il difetto del 1/9: un render `motion_video` girava da dieci minuti e la riga «lavoro in
 * background» non è mai comparsa. Il fetch che accende il watcher stava SOLO nel ramo felice di
 * `send()` — uno stream che si rompe (o lo Stop) esce da `result === 'error'` e torna indietro
 * prima. Da lì in poi nessuno ricontrolla più: il seed del server è la fotografia della load, e
 * al ritorno del focus la pagina non chiede niente. Il lavoro c'era, girava, e non lo diceva
 * nessuno.
 */
describe('lifecycle: il controllo dei lavori in background è richiamabile da fuori il ramo felice', () => {
	beforeEach(() => {
		watchToolJobs.mockClear();
		isWatchingToolJobs.mockReturnValue(false);
	});

	it('accende il watcher quando il thread ha un lavoro ancora in corso', async () => {
		respondWithJobs([{ id: 'j1', tool_name: 'motion_video', status: 'running' }]);

		await lifecycle().checkPendingTools();

		expect(watchToolJobs).toHaveBeenCalledWith(
			expect.objectContaining({ brandSlug: 'anomalia', threadId: 'thread-1' })
		);
	});

	it('non accende niente quando non c`è più niente in corso', async () => {
		respondWithJobs([]);

		await lifecycle().checkPendingTools();

		expect(watchToolJobs).not.toHaveBeenCalled();
	});

	it('non chiede niente mentre il turno sta ancora scorrendo', async () => {
		const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await lifecycle(true).checkPendingTools();

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('un endpoint che risponde male non fa saltare il chiamante', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			})
		);

		await expect(lifecycle().checkPendingTools()).resolves.toBeUndefined();
	});
});
