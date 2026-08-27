import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * IL TEST-GUARDIA DEL PRINCIPIO — "le pagine devono essere gusci UI vuoti, che di loro non
 * fanno assolutamente nulla se non inviare le risposte degli utenti". Legge la pagina come
 * TESTO (non la esegue: qui non serve un DOM) e fallisce se ci trova dentro cose che solo il
 * service/store devono sapere: un fetch diretto, un parsing manuale della risposta, o la
 * priorità reply>testo (`source === 'text'`) che vive in turn.ts/store.svelte.ts.
 */
const pageSource = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf-8');

describe('agent-lab/+page.svelte — resta un guscio', () => {
	it('non chiama fetch direttamente', () => {
		expect(pageSource).not.toMatch(/fetch\(/);
	});

	it('non fa parsing manuale del JSON del contratto', () => {
		expect(pageSource).not.toMatch(/JSON\.parse/);
	});

	it('non reimplementa la priorità reply/testo del server', () => {
		expect(pageSource).not.toMatch(/source\s*===\s*['"]text['"]/);
	});
});
