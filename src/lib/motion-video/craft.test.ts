import { describe, expect, it } from 'vitest';
import { MOTION_CRAFT_SPECS, MOTION_FALLBACK_SANS } from './craft';
import { MOTION_EXPO_IN_OUT, MOTION_OVERSHOOT_OUT, findLinearMotion } from './easing';
import { defaultMotionSource } from './source';
import { compileMotionSource } from './compile';

describe('MOTION_CRAFT_SPECS', () => {
	it('covers type, transitions, easing, overlap, UI mockups, and Nano Banana', () => {
		expect(MOTION_FALLBACK_SANS).toBe('Inter');
		expect(MOTION_CRAFT_SPECS).toContain('Typography');
		expect(MOTION_CRAFT_SPECS).toContain(MOTION_FALLBACK_SANS);
		expect(MOTION_CRAFT_SPECS).toMatch(/slide/i);
		expect(MOTION_CRAFT_SPECS).toMatch(/iris|mask/i);
		expect(MOTION_CRAFT_SPECS).toMatch(/expo in-out/i);
		expect(MOTION_CRAFT_SPECS).toMatch(/overshoot|micro-settles/i);
		expect(MOTION_CRAFT_SPECS).toMatch(/through the cut|end of the scene/i);
		expect(MOTION_CRAFT_SPECS).toMatch(/programmatic UI mockups/i);
		expect(MOTION_CRAFT_SPECS).toMatch(/Nano Banana Pro/);
		expect(MOTION_CRAFT_SPECS).toContain('<Img src=');
	});

	it('non fissa il numero di beat: l’arco sono i mestieri, il conto lo decide chi scrive', () => {
		// «5 beats è il pattern stabilito» era una regola letta dall’elenco dei cinque mestieri:
		// l’agente ci si ancorava anche su un 8s e su un 45s.
		expect(MOTION_CRAFT_SPECS).toMatch(/JOBS, not a fixed count/);
		expect(MOTION_CRAFT_SPECS).toMatch(/never from a template/);
		expect(MOTION_CRAFT_SPECS).not.toMatch(/Not five statements/);
	});

	it('mandates expo in-out and names the trap that actually ships linear motion', () => {
		// La regola "mai linear" c'era già e non bastava: il modo comune di scrivere movimento
		// lineare è OMETTERE l'easing, che in Remotion è lineare per default.
		expect(MOTION_CRAFT_SPECS).toContain(MOTION_EXPO_IN_OUT);
		expect(MOTION_CRAFT_SPECS).toContain(MOTION_OVERSHOOT_OUT);
		expect(MOTION_CRAFT_SPECS).toMatch(/NO .easing. field IS linear/i);
		expect(MOTION_CRAFT_SPECS).toMatch(/never Easing\.linear/i);
		// L'overshoot resta, ma come ruolo distinto: atterraggio, non percorrenza.
		expect(MOTION_CRAFT_SPECS).toMatch(/different job|Travel = expo in-out/i);
	});

	it('rules on shape, because the seed used to teach the wrong one', () => {
		// A CTA at borderRadius: 999 reads as a lozenge, and the model copied it from the seed.
		expect(MOTION_CRAFT_SPECS).toMatch(/never 999/i);
		expect(MOTION_CRAFT_SPECS).toMatch(/10.14 on buttons/i);
		expect(MOTION_CRAFT_SPECS).toMatch(/percentage radius only when width === height/i);
		expect(MOTION_CRAFT_SPECS).toMatch(/ellipse/i);
	});
});

describe('the seed practises what the specs preach', () => {
	const source = defaultMotionSource({ brandName: 'Acme', displayFont: 'Satoshi' });

	it('gives its CTA a fixed radius, not a full pill', () => {
		const cta = source.slice(source.indexOf("padding: '14px 28px'"));
		expect(cta.slice(0, 400)).toMatch(/borderRadius: 1[0-4],/);
	});

	it('leaves no 999 radius anywhere for the model to copy', () => {
		expect(source).not.toMatch(/borderRadius:\s*9{3,}/);
	});

	it('uses percentage radii only where the box is square', () => {
		for (const m of source.matchAll(/borderRadius:\s*'(\d+)%'/g)) {
			const around = source.slice(Math.max(0, m.index - 200), m.index);
			const w = /width:\s*(\d+)/.exec(around)?.[1];
			const h = /height:\s*(\d+)/.exec(around)?.[1];
			if (w && h) expect(w, 'percentage radius on a non-square box').toBe(h);
		}
	});
});

