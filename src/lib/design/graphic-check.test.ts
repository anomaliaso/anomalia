import { describe, expect, it } from 'vitest';
import { htmlToSatori } from './html-to-satori';
import { defaultGraphicHtml } from './graphic-source';
import { GRAPHIC_CRAFT_SPECS } from './graphic-craft';
import {
	MAX_LINE_CHARS,
	MIN_HIERARCHY_STEP,
	MIN_SAFE_PADDING_RATIO,
	MIN_TEXT_RATIO,
	contrastRatio,
	inspectGraphicTree,
	logoIssue,
	parseColor
} from './graphic-check';

/**
 * IL GATE DELLE GRAFICHE, TESTATO PER CONTO SUO.
 *
 * Prima queste regole erano coperte solo di riflesso, da `default-skills.test.ts`, che le guarda
 * come illustrazione delle skill. Il gate però è un pezzo di prodotto: è la cosa che rifiuta una
 * scrittura, e una regola senza un test che la verifica è una regola che vale finché nessuno la
 * tocca per sbaglio.
 *
 * Ogni test passa da `htmlToSatori`, cioè DALLO STESSO parser che alimenta il renderer. Un test
 * che si costruisse l'albero a mano proverebbe una cosa che in produzione non succede mai.
 */

const canvas = (body: string, rootStyle = '') =>
	htmlToSatori(
		`<div class="canvas" data-graphic data-width="1080" data-height="1350" style="display:flex;flex-direction:column;background-color:#ffffff;${rootStyle}">${body}</div>`
	);

const inspect = (body: string, rootStyle = '', brandColors?: string[]) => {
	const { tree, width, height } = canvas(body, rootStyle);
	return inspectGraphicTree(tree, { width, height, brandColors });
};

const rules = (body: string, rootStyle = '') => inspect(body, rootStyle).map((i) => i.rule);

describe('parseColor / contrastRatio', () => {
	it('reads the three notations a model actually writes', () => {
		expect(parseColor('#fff')).toEqual([255, 255, 255]);
		expect(parseColor('#1d1d1f')).toEqual([29, 29, 31]);
		expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0]);
		expect(parseColor('white')).toEqual([255, 255, 255]);
		expect(parseColor('var(--ink)')).toBeNull();
	});

	it('black on white is the WCAG 21:1 ceiling', () => {
		expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
	});
});

describe('text_below_feed_floor — the one rule with teeth', () => {
	it('blocks a caption that would be six points on a phone', () => {
		const issue = inspect(
			'<div style="display:flex;font-size:18px;color:#111111">Iscriviti alla newsletter</div>'
		).find((i) => i.rule === 'text_below_feed_floor');
		expect(issue?.blocking).toBe(true);
		expect(issue?.detail).toContain('18px');
		expect(issue?.detail).toContain(`${Math.round(1080 * MIN_TEXT_RATIO)}px`);
	});

	it('leaves text exactly on the floor alone', () => {
		const floor = Math.round(1080 * MIN_TEXT_RATIO);
		expect(rules(`<div style="display:flex;font-size:${floor}px;color:#111111">Ok</div>`)).not.toContain(
			'text_below_feed_floor'
		);
	});

	it('scales with the canvas instead of hard-coding px', () => {
		// Stessa dichiarazione, tela più stretta: 24px su 600 è sopra la soglia, su 1080 no.
		const narrow = htmlToSatori(
			'<div class="canvas" data-graphic data-width="600" data-height="750" style="display:flex;background-color:#fff"><div style="display:flex;font-size:20px;color:#111">Nota</div></div>'
		);
		expect(
			inspectGraphicTree(narrow.tree, { width: narrow.width, height: narrow.height }).map((i) => i.rule)
		).not.toContain('text_below_feed_floor');
	});
});

