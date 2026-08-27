import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Su mobile l'avatar a sinistra della bolla AI e il gutter da 38px rubano larghezza
 * senza dare identità (il volto è già in topbar). Questo file è l'unica fonte di quel
 * layout: se il media query sparisce o il gutter torna a 38px, le bolle AI si
 * restringono di nuovo.
 */
const css = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), 'chat-messages.css'),
	'utf8'
);

describe('chat messages — mobile senza avatar AI', () => {
	it('il gutter del volto è zero sotto i 768px, e il volto è spento', () => {
		const idx = css.indexOf('@media (max-width: 767px)');
		expect(idx).toBeGreaterThan(-1);
		const mobile = css.slice(idx);
		expect(mobile).toMatch(/\.chat-turn\s*\{[\s\S]*--chat-gutter:\s*0;/);
		expect(mobile).toMatch(/\.chat-turn-face\s*\{[\s\S]*display:\s*none;/);
	});

	it('desktop tiene ancora il gutter: il volto resta a sinistra delle bolle', () => {
		const beforeMobile = css.split('@media (max-width: 767px)')[0];
		expect(beforeMobile).toMatch(/--chat-gutter:\s*38px;/);
		expect(beforeMobile).toMatch(/\.chat-turn-face\s*\{/);
		expect(beforeMobile).not.toMatch(/\.chat-turn-face\s*\{[\s\S]*display:\s*none;/);
	});
});
