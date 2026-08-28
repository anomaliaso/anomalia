import { describe, expect, it, vi } from 'vitest';
import { streamOpenAICompletions } from '@earendil-works/pi-ai/openai-completions';
import type { Context, Model } from '@earendil-works/pi-ai/types';

const model: Model<'openai-completions'> = {
	id: 'test-model',
	name: 'Test model',
	api: 'openai-completions',
	provider: 'openrouter',
	baseUrl: 'https://openrouter.ai/api/v1',
	reasoning: false,
	input: ['text'],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 1_000
};

const context: Context = {
	messages: [{ role: 'user', content: 'hello', timestamp: 0 }]
};

describe('OpenRouter OpenAI-compatible stream', () => {
	it('accepts a completed response whose provider omits finish_reason', async () => {
		const body = [
			`data: ${JSON.stringify({
				id: 'chatcmpl-test',
				model: 'test-model',
				choices: [{ delta: { content: 'hello' }, finish_reason: null }]
			})}`,
			'data: [DONE]'
		].join('\n\n') + '\n\n';
		vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
			status: 200,
			headers: { 'content-type': 'text/event-stream' }
		})));

		try {
			const stream = streamOpenAICompletions(model, context, { apiKey: 'test' });
			for await (const _event of stream) {}

			const result = await stream.result();
			expect(result.stopReason).toBe('stop');
			expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
