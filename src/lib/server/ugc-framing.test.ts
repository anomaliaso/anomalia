import { describe, expect, it } from 'vitest';
import {
	UGC_FRAMING_DIRECTION,
	UGC_SHOT_FRAMINGS,
	defaultUgcFramings,
	formatSeedanceUgcBlocks,
	isUgcShotFraming,
	type UgcShotBrief
} from './ugc';
import { formatIsMultiScene, ugcFormatById } from '$lib/ugc-formats';

/**
 * L'inquadratura per shot: la differenza fra un montaggio e un talking head fisso tagliato a pezzi.
 *
 * `CAMERA:` è una riga per tutta la clip. Finché era l'unica cosa a dire come si gira, gli shot di
 * un formato multi-scena cambiavano COSA succede e mai COME è ripreso — che è esattamente ciò che
 * un montaggio non è.
 */
function brief(format: string | null, beats: number, framings?: Array<string | null>): UgcShotBrief {
	return {
		subject: 'Sara, 30, in cucina',
		camera: 'handheld phone, arm’s length',
		audio: 'phone mic',
		behavioralBeats: ['glance away', 'shrug'],
		format: format as never,
		timeline: Array.from({ length: beats }, (_, i) => ({
			start: i * 2,
			end: i * 2 + 2,
			action: `azione ${i + 1}`,
			framing: (framings?.[i] ?? null) as never
		}))
	};
}

/**
 * `unboxing` è multi-scena, `testimonial` è ripresa unica — la coppia su cui poggia la suite.
 *
 * Vanno verificati, non assunti: la prima versione di questo file usava `talking_head`, che NON
 * esiste in `ugc-formats.ts`. Il test passava lo stesso, perché `formatIsMultiScene` di un id
 * sconosciuto è false — cioè passava per il motivo sbagliato, che è il modo in cui un test smette
 * di proteggere qualcosa senza diventare rosso.
 */
const MULTI = 'unboxing';
const SINGLE = 'testimonial';

describe('defaultUgcFramings', () => {
	it('alterna invece di ripetere', () => {
		// Due shot di fila nello stesso campo si leggono come un jump cut, cioè come un errore.
		const f = defaultUgcFramings(6);
		for (let i = 1; i < f.length; i++) expect(f[i], `shot ${i}`).not.toBe(f[i - 1]);
	});

	it('apre sul campo medio, che è quello in cui si parla', () => {
		expect(defaultUgcFramings(1)[0]).toBe('medium');
	});

	it('regge qualsiasi numero di shot senza uscire dal vocabolario', () => {
		for (const f of defaultUgcFramings(20)) expect(UGC_SHOT_FRAMINGS).toContain(f);
		expect(defaultUgcFramings(0)).toEqual([]);
	});
});

describe('isUgcShotFraming', () => {
	it('accetta solo i campi che una clip col telefono può avere', () => {
		expect(isUgcShotFraming('insert')).toBe(true);
		// Niente vocabolario da troupe: un dolly non è una cosa che una persona sola ottiene.
		expect(isUgcShotFraming('dolly-in')).toBe(false);
		expect(isUgcShotFraming('')).toBe(false);
		expect(isUgcShotFraming(null)).toBe(false);
	});

	it('ogni campo ha una direzione scritta, o nel prompt arriverebbe un’etichetta nuda', () => {
		for (const f of UGC_SHOT_FRAMINGS) {
			expect(UGC_FRAMING_DIRECTION[f]?.length, f).toBeGreaterThan(20);
		}
	});
});

describe('formatSeedanceUgcBlocks — inquadrature', () => {
	it('su multi-scena ogni SHOT porta il proprio campo', () => {
		const out = formatSeedanceUgcBlocks({ brief: brief(MULTI, 4) });
		expect(out).toMatch(/SHOT 1 \(0-2s\) — /);
		expect(out).toMatch(/SHOT 2 \(2-4s\) — /);
		expect(out).toMatch(/Framing changes shot by shot/);
	});

	it('su ripresa unica NON tocca il campo, come non scrive "Hard cut"', () => {
		// Chiedere campi diversi a un video che non deve avere stacchi è invitarlo a tagliarsi.
		const out = formatSeedanceUgcBlocks({ brief: brief(SINGLE, 4) });
		expect(out).not.toMatch(/SHOT 1 \(0-2s\) — /);
		expect(out).not.toMatch(/Framing changes shot by shot/);
		expect(out).toMatch(/SHOT 1 \(0-2s\):/);
	});

	it('rispetta il campo scelto dal pianificatore quando c’è', () => {
		const out = formatSeedanceUgcBlocks({ brief: brief(MULTI, 2, ['insert', 'close']) });
		expect(out).toContain(UGC_FRAMING_DIRECTION.insert);
		expect(out).toContain(UGC_FRAMING_DIRECTION.close);
	});

	it('non lascia passare due campi uguali di fila, nemmeno se richiesti', () => {
		// La deduplica vale anche contro il pianificatore: il difetto è nel risultato, non
		// nell'intenzione di chi l'ha chiesto.
		const out = formatSeedanceUgcBlocks({ brief: brief(MULTI, 3, ['close', 'close', 'close']) });
		const shots = out.split('\n').filter((l) => /^SHOT \d+ \(/.test(l));
		expect(shots.length).toBe(3);
		for (let i = 1; i < shots.length; i++) {
			expect(shots[i].split(':')[0], `shot ${i + 1}`).not.toBe(shots[i - 1].split(':')[0]);
		}
	});

	it('un campo sconosciuto cade sul default invece di finire nel prompt', () => {
		const out = formatSeedanceUgcBlocks({ brief: brief(MULTI, 2, ['dolly-in', null]) });
		expect(out).not.toMatch(/dolly-in/);
		expect(out).toMatch(/SHOT 1 \(0-2s\) — /);
	});
});

describe('le premesse della suite', () => {
	it('i due formati usati esistono e sono davvero uno multi-scena e uno no', () => {
		expect(formatIsMultiScene(MULTI)).toBe(true);
		expect(formatIsMultiScene(SINGLE)).toBe(false);
		// Un id inventato non deve poter fingere di essere una ripresa unica.
		expect(ugcFormatById(MULTI)).toBeTruthy();
		expect(ugcFormatById(SINGLE)).toBeTruthy();
	});
});
