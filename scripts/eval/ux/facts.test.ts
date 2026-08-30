import { describe, expect, it } from 'vitest';
import { setupTurnCompleted } from './facts';

describe('setupTurnCompleted', () => {
	it('does not treat a persisted assistant message as a completed run', () => {
		expect(setupTurnCompleted(1, ['running'])).toBe(false);
	});

	it('requires both the persisted reply and a done agent-kit run', () => {
		expect(setupTurnCompleted(1, ['done'])).toBe(true);
	});
});
