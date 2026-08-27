import { describe, expect, it } from 'vitest';
import { createHarnessSession } from './session';
import { attachHarness } from './run';
import { wrapTools } from './pipeline';
import {
	evaluateSteward,
	stewardWouldBlock,
	formatStewardPatch,
	createSessionSteward,
	resultLooksFailed,
	type StewardSnapshot
} from './steward';

function snap(over: Partial<StewardSnapshot>): StewardSnapshot {
	return {
		agent: 'produce',
		tools: ['read_brand_studio', 'search_web', 'finish'],
		calls: [],
		results: [],
		step: 0,
		...over
	};
}

describe('evaluateSteward', () => {
	it('is silent at the start when there is no paid search tool', () => {
		expect(evaluateSteward(snap({ tools: ['read_brand_studio', 'finish'] }))).toEqual([]);
	});

	it('tells grounding agents to read the brand before search, before any tool runs', () => {
		const notes = evaluateSteward(snap({}));
		expect(notes.some((n) => n.code === 'read_brand_first')).toBe(true);
		expect(notes[0]?.text).toMatch(/instruction, not an outage/i);
		expect(notes[0]?.text).toMatch(/do not retry/i);
		expect(notes[0]?.text).toContain('read_brand_studio');
	});

	it('warns after two steps with no brand read on grounding agents', () => {
		const notes = evaluateSteward(snap({ step: 2, calls: ['search_web'] }));
		expect(notes.some((n) => n.code === 'missing_brand')).toBe(true);
	});

	it('does not nag chat to read studio (brand is already in the system prompt)', () => {
		const notes = evaluateSteward(
			snap({ agent: 'chat', tools: ['read_brand_kit', 'search_web'], step: 4, calls: ['search_web'] })
		);
		expect(notes.some((n) => n.code === 'missing_brand')).toBe(false);
	});

	it('warns when the same tool is called three times in a row', () => {
		const notes = evaluateSteward(
			snap({ calls: ['search_web', 'search_web', 'search_web'], step: 3 })
		);
		expect(notes.some((n) => n.code === 'repeat_tool')).toBe(true);
	});

	it('warns after a tool error', () => {
		const notes = evaluateSteward(
			snap({
				results: [{ name: 'search_web', failed: true, error: 'rate limited' }]
			})
		);
		expect(notes.some((n) => n.code === 'tool_error')).toBe(true);
	});
});

describe('stewardWouldBlock', () => {
	it('blocks paid search until a grounding agent has read the brand', () => {
		const block = stewardWouldBlock(snap({}), 'search_web');
		expect(block?.code).toBe('search_before_brand');
	});

	it('allows search after read_brand_studio', () => {
		expect(stewardWouldBlock(snap({ calls: ['read_brand_studio'] }), 'search_web')).toBeNull();
	});

	it('never blocks finish', () => {
		expect(stewardWouldBlock(snap({}), 'finish')).toBeNull();
	});

	it('does not block chat search_web', () => {
		expect(
			stewardWouldBlock(
				snap({ agent: 'chat', tools: ['read_brand_kit', 'search_web'] }),
				'search_web'
			)
		).toBeNull();
	});

	it('blocks a third retry of a tool that failed twice', () => {
		const block = stewardWouldBlock(
			snap({
				results: [
					{ name: 'search_web', failed: true, error: 'timeout' },
					{ name: 'search_web', failed: true, error: 'timeout' }
				],
				calls: ['read_brand_studio']
			}),
			'search_web'
		);
		expect(block?.code).toBe('error_retry');
	});

	it('does not gate seo, director, or image — brand is already in those prompts', () => {
		for (const agent of ['seo', 'director', 'image', 'analytics_review', 'chat_editor']) {
			expect(
				stewardWouldBlock(
					snap({ agent, tools: ['read_brand_studio', 'search_web', 'render_image'] }),
					'search_web'
				)
			).toBeNull();
			expect(
				evaluateSteward(
					snap({
						agent,
						tools: ['read_brand_studio', 'search_web'],
						step: 4,
						calls: ['search_web']
					})
				).some((n) => n.code === 'missing_brand')
			).toBe(false);
		}
	});

	it('never blocks render_image or finish even on a grounding agent', () => {
		expect(stewardWouldBlock(snap({}), 'render_image')).toBeNull();
		expect(stewardWouldBlock(snap({}), 'generate_image')).toBeNull();
		expect(stewardWouldBlock(snap({}), 'submit_batch')).toBeNull();
	});

	it('does not treat a search_before_brand deny as a tool outage', () => {
		const block = stewardWouldBlock(snap({}), 'search_web');
		expect(block?.text).toMatch(/DID NOT RUN/);
		expect(block?.text).toMatch(/not a search_web error/i);
		expect(block?.text).toMatch(/Required next tool: read_brand_studio/);
		const denied = {
			ok: false,
			ran: false,
			blocked_by: 'steward' as const,
			code: 'search_before_brand',
			instruction: block!.text
		};
		expect(resultLooksFailed(denied, true)).toBe(false);
	});
});

