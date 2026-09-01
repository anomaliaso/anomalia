import { describe, expect, it } from 'vitest';
import { kitPersonaOverlay, type CustomAgentPersona } from './custom-agent-persona';

const persona: CustomAgentPersona = {
	id: 'ca-1',
	name: 'Scriba di Rime',
	prompt: 'RISpondi SEMPRE in rima.',
	agent: 'content',
	color: 'amber',
	model: null
};

describe("kitPersonaOverlay — l'overlay persona che la coda e il percorso interattivo portano al bridge", () => {
	it('dice chi ha la macchina, dove legge la memoria e porta il brief montato', () => {
		const overlay = kitPersonaOverlay(persona, 'it');
		expect(overlay.id).toBe('ca-1');
		expect(overlay.memoryKey).toBe('custom:ca-1');
		expect(overlay.systemBlock).toContain('Scriba di Rime');
		expect(overlay.systemBlock).toContain('RISpondi SEMPRE in rima.');
	});
});
