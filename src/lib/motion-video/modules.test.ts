import { describe, expect, it } from 'vitest';
import { VERSION } from 'remotion';
import {
	MOTION_ALLOWED_MODULES,
	MOTION_MODULE_NOTES,
	MOTION_REMOTION_VERSION,
	MOTION_RENDER_PACKAGES,
	isMotionAllowedModule,
	motionImportContract
} from './modules';

describe('la versione di Remotion è una sola', () => {
	it('la costante è la versione davvero installata', () => {
		// Il guasto che questo test previene è già successo una volta: con `^4.0.498` su tutti,
		// npm ha risolto `remotion` a 4.0.506 e i pacchetti nuovi a 4.0.498, e Remotion **lancia**
		// su disallineamento — il player moriva all'import, prima di qualsiasi video. Se questa
		// riga fallisce, il fix è allineare package.json e questa costante, non rilassare il test.
		expect(MOTION_REMOTION_VERSION).toBe(VERSION);
	});

	it('la VM di render installa quella stessa versione per ogni pacchetto Remotion', () => {
		for (const [name, version] of Object.entries(MOTION_RENDER_PACKAGES)) {
			if (name === 'remotion' || name.startsWith('@remotion/')) {
				expect(version, name).toBe(MOTION_REMOTION_VERSION);
			}
		}
	});
});

describe('allowlist e pacchetti restano d’accordo', () => {
	it('ogni specificatore ammesso ha un pacchetto che lo contiene', () => {
		// `@remotion/transitions/slide` non si installa: si installa `@remotion/transitions`.
		// Un import ammesso il cui pacchetto non finisce nella VM compila nel browser e fallisce
		// il render, che è il modo peggiore di divergere.
		for (const spec of MOTION_ALLOWED_MODULES) {
			const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
			expect(Object.keys(MOTION_RENDER_PACKAGES), spec).toContain(pkg);
		}
	});

	it('ogni specificatore ha la riga che il modello leggerà', () => {
		for (const spec of MOTION_ALLOWED_MODULES) {
			expect(MOTION_MODULE_NOTES[spec].length, spec).toBeGreaterThan(20);
		}
	});

	it('il contratto nel prompt elenca esattamente la allowlist', () => {
		const contract = motionImportContract();
		for (const spec of MOTION_ALLOWED_MODULES) expect(contract).toContain(`'${spec}'`);
	});
});

describe('isMotionAllowedModule', () => {
	it('accetta i sotto-export ammessi uno per uno, non il pacchetto in blocco', () => {
		expect(isMotionAllowedModule('@remotion/transitions/slide')).toBe(true);
		// Le transizioni "da effetto" restano fuori: ammettere il pacchetto non ammette i suoi rami.
		expect(isMotionAllowedModule('@remotion/transitions/film-burn')).toBe(false);
		expect(isMotionAllowedModule('@remotion/transitions/crosswarp')).toBe(false);
	});

	it('non si fa ingannare dalle proprietà di Object.prototype', () => {
		// `spec in notes` avrebbe detto true a questi. `hasOwnProperty` no.
		expect(isMotionAllowedModule('constructor')).toBe(false);
		expect(isMotionAllowedModule('toString')).toBe(false);
		expect(isMotionAllowedModule('__proto__')).toBe(false);
	});
});
