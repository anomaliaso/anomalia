import { describe, expect, it, vi } from 'vitest';

const genMock = vi.fn();
vi.mock('ai', async (orig) => ({
	...((await orig()) as object),
	generateText: (...a: unknown[]) => genMock(...a)
}));

const { judgeTranscript, formatTranscript } = await import('./transcript-judge');

const fakeModel = {} as never;

describe('formatTranscript', () => {
	it('rende messaggi, tool con esito e stati del run su righe leggibili', () => {
		const text = formatTranscript([
			{ kind: 'user', text: 'rifallo, bello' },
			{ kind: 'tool', name: 'motion_render', input: { source: 'trailer.tsx' }, failed: true, output: 'timeout' },
			{ kind: 'assistant', text: 'Fatto.' },
			{ kind: 'run', state: 'done', reason: 'completed' }
		]);
		expect(text).toContain('user: rifallo, bello');
		expect(text).toContain('[tool motion_render]');
		expect(text).toContain('FAILED');
		expect(text).toContain('[run done (completed)]');
	});
});

describe('judgeTranscript', () => {
	const questions = [
		"L'agente è uscito dal loop da solo?",
		'Ha ripetuto lo stesso tool con gli stessi argomenti dopo un fallimento?'
	];

	it('il verdetto è la congiunzione delle risposte chiuse', async () => {
		genMock.mockResolvedValue({
			text: '[{"question":"q1","answer":true,"reason":"ha chiesto"},{"question":"q2","answer":true,"reason":"mai ripetuto"}]'
		});
		const v = await judgeTranscript({ model: fakeModel, transcript: 'user: ciao', questions });
		expect(v.passed).toBe(true);
		expect(v.answers).toHaveLength(2);
	});

	it('una sola risposta falsa boccia lo scenario', async () => {
		genMock.mockResolvedValue({
			text: 'ecco il verdetto: [{"question":"q1","answer":true,"reason":"ok"},{"question":"q2","answer":false,"reason":"ripetuto identico"}] fine'
		});
		const v = await judgeTranscript({ model: fakeModel, transcript: 'user: ciao', questions });
		expect(v.passed).toBe(false);
	});

	it('un verdetto malformato LANCIA: mai un pass silenzioso', async () => {
		genMock.mockResolvedValue({ text: 'non saprei dire' });
		await expect(judgeTranscript({ model: fakeModel, transcript: 'x', questions })).rejects.toThrow();
		genMock.mockResolvedValue({ text: '[{"question":"q1","answer":true,"reason":"ok"}]' });
		await expect(judgeTranscript({ model: fakeModel, transcript: 'x', questions })).rejects.toThrow();
	});

	it('la trascrizione a eventi arriva al giudice già formattata', async () => {
		genMock.mockImplementation(({ prompt }: { prompt: string }) => {
			expect(prompt).toContain('[tool ask_user]');
			return Promise.resolve({ text: '[{"question":"q","answer":true,"reason":"ok"}]' });
		});
		await judgeTranscript({
			model: fakeModel,
			transcript: [{ kind: 'tool', name: 'ask_user', input: { question: 'quale stile?' } }],
			questions: ['q']
		});
	});
});
