import { describe, expect, it, vi } from 'vitest';
import {
	ChatJobCancelledError,
	createJobCancellation,
	isChatJobCancelledError,
	shouldPersistAsyncToolResult,
} from './job-cancel';

describe('shouldPersistAsyncToolResult', () => {
	it('persists only while still running', () => {
		expect(shouldPersistAsyncToolResult('running')).toBe(true);
		expect(shouldPersistAsyncToolResult('cancelled')).toBe(false);
		expect(shouldPersistAsyncToolResult('done')).toBe(false);
		expect(shouldPersistAsyncToolResult(null)).toBe(false);
	});
});

describe('createJobCancellation', () => {
	it('passes while status is running', async () => {
		const maybeSingle = vi.fn().mockResolvedValue({ data: { status: 'running' } });
		const supabase = {
			from: () => ({
				select: () => ({
					eq: () => ({ maybeSingle }),
				}),
			}),
		} as never;

		const cancel = createJobCancellation(supabase, 'job-1');
		await expect(cancel.assertActive()).resolves.toBeUndefined();
		expect(cancel.signal.aborted).toBe(false);
	});

	it('throws and aborts the signal when cancelled', async () => {
		const maybeSingle = vi.fn().mockResolvedValue({ data: { status: 'cancelled' } });
		const supabase = {
			from: () => ({
				select: () => ({
					eq: () => ({ maybeSingle }),
				}),
			}),
		} as never;

		const cancel = createJobCancellation(supabase, 'job-1');
		await expect(cancel.assertActive()).rejects.toBeInstanceOf(ChatJobCancelledError);
		expect(cancel.signal.aborted).toBe(true);
		expect(isChatJobCancelledError(new ChatJobCancelledError())).toBe(true);
	});
});
