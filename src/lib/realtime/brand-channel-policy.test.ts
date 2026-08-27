import { describe, expect, it } from 'vitest';
import { shouldCoalesceBrandConnect } from './brand-channel-policy';

const A = 'c3683228-8163-4a3c-857d-3bc1e177199a';
const B = '22bf9fdc-9fcd-4f8c-a6e0-54cfa7ffec37';

describe('shouldCoalesceBrandConnect', () => {
	it('reuses a live channel for the same brand', () => {
		expect(shouldCoalesceBrandConnect(A, A, true, false)).toBe(true);
	});

	it('reuses an in-flight connect while #channel is still null', () => {
		// The race that threw: shell effect re-ran during getSession, second connect tried to
		// re-bind presence on the topic the first call had already subscribed.
		expect(shouldCoalesceBrandConnect(A, A, false, true)).toBe(true);
	});

	it('does not coalesce when nothing is connected or connecting', () => {
		expect(shouldCoalesceBrandConnect(A, A, false, false)).toBe(false);
	});

	it('never coalesces across brands', () => {
		expect(shouldCoalesceBrandConnect(A, B, true, false)).toBe(false);
		expect(shouldCoalesceBrandConnect(A, B, false, true)).toBe(false);
		expect(shouldCoalesceBrandConnect(null, A, false, true)).toBe(false);
	});
});
