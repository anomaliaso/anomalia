import { describe, expect, it, vi } from 'vitest';
import { streamOpenAICompletions } from '@earendil-works/pi-ai/openai-completions';
import type { Context, Model } from '@earendil-works/pi-ai/types';

const context: Context = {
	messages: [{ role: 'user', content: 'hello', timestamp: 0 }]
};

function modelOn(provider: string, baseUrl: string): Model<'openai-completions'> {
	return {
		id: 'test-model',
		name: 'Test model',
		api: 'openai-completions',
		provider,
		baseUrl,
		reasoning: false,
		input: ['text'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 1_000
	};
}

async function streamResult(model: Model<'openai-completions'>, deltas: Array<object>): Promise<{ stopReason: string; content: Array<{ type: string }> }> {
	const body = deltas
		.map((delta) => `data: ${JSON.stringify({ id: 'chatcmpl-test', model: 'test-model', choices: [{ delta, finish_reason: null }] })}`)
		.concat('data: [DONE]')
		.join('\n\n') + '\n\n';
	vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
		status: 200,
		headers: { 'content-type': 'text/event-stream' }
	})));

	try {
		const stream = streamOpenAICompletions(model, context, { apiKey: 'test' });
		for await (const _event of stream) {}

		const result = await stream.result();
		return { stopReason: result.stopReason, content: result.content };
	} finally {
		vi.unstubAllGlobals();
	}
}

describe('OpenRouter OpenAI-compatible stream', () => {
	it('accepts a completed response whose provider omits finish_reason', async () => {
		const result = await streamResult(modelOn('openrouter', 'https://openrouter.ai/api/v1'), [{ content: 'hello' }]);

		expect(result.stopReason).toBe('stop');
		expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
	});

	it('accepts a completed response from any gateway that omits finish_reason', async () => {
		const result = await streamResult(modelOn('kie', 'https://kie.example/v1'), [{ content: 'hello' }]);

		expect(result.stopReason).toBe('stop');
		expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
	});

	it('infers toolUse when only a tool call arrived without finish_reason', async () => {
		const result = await streamResult(modelOn('kie', 'https://kie.example/v1'), [{ tool_calls: [{ id: 't1', type: 'function', function: { name: 'ask_user', arguments: '{}' } }] }]);

		expect(result.stopReason).toBe('toolUse');
	});

	it('still fails when nothing arrived and the provider never omits finish_reason', async () => {
		const result = await streamResult(modelOn('kie', 'https://kie.example/v1'), []);

		expect(result.stopReason).toBe('error');
	});
});
