import { describe, expect, it, vi } from 'vitest';
import { MAX_REVIEW_REFUSALS, createAgentBase } from './agent-base';
import { GROUNDING_BLOCK } from './chat/agents';

/**
 * DI CHI È LA MACCHINA.
 *
 * Il pannello mostra il computer dell'AGENTE (`?agent=`), ma il mount della sandbox non passava
 * nessun agente: i tool aprivano la VM del brand — un'altra macchina — e chi guardava lo schermo
 * dell'agente non vedeva niente di quello che stava succedendo.
 */
const sandboxMounts = vi.hoisted(() => [] as { agentId?: string }[]);
vi.mock('$lib/agent/tools/sandbox-tools', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/agent/tools/sandbox-tools')>();
	return {
		...actual,
		createSandboxTools: (opts: { agentId?: string }) => {
			sandboxMounts.push(opts);
			return { tools: {}, close: async () => {}, stats: () => ({}), secrets: () => [] };
		}
	};
});
vi.mock('$lib/server/sandbox', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/sandbox')>();
	return { ...actual, isSandboxConfigured: () => true };
});

/**
 * LA GUARDIA CHE NON DEVE DIVENTARE UN VICOLO CIECO.
 *
 * Questi test esistono per un difetto arrivato in produzione: la guardia della review rifiutava
 * `finish` finché una run `verify` non risultava girata, ma non aveva tetto e non guardava se una
 * delega fosse ancora possibile. A fine di un turno lungo non c'è più tempo per aprirne una, quindi
 * l'agente restava a chiamare `finish` e a essere rifiutato fino a bruciare gli step. Il turno
 * moriva senza consegnare e in galleria restavano video vuoti.
 *
 * La regola che questi test difendono: una guardia o si può soddisfare, o non si alza.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stub = {} as any;

function base(opts: { remainingMs?: () => number } = {}) {
	return createAgentBase({
		supabase: stub,
		brandId: 'b1',
		userId: 'u1',
		model: stub,
		defaultAgent: 'motion',
		surfaceWriteKeys: ['replace_source'],
		requireReview: true,
		sandbox: false,
		...opts
	});
}

describe('guardFinish — la review', () => {
	it('non si alza quando non c’è più tempo per una delega', async () => {
		// È il caso che ha rotto la produzione: chiedere una review quando non si può più farne una
		// è un vicolo cieco, perché l'agente non può né obbedire né finire.
		const b = await base({ remainingMs: () => 1_000 });
		expect(await b.guardFinish()).toBeNull();
		expect(b.reviewSkipped()).toBe(true);
	});

	it('lascia passare dopo un numero finito di rifiuti, non all’infinito', async () => {
		const b = await base({ remainingMs: () => 10 * 60_000 });
		for (let i = 0; i < MAX_REVIEW_REFUSALS; i++) {
			const r = await b.guardFinish();
			expect(r?.error, `rifiuto ${i + 1}`).toBe('review_missing');
		}
		// Il rifiuto successivo NON deve arrivare: sopra il tetto si consegna, dichiarandolo.
		expect(await b.guardFinish()).toBeNull();
		expect(b.reviewSkipped()).toBe(true);
	});

	it('dice quanti rifiuti restano, così il modello sa che è finita', async () => {
		const b = await base({ remainingMs: () => 10 * 60_000 });
		const first = await b.guardFinish();
		expect(first?.refusals_left).toBe(MAX_REVIEW_REFUSALS - 1);
	});

	it('il tetto è basso: due giri, non dieci', async () => {
		// Ogni rifiuto costa un passo del turno. Un tetto alto è lo stesso vicolo cieco, più lento.
		expect(MAX_REVIEW_REFUSALS).toBeGreaterThanOrEqual(1);
		expect(MAX_REVIEW_REFUSALS).toBeLessThanOrEqual(3);
	});

	it('senza requireReview non chiede niente e non dichiara niente', async () => {
		const b = await createAgentBase({
			supabase: stub,
			brandId: 'b1',
			userId: 'u1',
			model: stub,
			defaultAgent: 'motion',
			surfaceWriteKeys: [],
			sandbox: false
		});
		expect(await b.guardFinish()).toBeNull();
		expect(b.reviewSkipped()).toBe(false);
	});

	it('senza sotto-agenti montati non pretende una review', async () => {
		// Niente supabase/brandId/userId ⇒ niente delega: pretenderla sarebbe lo stesso vicolo cieco.
		const b = await createAgentBase({
			model: stub,
			defaultAgent: 'motion',
			surfaceWriteKeys: [],
			requireReview: true,
			sandbox: false
		});
		expect(await b.guardFinish()).toBeNull();
	});
});

describe('promptBlock', () => {
	it('porta sempre il grounding, anche senza thread, delega o macchina', async () => {
		// Non inventare non richiede un tool: è l'unica regola che non dipende da cosa è montato.
		const b = await createAgentBase({
			model: stub,
			defaultAgent: 'motion',
			surfaceWriteKeys: [],
			sandbox: false
		});
		expect(b.promptBlock).toMatch(/NEVER INVENT/);
		expect(b.promptBlock).toMatch(/SEARCHING TOO MUCH IS BETTER THAN NOT SEARCHING/);
	});

	it('la regola sta in un posto solo: è la stessa stringa della chat', async () => {
		// Scritta due volte divergerebbe al primo cambio, e la versione che diverge è sempre
		// quella che qualcuno legge.
		const b = await createAgentBase({
			model: stub,
			defaultAgent: 'motion',
			surfaceWriteKeys: [],
			sandbox: false
		});
		expect(b.promptBlock).toContain(GROUNDING_BLOCK);
	});
});

describe('di chi è la macchina', () => {
	it('monta la sandbox sul computer dell’agente, non su quello del brand', async () => {
		sandboxMounts.length = 0;
		await createAgentBase({
			supabase: stub,
			brandId: 'b1',
			userId: 'u1',
			model: stub,
			defaultAgent: 'motion',
			surfaceWriteKeys: []
		});
		expect(sandboxMounts).toHaveLength(1);
		expect(sandboxMounts[0].agentId).toBe('motion');
	});
});