describe('the seed moves on expo in-out, never linear', () => {
	const source = defaultMotionSource({ brandName: 'Acme', displayFont: 'Satoshi' });

	it('carries no linear motion for the model to copy', () => {
		// Il seed è la prima cosa che il modello legge: il 999 del borderRadius si è propagato
		// esattamente così. Un interpolate senza easing qui insegnerebbe la stessa cosa.
		expect(findLinearMotion(source)).toEqual([]);
	});

	it('uses expo in-out to travel and the overshoot only to land', () => {
		expect(source).toContain(`const ease = ${MOTION_EXPO_IN_OUT}`);
		expect(source).toContain(`const settle = ${MOTION_OVERSHOOT_OUT}`);
	});
});

describe('defaultMotionSource craft', () => {
	it('uses extreme easing, overlapping slides, an iris, and a UI mockup', () => {
		const source = defaultMotionSource({ brandName: 'Acme', displayFont: 'Satoshi' });
		expect(source).toContain('Easing.bezier');
		expect(source).toContain('clipPath');
		expect(source).toContain('translateX');
		expect(source).toContain('Post');
		expect(source).toContain('Graph');
		expect(compileMotionSource(source).durationInFrames).toBe(180);
	});
});

/**
 * I mockup UI: la parte delle specs che decide se un video è una demo di prodotto o una slide.
 * Le tre regole si tengono insieme — tagliato, fedele, che fa qualcosa — e servono tutte e tre:
 * un mockup tagliato ma inventato è finto lo stesso, uno fedele ma fermo è uno screenshot.
 */
describe('mockup UI nelle craft specs', () => {
	it('chiede desktop, e dice perché non il telefono', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/DESKTOP FIRST/);
		expect(MOTION_CRAFT_SPECS).toMatch(/phone frame reads as generic/i);
	});

	it('impone il taglio su almeno un lato, non come gusto ma come lettura', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/CROP IT/);
		expect(MOTION_CRAFT_SPECS).toMatch(/past at least one edge/i);
		// La ragione deve restare nel testo: senza, la regola si legge come una preferenza e il
		// primo che la trova scomoda la salta.
		expect(MOTION_CRAFT_SPECS).toMatch(/PICTURE OF an app/);
	});

	it('preferisce ricostruire il vero, e nomina i tool per guardarlo', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/REBUILD THE REAL ONE, IN CODE/);
		for (const tool of ['capture_website', 'harvest_product_ui', 'search_web']) {
			expect(MOTION_CRAFT_SPECS, tool).toContain(tool);
		}
		// Lo screenshot resta un ripiego, e il ripiego ha una forma precisa: da solo, a pieno
		// campo, senza chrome inventato attorno. Detto così non diventa la scorciatoia.
		expect(MOTION_CRAFT_SPECS).toMatch(/show the screenshot ALONE/);
	});

	it('pretende un’azione E il suo risultato', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/SHOW AN ACTION, NOT A STILL/);
		for (const verb of ['cursor', 'tap', 'typed into a field']) {
			expect(MOTION_CRAFT_SPECS, verb).toContain(verb);
		}
		// Un click senza conseguenza non dimostra niente: è la metà che la gente ricorda.
		expect(MOTION_CRAFT_SPECS).toMatch(/click with no consequence demonstrates nothing/);
	});
});

/**
 * L'audio è acceso di default, e le due regole che lo rendono usabile: una registrazione sola, e
 * un beat mai più corto della sua battuta.
 */
describe('audio nelle craft specs', () => {
	it('è di default, con l’opt-out esplicito', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/VOICE AND MUSIC ARE ON BY DEFAULT/);
		expect(MOTION_CRAFT_SPECS).toMatch(/Do not ask whether to add them/);
		// Il "no" dell'utente resta la cosa che si onora senza discutere.
		expect(MOTION_CRAFT_SPECS).toMatch(/build it silent/);
	});

	it('vieta la generazione per beat, e dice perché', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/Never one call per beat/);
		expect(MOTION_CRAFT_SPECS).toMatch(/six beats become six people/);
	});

	it('separa le parole dette da quelle scritte', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/words in the ear are NOT the words on screen/);
	});

	it('impone che il beat si dimensioni sull’audio, non viceversa', () => {
		// È la regola che evita la battuta tagliata a metà parola.
		expect(MOTION_CRAFT_SPECS).toMatch(/AT LEAST AS LONG AS ITS CLIP/);
	});

	it('un url audio inventato è peggio del silenzio', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/Never invent an audio URL/);
	});
});