describe('off_canvas — testo che nel PNG non c’è', () => {
	it('blocks absolutely-positioned type parked past the right edge', () => {
		const issue = inspect(
			'<div style="display:flex;position:absolute;left:1200px;top:40px;font-size:64px;color:#111">Fuori</div>'
		).find((i) => i.rule === 'off_canvas');
		expect(issue?.blocking).toBe(true);
		expect(issue?.detail).toContain('1200');
	});

	it('blocks type parked below the bottom edge', () => {
		expect(
			rules('<div style="display:flex;position:absolute;top:1400px;font-size:64px;color:#111">Giù</div>')
		).toContain('off_canvas');
	});

	it('says nothing about an off-canvas box with no words in it', () => {
		// Una forma decorativa che esce dal bordo è una scelta, non un difetto: si vede il pezzo
		// che resta dentro. È il TESTO che, tagliato via, sparisce e basta.
		expect(
			rules('<div style="display:flex;position:absolute;left:1400px;width:300px;height:300px;background-color:#c485fe"></div>')
		).not.toContain('off_canvas');
	});

	it('says nothing about a deliberate bleed that still overlaps the canvas', () => {
		expect(
			rules('<div style="display:flex;position:absolute;left:-40px;top:80px;width:1200px;font-size:90px;color:#111">Bleed</div>')
		).not.toContain('off_canvas');
	});

	it('says nothing when the position is left to flexbox', () => {
		// Senza position:absolute la posizione la decide il layout, e nessun controllo statico può
		// saperla. Tacere è l'unico comportamento onesto.
		expect(
			rules('<div style="display:flex;margin-left:2000px;font-size:64px;color:#111">Flex</div>')
		).not.toContain('off_canvas');
	});
});

describe('outside_safe_area — il margine della tela', () => {
	it('warns on a root padding written in web pixels', () => {
		const issue = inspect('<div style="display:flex;font-size:64px;color:#111">Titolo</div>', 'padding:24px;').find(
			(i) => i.rule === 'outside_safe_area'
		);
		expect(issue?.blocking).toBe(false);
		expect(issue?.detail).toContain(`${Math.round(1080 * MIN_SAFE_PADDING_RATIO)}px`);
	});

	it('is happy with the 7% the starter canvas uses', () => {
		expect(
			rules('<div style="display:flex;font-size:64px;color:#111">Titolo</div>', 'padding:76px;')
		).not.toContain('outside_safe_area');
	});

	it('stays silent when the root declares no padding at all', () => {
		// Il margine può venire da un figlio, da un box interno o da un flex centrato: cose che
		// questo controllo non vede. Inventare un difetto sarebbe peggio che non vederlo.
		expect(
			rules('<div style="display:flex;font-size:64px;color:#111">Titolo</div>')
		).not.toContain('outside_safe_area');
	});
});

describe('line_too_long — la misura di riga', () => {
	it('warns on a body line that wraps into a paragraph', () => {
		const long = 'a'.repeat(MAX_LINE_CHARS + 10);
		const issue = inspect(`<div style="display:flex;font-size:32px;color:#111">${long}</div>`).find(
			(i) => i.rule === 'line_too_long'
		);
		expect(issue?.blocking).toBe(false);
		expect(issue?.detail).toContain(String(MAX_LINE_CHARS + 10));
	});

	it('leaves a long HEADLINE alone — at that size the measure is a different number', () => {
		const long = 'a'.repeat(MAX_LINE_CHARS + 10);
		expect(rules(`<div style="display:flex;font-size:90px;color:#111">${long}</div>`)).not.toContain(
			'line_too_long'
		);
	});
});

describe('hierarchy / contrast / palette', () => {
	it('three sizes within a whisker of each other warn, never block', () => {
		const issue = inspect(
			['64px', '56px', '52px']
				.map((fs) => `<div style="display:flex;font-size:${fs};color:#111111">Riga</div>`)
				.join('')
		).find((i) => i.rule === 'hierarchy_flat');
		expect(issue?.blocking).toBe(false);
		expect(issue?.detail).toContain(`${MIN_HIERARCHY_STEP}×`);
	});

	it('a single text has no hierarchy to get wrong', () => {
		expect(rules('<div style="display:flex;font-size:64px;color:#111">Solo</div>')).not.toContain(
			'hierarchy_flat'
		);
	});

	it('skips contrast entirely when a photo sits behind the type', () => {
		expect(
			rules(
				'<img src="https://x/p.jpg" style="position:absolute;width:1080px;height:1350px" /><div style="display:flex;font-size:40px;color:#f2f2f2;background-color:#ffffff">Sopra la foto</div>'
			)
		).not.toContain('low_contrast');
	});

	it('reports an invented colour and never blocks it', () => {
		const issue = inspect(
			'<div style="display:flex;font-size:80px;color:#111111;background-color:#ff0000">Offerta</div>',
			'',
			['#c485fe']
		).find((i) => i.rule === 'off_palette');
		expect(issue?.blocking).toBe(false);
		expect(issue?.detail).toContain('#c485fe');
	});

	it('counts a fourth non-neutral colour as an accumulation', () => {
		const issue = inspect(
			['#ff0000', '#00ff00', '#0000ff', '#ffcc00']
				.map((c) => `<div style="display:flex;font-size:60px;color:${c}">Riga</div>`)
				.join('')
		).find((i) => i.rule === 'too_many_colors');
		expect(issue?.blocking).toBe(false);
	});
});

