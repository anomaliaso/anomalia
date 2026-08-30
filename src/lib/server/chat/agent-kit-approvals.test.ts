import { describe, expect, it } from 'vitest';
import { approvalInputHash, displayApprovalInput, isApprovalDecision, waitForApproval } from './agent-kit-approvals';

describe('agent kit approvals', () => {
	it('hashes the same input independently of object key order', () => {
		expect(approvalInputHash({ post_id: 'p1', caption: 'new' })).toBe(
			approvalInputHash({ caption: 'new', post_id: 'p1' })
		);
	});

	it('redacts credentials before approval input reaches the UI', () => {
		expect(displayApprovalInput({ channel: 'instagram', api_key: 'secret', nested: { token: 'x' } })).toEqual({
			channel: 'instagram',
			api_key: '[redacted]',
			nested: { token: '[redacted]' }
		});
	});

	it('accepts only terminal approval decisions', () => {
		expect(isApprovalDecision('approved')).toBe(true);
		expect(isApprovalDecision('denied')).toBe(true);
		expect(isApprovalDecision('pending')).toBe(false);
	});

	it('persists the continuation and the visible request in one RPC call', async () => {
		let args: Record<string, unknown> | undefined;
		const db = {
			rpc: async (_name: string, next: Record<string, unknown>) => {
				args = next;
				return { data: { closed: true }, error: null };
			}
		} as never;

		await waitForApproval(db, {
			runId: 'run-1',
			harnessApprovalId: 'harness-1',
			toolCallId: 'call-1',
			toolName: 'publish_post',
			toolInput: { post_id: 'post-1' },
			continueState: { cursor: 3 },
			message: { content: '', toolCalls: [{ type: 'tool-approval-request', approvalId: 'harness-1' }] }
		});

		expect(args).toMatchObject({
			p_run_id: 'run-1',
			p_continue_state: { cursor: 3 },
			p_message: { content: '', tool_calls: [{ type: 'tool-approval-request', approvalId: 'harness-1' }] }
		});
		expect(args?.p_input_hash).toBe(approvalInputHash({ post_id: 'post-1' }));
	});
});
