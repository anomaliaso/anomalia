import { describe, expect, it } from 'vitest';
import type { AdapterContext, ToolResult, ToolSpec } from '@anomalia/agent-kit/types';
import { buildTools } from './ai-runtime';

const ctx: AdapterContext = { brandId: 'b1', userId: 'u1', runId: 'run-1', locale: 'it' };

const BURN_TOOL: ToolSpec = {
	name: 'burn',
	description: 'brucia token',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false }
};

const REPLY_TOOL: ToolSpec = {
	name: 'reply',
	description: 'chiude il turno',
	inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
	terminal: true
};

const noopExec = async (): Promise<ToolResult> => ({ content: [{ type: 'text', text: 'ok' }] });

describe('buildTools — la traduzione ToolSpec[] → ToolSet che i motori condividono', () => {
	it('un tool con terminal: true non monta execute, e il loop si ferma per costruzione', () => {
		const tools = buildTools([BURN_TOOL, REPLY_TOOL], noopExec, ctx);
		expect(tools.burn.execute).toBeTypeOf('function');
		expect(tools.reply.execute).toBeUndefined();
	});

	it('un tool normale passa dall executor con nome e args del modello', async () => {
		const calls: Array<{ name: string; args: unknown; id?: string }> = [];
		const exec = async (call: { name: string; args: unknown; id?: string }): Promise<ToolResult> => {
			calls.push(call);
			return { content: [{ type: 'text', text: `visto: ${JSON.stringify(call.args)}` }] };
		};
		const tools = buildTools([BURN_TOOL], exec, ctx);
		const out = await (tools.burn.execute as (input: unknown) => Promise<ToolResult>)({ intensity: 7 });
		expect(calls).toEqual([{ name: 'burn', args: { intensity: 7 } }]);
		expect(out.content).toEqual([{ type: 'text', text: 'visto: {"intensity":7}' }]);
	});

	it('il toolCallId dell’SDK diventa call.id — è come un artefatto si ancora alla chip in chat', async () => {
		const calls: Array<{ name: string; id?: string }> = [];
		const exec = async (call: { name: string; id?: string }): Promise<ToolResult> => {
			calls.push(call);
			return { content: [{ type: 'text', text: 'ok' }] };
		};
		const tools = buildTools([BURN_TOOL], exec, ctx);
		await (
			tools.burn.execute as (input: unknown, opts: { toolCallId: string }) => Promise<ToolResult>
		)({}, { toolCallId: 'call-9' });
		expect(calls[0]?.id).toBe('call-9');
	});
});
