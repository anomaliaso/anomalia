import { describe, expect, it } from 'vitest';
import { POST_STATUS, POST_STATUS_VOCABULARY } from './post-status';

describe('il vocabolario degli stati dice quello che il database ha davvero', () => {
	it('copre i cinque stati che esistono in produzione, e nessuno inventato', () => {
		expect(Object.keys(POST_STATUS).sort()).toEqual(
			['approved', 'failed', 'pending_user', 'published', 'scheduled'].sort()
		);
	});

	it("dice esplicitamente che «bozza» è pending_user: è la riga che mancava", () => {
		expect(POST_STATUS_VOCABULARY).toContain('pending_user');
		expect(POST_STATUS_VOCABULARY.toLowerCase()).toContain('bozze');
	});
});
