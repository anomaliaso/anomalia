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

describe('batch loops: cap USD restano su generateText', () => {
	it.each(['image-agent.ts', 'strategy-agent.ts', 'week-planner-agent.ts', 'produce-agent.ts'])(
		'%s usa harnessGenerateText e PER_RUN o deadline, non new HarnessAgent',
		(file) => {
			const src = readFileSync(join(root, `lib/server/${file}`), 'utf8');
			expect(src).toContain('harnessGenerateText');
			expect(src).not.toMatch(/new HarnessAgent\b/);
			expect(src.includes('PER_RUN_USD_CAP') || src.includes('deadlineMs') || src.includes('deadlineReached')).toBe(
				true
			);
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
