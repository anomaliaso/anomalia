import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { brandSkills, skillsForAgent } from './brand-skills';

const WRITING = ['humanizer', 'stop-slop'];

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
});

describe('skillsForAgent — ogni agente ha le sue skill', () => {
	it('i prose-writer (content, ugc, web, analyst, auto) ricevono le due skill di scrittura', async () => {
		for (const agentId of ['content', 'ugc', 'web', 'analyst', 'auto']) {
			const names = (await skillsForAgent(agentId)).map((s) => s.name).sort();
			expect(names, agentId).toEqual(WRITING);
		}
	});

	it('il Motion riceve anche la skill Remotion presa dal repo', async () => {
		const names = (await skillsForAgent('motion')).map((s) => s.name).sort();
		expect(names).toEqual([...WRITING, 'remotion-best-practices'].sort());
		const remotion = (await skillsForAgent('motion')).find((s) => s.name === 'remotion-best-practices');
		expect(remotion?.content).toContain('Remotion');
	});

	it('senza agente noto non lascia il turno a mani vuote: cadono le skill di scrittura', async () => {
		for (const agentId of [undefined, null, 'chimera']) {
			const names = (await skillsForAgent(agentId as string | undefined)).map((s) => s.name).sort();
			expect(names).toEqual(WRITING);
		}
	});

	it('startHarnessTurn cucina le skill PER AGENTE dentro HarnessAgent', () => {
		const src = readFileSync('src/lib/agent/bridge/adapters.ts', 'utf8');
		expect(src).toMatch(/skillsForAgent\(opts\.agentId\)/);
		expect(src).toMatch(/skills\.length > 0 \? \{ skills \} : \{\}/);
	});

	it('il bridge porta l’identità dell’agente fino a startHarnessTurn', () => {
		const src = readFileSync('src/lib/agent/bridge/live.ts', 'utf8');
		expect(src).toMatch(/agentId:\s*spec\.id/);
	});
});
