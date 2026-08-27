import type { El } from './graphic-tree';
import { parsePx } from './graphic-source';

/**
 * IL GATE DELLE GRAFICHE: leggere la tela come la vede il feed, non come la vede il canvas.
 *
 * Una grafica si compone a 1080px e si guarda a ~390. È l'unico fatto che il modello che scrive
 * l'HTML non ha mai davanti, e produce sempre lo stesso difetto: una didascalia a 18px, cioè
 * 6 punti sul telefono di chi scrolla — presente nel sorgente, invisibile nel prodotto.
 *
 * Questo file NON è un motore CSS: cammina l'ALBERO CHE RENDERIZZA DAVVERO (`htmlToSatori`, lo
 * stesso che satori riceve), quindi legge gli stili già risolti — classi, inline, cascata. Un
 * controllo che rifacesse il parsing per conto suo mentirebbe: boccerebbe pixel che non esistono.
 *
 * UNA SOLA REGOLA HA I DENTI. `text_below_feed_floor` blocca la scrittura, perché il px è
 * letterale nel sorgente e la correzione è sempre possibile (alza il numero). Contrasto, gerarchia
 * e palette tornano come AVVISI: dietro il testo può esserci una foto o uno scrim assoluto che
 * nessun controllo statico vede, e un rifiuto su un falso positivo manda l'agente in loop su un
 * difetto che non c'è. Meglio un avviso che il modello legge che un muro che non sa scavalcare.
 */

/** Sotto questa frazione della larghezza tela il testo è illeggibile nel feed. 1080 → 23.8px. */
export const MIN_TEXT_RATIO = 0.022;
/** Sopra questa frazione il testo è "large" per WCAG: gli basta 3:1. 1080 → 54px. */
const LARGE_TEXT_RATIO = 0.05;
/** Passo minimo fra il testo più grande e il secondo: sotto, la gerarchia è piatta. */
export const MIN_HIERARCHY_STEP = 1.5;
/** Colori non neutri distinti tollerati su una tela. */
const MAX_ACCENTS = 3;
/** Distanza RGB entro cui un colore "è" un colore del brand. */
const BRAND_COLOR_TOLERANCE = 60;
/**
 * Margine minimo della tela, in frazione di larghezza. La tela di partenza del prodotto
 * (`defaultGraphicHtml`) sta al 7%; sotto il 3% il testo è appiccicato al bordo e il crop del feed
 * se lo mangia. Si guarda SOLO il padding dichiarato sulla radice: un margine ottenuto da un
 * figlio, da un flex centrato o da un box interno esiste e questo controllo non lo vede, quindi
 * quando la radice non dichiara niente non si dice niente.
 */
export const MIN_SAFE_PADDING_RATIO = 0.03;
/**
 * Caratteri per riga oltre cui una riga di corpo diventa un paragrafo. 45 è il numero della skill
 * `graphic-feed-legibility` (§6), non una soglia tipografica generale: alle dimensioni di una
 * grafica da feed una riga più lunga di così va a capo e nessuno la legge scrollando.
 */
export const MAX_LINE_CHARS = 45;

export type GraphicIssue = {
	rule:
		| 'text_below_feed_floor'
		| 'off_canvas'
		| 'low_contrast'
		| 'hierarchy_flat'
		| 'off_palette'
		| 'too_many_colors'
		| 'outside_safe_area'
		| 'line_too_long'
		| 'logo_missing';
	/** true = la scrittura viene rifiutata. false = torna all'agente come avviso. */
	blocking: boolean;
	detail: string;
};

type Ctx = {
	fontSize: number | null;
	color: string | null;
	background: string | null;
};

type TextNode = { text: string; fontSize: number | null; color: string | null; background: string | null };

const style = (n: El): Record<string, unknown> => (n.props?.style ?? {}) as Record<string, unknown>;

function sizeOf(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
	if (typeof v === 'string') return parsePx(v);
	return null;
}