describe('session steward on the harness', () => {
	it('denies search_web until produce reads the brand, then allows it', async () => {
		const session = createHarnessSession({ agent: 'produce', brandId: 'b' });
		const tools = wrapTools(
			session,
			{
				read_brand_studio: { execute: async () => ({ ok: true, name: 'Acme' }) },
				search_web: { execute: async () => ({ answer: 'ok' }) }
			},
			createSessionSteward(session, ['read_brand_studio', 'search_web']).pipeline()
		);
		const denied = await tools.search_web.execute({ query: 'x' }, {});
		expect(denied).toMatchObject({
			ok: false,
			ran: false,
			blocked_by: 'steward',
			code: 'search_before_brand',
			tool: 'search_web',
			next_tool: 'read_brand_studio',
			do_not_retry: true
		});
		expect(denied).not.toHaveProperty('error');
		expect(String((denied as { instruction: string }).instruction)).toMatch(/DID NOT RUN/);
		expect(String((denied as { instruction: string }).instruction)).toMatch(
			/Do not call search_web/
		);
		expect(resultLooksFailed(denied, true)).toBe(false);
		expect(session.events.some((e) => e.type === 'steward')).toBe(true);

		await tools.read_brand_studio.execute({}, {});
		const allowed = await tools.search_web.execute({ query: 'x' }, {});
		expect(allowed).toEqual({ answer: 'ok' });
	});

	it('does not escalate two blocked searches into error_retry', async () => {
		const session = createHarnessSession({ agent: 'produce', brandId: 'b' });
		const steward = createSessionSteward(session, ['read_brand_studio', 'search_web']);
		const tools = wrapTools(
			session,
			{
				read_brand_studio: { execute: async () => ({ ok: true }) },
				search_web: { execute: async () => ({ answer: 'ok' }) }
			},
			steward.pipeline()
		);
		await tools.search_web.execute({ query: 'x' }, {});
		const second = await tools.search_web.execute({ query: 'x' }, {});
		expect(second).toMatchObject({ code: 'search_before_brand', next_tool: 'read_brand_studio' });
		expect(steward.wouldBlock('search_web')?.code).toBe('search_before_brand');
	});

	it('appends [steward] to prepareStep without dropping the caller system', () => {
		const session = createHarnessSession({ agent: 'produce', brandId: 'b' });
		session.recordToolCall('search_web', { query: 'x' });
		session.recordStep({ toolCalls: [{ toolName: 'search_web' }] });
		session.recordStep({ toolCalls: [{ toolName: 'search_web' }] });
		const instrumented = attachHarness(session, {
			system: 'base',
			tools: {
				read_brand_studio: { execute: async () => ({}) },
				search_web: { execute: async () => ({}) }
			},
			prepareStep: () => ({ system: 'base\n[budget] 1' })
		});
		const prepared = instrumented.prepareStep({});
		expect(prepared.system).toContain('base\n[budget] 1');
		expect(prepared.system).toContain('[steward]');
		expect(prepared.system).toContain('missing_brand');
		expect(formatStewardPatch([{ level: 'warn', code: 'missing_brand', text: 'x' }])).toContain(
			'[steward]'
		);
	});

	it('leaves prepareStep untouched when there is nothing to say', () => {
		const session = createHarnessSession({ agent: 'produce', brandId: 'b' });
		const original = { system: 'PRODUCT FIDELITY — keep this' };
		const instrumented = attachHarness(session, {
			system: 'PRODUCT FIDELITY — keep this',
			messages: [{ role: 'user', content: 'go' }],
			prepareStep: () => original,
			onStepFinish: () => {}
		});
		expect(instrumented.prepareStep({})).toBe(original);
	});

	it('does not deny search when steward is opted out', async () => {
		const session = createHarnessSession({ agent: 'produce', brandId: 'b', steward: false });
		const instrumented = attachHarness(session, {
			tools: {
				search_web: { execute: async () => ({ answer: 'ok' }) }
			}
		});
		const out = await instrumented.tools.search_web.execute({ query: 'x' }, {});
		expect(out).toEqual({ answer: 'ok' });
		expect(session.events.some((e) => e.type === 'steward')).toBe(false);
	});

	it('renders steward notes in the transcript', () => {
		const session = createHarnessSession({ agent: 'produce', brandId: 'b' });
		session.recordSteward([
			{ level: 'block', code: 'search_before_brand', text: 'Read the brand first.' }
		]);
		expect(session.transcript()).toContain('--- steward ---');
		expect(session.transcript()).toContain('block search_before_brand');
	});
});

