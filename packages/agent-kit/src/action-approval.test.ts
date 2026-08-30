import { describe, expect, it } from 'vitest';
import {
	applyJudgeDecision,
	planActionGate,
	resolveActionApprovalDetail,
	type ActionApprovalResolved
} from './action-approval';

const DEFAULT: ActionApprovalResolved = {
	decision: 'allow',
	source: 'default',
	matchingRules: []
};

describe('action approval', () => {
	it('nonconsequential tool stays on allow without a prompt', () => {
		expect(
			planActionGate({
				resolved: DEFAULT,
				consequential: false,
				autoReviewEnabled: true,
				checkerConfigured: true
			})
		).toBe('allow');
	});

	it('default consequential tool enters judge only with auto-review and checker', () => {
		expect(
			planActionGate({
				resolved: DEFAULT,
				consequential: true,
				autoReviewEnabled: true,
				checkerConfigured: true
			})
		).toBe('judge');
	});

	it('explicit rules win over the judge', () => {
		expect(
			planActionGate({
				resolved: { decision: 'ask', source: 'require_approval', matchingRules: [] },
				consequential: true,
				autoReviewEnabled: true,
				checkerConfigured: true
			})
		).toBe('ask');
		expect(
			planActionGate({
				resolved: { decision: 'allow', source: 'always_allow', matchingRules: [] },
				consequential: true,
				autoReviewEnabled: true,
				checkerConfigured: true
			})
		).toBe('allow');
	});

	it('a broken checker asks instead of allowing a consequential action', () => {
		expect(applyJudgeDecision({ decision: 'error', consequential: true })).toBe('ask');
	});

	it('resolves the most specific approval rule deterministically', () => {
		const result = resolveActionApprovalDetail({
			toolName: 'gmail_send',
			rules: [
				{ effect: 'require_approval', matchKind: 'category', matchValue: 'email' },
				{ effect: 'always_allow', matchKind: 'tool', matchValue: 'gmail_send' }
			]
		});
		expect(result.decision).toBe('allow');
		expect(result.source).toBe('always_allow');
	});
});
