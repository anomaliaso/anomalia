import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { brandSkills } from './brand-skills';

describe('brandSkills', () => {
	it('porta esattamente humanizer e stop-slop, entrambi MIT', () => {
		expect(brandSkills.map((s) => s.name).sort()).toEqual(['humanizer', 'stop-slop']);
	});

	it('ogni skill ha descrizione e contenuto pieni', () => {
		for (const skill of brandSkills) {
			expect(skill.description.trim().length).toBeGreaterThan(40);
			expect(skill.content.trim().length).toBeGreaterThan(1000);
		}
	});

	it('humanizer arriva intero fino alle sezioni finali, non troncato', () => {
		const humanizer = brandSkills.find((s) => s.name === 'humanizer');
		expect(humanizer?.content).toContain('Rewrite process');
		expect(humanizer?.content).toContain('How to return the result');
		expect(humanizer?.content).toContain('Wikipedia:Signs_of_AI_writing');
	});

	it('stop-slop porta i riferimenti come file allegati alla skill', () => {
		const stopSlop = brandSkills.find((s) => s.name === 'stop-slop');
		const paths = (stopSlop?.files ?? []).map((f) => f.path);
		expect(paths).toContain('references/phrases.md');
		expect(paths).toContain('references/structures.md');
		expect(paths).toContain('references/examples.md');
		for (const file of stopSlop?.files ?? []) {
			expect(file.content.trim().length).toBeGreaterThan(200);
		}
	});

	it('nessuna skill supera il tetto di 64KB che il loader impone ai file', () => {
		const MAX_TEXT_BYTES = 64 * 1024;
		for (const skill of brandSkills) {
			expect(Buffer.byteLength(skill.content)).toBeLessThan(MAX_TEXT_BYTES);
			for (const file of skill.files ?? []) {
				expect(Buffer.byteLength(file.content)).toBeLessThan(MAX_TEXT_BYTES);
			}
		}
	});

	it('startHarnessTurn cucina le skill di brand dentro HarnessAgent, sempre', () => {
		const src = readFileSync('src/lib/agent/bridge/adapters.ts', 'utf8');
		expect(src).toMatch(/\[\.\.\.brandSkills, \.\.\.\(await loadHarnessSkills\(skillSelection\)\)\]/);
		expect(src).toMatch(/skills\.length > 0 \? \{ skills \} : \{\}/);
	});
});
