import { describe, it, expect, vi } from 'vitest';
import type { ToolCall } from '../kit';
import { createDelegationPlugin } from './delegation';

const ctx = { brandId: 'b1', userId: 'u1', runId: 'r1', locale: 'it' };

function fakeTool(result: unknown) {
	return {
		description: 'tool vero di subagents.ts',
		inputSchema: { type: 'object', properties: { role: { type: 'string' } }, required: ['role'] },
		execute: vi.fn(async () => result)
	};
}

function fakeTools() {
	return {
		delegate_task: fakeTool({ role: 'research', report: 'FINDINGS', steps: 2, tools_used: ['brand_read'] }),
		run_task_pipeline: fakeTool({ verdict: 'pass', phases: [] }),
		run_parallel_tasks: fakeTool({ tasks: [], failed: 0 })
	} as Record<string, never>;
}

const call = (name: string, args: Record<string, unknown> = { role: 'research' }): ToolCall => ({ name, args });

describe('delegation plugin — la delega del motore classico, montata sul kit', () => {
	it('espone i tre tool di delega, in modalità agent', () => {
		const p = createDelegationPlugin({ tools: fakeTools() });
		expect(p.name).toBe('delegation');
		expect(p.tools.map((t) => t.name).sort()).toEqual(['delegate_task', 'run_parallel_tasks', 'run_task_pipeline']);
		for (const t of p.tools) expect(t.requiresMode).toBe('agent');
	});

	it('delegate_task passa args e signal al tool VERO e ne propaga il risultato intero', async () => {
		const tools = fakeTools();
		const p = createDelegationPlugin({ tools });
		const res = await p.execute(call('delegate_task', { role: 'verify' }), ctx);
		expect(tools.delegate_task.execute).toHaveBeenCalledWith(
			expect.objectContaining({ role: 'verify' }),
			expect.objectContaining({ abortSignal: undefined })
		);
		expect(JSON.parse(res.content[0].text)).toMatchObject({ role: 'research', report: 'FINDINGS' });
		expect(res.isError).toBeFalsy();
	});

	it('un risultato con `error` torna isError, come fa execChatTool per ogni altro ponte', async () => {
		const tools = { delegate_task: fakeTool({ error: 'budget spent' }) };
		const p = createDelegationPlugin({ tools });
		const res = await p.execute(call('delegate_task'), ctx);
		expect(res.isError).toBe(true);
	});

	it('un nome che non è delega rifiuta senza eseguire nulla', async () => {
		const tools = fakeTools();
		const p = createDelegationPlugin({ tools });
		const res = await p.execute(call('brand_write', { path: 'x', content: 'y' }), ctx);
		expect(res.isError).toBe(true);
		expect(tools.delegate_task.execute).not.toHaveBeenCalled();
	});
});
