import { describe, expect, it } from 'vitest';
import {
	createHarnessSession,
	omitImageData,
	renderTranscript,
	sanitizeVisible,
	clipText,
	MAX_VALUE_CHARS
} from './session';
import { wrapTools } from './pipeline';
import { attachHarness } from './run';
import { sessionToRow } from './persist';

describe('omitImageData / sanitizeVisible', () => {
	it('replaces data-URI images with size and hash, not pixels', () => {
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
		const dataUri = `data:image/jpeg;base64,${jpeg}`;
		const omitted = omitImageData(dataUri);
		expect(omitted.type).toBe('image_omitted');
		expect(omitted.mimeType).toBe('image/jpeg');
		expect(omitted.bytes).toBeGreaterThan(0);
		expect(omitted.sha256).toMatch(/^[0-9a-f]{16}$/);

		const sanitized = sanitizeVisible({
			type: 'image',
			image: dataUri
		}) as { type: string; image: { type: string } };
		expect(sanitized.image.type).toBe('image_omitted');
		expect(JSON.stringify(sanitized)).not.toContain(jpeg);
	});

	it('keeps https image URLs as refs', () => {
		const sanitized = sanitizeVisible({
			type: 'image',
			image: 'https://cdn.example.com/logo.png'
		}) as { image: { type: string; src: string } };
		expect(sanitized.image).toEqual({
			type: 'image_ref',
			src: 'https://cdn.example.com/logo.png'
		});
	});

	it('clips long strings and omits raw jpeg base64', () => {
		const long = 'x'.repeat(MAX_VALUE_CHARS + 50);
		expect(clipText(long).endsWith(`…[truncated 50 chars]`)).toBe(true);
		const jpegB64 = '/9j/' + 'A'.repeat(9000);
		const omitted = sanitizeVisible(jpegB64) as { type: string };
		expect(omitted.type).toBe('image_omitted');
	});
});

describe('HarnessSession transcript', () => {
	it('records system, messages, tools, prepare_step patches, and assistant text', async () => {
		const session = createHarnessSession({
			brandId: 'brand-1',
			userId: 'user-1',
			agent: 'chat',
			mode: 'agent',
			surface: 'chat',
			model: 'grok-4',
			provider: 'kie'
		});
		session.captureRequest({
			system: 'You are Anomalia.',
			messages: [
				{ role: 'user', content: 'Hello' },
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'see this' },
						{ type: 'image', image: 'data:image/png;base64,iVBORw0KGgo=' }
					]
				}
			]
		});
		session.capturePrepareStep({ system: 'You are Anomalia.\n[budget] remaining_sec≈12' });
		session.recordToolCall('read_posts', { status: 'pending_user' });
		session.recordToolResult('read_posts', { posts: [{ id: 'p1' }] }, 12, true);
		session.recordStep({ text: 'looking', toolCalls: [{ toolName: 'read_posts' }] });
		session.recordAssistantText('Done.');
		session.recordAssistantText('Done.');
		session.finish('finished');

		const text = session.transcript();
		expect(text).toContain('agent=chat');
		expect(text).toContain('--- system ---');
		expect(text).toContain('You are Anomalia.');
		expect(text).toContain('--- system (prepare_step) ---');
		expect(text).toContain('[budget] remaining_sec≈12');
		expect(text).toContain('--- user ---');
		expect(text).toContain('Hello');
		expect(text).toContain('[image');
		expect(text).toContain('→ read_posts');
		expect(text).toContain('← read_posts (12ms)');
		expect(text).toContain('--- assistant ---');
		expect(text).toContain('Done.');
		expect(text).toContain('=== turn end finished');
		expect(text).not.toContain('iVBORw0KGgo=');
		expect(text.split('--- assistant ---').length - 1).toBe(1);

		const rendered = renderTranscript(session.events);
		expect(rendered).toContain('→ read_posts');
	});

	it('records cache and reasoning tokens from the ai@7 nested usage shape', () => {
		const session = createHarnessSession({ agent: 'chat', brandId: 'b' });
		session.recordUsage({
			inputTokens: 1000,
			inputTokenDetails: { noCacheTokens: 400, cacheReadTokens: 600, cacheWriteTokens: 0 },
			outputTokens: 149,
			outputTokenDetails: { textTokens: 68, reasoningTokens: 81 }
		});
		expect(renderTranscript(session.events)).toContain('usage in=1000 out=149 cached=600 think=81');
	});

	it('does not overwrite aborted status with a later finished', () => {
		const session = createHarnessSession({ agent: 'chat', brandId: 'b' });
		session.finish('aborted');
		session.finish('finished');
		expect(session.status).toBe('aborted');
	});
});

describe('wrapTools', () => {
	it('logs call and result without changing the return value', async () => {
		const session = createHarnessSession({ agent: 'strategy', brandId: 'b' });
		const tools = wrapTools(session, {
			echo: {
				description: 'echo',
				execute: async (input: { n: number }) => ({ n: input.n * 2 })
			}
		});
		const out = await tools.echo.execute({ n: 3 }, {});
		expect(out).toEqual({ n: 6 });
		expect(session.events.some((e) => e.type === 'tool_call' && e.name === 'echo')).toBe(true);
		const result = session.events.find((e) => e.type === 'tool_result');
		expect(result).toMatchObject({ type: 'tool_result', name: 'echo', ok: true, output: { n: 6 } });
	});

	it('before-hook deny returns without calling the original execute', async () => {
		const session = createHarnessSession({ agent: 'strategy', brandId: 'b' });
		let called = false;
		const tools = wrapTools(
			session,
			{
				danger: {
					execute: async () => {
						called = true;
						return { ok: true };
					}
				}
			},
			{ before: [() => ({ deny: 'blocked' })] }
		);
		const out = await tools.danger.execute({}, {});
		expect(called).toBe(false);
		expect(out).toEqual({ error: 'blocked' });
	});
});

