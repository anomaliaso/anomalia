import { describe, expect, it } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { renderBrandStrategyFile } from './brand-file';
import { BRAND_FILE_PATHS, createFileTools } from './agent-files';
import { AGENTS, type AgentId } from './agents';

const BRAND_ID = 'b1';
const STRATEGY_PATH = 'brand/strategy.md';

const stub = { toolCallId: 't', messages: [] } as never;

function seed(over: Record<string, Record<string, unknown>[]> = {}) {
	return createTestSupabase({
		brand_strategy: [
			{
				brand_id: BRAND_ID,
				positioning: 'La bottega che mostra gli scarti',
				report: { summary: 'Nessun concorrente mostra il forno aperto.' },
				benchmark: {}
			}
		],
		editorial_plans: [
			{
				brand_id: BRAND_ID,
				status: 'active',
				strategy: 'Far vedere il lavoro, non il prodotto finito.',
				voice: { tone: 'artigiana e asciutta', dont: ['emoji'] },
				cadence: '3/week',
				platform_mix: { instagram: 2, linkedin: 1 },
				weeks: [
					{
						index: 0,
						week_start: '2026-08-24',
						theme: 'Il forno e i suoi errori',
						focus: 'Le cotture andate storte',
						content_mix: [{ type: 'carousel', count: 1 }],
						rationale: 'Il difetto prova la mano',
						brief: 'Settimana del lancio',
						products: ['Servizio Terra Cruda'],
						status: 'planned'
					},
					{ index: 1, week_start: null, theme: 'Chi impasta', focus: 'Ritratti', content_mix: [], rationale: '', brief: null, products: null, status: 'upcoming' }
				]
			},
			{ brand_id: BRAND_ID, status: 'superseded', strategy: 'IL PIANO VECCHIO', voice: {}, cadence: 'daily', platform_mix: {}, weeks: [] }
		],
		gtm_plans: [
			{
				id: 'g1',
				brand_id: BRAND_ID,
				status: 'active',
				horizon: '6m',
				objective: 'Duecento clienti in bottega',
				phases: [
					{ index: 0, name: 'Farsi vedere', objective: 'Riconoscibilità', rationale: 'Nessuno sa che esistiamo', duration_weeks: 8, start_date: '2026-07-01', end_date: '2026-08-31', platform_weights: [], pillars: [], goals: [] }
				]
			}
		],
		...over
	});
}

describe('brand/strategy.md — il piano che il kit poteva solo interrogare a tabelle nude', () => {
	it('porta positioning, ricerca, piano editoriale settimana per settimana col brief e i prodotti scelti, e piano GTM', async () => {
		const kit = seed();
		const doc = await renderBrandStrategyFile(kit.client, BRAND_ID);

		expect(doc).toContain('La bottega che mostra gli scarti');
		expect(doc).toContain('Nessun concorrente mostra il forno aperto.');
		expect(doc).toContain('Far vedere il lavoro, non il prodotto finito.');
		expect(doc).toContain('artigiana e asciutta');
		expect(doc).toContain('3/week');
		expect(doc).toContain('Il forno e i suoi errori');
		expect(doc).toContain('Chi impasta');
		expect(doc).toContain('Settimana del lancio');
		expect(doc).toContain('Servizio Terra Cruda');
		expect(doc).toContain('Duecento clienti in bottega');
		expect(doc).toContain('Farsi vedere');
	});

	it('il piano superato non entra: si serve solo quello attivo', async () => {
		const kit = seed();
		const doc = await renderBrandStrategyFile(kit.client, BRAND_ID);
		expect(doc).not.toContain('IL PIANO VECCHIO');
	});

	it('un brand senza strategia rende il vuoto, non un documento che sembra pieno', async () => {
		const kit = createTestSupabase({ brand_strategy: [], editorial_plans: [], gtm_plans: [] });
		expect(await renderBrandStrategyFile(kit.client, BRAND_ID)).toBe('');
	});
});

describe('brand/strategy.md — servito dall’albero a ogni mestiere', () => {
	const ids = Object.keys(AGENTS) as AgentId[];

	it('è un file del brand, quindi sta in BRAND_FILE_PATHS', () => {
		expect(BRAND_FILE_PATHS).toContain(STRATEGY_PATH);
	});

	it('read_file lo apre per ognuno dei mestieri, mai un «No such file»', async () => {
		for (const id of ids) {
			const kit = seed();
			const { read_file } = createFileTools(id, 'thread-1', { supabase: kit.client, brandId: BRAND_ID });
			const out = (await read_file.execute({ path: STRATEGY_PATH }, stub)) as { error?: string; content?: string };
			expect(out.error, id).toBeUndefined();
			expect(out.content, id).toContain('Duecento clienti in bottega');
		}
	});

	it('ls lo elenca fra le guide, così un mestiere sa che esiste senza indovinarlo', async () => {
		const kit = seed();
		const { ls } = createFileTools('analyst', 'thread-1', { supabase: kit.client, brandId: BRAND_ID });
		const out = (await ls.execute({ path: '' }, stub)) as { guides: string[] };
		expect(out.guides).toContain(STRATEGY_PATH);
	});

	it('senza brand context dice che non può leggerlo, non che non esiste', async () => {
		const { read_file } = createFileTools('analyst');
		const out = (await read_file.execute({ path: STRATEGY_PATH }, stub)) as { error?: string };
		expect(out.error).toContain('brand context');
	});
});
