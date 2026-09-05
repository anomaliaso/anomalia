import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il roster della GEO e la differenza fra «non ha citato» e «non ha risposto».
 *
 * I sei motori sono gli assistenti che la gente interroga davvero, e sono esattamente quelli che
 * sul gateway hanno una ricerca web vera. Ogni riga qui sotto è stata MISURATA prima di essere
 * cablata: v. il changelog interno per la tabella (citazioni, costo, id del modello).
 */
const M = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>,
	llmText: vi.fn(async (_o: { model?: string; webSearch?: string; prompt: string }) => ({
		text: 'Acme is a good option, alongside Globex.',
		citations: [{ uri: 'https://acme.com/blog', title: 'Acme' }]
	})),
	exaGroundedAnswer: vi.fn(async () => ({ text: 'Acme leads.', citations: [{ uri: 'https://acme.com', title: 'a' }] })),
	structured: vi.fn(async () => ({ brandMentioned: true, rank: 1, competitors: ['Globex'] }))
}));

vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('$lib/server/llm', async () => ({
	...(await vi.importActual<typeof import('$lib/server/llm')>('$lib/server/llm')),
	llmText: M.llmText
}));
vi.mock('./research', () => ({
	genaiClient: () => null,
	groundedGemini: vi.fn(),
	structured: M.structured
}));
vi.mock('./exa', () => ({ exaConfigured: () => true, exaGroundedAnswer: M.exaGroundedAnswer }));
vi.mock('./ai-log', async () => ({
	...(await vi.importActual<typeof import('./ai-log')>('./ai-log')),
	withBrandContext: <T>(_b: string, fn: () => T) => fn(),
	requireBrandContext: () => 'brand-1'
}));

const { citationEngines, measuredCitationEngines, runCitationAudit } = await import('./geo');

const PROMPTS = [{ prompt: 'best tools for X', lang: 'en' }];

describe('il roster dei motori di citazione', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const k of Object.keys(M.env)) delete M.env[k];
	});

	it('è sei: i cinque con ricerca vera sul gateway, più Exa', () => {
		expect(citationEngines()).toEqual(['gemini', 'gpt', 'grok', 'claude', 'perplexity', 'exa']);
	});

	it('non contiene più DeepSeek né Bing', () => {
		expect(citationEngines()).not.toContain('deepseek');
		expect(citationEngines()).not.toContain('bing');
	});

	it('i motori misurati restano allineati al roster', () => {
		expect(measuredCitationEngines()).toEqual(citationEngines());
	});

	/**
	 * Perplexity cerca da sé e col plugin `web` risponde 404. Gli altri quattro vanno istruiti a
	 * cercare. Se qualcuno inverte una riga della tabella, la sonda smette di cercare in silenzio —
	 * risponde bene, a memoria, e la misura non se ne accorge.
	 */
	it('istruisce a cercare i quattro nativi, e lascia cercare Perplexity da sé', async () => {
		await runCitationAudit('Acme', PROMPTS, { samplesPerPrompt: 1 });
		const byModel = new Map(M.llmText.mock.calls.map(([o]) => [o.model, o.webSearch]));
		expect(byModel.get('perplexity/sonar')).toBe('built-in');
		for (const [model, mode] of byModel) {
			if (model !== 'perplexity/sonar') expect(mode).toBe('native');
		}
	});
});

/**
 * OpenAI entra nel roster SAPENDO che due risposte su tre non citano niente (misurato: 0, 0, 2
 * annotazioni su tre prompt reali). Quella è una risposta valida senza fonti, non una sonda
 * fallita, e le due cose NON devono finire nello stesso secchio: una sonda fallita esce dal
 * conteggio, una risposta senza fonti ci resta e vale zero solo sul dominio citato. Confonderle
 * trasformerebbe il guasto di un provider in un voto più basso per il brand.
 */
describe('un motore che non cita non è un motore che non ha risposto', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const k of Object.keys(M.env)) delete M.env[k];
	});

	it('conta la risposta senza fonti, e la esclude solo dal dominio citato', async () => {
		M.llmText.mockImplementation(async () => ({ text: 'Acme is the one to beat.', citations: [] }));
		const audit = await runCitationAudit('Acme', PROMPTS, { samplesPerPrompt: 1, brandDomain: 'acme.com' });

		const noSources = audit.results.filter((r) => r.engine !== 'exa');
		expect(noSources.every((r) => r.error === null)).toBe(true);
		expect(noSources.every((r) => r.sources.length === 0)).toBe(true);
		expect(audit.shareOfVoice).toBe(100);
		// Solo Exa ha citato il dominio: 1 risposta su 6.
		expect(audit.domainCitedShare).toBe(17);
	});

	it('una sonda fallita esce dal conteggio invece di valere «non citato»', async () => {
		M.llmText.mockRejectedValue(new Error('gateway down'));
		const audit = await runCitationAudit('Acme', PROMPTS, { samplesPerPrompt: 1, brandDomain: 'acme.com' });

		const failed = audit.results.filter((r) => r.engine !== 'exa');
		expect(failed.every((r) => !!r.error)).toBe(true);
		// Exa ha risposto e ha citato il brand: la share è 100, non 17.
		expect(audit.shareOfVoice).toBe(100);
	});
});