function collect(node: El | string, ctx: Ctx, out: TextNode[], flags: { photo: boolean }): void {
	if (typeof node === 'string') {
		if (node.trim()) out.push({ text: node.trim(), ...ctx });
		return;
	}
	if (!node || typeof node !== 'object') return;
	const s = style(node);
	if (node.type === 'img' || s.backgroundImage) flags.photo = true;

	const next: Ctx = {
		fontSize: sizeOf(s.fontSize) ?? ctx.fontSize,
		color: typeof s.color === 'string' ? s.color : ctx.color,
		background: typeof s.backgroundColor === 'string' ? s.backgroundColor : ctx.background
	};

	const kids = node.props?.children;
	if (kids == null) return;
	for (const child of Array.isArray(kids) ? kids : [kids]) collect(child as El | string, next, out, flags);
}

/** Come `sizeOf`, ma tiene lo zero e i negativi: un `left: -40` è un valore, non un'assenza. */
function numOf(v: unknown): number | null {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v !== 'string') return null;
	const m = /^-?[\d.]+/.exec(v.trim());
	if (!m) return null;
	const n = Number(m[0]);
	return Number.isFinite(n) ? n : null;
}

function textOf(node: El | string): string {
	if (typeof node === 'string') return node.trim();
	if (!node || typeof node !== 'object') return '';
	const kids = node.props?.children;
	if (kids == null) return '';
	return (Array.isArray(kids) ? kids : [kids]).map((k) => textOf(k as El | string)).join(' ').trim();
}

/**
 * Testo posizionato FUORI dalla tela.
 *
 * `htmlToSatori` forza `overflow:hidden` sulla radice, quindi niente déborda davvero: viene
 * tagliato. Un blocco assoluto interamente oltre il bordo non è un'esondazione, è testo che nel
 * PNG non c'è — presente nel sorgente, assente nel prodotto, esattamente come il testo troppo
 * piccolo. Per questo blocca: i numeri sono letterali nel sorgente e la correzione è ovvia.
 *
 * Solo `position:absolute` con coordinate esplicite: per tutto il resto la posizione la decide il
 * flex e nessun controllo statico può saperla senza mentire.
 */
function offCanvasIssues(node: El | string, width: number, height: number, out: GraphicIssue[]): void {
	if (typeof node !== 'object' || !node) return;
	const s = style(node);
	if (s.position === 'absolute') {
		const left = numOf(s.left);
		const top = numOf(s.top);
		const w = sizeOf(s.width);
		const h = sizeOf(s.height);
		const past =
			(left != null && left >= width && 'left') ||
			(top != null && top >= height && 'top') ||
			(left != null && w != null && left + w <= 0 && 'left') ||
			(top != null && h != null && top + h <= 0 && 'top');
		const text = past ? textOf(node) : '';
		if (past && text) {
			out.push({
				rule: 'off_canvas',
				blocking: true,
				detail: `"${text.slice(0, 40)}" is positioned ${past}:${past === 'left' ? left : top}px on a ${width}×${height} canvas — entirely outside it, so it is clipped away and never appears in the image.`
			});
		}
	}
	const kids = node.props?.children;
	if (kids == null) return;
	for (const child of Array.isArray(kids) ? kids : [kids]) offCanvasIssues(child as El | string, width, height, out);
}

/** Il padding dichiarato sulla radice, il più piccolo dei quattro lati che compaiono. */
function rootPadding(s: Record<string, unknown>): number | null {
	const sides = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']
		.map((k) => numOf(s[k]))
		.filter((n): n is number => n != null);
	const shorthand = numOf(s.padding);
	if (shorthand != null) sides.push(shorthand);
	return sides.length ? Math.min(...sides) : null;
}

