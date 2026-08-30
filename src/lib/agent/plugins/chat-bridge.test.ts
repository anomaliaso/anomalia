import { describe, expect, it } from 'vitest';
import { execChatTool } from './chat-bridge';

describe('execChatTool', () => {
	it('marca ambiguous una eccezione del tool reale', async () => {
		const tool = {
			execute: async () => {
				throw new Error('connessione interrotta dopo la scrittura');
			}
		};

		const result = await execChatTool(tool as never, 'content_update_post', {}, 'run-1');

		expect(result.isError).toBe(true);
		expect(result.effectStatus).toBe('ambiguous');
	});
});
