import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');

describe('niente agenti annidati sul GTM di produzione', () => {
	it('proposeGtmDual non chiama runGtmStrategyAgent', () => {
		const src = readFileSync(join(root, 'lib/server/gtm.ts'), 'utf8');
		expect(src).not.toContain('runGtmStrategyAgent');
		expect(src).not.toMatch(/invokeGtmStrategyAgent/);
	});
});

// CHI GUIDA IL GIRO, un orchestratore per riga.
//
// `harness` = passa ancora da `harnessGenerateText`; `sdk` = guida `generateText` da sé e prende
// la traccia dai moduli foglia. Gli orchestratori escono dal framework uno per PR, e una tabella
// con una riga per file fa sì che due PR in parallelo tocchino righe diverse invece della stessa.
const LOOP_DRIVER: Record<string, 'harness' | 'sdk'> = {
	'image-agent.ts': 'sdk',
	'produce-agent.ts': 'sdk',
	'seo-agent.ts': 'sdk',
	'strategy-agent.ts': 'sdk',
	'week-planner-agent.ts': 'sdk'
};

const loopFiles = Object.keys(LOOP_DRIVER);

describe('batch loops: cap USD restano su generateText', () => {
	it.each(loopFiles)('%s ha un tetto e non è un HarnessAgent', (file) => {
		const src = readFileSync(join(root, `lib/server/${file}`), 'utf8');
		expect(src).not.toMatch(/new HarnessAgent\b/);
		expect(src.includes('PER_RUN_USD_CAP') || src.includes('deadlineMs') || src.includes('deadlineReached')).toBe(
			true
		);
	});

	it.each(loopFiles.filter((f) => LOOP_DRIVER[f] === 'harness'))(
		'%s passa ancora da harnessGenerateText',
		(file) => {
			const src = readFileSync(join(root, `lib/server/${file}`), 'utf8');
			expect(src).toContain('harnessGenerateText');
		}
	);

	// `harness/index` riesporta `harness/run`, che importa `chat/model` e `chat/controller`: chi
	// prende la traccia dall'indice si porta dentro la chat e `$lib/agent` senza usarli. I moduli
	// foglia non li toccano, e questo test è l'unica cosa che impedisce di «riordinare» l'import.
	it.each(loopFiles.filter((f) => LOOP_DRIVER[f] === 'sdk'))(
		'%s guida l\'SDK e prende la traccia dai moduli foglia',
		(file) => {
			const src = readFileSync(join(root, `lib/server/${file}`), 'utf8');
			expect(src).toMatch(/await generateText\(/);
			expect(src).not.toContain('harnessGenerateText(');
			expect(src).not.toMatch(/from '\$lib\/server\/harness'/);
			expect(src).toMatch(/from '\$lib\/server\/harness\/session'/);
			expect(src).toMatch(/from '\$lib\/server\/harness\/persist'/);
		}
	);

	it.each(['session.ts', 'persist.ts', 'pipeline.ts', 'steward.ts'])(
		'harness/%s non importa la chat né $lib/agent',
		(file) => {
			const src = readFileSync(join(root, `lib/server/harness/${file}`), 'utf8');
			expect(src).not.toMatch(/from '\$lib\/server\/chat\//);
			expect(src).not.toMatch(/from '\$lib\/agent\//);
		}
	);
});

describe('autopilot: tick accoda, HTTP week planner resta a 200s', () => {
	it('il tick non chiama planWeekStrategy né runAutopilotForBrand in-process', () => {
		const src = readFileSync(join(root, 'routes/api/v1/autopilot/tick/+server.ts'), 'utf8');
		expect(src).toContain("tool_name: 'run_autopilot'");
		expect(src).not.toContain('runAutopilotForBrand(');
		expect(src).not.toContain('planWeekStrategy');
	});

	it('il week planner di default ha 200s', () => {
		const src = readFileSync(join(root, 'lib/server/week-planner-agent.ts'), 'utf8');
		expect(src).toMatch(/opts\.deadlineMs \?\? 200_000/);
	});
});