/**
 * Il logo c'è?
 *
 * Si legge il SORGENTE e non l'albero, ed è deliberato: al momento del render ogni URL remoto è
 * già stato sostituito da un data URI, quindi nell'albero il logo non è più riconoscibile. Il
 * sorgente durevole invece porta ancora l'URL esatto del brand kit. Avviso e non rifiuto: una
 * grafica può legittimamente non portare il marchio (una slide interna di un carosello).
 */
export function logoIssue(source: string, logoUrl: string | null | undefined): GraphicIssue | null {
	const url = logoUrl?.trim();
	if (!url || !source) return null;
	if (source.includes(url)) return null;
	return {
		rule: 'logo_missing',
		blocking: false,
		detail: `The brand logo is in AVAILABLE IMAGES but no <img> on this canvas uses it. Place it (size sm/md, fit contain) instead of typing the brand name or drawing a generic icon.`
	};
}

const NAMED: Record<string, [number, number, number]> = {
	white: [255, 255, 255],
	black: [0, 0, 0]
};

export function parseColor(raw: string | null | undefined): [number, number, number] | null {
	if (!raw) return null;
	const v = raw.trim().toLowerCase();
	if (NAMED[v]) return NAMED[v];
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
	if (hex) {
		const h = hex[1]!;
		const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
		return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
	}
	const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
	if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
	return null;
}

