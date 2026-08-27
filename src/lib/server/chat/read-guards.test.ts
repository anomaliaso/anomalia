import { beforeEach, describe, expect, it } from 'vitest';
import { noteRead, requireFreshRead, resetReadReceipts } from './read-guards';

beforeEach(() => resetReadReceipts());

describe('requireFreshRead', () => {
	it('refuses a write with no read behind it', () => {
		const gate = requireFreshRead('motion', 'v1', 't1', 'the motion source', 'read_motion_source');
		expect(gate?.error).toContain('Read before writing');
		expect(gate?.error).toContain('read_motion_source');
	});

	it('lets a write through right after a read of the same state', () => {
		noteRead('motion', 'v1', '2026-08-26T10:00:00Z');
		const gate = requireFreshRead(
			'motion',
			'v1',
			'2026-08-26T10:00:00Z',
			'the motion source',
			'read_motion_source'
		);
		expect(gate).toBeNull();
	});

	it('refuses when the resource changed since the read', () => {
		noteRead('post', 'p1', 'old');
		const gate = requireFreshRead('post', 'p1', 'new', 'this post', 'read_post');
		expect(gate?.error).toContain('changed since your last read');
		expect(gate?.error).toContain('nothing was written');
		expect(gate?.error).toContain('read_post');
	});

	it('keys receipts per resource id — one stale id says nothing about another', () => {
		noteRead('graphic', 'a|0', 3);
		expect(requireFreshRead('graphic', 'b|0', 3, 'slide', 'read_source')).not.toBeNull();
		expect(requireFreshRead('graphic', 'a|0', 4, 'slide', 'read_source')).not.toBeNull();
		expect(requireFreshRead('graphic', 'a|0', 3, 'slide', 'read_source')).toBeNull();
	});

	it('fails open on a resource that carries no token at all', () => {
		expect(requireFreshRead('document', 'd1', null, 'doc', 'read_document')).toBeNull();
	});

	it('ignores reads that carry no token', () => {
		noteRead('document', 'd1', undefined);
		expect(requireFreshRead('document', 'd1', 't', 'doc', 'read_document')).not.toBeNull();
	});

	it('refreshes the receipt by reading again after a change', () => {
		noteRead('motion', 'v1', 't1');
		expect(requireFreshRead('motion', 'v1', 't2', 'src', 'read_motion_source')).not.toBeNull();

		noteRead('motion', 'v1', 't2');
		expect(requireFreshRead('motion', 'v1', 't2', 'src', 'read_motion_source')).toBeNull();
	});

	it('evicts the oldest receipt past the cap instead of growing forever', () => {
		for (let i = 0; i < 2500; i++) noteRead('post', `p${i}`, 't');
		expect(requireFreshRead('post', 'p0', 't', 'post', 'read_post')?.error).toContain(
			'Read before writing'
		);
		expect(requireFreshRead('post', 'p2499', 't', 'post', 'read_post')).toBeNull();
	});
});
