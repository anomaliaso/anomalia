import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Le due difese di render_stills, esercitate con una VM finta.
 *
 * 1. `toModelOutput` IDEMPOTENTE (sonda del 2026-08-21, vedi reference-tools.ts:30-41): con
 *    streamText l'SDK lo chiama più volte per lo stesso toolCallId — il vecchio `pending.delete`
 *    dava i PNG alla copia che nessuno spedisce e il JSON al modello: ogni render pagava una VM e
 *    il modello giudicava alla cieca.
 * 2. RIMBORSO sul lancio: una sandbox che esplode non è un render che il modello ha usato — ma
 *    `attempts` non si rimborsa mai, o il rimborso diventerebbe retry infiniti.
 * 3. I fotogrammi si pubblicano come artefatti della chat quando c'è un thread.
 */

let sandboxBehaviour: 'ok' | 'throw' = 'ok';
let lastSandboxOpts: Record<string, unknown> | null = null;

function fakeHandle() {
	return {
		run: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
		read: async () => 'not-the-desired-package-json',
		write: async () => {},
		readBuffer: async () => Buffer.from('png-bytes'),
		release: async () => {}
	};
}

vi.mock(import('$lib/server/sandbox'), async (importOriginal) => ({
	...(await importOriginal()),
	isSandboxConfigured: (() => true) as never,
	openBrandSandbox: (async (opts: Record<string, unknown>) => {
		lastSandboxOpts = opts;
		if (sandboxBehaviour === 'throw') throw new Error('VM did not boot');
		return fakeHandle();
	}) as never
}));

vi.mock(import('$lib/server/sandbox-credits'), async (importOriginal) => ({
	...(await importOriginal()),
	withSandboxBilling: (async (_opts: unknown, fn: () => Promise<unknown>) => fn()) as never
}));

const publishMotionStillArtifacts = vi.fn(async () => []);
vi.mock('./still-artifacts', () => ({ publishMotionStillArtifacts }));

async function makeTools(extra: Record<string, unknown> = {}) {
	const { createMotionRenderTools } = await import('./render-tools');
	return createMotionRenderTools({
		brandId: 'b1',
		resolveTarget: () => ({
			id: 'v1',
			title: 'Test video',
			source: 'export const fps = 30;\nexport const durationInFrames = 90;',
			fps: 30,
			durationInFrames: 90
		}),
		...extra
	});
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (tools: any, input: Record<string, unknown>, id = 'call-1') =>
	tools.render_stills.execute(input, { toolCallId: id, messages: [] });

describe('render_stills', () => {
	beforeEach(() => {
		publishMotionStillArtifacts.mockReset().mockResolvedValue([]);
	});

	it('toModelOutput è idempotente: i frame arrivano a OGNI chiamata, non solo alla prima', async () => {
		sandboxBehaviour = 'ok';
		const tools = await makeTools();
		const res = await exec(tools, { at_seconds: [1] }, 'call-frames');
		expect(res.attached).toBe('frames');

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const toModelOutput = (tools.render_stills as any).toModelOutput;
		const first = toModelOutput({ toolCallId: 'call-frames', output: res });
		const second = toModelOutput({ toolCallId: 'call-frames', output: res });
		// Prima della correzione: first='content', second='json' — e second era quello sul filo.
		expect(first.type).toBe('content');
		expect(second.type).toBe('content');
	});

	/**
	 * Remotion lancia chrome-headless-shell, e senza `needsBrowser` la VM nasce sull'immagine
	 * di default senza le librerie di sistema di Chromium: ogni render moriva con
	 * `libnspr4.so: cannot open shared object file`, che l'agente leggeva come «VM chiusa».
	 */
	it('chiede la VM col browser provisionato: senza le .so di Chromium Remotion non parte', async () => {
		sandboxBehaviour = 'ok';
		lastSandboxOpts = null;
		const tools = await makeTools();
		await exec(tools, { at_seconds: [1] }, 'call-browser');
		expect(lastSandboxOpts?.needsBrowser).toBe(true);
	});

	it('un lancio della VM rimborsa il budget, e `attempts` ferma i retry infiniti', async () => {
		sandboxBehaviour = 'throw';
		const { MAX_RENDERS_PER_TURN } = await import('./render-tools');
		const tools = await makeTools();

		// Ogni fallimento viene rimborsato: nessuno dei primi 2×MAX ritorna budget_spent.
		for (let i = 0; i < MAX_RENDERS_PER_TURN * 2; i++) {
			const res = await exec(tools, {}, `fail-${i}`);
			expect(res.error).toBe('render_failed');
			expect(res.detail).toContain('VM did not boot');
		}
		// Ma i tentativi no: al tetto, basta.
		const capped = await exec(tools, {}, 'fail-final');
		expect(capped.error).toBe('render_budget_spent');
	});

	it('con un thread i fotogrammi si pubblicano come artefatti della chat', async () => {
		sandboxBehaviour = 'ok';
		publishMotionStillArtifacts.mockResolvedValue([
			{
				id: 'a1',
				title: 'Test video · frame 30',
				file_name: 'still-f30.png',
				kind: 'image',
				bytes: 9,
				url: 'https://cdn.test/still-f30.png'
			}
		]);
		const tools = await makeTools({ userId: 'u1', threadId: 't1', supabase: {} });
		const res = await exec(tools, { at_seconds: [1] }, 'call-chat');
		expect(publishMotionStillArtifacts).toHaveBeenCalledTimes(1);
		expect(publishMotionStillArtifacts.mock.calls[0][0]).toMatchObject({
			brandId: 'b1',
			userId: 'u1',
			threadId: 't1',
			toolCallId: 'call-chat',
			title: 'Test video'
		});
		expect(res.shown_in_chat).toBe(true);
		expect(res.artifacts).toEqual([
			{ id: 'a1', url: 'https://cdn.test/still-f30.png', title: 'Test video · frame 30' }
		]);
		expect(res.media).toEqual([{ url: 'https://cdn.test/still-f30.png', caption: 'Test video · frame 30' }]);
	});
});