describe('logo_missing — letto sul sorgente, non sull’albero', () => {
	const logo = 'https://cdn.example.com/brand/logo.svg';

	it('warns when the offered logo never appears in the source', () => {
		const issue = logoIssue('<div class="canvas"><h1>Acme</h1></div>', logo);
		expect(issue?.rule).toBe('logo_missing');
		expect(issue?.blocking).toBe(false);
	});

	it('says nothing when the logo is placed', () => {
		expect(logoIssue(`<div class="canvas"><img src="${logo}" /></div>`, logo)).toBeNull();
	});

	it('says nothing when no logo was offered', () => {
		expect(logoIssue('<div class="canvas"></div>', null)).toBeNull();
		expect(logoIssue('<div class="canvas"></div>', '  ')).toBeNull();
	});
});

describe('il gate non boccia il prodotto', () => {
	it('the starter canvas this product ships passes its own gate', () => {
		const { tree, width, height } = htmlToSatori(
			defaultGraphicHtml({ headline: 'A short headline', brandName: 'Acme', accent: '#c485fe' })
		);
		const issues = inspectGraphicTree(tree, { width, height, brandColors: ['#c485fe'] });
		expect(issues.filter((i) => i.blocking)).toEqual([]);
		// L'unico avviso noto: il kicker grigio Apple, 3.44:1 su carta chiara. Difetto vero del
		// template, non un falso positivo — quando verrà scurito, questa riga va tolta.
		expect(issues.map((i) => i.rule)).toEqual(['low_contrast']);
	});
});

/**
 * IL VINCOLO DI METODO: una regola tiene solo se vive in tre posti — il prompt, un esempio che
 * compila, e un controllo nel codice che rifiuta l'imitazione. Questo blocco tiene insieme il
 * primo e il terzo: se qualcuno cambia una soglia nel gate senza toccare il prompt che la insegna,
 * il modello riceverebbe un numero che il codice non applica più. È già successo altrove (il
 * ricettario delle transizioni del motion stava nel prompt e il modello lo ignorava).
 */
describe('GRAPHIC_CRAFT_SPECS parla degli stessi numeri che il gate applica', () => {
	it('carries the thresholds the code enforces', () => {
		expect(GRAPHIC_CRAFT_SPECS).toContain(`${Math.round(1080 * MIN_TEXT_RATIO)}px`);
		expect(GRAPHIC_CRAFT_SPECS).toContain(`${MIN_HIERARCHY_STEP}×`);
		expect(GRAPHIC_CRAFT_SPECS).toContain(`${Math.round(1080 * MIN_SAFE_PADDING_RATIO)}px`);
		expect(GRAPHIC_CRAFT_SPECS).toContain(`${MAX_LINE_CHARS} characters`);
	});

	it('says which rules refuse the write and which only warn', () => {
		expect(GRAPHIC_CRAFT_SPECS).toMatch(/ENFORCED — the write is REFUSED/);
		expect(GRAPHIC_CRAFT_SPECS).toMatch(/CHECKED — .*warning/);
	});

	it('recovers the two rules that were stranded in the dead block composer', () => {
		// Dove spezzare una headline, con l'esempio, e il velo 0.4–0.55 sopra una foto: erano le
		// uniche due regole tipografiche con un numero del repo, e vivevano nel ramo morto.
		expect(GRAPHIC_CRAFT_SPECS).toContain('Tu ne presidi uno.');
		expect(GRAPHIC_CRAFT_SPECS).toContain('0.4–0.55');
		expect(GRAPHIC_CRAFT_SPECS).toContain('0.65 alpha');
	});

	it('speaks in fractions of the canvas, never in bare pixels', () => {
		// Ogni px citato deve essere accompagnato dalla sua percentuale nella stessa riga: è la
		// disciplina che rende la regola valida su 1080×1350 come su 1080×1920.
		const bare = GRAPHIC_CRAFT_SPECS.split('\n').filter(
			(l) => /\d+px/.test(l) && !/%/.test(l) && !/alpha|:1/.test(l)
		);
		expect(bare).toEqual([]);
	});
});
