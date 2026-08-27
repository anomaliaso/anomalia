import { describe, expect, it } from 'vitest';
import { dedupePresence, peersHere, sharesLocation } from './presence-peers';

const HOME = '/app/anomalia';
const CHAT = 'de4e0fba-a2d3-47ed-982e-363a1d212f58';

const meta = (over: Record<string, unknown> = {}) => ({
	userId: 'u2',
	name: 'Giulia Rossi',
	avatar: null,
	path: HOME,
	threadId: null,
	...over
});

describe('sharesLocation', () => {
	it('matches on the same route', () => {
		expect(sharesLocation(meta(), { path: HOME, threadId: null })).toBe(true);
		expect(sharesLocation(meta(), { path: '/app/anomalia/plan', threadId: null })).toBe(false);
	});

	it('matches on the same thread even from a different route', () => {
		// The desktop workbench keeps the open thread in a memory store, so two people can be in
		// the same conversation while their URLs disagree.
		const peer = meta({ path: '/app/anomalia/plan', threadId: CHAT });
		expect(sharesLocation(peer, { path: HOME, threadId: CHAT })).toBe(true);
	});

	it('never matches everyone on an empty location', () => {
		expect(sharesLocation(meta({ path: '' }), { path: '', threadId: null })).toBe(false);
	});
});

describe('dedupePresence', () => {
	it('drops the viewer themselves', () => {
		const state = { u1: [meta({ userId: 'u1' })] };
		expect(dedupePresence(state, 'u1', { path: HOME, threadId: null })).toEqual([]);
	});

	it('counts three tabs of one person as one teammate', () => {
		const state = {
			u2: [meta({ path: '/a' }), meta({ path: '/b' }), meta({ path: '/c' })]
		};
		const peers = dedupePresence(state, 'u1', { path: HOME, threadId: null });
		expect(peers).toHaveLength(1);
		expect(peers[0].userId).toBe('u2');
	});

	it('prefers the tab that is on the page with you', () => {
		// Otherwise a colleague with this page open in a background tab reads as "elsewhere".
		const state = { u2: [meta({ path: '/somewhere-else' }), meta({ path: HOME })] };
		const peers = dedupePresence(state, 'u1', { path: HOME, threadId: null });
		expect(peers[0].path).toBe(HOME);
	});

	it('survives junk metas without inventing a peer', () => {
		const state = {
			u2: [{ name: 'no id' }, null as never, meta()],
			u3: [meta({ userId: 'u3', name: '', avatar: '' })]
		};
		const peers = dedupePresence(state, 'u1', { path: HOME, threadId: null });
		expect(peers.map((p) => p.userId).sort()).toEqual(['u2', 'u3']);
		const u3 = peers.find((p) => p.userId === 'u3')!;
		expect(u3.name).toBe('Utente');
		expect(u3.avatar).toBeNull();
	});

	it('tolerates an empty state', () => {
		expect(dedupePresence({}, 'u1', { path: HOME, threadId: null })).toEqual([]);
	});
});

describe('peersHere', () => {
	it('keeps only the peers sharing the viewer location', () => {
		const peers = [
			meta({ userId: 'u2', path: HOME }),
			meta({ userId: 'u3', path: '/app/anomalia/plan' }),
			meta({ userId: 'u4', path: '/app/anomalia/plan', threadId: CHAT })
		];
		const here = peersHere(peers, { path: HOME, threadId: CHAT });
		expect(here.map((p) => p.userId)).toEqual(['u2', 'u4']);
	});
});