describe('attachHarness', () => {
	it('captures prepareStep system changes and still returns the original patch', async () => {
		const session = createHarnessSession({ agent: 'produce', brandId: 'b' });
		const instrumented = attachHarness(session, {
			system: 'base',
			messages: [{ role: 'user', content: 'go' }],
			prepareStep: () => ({ system: 'base\n[budget] 1' }),
			onStepFinish: () => {}
		});
		const prepared = instrumented.prepareStep({});
		expect(prepared).toEqual({ system: 'base\n[budget] 1' });
		expect(typeof (prepared as { then?: unknown }).then).not.toBe('function');
		expect(session.events.some((e) => e.type === 'system' && e.source === 'prepare_step')).toBe(
			true
		);
		await instrumented.onStepFinish({ text: 'step', toolCalls: [{ toolName: 'finish' }] });
		expect(session.events.some((e) => e.type === 'step')).toBe(true);
	});

	// Il 28.6% dei turni di produzione su Grok finiva con ZERO chiamate: leggeva il brief e chiudeva
	// a parole. Il primo step di una richiesta di produzione ora DEVE chiamare uno strumento — e
	// solo quello, perché forzarne uno su una domanda produrrebbe un turno assurdo.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const prep = (t: any, stepNumber: number) => t.prepareStep({ stepNumber }) as Record<string, unknown>;
	// `model` conta: il forzare vale solo dove il modello accetta un tool_choice diverso da `auto`
	// (vedi FORCED_TOOL_CHOICE_MODELS in run.ts — glm risponde 400 e il turno muore prima di partire).
	const chatTurn = (text: string, tools: Record<string, unknown> = { create_post: {}, read_posts: {}, ask_user_questions: {} }) =>
		attachHarness(createHarnessSession({ agent: 'chat', surface: 'chat', brandId: 'b', model: 'grok-4-6' }), {
			system: 'base',
			messages: [{ role: 'user', content: text }],
			tools
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);

	it('forza uno strumento al primo step di una richiesta di produzione, e solo lì', () => {
		const t = chatTurn('Crea un post statico e grafico');
		const first = prep(t, 0);
		expect(first.toolChoice).toBe('required');
		// ask_user_questions chiude il turno (stopWhen): sarebbe il modo di obbedire senza fare niente.
		expect(first.activeTools).toEqual(['create_post', 'read_posts']);
		expect(prep(t, 1).toolChoice).toBeUndefined();
	});

	it('un modello che rifiuta il tool_choice forzato non viene forzato: quel 400 costa il turno', () => {
		const glm = attachHarness(
			createHarnessSession({ agent: 'chat', surface: 'chat', brandId: 'b', model: 'z-ai/glm-5.3-flash' }),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			{ system: 'base', messages: [{ role: 'user', content: 'Crea un post statico e grafico' }], tools: { create_post: {} } } as any
		);
		expect(prep(glm, 0).toolChoice).toBeUndefined();
	});

	it('lascia libero il triage: una domanda non si forza', () => {
		const t = chatTurn("cos'e un gatto?");
		expect(prep(t, 0).toolChoice).toBeUndefined();
	});

	it('non forza fuori dalla chat, ne senza strumenti da chiamare', () => {
		const batch = attachHarness(createHarnessSession({ agent: 'produce', surface: 'batch', brandId: 'b', model: 'grok-4-6' }), {
			system: 'base',
			messages: [{ role: 'user', content: 'Crea un post statico e grafico' }],
			tools: { create_post: {} }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		expect(prep(batch, 0).toolChoice).toBeUndefined();
		// Un `required` senza candidati e un 400 del provider, non una correzione.
		const empty = chatTurn('Crea un post statico e grafico', { ask_user_questions: {} });
		expect(prep(empty, 0).toolChoice).toBeUndefined();
	});
});

describe('sessionToRow', () => {
	it('returns null without a brandId', () => {
		const session = createHarnessSession({ agent: 'chat' });
		expect(sessionToRow(session)).toBeNull();
	});

	it('maps a finished session onto the persist row', () => {
		const session = createHarnessSession({
			brandId: '11111111-1111-1111-1111-111111111111',
			userId: '22222222-2222-2222-2222-222222222222',
			threadId: '33333333-3333-3333-3333-333333333333',
			agent: 'director',
			mode: 'kie',
			surface: 'batch',
			model: 'grok-4',
			provider: 'kie'
		});
		session.captureRequest({ system: 'Director', prompt: 'Review this batch' });
		session.finish('finished');
		const row = sessionToRow(session);
		expect(row).toMatchObject({
			brand_id: '11111111-1111-1111-1111-111111111111',
			agent: 'director',
			mode: 'kie',
			status: 'finished',
			system_prompt: 'Director'
		});
		expect(row?.transcript).toContain('--- prompt ---');
		expect(row?.transcript).toContain('Review this batch');
		expect(row?.event_count).toBeGreaterThan(0);
		expect(row?.finished_at).toBeTruthy();
	});
});