const channel = (c: number) => {
	const s = c / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative-luminance contrast, 1..21. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
	const lum = ([r, g, bl]: [number, number, number]) =>
		0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
	const la = lum(a);
	const lb = lum(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Grigi, bianco e nero non contano come colore: sono la carta, non la tinta. */
function isNeutral([r, g, b]: [number, number, number]): boolean {
	return Math.max(r, g, b) - Math.min(r, g, b) < 26;
}

function distance(a: [number, number, number], b: [number, number, number]): number {
	return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/**
 * Guarda l'albero che satori riceve e dice cosa non regge nel feed.
 * `width` è la larghezza della tela: ogni soglia è una frazione di quella, non un px assoluto.
 */
export function inspectGraphicTree(
	tree: El,
	opts: { width: number; height?: number; brandColors?: readonly string[] | null }
): GraphicIssue[] {
	const width = opts.width > 0 ? opts.width : 1080;
	const height = opts.height && opts.height > 0 ? opts.height : Math.round(width * 1.25);
	const root = style(tree);
	const texts: TextNode[] = [];
	const flags = { photo: false };
	collect(tree, {
		fontSize: sizeOf(root.fontSize),
		color: typeof root.color === 'string' ? root.color : null,
		background: typeof root.backgroundColor === 'string' ? root.backgroundColor : null
	}, texts, flags);

	const issues: GraphicIssue[] = [];
	const floor = Math.round(width * MIN_TEXT_RATIO);

	for (const t of texts) {
		if (t.fontSize == null || t.fontSize >= floor) continue;
		issues.push({
			rule: 'text_below_feed_floor',
			blocking: true,
			detail: `"${t.text.slice(0, 40)}" is ${Math.round(t.fontSize)}px on a ${width}px canvas — under the ${floor}px feed floor (${Math.round(MIN_TEXT_RATIO * 1000) / 10}% of width). Raise it.`
		});
	}

	// Testo fuori tela: stessa disciplina del feed floor — numero letterale, correzione ovvia.
	offCanvasIssues(tree, width, height, issues);

	// Margine di sicurezza: solo il padding DICHIARATO sulla radice, e solo quando c'è.
	const pad = rootPadding(root);
	const minPad = Math.round(width * MIN_SAFE_PADDING_RATIO);
	if (pad != null && pad < minPad) {
		issues.push({
			rule: 'outside_safe_area',
			blocking: false,
			detail: `The canvas padding is ${Math.round(pad)}px on a ${width}px canvas — under the ${minPad}px safe area (${Math.round(MIN_SAFE_PADDING_RATIO * 100)}% of width). The product's starter canvas uses ${Math.round(width * 0.07)}px (7%).`
		});
	}

	// Misura di riga: una riga di corpo oltre i 45 caratteri va a capo e diventa un paragrafo.
	for (const t of texts) {
		if (t.fontSize != null && t.fontSize >= width * LARGE_TEXT_RATIO) continue;
		if (t.text.length <= MAX_LINE_CHARS) continue;
		issues.push({
			rule: 'line_too_long',
			blocking: false,
			detail: `"${t.text.slice(0, 40)}…" is ${t.text.length} characters on one line — past the ${MAX_LINE_CHARS}-character measure. Fewer words at a bigger size, or break the line where the break carries meaning.`
		});
	}

	// Gerarchia: i due gradi più grandi devono staccarsi. Una tela con un solo testo non ha
	// gerarchia da sbagliare — la regola parte da tre.
	const sizes = [...new Set(texts.map((t) => t.fontSize).filter((s): s is number => s != null))].sort(
		(a, b) => b - a
	);
	if (texts.length >= 3 && sizes.length >= 2 && sizes[0]! / sizes[1]! < MIN_HIERARCHY_STEP) {
		issues.push({
			rule: 'hierarchy_flat',
			blocking: false,
			detail: `Largest type is ${Math.round(sizes[0]!)}px and the next is ${Math.round(sizes[1]!)}px — a ${(sizes[0]! / sizes[1]!).toFixed(2)}× step. Under ${MIN_HIERARCHY_STEP}× nothing reads as the headline.`
		});
	}

	// Contrasto: solo su tele senza foto né gradienti. Dietro un'immagine (o uno scrim assoluto)
	// il colore di fondo dichiarato non è quello che l'occhio vede, e un rifiuto sarebbe cieco.
	if (!flags.photo) {
		for (const t of texts) {
			const fg = parseColor(t.color);
			const bg = parseColor(t.background);
			if (!fg || !bg || t.fontSize == null) continue;
			const ratio = contrastRatio(fg, bg);
			const min = t.fontSize >= width * LARGE_TEXT_RATIO ? 3 : 4.5;
			if (ratio + 0.005 < min) {
				issues.push({
					rule: 'low_contrast',
					blocking: false,
					detail: `"${t.text.slice(0, 40)}" is ${t.color} on ${t.background} — ${ratio.toFixed(2)}:1, under the ${min}:1 this size needs.`
				});
			}
		}
	}

	// Palette: quante tinte, e sono del brand? I neutri non contano.
	const declared: string[] = [];
	const walkColors = (n: El | string) => {
		if (typeof n !== 'object' || !n) return;
		const s = style(n);
		for (const key of ['color', 'backgroundColor', 'borderColor']) {
			const v = s[key];
			if (typeof v === 'string') declared.push(v);
		}
		const kids = n.props?.children;
		if (kids == null) return;
		for (const child of Array.isArray(kids) ? kids : [kids]) walkColors(child as El | string);
	};
	walkColors(tree);

	const accents = new Map<string, [number, number, number]>();
	for (const raw of declared) {
		const rgb = parseColor(raw);
		if (!rgb || isNeutral(rgb)) continue;
		accents.set(rgb.join(','), rgb);
	}
	if (accents.size > MAX_ACCENTS) {
		issues.push({
			rule: 'too_many_colors',
			blocking: false,
			detail: `${accents.size} different non-neutral colours on one canvas. Keep to ${MAX_ACCENTS} plus neutrals.`
		});
	}
	const brand = (opts.brandColors ?? [])
		.map((c) => parseColor(c))
		.filter((c): c is [number, number, number] => !!c && !isNeutral(c));
	if (brand.length) {
		for (const [key, rgb] of accents) {
			if (brand.some((b) => distance(b, rgb) <= BRAND_COLOR_TOLERANCE)) continue;
			issues.push({
				rule: 'off_palette',
				blocking: false,
				detail: `rgb(${key}) is not in the brand palette (${opts.brandColors!.join(', ')}). Use a brand colour or a neutral.`
			});
		}
	}

	return issues;
}
