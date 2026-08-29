import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILTIN_TOOLS, TERMINAL_TOOL_NAMES } from './builtin';

describe('BUILTIN_TOOLS', () => {
	it('ha al massimo 14 tool', () => {
		expect(BUILTIN_TOOLS.length).toBeLessThanOrEqual(14);
	});

	it('ogni tool ha nome, descrizione non vuota e uno schema oggetto', () => {
		for (const tool of BUILTIN_TOOLS) {
			expect(tool.name).toMatch(/^[a-z_]+$/);
			expect(tool.description.length).toBeGreaterThan(0);
			expect(tool.inputSchema.type).toBe('object');
			expect(typeof tool.consequential).toBe('boolean');
		}
	});

	it('i nomi sono unici', () => {
		const names = BUILTIN_TOOLS.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('il catalogo non dichiara deleghe che nessuno esegue: il modello non deve vedere un tool fantasma', () => {
		expect(BUILTIN_TOOLS.map((t) => t.name)).not.toContain('run_subagent');
	});

	it('TERMINAL_TOOL_NAMES contiene reply e ask_user', () => {
		expect(TERMINAL_TOOL_NAMES).toContain('reply');
		expect(TERMINAL_TOOL_NAMES).toContain('ask_user');
	});

	it('reply e ask_user portano terminal: true sulla spec, e nessun altro tool lo porta', () => {
		const marked = BUILTIN_TOOLS.filter((t) => t.terminal).map((t) => t.name).sort();
		expect(marked).toEqual([...TERMINAL_TOOL_NAMES].sort());
	});

	it('il file resta sotto le 300 righe (il budget del catalogo dichiarativo)', () => {
		const path = fileURLToPath(new URL('./builtin.ts', import.meta.url));
		const lines = readFileSync(path, 'utf-8').split('\n').length;
		expect(lines).toBeLessThan(300);
	});
});
