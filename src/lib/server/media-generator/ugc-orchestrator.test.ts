import { describe, expect, it, vi } from 'vitest';
import type { UgcClipPlan } from './ugc-batch';

/**
 * LLM_* finto: geminiFast/IMAGE_AGENT_MODEL ora passano dal centralino e senza chiave+default
 * lanciano `llm_unconfigured` prima ancora di costruire i tool.
 */
const M = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));
M.env.LLM_API_KEY = 'test-key';
M.env.LLM_DEFAULT_MODEL = 'google/gemini-2.5-flash';

/**
 * Il giro completo dell'orchestratore UGC, guidato al posto del modello.
 *
 * L'harness è finto: invoca i tool nella sequenza che il difetto reale percorreva — resa fallita,
 * patch, ri-resa, patch di una clip GIÀ USCITA, ri-resa di quella — e verifica che ogni passo
 * risponda quello che i suoi stessi hint promettono. Prima di questa correzione: la fallita
 * tornava 'rendered', patch e render su una già-resa si rifiutavano a vicenda in cerchio, e la
 * guardia-a-parole di finish poteva murare il turno all'infinito.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Driver = (tools: Record<string, any>) => Promise<void>;
let drive: Driver = async () => {};

// Il finto modello sta su `generateText` dell'SDK, non sull'involucro: e` il confine che
// sopravvive all'uscita dell'orchestratore dal framework, quindi lo stesso test vale su
// entrambe le implementazioni.
vi.mock(import('ai'), async (importOriginal) => ({
	...(await importOriginal()),
	generateText: (async (opts: { tools: Record<string, unknown> }) => {
		await drive(opts.tools as Record<string, never>);
		return { steps: [1], text: 'done' };
	}) as never
}));

vi.mock(import('$lib/server/agent-base'), async (importOriginal) => ({
	...(await importOriginal()),
	createAgentBase: (async () => ({
		attach: <T,>(t: T) => t,
		promptBlock: '',
		guardFinish: async () => null,
		close: async () => {},
		reviewRuns: () => 1,
		reviewSkipped: () => false
	})) as never
}));

vi.mock(import('$lib/server/brand-context-tools'), async (importOriginal) => ({
	...(await importOriginal()),
	createBrandContextTools: (() => ({})) as never
}));

vi.mock(import('$lib/server/media-library-tools'), async (importOriginal) => ({
	...(await importOriginal()),
	createMediaLibraryTools: (() => ({})) as never
}));

// L'import sta qui e non dentro i test: valutare il grafo di ugc-agent richiede secondi, e dentro
// il test spunterebbe il timeout di default prima ancora della prima asserzione.
const { runUgcOrchestrator } = await import('./ugc-agent');

function plan(index: number): UgcClipPlan {
	return {
		index,
		product: null,
		model: null,
		script: { hook: `hook ${index}`, body: `body ${index}`, cta: `cta ${index}` },
		setting: 'kitchen',
		format: null,
		hookVisual: null
	} as unknown as UgcClipPlan;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (tools: Record<string, any>, name: string, input: Record<string, unknown> = {}) =>
	tools[name].execute(input, { toolCallId: 't', messages: [] });

describe('runUgcOrchestrator — fallimenti, retry e finish', () => {
	it('fallita ≠ resa, patch→re-render funziona sulle già-uscite, finish passa al secondo rifiuto', async () => {
		const finished = new Set<number>();
		const failed = new Map<number, string>();
		const plans = [plan(0), plan(1)];
		let renderShouldFail = true;
		const renderClip = async (p: UgcClipPlan) => {
			// Come runOneUgcClip: non lancia — scrive finished o failed (o niente = rinvio).
			if (renderShouldFail) failed.set(p.index, 'no cast portrait');
			else {
				finished.add(p.index);
				failed.delete(p.index);
			}
		};

		drive = async (tools) => {
			// 1. Una resa che fallisce deve dire 'failed' CON la ragione — non 'rendered'.
			const first = await call(tools, 'render_clip', { index: 0 });
			expect(first.outcome).toBe('failed');
			expect(first.reason).toBe('no cast portrait');

			// 2. read_plan la mostra fallita, non uscita.
			const seen = await call(tools, 'read_plan');
			expect(seen.clips[0].status).toBe('failed');
			expect(seen.clips[0].failure).toBe('no cast portrait');

			// 3. Una fallita si patcha e si ri-rende (prima already_rendered bloccava per sempre).
			const patched = await call(tools, 'patch_clip', { index: 0, hook: 'better hook', why: 'fix' });
			expect(patched.ok).toBe(true);
			renderShouldFail = false;
			const retry = await call(tools, 'render_clip', { index: 0 });
			expect(retry.outcome).toBe('rendered');

			// 4. Il cerchio patch/render sulle GIÀ USCITE: patch applica (con nota), il re-render
			//    è permesso dopo il patch, e rifiutato senza.
			const again = await call(tools, 'render_clip', { index: 0 });
			expect(again.error).toBe('already_rendered');
			const repatch = await call(tools, 'patch_clip', { index: 0, cta: 'new cta', why: 'cta wrong' });
			expect(repatch.ok).toBe(true);
			expect(repatch.note).toContain('re-render');
			const rerender = await call(tools, 'render_clip', { index: 0 });
			expect(rerender.outcome).toBe('rendered');
			// Consumato il patch: senza un altro patch il re-render torna a essere rifiutato.
			const blocked = await call(tools, 'render_clip', { index: 0 });
			expect(blocked.error).toBe('already_rendered');

			// 5. La guardia-a-parole di finish: primo rifiuto sì, secondo identico passa con avviso.
			const refused = await call(tools, 'finish', { summary: 'ho deciso di fermarmi qui' });
			expect(refused.error).toBe('clips_pending');
			const done = await call(tools, 'finish', { summary: 'ho deciso di fermarmi qui' });
			expect(done.ok).toBe(true);
			expect(done.warning).toContain('pending');
		};

		const outcome = await runUgcOrchestrator({
			supabase: {} as never,
			brandId: 'b1',
			userId: 'u1',
			brandName: 'Brand',
			plans,
			renderClip,
			finished,
			failed,
			concurrency: 2,
			locale: 'it'
		});
		expect(outcome.calledFinish).toBe(true);
		expect(outcome.rendered).toBe(1);
		expect(outcome.failedIndexes).toEqual([]);
	});

	it('un rinvio per deadline è "deferred", non un fallimento, e non consuma budget', async () => {
		const finished = new Set<number>();
		const failed = new Map<number, string>();
		drive = async (tools) => {
			// renderClip non tocca niente = runOneUgcClip che rientra per deadline.
			const res = await call(tools, 'render_clip', { index: 0 });
			expect(res.outcome).toBe('deferred');
			expect(res.hint).toContain('time');
			// Il budget non si consuma: la resa non è mai partita.
			const seen = await call(tools, 'read_plan');
			expect(seen.renders_left).toBe(1 + 4); // plans.length + UGC_AGENT_RENDER_HEADROOM
		};
		await runUgcOrchestrator({
			supabase: {} as never,
			brandId: 'b1',
			userId: 'u1',
			brandName: 'Brand',
			plans: [plan(0)],
			renderClip: async () => {},
			finished,
			failed,
			concurrency: 1,
			locale: 'it'
		});
	});
});
