import { describe, it, expect } from 'vitest';
import { AGENT_AVATAR_FACES, avatarBeatAt, type AvatarBeat } from '$lib/agent-avatars';

/**
 * Il ritmo dell'avatar vivo è la cosa che decide se il dettaglio è bello o fastidioso, ed è
 * anche l'unica parte pura: qui si pinna il RITMO, non il disegno. Il timer che chiama questa
 * funzione sta in AgentAvatar (`alive`), e reduced-motion lo spegne lì.
 */

/** Una sequenza di battiti come la produce il componente: ogni battito conosce il precedente. */
function run(seed: number, count: number, from = 0): AvatarBeat[] {
	const beats: AvatarBeat[] = [];
	let elapsed = from;
	let prev: AvatarBeat | null = null;
	for (let i = 0; i < count; i++) {
		const b = avatarBeatAt(i, seed, elapsed, prev);
		beats.push(b);
		prev = b;
		elapsed += b.holdMs;
	}
	return beats;
}

describe('avatarBeatAt — il ritmo dell attesa', () => {
	it('cambia sempre espressione: mai la stessa faccia due battiti di fila', () => {
		for (const seed of [1, 42, 999, 123456]) {
			const beats = run(seed, 40);
			for (let i = 1; i < beats.length; i++) expect(beats[i].face).not.toBe(beats[i - 1].face);
			for (const b of beats) expect(AGENT_AVATAR_FACES).toContain(b.face);
		}
	});

	it('le pause sono irregolari, non un intervallo fisso', () => {
		const holds = new Set(run(7, 30).map((b) => b.holdMs));
		expect(holds.size).toBeGreaterThan(6);
		for (const h of holds) {
			expect(h).toBeGreaterThanOrEqual(1200);
			expect(h).toBeLessThanOrEqual(4400);
		}
	});

	it('le pause non marciano in una direzione: niente scaletta', () => {
		// Il primo tentativo usava `hash()`, che è lineare (h*31 + c): con lo step che avanza di
		// uno, le pause salivano di ~60ms alla volta — 2642, 2704, 2766… In Playwright si vedeva
		// un ritmo prevedibile quanto un intervallo fisso. Qui si pinna il mescolamento.
		for (const seed of [3, 77, 1234]) {
			const holds = run(seed, 24, 12_000).map((b) => b.holdMs);
			let flips = 0;
			for (let i = 2; i < holds.length; i++) {
				const a = Math.sign(holds[i] - holds[i - 1]);
				const b = Math.sign(holds[i - 1] - holds[i - 2]);
				if (a !== 0 && b !== 0 && a !== b) flips++;
			}
			expect(flips).toBeGreaterThan(5);
		}
	});

	it('nei primi secondi guarda e basta: nessuna mossa grande', () => {
		for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
			// 9s di attesa, ~4 battiti al massimo con le pause della prima fase.
			for (const b of run(seed, 4)) {
				if (b.holdMs) expect(b.move).toBeNull();
			}
		}
	});

	it('mossa grande = rara, e mai due attaccate', () => {
		let moves = 0;
		let beats = 0;
		for (const seed of [11, 22, 33, 44, 55]) {
			// Si parte già dentro la fase "occupato", dove le mosse esistono.
			const seq = run(seed, 20, 12_000);
			for (let i = 0; i < seq.length; i++) {
				beats++;
				if (seq[i].move) {
					moves++;
					if (i > 0) expect(seq[i - 1].move).toBeNull();
				}
			}
		}
		expect(moves).toBeGreaterThan(0);
		// Piccole e frequenti, grandi e rare: meno di un battito su tre porta una mossa.
		expect(moves / beats).toBeLessThan(0.34);
	});

	it("l'attesa lunga cambia il repertorio: si annoia, con pause più lunghe", () => {
		const busy = run(5, 25, 12_000);
		const bored = run(5, 25, 90_000);
		const avg = (b: AvatarBeat[]) => b.reduce((s, x) => s + x.holdMs, 0) / b.length;
		expect(avg(bored)).toBeGreaterThan(avg(busy));
		// E le pose diventano quelle di chi aspetta da un pezzo.
		expect(bored.some((b) => b.face === 'sleepy' || b.face === 'squint')).toBe(true);
	});

	it('semi diversi = attese diverse (dopo tre turni non la sai a memoria)', () => {
		const a = run(1, 12).map((b) => `${b.face}:${b.move}:${b.holdMs}`).join('|');
		const b = run(2, 12).map((x) => `${x.face}:${x.move}:${x.holdMs}`).join('|');
		expect(a).not.toBe(b);
		// Ma lo stesso seme resta deterministico: i test non sono a caso.
		expect(run(1, 12).map((x) => x.face).join()).toBe(run(1, 12).map((x) => x.face).join());
	});
});