describe('i tool bloccati spariscono dal tavolo (activeTools)', () => {
	it('un tool fallito due volte non è più tra gli activeTools dello step dopo', () => {
		const session = createHarnessSession({ agent: 'chat', brandId: 'b' });
		session.recordToolResult('publish_post', { error: 'boom' }, 5, true);
		session.recordToolResult('publish_post', { error: 'boom' }, 5, true);
		const instrumented = attachHarness(session, {
			system: 'base',
			tools: {
				publish_post: { execute: async () => ({}) },
				read_brand_kit: { execute: async () => ({}) },
				finish: { execute: async () => ({}) }
			},
			prepareStep: () => ({})
		});
		const prepared = instrumented.prepareStep({ stepNumber: 3 });
		expect(prepared.activeTools).toEqual(['read_brand_kit', 'finish']);
		expect(prepared.system).toContain('[steward]');
		expect(prepared.system).toContain('publish_post');
	});

	it('la ricerca a pagamento non è sul tavolo finché il brand non è letto, poi torna', () => {
		const session = createHarnessSession({ agent: 'produce', brandId: 'b' });
		const instrumented = attachHarness(session, {
			system: 'base',
			tools: {
				read_brand_studio: { execute: async () => ({}) },
				search_web: { execute: async () => ({}) },
				finish: { execute: async () => ({}) }
			},
			prepareStep: () => ({})
		});
		const before = instrumented.prepareStep({ stepNumber: 1 });
		expect(before.activeTools).toEqual(['read_brand_studio', 'finish']);
		session.recordToolCall('read_brand_studio', {});
		session.recordToolResult('read_brand_studio', { ok: true }, 5, true);
		const after = instrumented.prepareStep({ stepNumber: 2 });
		expect(after.activeTools).toBeUndefined();
	});

	it('un activeTools già deciso dal chiamante non viene toccato', () => {
		const session = createHarnessSession({ agent: 'chat', brandId: 'b' });
		session.recordToolResult('publish_post', { error: 'boom' }, 5, true);
		session.recordToolResult('publish_post', { error: 'boom' }, 5, true);
		const instrumented = attachHarness(session, {
			system: 'base',
			tools: {
				publish_post: { execute: async () => ({}) },
				finish: { execute: async () => ({}) }
			},
			prepareStep: () => ({ activeTools: ['publish_post'] })
		});
		const prepared = instrumented.prepareStep({ stepNumber: 3 });
		expect(prepared.activeTools).toEqual(['publish_post']);
	});

	it('senza blocchi non compare nessun activeTools', () => {
		const session = createHarnessSession({ agent: 'chat', brandId: 'b' });
		const instrumented = attachHarness(session, {
			system: 'base',
			tools: { read_brand_kit: { execute: async () => ({}) } },
			messages: [{ role: 'user', content: 'ciao' }],
			prepareStep: () => ({})
		});
		const prepared = instrumented.prepareStep({ stepNumber: 1 });
		expect(prepared.activeTools).toBeUndefined();
	});
});