describe('consegna nelle craft specs', () => {
	it('dice che senza render è solo codice', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/NOT A VIDEO UNTIL IT IS RENDERED/);
		expect(MOTION_CRAFT_SPECS).toContain('render_motion_video');
	});

	it('separa il render di controllo da quello finale', () => {
		// Confonderli costa una VM a ogni verifica: gli still sono per mentre si lavora.
		expect(MOTION_CRAFT_SPECS).toMatch(/render_stills is what you use WHILE working/);
		expect(MOTION_CRAFT_SPECS).toMatch(/Render ONCE, at the end/);
	});

	it('lega il render all’audio, che è il motivo per cui non può farlo il browser', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/only path that carries sound/);
	});
});

describe('mockup UI — il materiale vero prima del disegno', () => {
	it('dà un ordine di ricerca, non un elenco di tool', () => {
		// "Guarda il vero" senza dire DOVE si traduce in "il modello inventa": l'ordine conta,
		// e la libreria del brand viene prima di tutto perché è gratis e spesso c'è già.
		const p = MOTION_CRAFT_SPECS;
		expect(p).toMatch(/BEFORE WRITING A SINGLE LINE OF MOCKUP/);
		expect(p.indexOf('read_media')).toBeLessThan(p.indexOf('harvest_product_ui'));
		expect(p.indexOf('harvest_product_ui')).toBeLessThan(p.indexOf('search_web'));
	});

	it('nomina il demo account, che è il materiale migliore che esista', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/Product demo account/);
		expect(MOTION_CRAFT_SPECS).toMatch(/REAL authenticated app screens/);
	});

	it('vieta lo screenshot dentro una UI disegnata', () => {
		// È il difetto visto dal vivo: due prodotti diversi nella stessa inquadratura.
		expect(MOTION_CRAFT_SPECS).toMatch(/NEVER PASTE A UI SCREENSHOT INSIDE A UI YOU DREW/);
		expect(MOTION_CRAFT_SPECS).toMatch(/worst of both/);
	});

	it('dice cosa ci va invece, dentro una UI di codice', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/Never another interface/);
	});

	// ── Le due regressioni del 2026-08-21, e la guardia perché non tornino ────────────────────
	//
	// Il 21 agosto la riga sulle molle è stata tolta dalle specifiche e sostituita da una regola
	// solo-bezier. Misurato sui punteggi: `spring(` per video passa da 11-12 a ZERO nello stesso
	// giorno, e il voto da 8.2 a 3.5. Il meccanismo è la composizione difensiva — il `finish`
	// rifiuta ogni `interpolate` senza `easing`, e la via più economica per non farsi bocciare è
	// mettere un easing su tutto e non usare mai una molla, che un campo `easing` non ce l'ha.
	// Senza molle non c'è overshoot, senza overshoot niente si assesta: tutto si ferma contro un
	// muro. Questo test è il motivo per cui non può succedere di nuovo in silenzio.
	it('insegna le molle, e dice che il controllo sul lineare non le riguarda', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/spring\(\)/);
		expect(MOTION_CRAFT_SPECS).toMatch(/damping/);
		expect(MOTION_CRAFT_SPECS).toMatch(/IS NOT LINEAR MOTION/);
	});

	// Stesso giorno, secondo difetto: le specifiche insegnavano a importare `slide` e `fade` dalla
	// radice di '@remotion/transitions'. Compila e MUORE AL RENDER
	// (`(0, esm_namespaceObject.slide) is not a function`, nei log del 22/08). Dopo due crash
	// l'agente ha tolto TUTTE le transizioni per far passare il render: un prompt che insegna
	// codice rotto non produce un errore, produce un video più povero.
	it('insegna i sottomoduli veri delle transizioni, non la radice del pacchetto', () => {
		expect(MOTION_CRAFT_SPECS).toMatch(/@remotion\/transitions\/slide/);
		expect(MOTION_CRAFT_SPECS).toMatch(/@remotion\/transitions\/fade/);
		expect(MOTION_CRAFT_SPECS).toMatch(/render-killer/);
	});
});
