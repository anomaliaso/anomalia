import { describe, expect, it } from 'vitest';
import { approvalContinuationMessage, findToolApproval, approvalMessageParts } from './approval';

describe('harness approval bridge', () => {
	it('finds a pending approval and its original tool call from a completed step', () => {
		expect(
			findToolApproval([
				{
					content: [
						{ type: 'tool-call', toolCallId: 'call-1', toolName: 'publish_post', input: { post_id: 'p1' } },
						{ type: 'tool-approval-request', approvalId: 'approval-1', toolCallId: 'call-1' }
					]
				}
			])
		).toEqual({
			approvalId: 'approval-1',
			toolCallId: 'call-1',
			toolName: 'publish_post',
			input: { post_id: 'p1' }
		});
	});

	it('serializes the original call and approval request for model history', () => {
		expect(approvalMessageParts({ approvalId: 'a1', toolCallId: 'c1', toolName: 'send_email', input: { to: 'a@b.test' } })).toEqual([
			{ type: 'tool-call', toolCallId: 'c1', toolName: 'send_email', input: { to: 'a@b.test' } },
			{ type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'c1' }
		]);
	});

	it('creates the native continuation response without adding a user turn', () => {
		expect(approvalContinuationMessage({ approvalId: 'a1', approved: false, reason: 'Not now' })).toEqual({
			role: 'tool',
			content: [{ type: 'tool-approval-response', approvalId: 'a1', approved: false, reason: 'Not now' }]
		});
	});
});
