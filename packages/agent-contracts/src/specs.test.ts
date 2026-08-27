import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS_MAX } from './contracts';
import { SPECIALISTS, specById, modelPolicyForAgent } from './specs';

describe('specs — i cinque specialisti come dominio', () => {
	it('sono cinque, con gli stessi id della chat esistente (migrazione no-op)', () => {
		expect(SPECIALISTS.map((s) => s.id).sort()).toEqual([
			'analyst',
			'content',
			'motion',
			'ugc',
			'web'
		]);
	});

	it('ogni istruzione sta nel tetto e resta CORTA: il mestiere vive nei file how/, non qui', () => {
		for (const s of SPECIALISTS) {
			expect(s.instructions.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX);
			// Il tetto vero del contratto è 20k; il tetto di DISCIPLINA è 3k.
			// Chi lo sfora sta rimettendo il prompt-monolite dentro le istruzioni.
			expect(s.instructions.length, `${s.id}: istruzioni troppo lunghe`).toBeLessThanOrEqual(3000);
		}
	});

	it('ognuna nomina reply: parlare è un atto esplicito, non un default', () => {
		for (const s of SPECIALISTS) expect(s.instructions).toContain('reply');
	});

	it('ognuna nomina almeno un file da leggere prima di agire', () => {
		for (const s of SPECIALISTS) expect(s.instructions).toMatch(/`(how|brand|work|web)\//);
	});

	it('specById risolve e rifiuta', () => {
		expect(specById('motion')?.name).toBe('Motion Specialist');
		expect(specById('media')).toBeNull();
	});

	it('solo motion dichiara Grok; gli altri restano Luna (default prodotto)', () => {
		expect(modelPolicyForAgent('motion')).toEqual({ family: 'grok', thinking: 'high' });
		for (const id of ['content', 'ugc', 'web', 'analyst', null, 'auto', 'sconosciuto'] as const) {
			expect(modelPolicyForAgent(id), String(id)).toEqual({ family: 'luna', thinking: 'high' });
		}
	});
});
