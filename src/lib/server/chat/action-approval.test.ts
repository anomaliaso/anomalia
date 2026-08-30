import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateText = vi.fn();
const logged: Array<Record<string, unknown>> = [];
const envHolder: Record<string, string | undefined> = {};

vi.mock('ai', async (original) => ({
	...((await original()) as object),
	generateText: (...args: unknown[]) => generateText(...args)
}));
vi.mock('$env/dynamic/private', () => ({ env: envHolder }));
vi.mock('$lib/server/chat/model', () => ({
	compactionModel: () => ({ model: {}, modelId: 'judge', provider: 'test' })
}));
vi.mock('$lib/server/ai-log', () => ({
	logAiCall: (row: Record<string, unknown>) => logged.push(row)
}));

const { createChatActionApproval } = await import('./action-approval');

function verdict(...answers: boolean[]) {
	return {
		text: JSON.stringify(answers.map((answer) => ({ question: 'q', answer, reason: 'r' }))),
		usage: { inputTokens: 10, outputTokens: 4 }
	};
}

const context = { brandId: 'b1', userId: 'u1', runId: 'r1', locale: 'it' as const };

beforeEach(() => {
	generateText.mockReset();
	logged.length = 0;
	delete envHolder.CHAT_ACTION_JUDGE;
});

describe('createChatActionApproval', () => {
	it('resta spento se il judge non è abilitato', () => {
		expect(createChatActionApproval({ messages: [], brandId: 'b1', userId: 'u1', threadId: 't1' })).toBeUndefined();
	});

	it('promuove il consenso del transcript a pass', async () => {
		envHolder.CHAT_ACTION_JUDGE = 'on';
		generateText.mockResolvedValue(verdict(false, false));
		const approval = createChatActionApproval({
			messages: [{ role: 'user', content: 'aggiorna il post p1' }],
			brandId: 'b1',
			userId: 'u1',
			threadId: 't1'
		});

		const decision = await approval!.checker!({
			spec: { name: 'content_update_post', description: '', inputSchema: {}, consequential: true, effectful: true },
			call: { name: 'content_update_post', args: { post_id: 'p1' }, id: 'c1' },
			context
		});

		expect(decision).toBe('pass');
		expect(generateText).toHaveBeenCalledOnce();
		expect(logged[0]).toMatchObject({ label: 'chatActionJudge', ok: true, threadId: 't1' });
	});

	it('chiede approvazione se il transcript segnala un’azione non autorizzata', async () => {
		envHolder.CHAT_ACTION_JUDGE = 'on';
		generateText.mockResolvedValue(verdict(true, false));
		const approval = createChatActionApproval({ messages: [], brandId: 'b1', userId: 'u1', threadId: 't1' });

		const decision = await approval!.checker!({
			spec: { name: 'content_schedule', description: '', inputSchema: {}, consequential: true, effectful: true },
			call: { name: 'content_schedule', args: {}, id: 'c1' },
			context
		});

		expect(decision).toBe('ask');
	});

	it('fallisce chiuso se il giudice non restituisce un verdetto valido', async () => {
		envHolder.CHAT_ACTION_JUDGE = 'on';
		generateText.mockResolvedValue({ text: 'no' });
		const approval = createChatActionApproval({ messages: [], brandId: 'b1', userId: 'u1', threadId: 't1' });

		const decision = await approval!.checker!({
			spec: { name: 'content_schedule', description: '', inputSchema: {}, consequential: true, effectful: true },
			call: { name: 'content_schedule', args: {}, id: 'c1' },
			context
		});

		expect(decision).toBe('error');
		expect(logged[0]).toMatchObject({ label: 'chatActionJudge', ok: false });
	});
});
