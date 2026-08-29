import { describe, expect, it, vi } from 'vitest';
import type { AdapterContext, ToolResult, ToolSpec } from '@anomalia/agent-kit/types';
import { buildTools } from './ai-runtime';

const context: AdapterContext = { brandId: 'b1', userId: 'u1', runId: 'r1', locale: 'it' };

const CONSEQUENT: ToolSpec = {
	name: 'publish',
	description: 'publish',
	inputSchema: { type: 'object' },
	consequential: true
};

const READ: ToolSpec = {
	name: 'read',
	description: 'read',
	consequential: false,
	inputSchema: { type: 'object' }
};

const ok: ToolResult = { content: [{ type: 'text', text: 'ok' }] };

describe('buildTools — action approval', () => {
	it('fails closed when the checker errors before a consequential tool executes', async () => {
		const execute = vi.fn(async () => ok);
		const tools = buildTools([CONSEQUENT], execute, context, {
			autoReviewEnabled: true,
			checker: async () => 'error'
		});

		const result = await (tools.publish.execute as (input: Record<string, unknown>) => Promise<ToolResult>)({});

		expect(execute).not.toHaveBeenCalled();
		expect(result.isError).toBe(true);
	});

	it('executes a consequential tool after a passing judge without a user prompt', async () => {
		const execute = vi.fn(async () => ok);
		const checker = vi.fn(async () => 'pass' as const);
		const tools = buildTools([CONSEQUENT], execute, context, { autoReviewEnabled: true, checker });
		const needsApproval = tools.publish.needsApproval as (input: Record<string, unknown>, options: { toolCallId: string }) => Promise<boolean>;

		expect(await needsApproval({}, { toolCallId: 'publish-1' })).toBe(false);
		await (tools.publish.execute as (input: Record<string, unknown>, options: { toolCallId: string }) => Promise<ToolResult>)({}, { toolCallId: 'publish-1' });

		expect(checker).toHaveBeenCalledOnce();
		expect(execute).toHaveBeenCalledOnce();
	});

	it('lets a nonconsequential tool through without invoking the checker', async () => {
		const execute = vi.fn(async () => ok);
		const checker = vi.fn(async () => 'error' as const);
		const tools = buildTools([READ], execute, context, { autoReviewEnabled: true, checker });
		const needsApproval = tools.read.needsApproval as (input: Record<string, unknown>, options: { toolCallId: string }) => Promise<boolean>;

		expect(await needsApproval({}, { toolCallId: 'read-1' })).toBe(false);

		await (tools.read.execute as (input: Record<string, unknown>) => Promise<ToolResult>)({});

		expect(execute).toHaveBeenCalledOnce();
		expect(checker).not.toHaveBeenCalled();
	});

	it('publishes approval metadata only for consequential tools', () => {
		const tools = buildTools([CONSEQUENT, READ], vi.fn(async () => ok), context);

		expect(tools.publish.needsApproval).toBeTypeOf('function');
		expect(tools.read.needsApproval).toBeTypeOf('function');
});
});
